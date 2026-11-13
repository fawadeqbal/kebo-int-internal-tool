import { Injectable } from "@nestjs/common";
import { decimalToMinor, fromDbDate, toDbDate, type Prisma } from "@kebo/database";
import { fromMinor, toMinor, type Minor } from "@kebo/money";
import { can, EXPENSE_CATEGORY_LABEL, PAYMENT_KIND_LABEL, type ExpenseCategory, type MoneyAccountInput, type TransferInput } from "@kebo/shared";
import { DomainError, ForbiddenError, NotFoundError, type ISODate } from "@kebo/utils";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { Clock } from "../../common/time/clock.service";
import type { SessionUser } from "../../common/auth/session-user";
import { checkAccount } from "./account-check";
import { LimitsService } from "../../common/company/limits.service";
import { LedgerPosting } from "../ledger/posting.service";

type Kind = "in" | "factory" | "expense" | "transfer_out" | "transfer_in" | "refund";

interface Entry {
  key: string;
  id: string;
  kind: Kind;
  on: string;
  at: Date;
  /** Signed: money in is positive, money out negative. */
  minor: Minor;
  currency: string;
  account: { id: string; name: string } | null;
  what: string;
  /** Who the money came from or went to. */
  party: { name: string; href: string | null } | null;
  reference: string | null;
  href: string | null;
  voided: boolean;
}

/**
 * The cash book (managers): where our money is kept (cash, banks, wallets),
 * money moved between those accounts, and one dated list of every amount in
 * (from customers) and out (to factories, expenses) with running balances.
 */
