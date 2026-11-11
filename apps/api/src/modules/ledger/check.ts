import { decimalToMinor, isCustomer } from "@kebo/database";
import { fromMinor, type Minor } from "@kebo/money";
import { factoryPositionsSql, positionsSql } from "../money/due";
import type { MoneyCtx } from "../money/position";
import type { PrismaService, Tx } from "../../database/prisma.service";

type Db = PrismaService["db"] | Tx;

export interface LedgerDifference {
  /** order: what the customer still owes on it; factory: what we still owe a factory on an order (one currency);
   *  account: a money account's balance; staff: what we owe a person back; credit: a customer's credit; group: a posting
   *  whose debits and credits differ in the main currency. */
  kind: "order" | "factory" | "account" | "staff" | "credit" | "group";
  key: string;
  currency: string;
  /** As the ledger has it. */
  ledger: string;
  /** As today's figures have it (the order's money, the factory's to pay, the cash book, to repay, the credit). */
  expected: string;
}

export interface LedgerCheck {
  checked: { orders: number; factoryParts: number; accounts: number; staff: number; credits: number; groups: number };
  differences: LedgerDifference[];
}

const m = (v: unknown) => decimalToMinor((v ?? 0) as never);

/**
 * The ledger's balances against today's figures, worked out the usual way (positionsSql / factoryPositionsSql =
 * orderPosition / factoryPosition, the cash book's balance, "to repay", the customer's credit): every order's
 * balance with its customer (total + charged − settled), every factory part's (owed − paid − taken off), every
 * money account's balance, what we owe each person back, each customer's credit; and every posting balanced in
 * the main currency. Lists each difference.
 */
export async function ledgerCheck(db: Db, fx: MoneyCtx): Promise<LedgerCheck> {
  const differences: LedgerDifference[] = [];
  const compare = (kind: LedgerDifference["kind"], k: string, currency: string, ledger: Minor, expected: Minor) => {
    if (ledger !== expected) differences.push({ kind, key: k, currency, ledger: fromMinor(ledger), expected: fromMinor(expected) });
  };

  // Orders (not cancelled): the customer's balance on each, in the order's currency.
  const positions = await positionsSql(db, fx);
  const orderLedger = await db.$queryRaw<{ id: string; minor: string }[]>`
    select o.id, coalesce(sum(l.debit - l.credit), 0)::text as minor
      from orders o left join ledger_entries l on l.order_id = o.id and l.account = 'customer:' || o.customer_id::text and l.currency = o.currency
     where o.status <> 'cancelled'
     group by o.id`;
  const orderRefs = new Map((await db.order.findMany({ select: { id: true, refNo: true, currency: true } })).map((o) => [o.id, o]));
  const byOrder = new Map(orderLedger.map((r) => [r.id, m(r.minor)]));
  for (const p of positions) {
    const o = orderRefs.get(p.id);
    compare(
      "order",
      o?.refNo ?? p.id,
      o?.currency ?? "",
      byOrder.get(p.id) ?? 0,
      Math.round(p.totalMinor + p.chargedMinor - p.settledMinor),
    );
  }

  // Factory parts of orders not cancelled: what we owe each factory in each currency (paid-only parts too).
  const parts = await factoryPositionsSql(db, fx);
  const expected = new Map<string, Minor>();
  for (const r of parts) expected.set(`${r.orderId}:${r.factoryId}:${r.currency}`, Math.round(r.owedMinor - r.paidMinor - r.takenOffMinor));
  const paidOnly = await db.$queryRaw<{ orderId: string; factoryId: string; currency: string; paid: string }[]>`
    select p.order_id as "orderId", p.factory_id as "factoryId", p.currency::text, sum(p.amount)::text as paid
      from factory_payments p join orders o on o.id = p.order_id and o.status <> 'cancelled'
     where p.voided_at is null
     group by 1, 2, 3`;
  for (const r of paidOnly) {
    const k = `${r.orderId}:${r.factoryId}:${r.currency}`;
    if (!expected.has(k)) expected.set(k, -m(r.paid));
  }
  const factoryLedger = await db.$queryRaw<{ orderId: string; factoryId: string; currency: string; minor: string }[]>`
    select l.order_id as "orderId", substr(l.account, 9) as "factoryId", l.currency::text, sum(l.credit - l.debit)::text as minor
      from ledger_entries l join orders o on o.id = l.order_id and o.status <> 'cancelled'
     where l.account like 'factory:%'
     group by 1, 2, 3`;
  const ledgerParts = new Map(factoryLedger.map((r) => [`${r.orderId}:${r.factoryId}:${r.currency}`, m(r.minor)]));
  const keys = new Set([...expected.keys(), ...ledgerParts.keys()]);
  for (const k of keys) {
    const [orderId, , currency] = k.split(":");
    compare(
      "factory",
      `${orderRefs.get(orderId!)?.refNo ?? orderId} · ${k.split(":")[1]}`,
      currency!,
      ledgerParts.get(k) ?? 0,
      expected.get(k) ?? 0,
    );
  }

  // Money accounts: the cash book's balance (the opening balance and what moved from the opening day on).
  const accounts = await db.$queryRaw<{ id: string; name: string; currency: string; balance: string; ledger: string }[]>`
    select a.id, a.name, a.currency::text,
           (a.opening_balance + coalesce((
              select sum(x) from (
                select received_amount as x from payments where account_id = a.id and voided_at is null and receipt_id is null and paid_on >= a.opening_on
                union all select received_amount from customer_receipts where account_id = a.id and voided_at is null and paid_on >= a.opening_on
                union all select -amount from customer_credits where account_id = a.id and kind = 'refund' and voided_at is null and "on" >= a.opening_on
                union all select -amount from factory_payments where account_id = a.id and voided_at is null and paid_on >= a.opening_on
                union all select -amount from expenses where account_id = a.id and voided_at is null and spent_on >= a.opening_on
                union all select -amount from expenses where repaid_account_id = a.id and voided_at is null and repaid_on >= a.opening_on
                union all select -amount_out from money_transfers where from_account_id = a.id and voided_at is null and transferred_on >= a.opening_on
                union all select amount_in from money_transfers where to_account_id = a.id and voided_at is null and transferred_on >= a.opening_on
              ) y), 0))::text as balance,
           coalesce((select sum(debit - credit) from ledger_entries where account = 'money:' || a.id::text), 0)::text as ledger
      from money_accounts a`;
  for (const a of accounts) compare("account", a.name, a.currency, m(a.ledger), m(a.balance));

  // Staff: what we owe each person back (expenses from their own money, not repaid yet), per currency.
  const staff = await db.$queryRaw<{ userId: string; currency: string; ledger: string; expected: string }[]>`
    with owed as (
      select paid_by as user_id, currency, sum(amount) as amount from expenses
       where own_money and repaid_on is null and voided_at is null and paid_by is not null group by 1, 2),
    posted as (
      select substr(account, 7)::uuid as user_id, currency, sum(credit - debit) as amount from ledger_entries
       where account like 'staff:%' group by 1, 2)
    select coalesce(o.user_id, p.user_id) as "userId", coalesce(o.currency, p.currency)::text as currency,
           coalesce(p.amount, 0)::text as ledger, coalesce(o.amount, 0)::text as expected
      from owed o full join posted p on p.user_id = o.user_id and p.currency = o.currency`;
  const people = new Map((await db.user.findMany({ select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  for (const s of staff) compare("staff", people.get(s.userId) ?? s.userId, s.currency, m(s.ledger), m(s.expected));

  // Customers' credit: in − used − refunded (fees are not part of it), per currency.
  const credits = await db.$queryRaw<{ customerId: string; currency: string; ledger: string; expected: string }[]>`
    with held as (
      select customer_id, currency, sum(case kind when 'in' then amount when 'used' then -amount when 'refund' then -amount else 0 end) as amount
        from customer_credits where voided_at is null group by 1, 2),
    posted as (
      select substr(account, 8)::uuid as customer_id, currency, sum(credit - debit) as amount from ledger_entries
       where account like 'credit:%' group by 1, 2)
    select coalesce(h.customer_id, p.customer_id) as "customerId", coalesce(h.currency, p.currency)::text as currency,
           coalesce(p.amount, 0)::text as ledger, coalesce(h.amount, 0)::text as expected
      from held h full join posted p on p.customer_id = h.customer_id and p.currency = h.currency`;
  const customers = new Map((await db.party.findMany({ where: isCustomer, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  for (const c of credits) compare("credit", customers.get(c.customerId) ?? c.customerId, c.currency, m(c.ledger), m(c.expected));

  // Every posting balanced in the main currency.
  const groups = await db.$queryRaw<{ n: number }[]>`select count(distinct group_id)::int as n from ledger_entries`;
  const unbalanced = await db.$queryRaw<{ groupId: string; entryNo: number; debit: string; credit: string }[]>`
    select group_id as "groupId", min(entry_no) as "entryNo", sum(debit_base)::text as debit, sum(credit_base)::text as credit
      from ledger_entries group by group_id having sum(debit_base) <> sum(credit_base)`;
  for (const g of unbalanced) compare("group", `entry ${g.entryNo}`, fx.main, m(g.debit), m(g.credit));

  return {
    checked: {
      orders: positions.length,
      factoryParts: keys.size,
      accounts: accounts.length,
      staff: staff.length,
      credits: credits.length,
      groups: groups[0]?.n ?? 0,
    },
    differences,
  };
}