@Injectable()
export class CashService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly limits: LimitsService,
    private readonly ledger: LedgerPosting,
  ) {}

  private assertManager(user: SessionUser) {
    if (!can(user, "expenses.manage")) throw new ForbiddenError("Only managers can see the cash book.");
  }

  /** Movements on accounts on or after their opening day, up to `upTo` (inclusive), by account. */
  private async movements(accountIds: string[], upTo: ISODate, before = false) {
    const accounts = await this.prisma.db.moneyAccount.findMany({ where: { id: { in: accountIds } }, select: { id: true, openingOn: true } });
    const sums = new Map<string, Minor>(accountIds.map((id) => [id, 0]));
    const limit = toDbDate(upTo);
    for (const a of accounts) {
      const on = { gte: a.openingOn, ...(before ? { lt: limit } : { lte: limit }) };
      const [pin, cout, eout, rout, tout, tin] = await Promise.all([
        // Payment entries (in the account's currency): money in, money out (refunds, suppliers), moves out and in.
        this.prisma.db.moneyMovement.aggregate({ _sum: { amount: true }, where: { accountId: a.id, voidedAt: null, direction: "in", valueDate: on } }),
        this.prisma.db.moneyMovement.aggregate({ _sum: { amount: true }, where: { accountId: a.id, voidedAt: null, direction: "out", valueDate: on } }),
        this.prisma.db.expense.aggregate({ _sum: { amount: true }, where: { accountId: a.id, voidedAt: null, spentOn: on } }),
        // Paid back to someone who paid from their own money: leaves the account on the day it was repaid.
        this.prisma.db.expense.aggregate({ _sum: { amount: true }, where: { repaidAccountId: a.id, voidedAt: null, repaidOn: on } }),
        this.prisma.db.moneyMovement.aggregate({ _sum: { amount: true }, where: { accountId: a.id, voidedAt: null, direction: "move", valueDate: on } }),
        this.prisma.db.moneyMovement.aggregate({ _sum: { allocatable: true }, where: { toAccountId: a.id, voidedAt: null, direction: "move", valueDate: on } }),
      ]);
      const m = (d: Prisma.Decimal | null) => (d ? decimalToMinor(d) : 0);
      sums.set(
        a.id,
        m(pin._sum.amount) -
          m(cout._sum.amount) -
          m(eout._sum.amount) -
          m(rout._sum.amount) -
          m(tout._sum.amount) +
          m(tin._sum.allocatable),
      );
    }
    return sums;
  }

  /**
   * Our accounts. Anyone who records payments gets the list to choose from;
   * managers also see each one's balance today.
   */
  async accounts(user: SessionUser) {
    if (!can(user, "payments.record") && !can(user, "expenses.manage")) throw new ForbiddenError("You do not record money.");
    const rows = await this.prisma.db.moneyAccount.findMany({ orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { name: "asc" }] });
    const managers = can(user, "expenses.manage");
    const sums = managers ? await this.movements(rows.map((r) => r.id), this.clock.today()) : null;
    return rows.map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      currency: a.currency,
      archived: Boolean(a.archivedAt),
      ...(managers
        ? {
            openingBalance: a.openingBalance.toFixed(2),
            openingOn: fromDbDate(a.openingOn),
            note: a.note,
            balance: fromMinor(decimalToMinor(a.openingBalance) + (sums!.get(a.id) ?? 0)),
          }
        : {}),
    }));
  }

  async saveAccount(user: SessionUser, id: string | null, input: MoneyAccountInput) {
    this.assertManager(user);
    if (input.openingOn > this.clock.today()) throw new DomainError("The opening day cannot be in the future.");
    const clash = await this.prisma.db.moneyAccount.findFirst({ where: { name: { equals: input.name, mode: "insensitive" }, ...(id ? { NOT: { id } } : {}) } });
    if (clash) throw new DomainError(`There is already an account called ${clash.name}.`);
    return this.prisma.tx(async (tx) => {
      if (id) {
        const a = await tx.moneyAccount.findUnique({ where: { id } });
        if (!a) throw new NotFoundError("Account");
        if (a.currency !== input.currency) {
          const used =
            (await tx.moneyMovement.count({ where: { OR: [{ accountId: id }, { toAccountId: id }] } })) +
            (await tx.expense.count({ where: { accountId: id } })) +
            0;
          if (used) throw new DomainError(`${a.name} already has money recorded in ${a.currency}; its currency cannot change.`);
        }
        const row = await tx.moneyAccount.update({
          where: { id },
          data: {
            name: input.name,
            kind: input.kind,
            currency: input.currency,
            openingBalance: input.openingBalance,
            openingOn: toDbDate(input.openingOn),
            note: input.note,
            archivedAt: input.archived ? (a.archivedAt ?? new Date()) : null,
          },
        });
        await this.audit.record(tx, {
          userId: user.id,
          action: "account_edit",
          entityType: "money_account",
          entityId: id,
          summary: `Changed the account ${row.name}`,
          oldValues: { name: a.name, openingBalance: a.openingBalance.toFixed(2), openingOn: fromDbDate(a.openingOn), closed: Boolean(a.archivedAt) },
          newValues: { name: row.name, openingBalance: row.openingBalance.toFixed(2), openingOn: input.openingOn, closed: Boolean(row.archivedAt) },
        });
        await this.ledger.post(tx, [{ type: "account", id }], { userId: user.id });
        return row;
      }
      const row = await tx.moneyAccount.create({
        data: { name: input.name, kind: input.kind, currency: input.currency, openingBalance: input.openingBalance, openingOn: toDbDate(input.openingOn), note: input.note },
      });
      await this.audit.record(tx, {
        userId: user.id,
        action: "account_create",
        entityType: "money_account",
        entityId: row.id,
        summary: `Added the account ${row.name} (${row.currency}, ${row.openingBalance.toFixed(2)} on ${input.openingOn})`,
      });
      await this.ledger.post(tx, [{ type: "account", id: row.id }], { userId: user.id });
      return row;
    });
  }

  /** Money moved between two of our accounts; with different currencies both amounts are needed. */
  async transfer(user: SessionUser, input: TransferInput) {
    this.assertManager(user);
    if (input.transferredOn > this.clock.today()) throw new DomainError("The date cannot be in the future.");
    const [from, to] = await Promise.all([
      this.prisma.db.moneyAccount.findUnique({ where: { id: input.fromAccountId } }),
      this.prisma.db.moneyAccount.findUnique({ where: { id: input.toAccountId } }),
    ]);
    if (!from || !to) throw new DomainError("Choose two of our accounts.");
    if (from.archivedAt || to.archivedAt) throw new DomainError(`${from.archivedAt ? from.name : to.name} is closed.`);
    let amountIn = input.amountIn;
    if (from.currency === to.currency) amountIn = amountIn ?? input.amountOut;
    else if (!amountIn) throw new DomainError(`Say how much arrived in ${to.name} (${to.currency}).`);
    return this.prisma.tx(async (tx) => {
      // A move: what left the first account, and (allocatable, in the second's currency) what arrived.
      const row = await tx.moneyMovement.create({
        data: {
          direction: "move",
          accountId: from.id,
          toAccountId: to.id,
          amount: input.amountOut,
          currency: from.currency,
          allocCurrency: to.currency,
          rate: Math.round((Number(input.amountOut) / Number(amountIn)) * 1e14) / 1e14,
          allocatable: amountIn!,
          valueDate: toDbDate(input.transferredOn),
          reference: input.reference,
          note: input.note,
          recordedById: user.id,
        },
      });
      await this.audit.record(tx, {
        userId: user.id,
        action: "transfer",
        entityType: "money_account",
        entityId: from.id,
        summary: `Moved ${from.currency} ${fromMinor(toMinor(input.amountOut))} from ${from.name} to ${to.name}${from.currency !== to.currency ? ` (${to.currency} ${fromMinor(toMinor(amountIn!))} arrived)` : ""}`,
      });
      await this.ledger.post(tx, [{ type: "movement", id: row.id }], { userId: user.id });
      return { id: row.id };
    });
  }

  async voidTransfer(user: SessionUser, id: string, reason: string) {
    this.assertManager(user);
    const t = await this.prisma.db.moneyMovement.findFirst({ where: { id, direction: "move" }, include: { account: true, toAccount: true } });
    if (!t) throw new NotFoundError("Transfer");
    if (t.voidedAt) throw new DomainError("This transfer was already removed.");
    await this.prisma.tx(async (tx) => {
      await tx.moneyMovement.update({ where: { id }, data: { voidedAt: new Date(), voidReason: reason } });
      await this.audit.record(tx, {
        userId: user.id,
        action: "transfer_void",
        entityType: "money_account",
        entityId: t.accountId!,
        summary: `Removed the move of ${t.currency} ${t.amount.toFixed(2)} from ${t.account!.name} to ${t.toAccount!.name}`,
        reason,
      });
      await this.ledger.post(tx, [{ type: "movement", id }], { userId: user.id, reason });
    });
    return { ok: true };
  }

  /**
   * Every amount in and out between two dates: from customers, to factories,
   * expenses, and moves between our accounts. ?account= one account (with its
   * balance before, after each line, and at the end), or "none" for what was
   * not put on any account yet. ?currency= one currency.
   */
  async cashBook(user: SessionUser, q: { from: ISODate; to: ISODate; account?: string; currency?: string; removed?: boolean }) {
    this.assertManager(user);
    const range = { gte: toDbDate(q.from), lte: toDbDate(q.to) };
    const none = q.account === "none";
    const accountId = q.account && !none ? q.account : undefined;
    const account = accountId ? await this.prisma.db.moneyAccount.findUnique({ where: { id: accountId } }) : null;
    if (accountId && !account) throw new NotFoundError("Account");
    const onAccount = none ? { accountId: null } : accountId ? { accountId } : {};
    const cur = q.currency ? { currency: q.currency } : {};
    const live = q.removed ? {} : { voidedAt: null };
    const acc = { select: { id: true, name: true } } as const;

    // Expenses are a plan feature: without it they are not listed.
    const expensesOn = await this.limits.allows("expenses");
    const [movements, expenses, repaid, transfers] = await Promise.all([
      // Money from customers as it arrived, back to them, and to suppliers (any currency): each payment entry once,
      // however many orders it pays; a payment from the customer's credit moved no money.
      this.prisma.db.moneyMovement.findMany({
        where: { direction: { in: ["in", "out"] }, valueDate: range, ...onAccount, ...cur, ...live },
        include: {
          account: acc,
          party: { select: { id: true, name: true } },
          allocations: {
            where: { later: false },
            include: { order: { select: { id: true, refNo: true } }, purchaseOrder: { select: { id: true, refNo: true } } },
            orderBy: { createdAt: "asc" },
          },
        },
      }),
      expensesOn
        ? this.prisma.db.expense.findMany({
            // Paid from someone's own money, or a bill not paid when it was recorded: on no account of ours (paying it is).
            where: { spentOn: range, ...onAccount, ...cur, ...live, ...(none ? { ownMoney: false, payLater: false } : {}) },
            include: { account: acc, customer: { select: { id: true, name: true } }, order: { select: { id: true, refNo: true } }, inquiry: { select: { id: true, refNo: true } } },
          })
        : Promise.resolve([]),
      expensesOn && !none
        ? this.prisma.db.expense.findMany({
            where: { repaidOn: range, repaidAccountId: accountId ?? { not: null }, ...cur, ...live },
            include: { repaidAccount: acc, paidBy: { select: { name: true } }, order: { select: { id: true, refNo: true } } },
          })
        : Promise.resolve([]),
      none
        ? Promise.resolve([])
        : this.prisma.db.moneyMovement
            .findMany({
              where: {
                direction: "move",
                valueDate: range,
                ...live,
                ...(accountId ? { OR: [{ accountId }, { toAccountId: accountId }] } : {}),
              },
              include: { account: true, toAccount: true },
            })
            .then((rows) =>
              rows.map((t) => ({
                ...t,
                fromAccountId: t.accountId!,
                fromAccount: t.account!,
                toAccount: t.toAccount!,
                amountOut: t.amount,
                amountIn: t.allocatable,
                transferredOn: t.valueDate,
              })),
            ),
    ]);

    const rows: Entry[] = [];
    for (const m of movements) {
      const at = { id: m.id, on: fromDbDate(m.valueDate), at: m.createdAt, currency: m.currency, account: m.account, voided: Boolean(m.voidedAt) };
      if (m.partyRole === "supplier") {
        const p = m.allocations[0];
        rows.push({
          ...at,
          key: `f:${m.id}`,
          kind: "factory",
          minor: -decimalToMinor(m.amount),
          what: p?.purchaseOrder ? `${PAYMENT_KIND_LABEL[p.kind]} to the factory for ${p.purchaseOrder.refNo}` : "Paid to the factory",
          party: { name: m.party!.name, href: `/factories/${m.party!.id}` },
          reference: m.reference,
          href: p?.purchaseOrder ? `/orders/${p.purchaseOrder.id}/payment` : null,
        });
        continue;
      }
      const party = { name: m.party!.name, href: `/customers/${m.party!.id}` };
      if (m.direction === "out") {
        rows.push({ ...at, key: `c:${m.id}`, kind: "refund", minor: -decimalToMinor(m.amount), what: `Credit refunded${m.note ? `: ${m.note}` : ""}`, party, reference: m.reference, href: party.href });
        continue;
      }
      const parts = m.allocations.filter((a) => a.order);
      const one = parts.length === 1 && decimalToMinor(parts[0]!.amount) === decimalToMinor(m.allocatable) ? parts[0]! : null;
      const conv = m.currency !== m.allocCurrency;
      rows.push({
        ...at,
        key: `m:${m.id}`,
        kind: "in",
        minor: decimalToMinor(m.amount),
        what: one
          ? `${PAYMENT_KIND_LABEL[one.kind]} for ${one.order!.refNo}${conv ? ` (${m.allocCurrency} ${one.amount.toFixed(2)} at ${Number(m.rate)})` : ""}${decimalToMinor(one.bankCharges) ? ` (bank charges ${one.bankCharges.toFixed(2)})` : ""}${m.paidByName ? `, paid by ${m.paidByName}` : ""}`
          : `One transfer for ${[...new Set(parts.map((p) => p.order!.refNo))].join(", ") || "the customer's credit"}${conv ? ` (at ${Number(m.rate)} per ${m.allocCurrency})` : ""}`,
        party,
        reference: m.reference,
        href: one ? `/orders/${one.order!.id}/payment` : party.href,
      });
    }
    for (const e of expenses)
      rows.push({
        key: `e:${e.id}`,
        id: e.id,
        kind: "expense",
        on: fromDbDate(e.spentOn),
        at: e.createdAt,
        minor: -decimalToMinor(e.amount),
        currency: e.currency,
        account: e.account,
        what: `${EXPENSE_CATEGORY_LABEL[e.category as ExpenseCategory] ?? e.category}: ${e.description}`,
        party: e.customer ? { name: e.order ? `${e.customer.name} · ${e.order.refNo}` : e.inquiry ? `${e.customer.name} · ${e.inquiry.refNo}` : e.customer.name, href: `/customers/${e.customer.id}` } : null,
        reference: e.reference,
        href: e.order ? `/orders/${e.order.id}/payment` : e.inquiry ? `/inquiries/${e.inquiry.id}` : null,
        voided: Boolean(e.voidedAt),
      });
    for (const e of repaid)
      rows.push({
        key: `r:${e.id}`,
        id: e.id,
        kind: "expense",
        on: fromDbDate(e.repaidOn!),
        at: e.updatedAt,
        minor: -decimalToMinor(e.amount),
        currency: e.currency,
        account: e.repaidAccount,
        what: e.payLater ? `Paid${e.payee ? ` ${e.payee}` : ""}: ${e.description}` : `Repaid${e.paidBy ? ` to ${e.paidBy.name}` : ""}: ${e.description}`,
        party: e.payLater ? (e.payee ? { name: e.payee, href: null } : null) : e.paidBy ? { name: e.paidBy.name, href: null } : null,
        reference: e.reference,
        href: e.order ? `/orders/${e.order.id}/costs` : null,
        voided: Boolean(e.voidedAt),
      });
    for (const t of transfers) {
      const between = `${t.fromAccount.name} → ${t.toAccount.name}`;
      if ((!accountId || t.fromAccountId === accountId) && (!q.currency || t.fromAccount.currency === q.currency))
        rows.push({
          key: `to:${t.id}`,
          id: t.id,
          kind: "transfer_out",
          on: fromDbDate(t.transferredOn),
          at: t.createdAt,
          minor: -decimalToMinor(t.amountOut),
          currency: t.fromAccount.currency,
          account: { id: t.fromAccount.id, name: t.fromAccount.name },
          what: `Moved to ${t.toAccount.name}${t.note ? `: ${t.note}` : ""}`,
          party: { name: between, href: null },
          reference: t.reference,
          href: null,
          voided: Boolean(t.voidedAt),
        });
      if ((!accountId || t.toAccountId === accountId) && (!q.currency || t.toAccount.currency === q.currency))
        rows.push({
          key: `ti:${t.id}`,
          id: t.id,
          kind: "transfer_in",
          on: fromDbDate(t.transferredOn),
          at: t.createdAt,
          minor: decimalToMinor(t.amountIn),
          currency: t.toAccount.currency,
          account: { id: t.toAccount.id, name: t.toAccount.name },
          what: `Moved from ${t.fromAccount.name}${t.note ? `: ${t.note}` : ""}`,
          party: { name: between, href: null },
          reference: t.reference,
          href: null,
          voided: Boolean(t.voidedAt),
        });
    }
    rows.sort((a, b) => (a.on !== b.on ? (a.on < b.on ? -1 : 1) : a.at.getTime() - b.at.getTime()));

    // One account: what it held before the period, after each line, and at the end.
    let opening: Minor | null = null;
    let running: Minor = 0;
    if (account) {
      const opened = fromDbDate(account.openingOn);
      const before = q.from > opened ? ((await this.movements([account.id], q.from, true)).get(account.id) ?? 0) : 0;
      opening = q.to < opened ? 0 : decimalToMinor(account.openingBalance) + before;
      running = opening;
    }
    const totals = new Map<string, { in: Minor; out: Minor }>();
    const out = rows.map((r) => {
      let balance: string | null = null;
      if (!r.voided) {
        const t = totals.get(r.currency) ?? { in: 0, out: 0 };
        // Moves between our own accounts are not money earned or spent: kept out of the totals unless one account is shown.
        if (account || (r.kind !== "transfer_in" && r.kind !== "transfer_out")) {
          if (r.minor > 0) t.in += r.minor;
          else t.out -= r.minor;
        }
        totals.set(r.currency, t);
        if (account && r.on >= fromDbDate(account.openingOn)) {
          running += r.minor;
          balance = fromMinor(running);
        }
      }
      return {
        key: r.key,
        id: r.id,
        kind: r.kind,
        on: r.on,
        amount: fromMinor(r.minor),
        currency: r.currency,
        account: r.account,
        what: r.what,
        party: r.party,
        reference: r.reference,
        href: r.href,
        voided: r.voided,
        balance,
      };
    });
    const curOfUnassigned = account ? { currency: account.currency } : cur;
    const unassigned = none
      ? out.filter((r) => !r.voided).length
      : (await this.prisma.db.moneyMovement.count({ where: { valueDate: range, accountId: null, voidedAt: null, ...curOfUnassigned } })) +
        (expensesOn ? await this.prisma.db.expense.count({ where: { spentOn: range, accountId: null, ownMoney: false, payLater: false, voidedAt: null, ...curOfUnassigned } }) : 0);

    return {
      from: q.from,
      to: q.to,
      account: account && { id: account.id, name: account.name, currency: account.currency, kind: account.kind, openingOn: fromDbDate(account.openingOn) },
      opening: opening === null ? null : fromMinor(opening),
      closing: opening === null ? null : fromMinor(running),
      totals: [...totals.entries()].map(([currency, t]) => ({ currency, in: fromMinor(t.in), out: fromMinor(t.out), net: fromMinor(t.in - t.out) })),
      /** Amounts in this period not on any account yet (to put on one, for balances that match the bank). */
      unassigned,
      rows: out,
    };
  }

  /** Put an amount on an account afterwards (a payment, a factory payment or an expense recorded without one). */
  async setAccount(user: SessionUser, kind: "in" | "factory" | "expense", id: string, accountId: string | null) {
    this.assertManager(user);
    if (kind === "expense") await this.limits.require("expenses");
    // Money in or to a supplier: its payment entry (asked for by the entry or by its payment on an order), in its currency.
    const entry =
      kind !== "expense"
        ? await this.prisma.db.moneyMovement.findFirst({
            where: { partyRole: kind === "in" ? "customer" : "supplier", OR: [{ id }, { allocations: { some: { id } } }] },
            select: { id: true, currency: true, accountId: true },
          })
        : null;
    if (kind !== "expense") {
      if (!entry) throw new NotFoundError("Entry");
      const next = await checkAccount(this.prisma.db, accountId, entry.currency, entry.accountId);
      await this.prisma.tx(async (tx) => {
        await tx.moneyMovement.update({ where: { id: entry.id }, data: { accountId: next } });
        await this.audit.record(tx, { userId: user.id, action: "account_set", entityType: "payment", entityId: entry.id, summary: next ? "Put an amount on an account" : "Took an amount off its account" });
        await this.ledger.post(tx, [{ type: "movement", id: entry.id }], { userId: user.id });
      });
      return { ok: true };
    }
    const row = await this.prisma.db.expense.findUnique({ where: { id }, select: { currency: true, accountId: true } });
    if (!row) throw new NotFoundError("Entry");
    if (kind === "expense" && (await this.prisma.db.expense.count({ where: { id, ownMoney: true } })))
      throw new DomainError("It was paid from someone's own money: record the repayment on the order's Costs page instead.");
    if (kind === "expense" && (await this.prisma.db.expense.count({ where: { id, payLater: true } })))
      throw new DomainError("It is a bill to pay: record its payment where the cost is, and say the account there.");
    const next = await checkAccount(this.prisma.db, accountId, row.currency, row.accountId);
    await this.prisma.tx(async (tx) => {
      await tx.expense.update({ where: { id }, data: { accountId: next } });
      await this.audit.record(tx, {
        userId: user.id,
        action: "account_set",
        entityType: "expense",
        entityId: id,
        summary: next ? "Put an amount on an account" : "Took an amount off its account",
      });
      await this.ledger.post(tx, [{ type: "expense", id }], { userId: user.id });
    });
    return { ok: true };
  }
}
