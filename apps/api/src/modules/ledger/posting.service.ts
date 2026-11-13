import { randomUUID } from "node:crypto";
import { Global, Injectable, Logger, Module } from "@nestjs/common";
import { decimalToMinor, fromDbDate, fromDbDateOrNull, nextCount, toDbDate, type Prisma, isSupplier } from "@kebo/database";
import { fromMinor, type Minor } from "@kebo/money";
import { ledgerAccount, paperNumber, parseLedgerAccount, readSettings, type LedgerSource, type PaymentKind } from "@kebo/shared";
import { todayIn, type ISODate } from "@kebo/utils";
import { PrismaService, type Tx } from "../../database/prisma.service";
import { LimitsService } from "../../common/company/limits.service";
import { Clock } from "../../common/time/clock.service";
import { CompanyContext } from "../../common/company/company-context";
import { orderRate } from "../money/order-money";
import {
  baseOf,
  allocationPlan,
  expensePlan,
  factoryPaymentPlan,
  fxPlan,
  openingPlan,
  orderPlan,
  movementPlan,
  purchasePlan,
  transferPlan,
  type DocPlan,
  type Line,
  type OrderDoc,
  type Part,
  type RuleCtx,
} from "./rules";

type Db = PrismaService["db"] | Tx;

/** A document to post: one of the ledger's sources, or "everything on this order". */
export type LedgerRef = { type: LedgerSource | "order_all"; id: string };

export interface PostOptions {
  /** Who saved the document (null: the system, e.g. the rebuild). */
  userId: string | null;
  /** Why it was changed or removed, as the person said (on the correction). */
  reason?: string | null;
}

/** What one call wrote. */
export interface PostResult {
  postings: number;
  rows: number;
  /** Documents whose rows were posted for the first time, corrected, or reversed. */
  posted: number;
  corrected: number;
  reversed: number;
}

interface Existing {
  id: string;
  sourceType: string;
  sourceId: string;
  part: string;
  date: ISODate;
  ref: string;
  account: string;
  currency: string;
  rate: string | null;
  orderId: string | null;
  customerId: string | null;
  factoryId: string | null;
  userId: string | null;
  moneyAccountId: string | null;
  debit: Minor;
  credit: Minor;
  debitBase: Minor;
  creditBase: Minor;
  reversesId: string | null;
}

/** A row about to be written. */
interface NewRow extends Omit<Existing, "sourceType" | "sourceId"> {
  type: string;
  memo: string;
  reason: string | null;
}

interface Posting {
  sourceType: string;
  sourceId: string;
  rows: NewRow[];
}

const key = (r: {
  account: string;
  currency: string;
  orderId?: string | null;
  customerId?: string | null;
  factoryId?: string | null;
  userId?: string | null;
  moneyAccountId?: string | null;
}) => [r.account, r.currency, r.orderId ?? "", r.customerId ?? "", r.factoryId ?? "", r.userId ?? "", r.moneyAccountId ?? ""].join("|");

const isFx = (sourceType: string) => sourceType === "fx_order" || sourceType === "fx_factory";
/** The lines a comparison looks at: not the exchange-difference line that only balances a posting in the main currency. */
const primary = (sourceType: string, account: string) => isFx(sourceType) || account !== "fx_diff";

/** Rebuild order on one day: the order first, then what it is owed and paid, then accounts' openings. */
const SOURCE_ORDER: Record<LedgerSource, number> = {
  order: 0,
  purchase_order: 1,
  movement: 2,
  allocation: 3,
  expense: 5,
  account: 7,
  fx_order: 8,
  fx_factory: 8,
};

/**
 * Posts documents to the ledger: works out the rows each document should have now (rules.ts), compares them
 * with what is posted for it, and writes only the difference — reversal rows and new rows (or, for an order and
 * a factory's part, the difference), with the person's reason. Calling it again changes nothing, so every write
 * path calls it on every save, inside its own transaction. Afterwards the exchange differences of the orders and
 * factory parts touched, and the opening balances of the accounts touched, follow.
 *
 * One company's postings never run at once (a transaction-level advisory lock), so two saves never post the same
 * document twice.
 */
@Injectable()
export class LedgerPosting {
  private readonly log = new Logger("Ledger");

  constructor(
    private readonly prisma: PrismaService,
    private readonly limits: LimitsService,
    private readonly clock: Clock,
  ) {}

  /** The main currency, Settings' rates and whether expenses are on, read inside the transaction. */
  async ctx(db: Db): Promise<RuleCtx> {
    const rows = await db.setting.findMany({ select: { key: true, value: true } });
    const s = readSettings(Object.fromEntries(rows.map((r) => [r.key, r.value])));
    return { main: s.sales.currency, rates: s.sales.exchangeRates, expensesOn: await this.limits.allows("expenses") };
  }

  private day(d: Date) {
    return todayIn(this.clock.timeZone, d);
  }

  /** Post these documents now, inside the caller's transaction. */
  async post(tx: Tx, refs: LedgerRef[], opts: PostOptions): Promise<PostResult> {
    const result: PostResult = { postings: 0, rows: 0, posted: 0, corrected: 0, reversed: 0 };
    if (!refs.length) return result;
    await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${`ledger:${CompanyContext.require().id}`}))`;
    const ctx = await this.ctx(tx);
    const expanded = await this.expand(tx, refs);
    // In date order (a rebuild numbers the postings as they happened), the order before what it is owed and paid.
    const dayOf = (p: DocPlan) => p.parts[0]?.date ?? p.voided?.on ?? "9999-12-31";
    const plans = (await this.plans(tx, expanded, ctx)).sort((a, b) =>
      dayOf(a) !== dayOf(b) ? (dayOf(a) < dayOf(b) ? -1 : 1) : SOURCE_ORDER[a.sourceType] - SOURCE_ORDER[b.sourceType],
    );
    const touched = await this.apply(tx, plans, opts, ctx, result);
    // The exchange differences of what was touched, then the opening balances of the accounts touched.
    const fx = await this.fxPlans(tx, touched, ctx);
    await this.apply(tx, fx, opts, ctx, result);
    const accounts = new Set([...touched.accounts, ...expanded.filter((r) => r.type === "account").map((r) => r.id)]);
    await this.apply(tx, await this.openingPlans(tx, [...accounts], ctx), opts, ctx, result);
    return result;
  }

  /* ---------------------------------------------------------------- which documents */

  /** "Everything on an order" as the documents it is; duplicates removed. */
  private async expand(tx: Tx, refs: LedgerRef[]): Promise<{ type: LedgerSource; id: string }[]> {
    const out = new Map<string, { type: LedgerSource; id: string }>();
    const add = (type: LedgerSource, id: string) => out.set(`${type}:${id}`, { type, id });
    const orders = [...new Set(refs.filter((r) => r.type === "order_all" || r.type === "order").map((r) => r.id))];
    for (const r of refs) if (r.type !== "order_all") add(r.type, r.id);
    if (orders.length) {
      const all = refs.filter((r) => r.type === "order_all").map((r) => r.id);
      // An order's factory parts go with it: the factories of its lines, and any posted before (removed since).
      const [lines, posted] = await Promise.all([
        tx.orderLine.findMany({
          where: { orderId: { in: orders }, factoryId: { not: null } },
          select: { orderId: true, factoryId: true },
          distinct: ["orderId", "factoryId"],
        }),
        tx.$queryRaw<{ sourceId: string }[]>`
          select distinct source_id as "sourceId" from ledger_entries
           where source_type = 'purchase_order' and split_part(source_id, ':', 1) = any(${orders}::text[])`,
      ]);
      for (const id of orders) add("order", id);
      for (const l of lines) add("purchase_order", `${l.orderId}:${l.factoryId}`);
      for (const p of posted) add("purchase_order", p.sourceId);
      if (all.length) {
        const [parts, expenses] = await Promise.all([
          tx.allocation.findMany({
            where: { OR: [{ orderId: { in: all } }, { purchaseOrderId: { in: all } }] },
            select: { id: true, movementId: true },
          }),
          tx.expense.findMany({ where: { orderId: { in: all } }, select: { id: true } }),
        ]);
        for (const p of parts) {
          add("movement", p.movementId);
          add("allocation", p.id);
        }
        for (const e of expenses) add("expense", e.id);
      }
    }
    return [...out.values()];
  }

  /* ---------------------------------------------------------------- what each document posts */

  private voidOf(at: Date | null, reason: string | null) {
    return at ? { on: this.day(at), reason } : null;
  }

  private async plans(tx: Tx, refs: { type: LedgerSource; id: string }[], ctx: RuleCtx): Promise<DocPlan[]> {
    const ids = (t: LedgerSource) => refs.filter((r) => r.type === t).map((r) => r.id);
    const out: DocPlan[] = [];
    const rateOf = (o: { currency: string; mainCurrency: string | null; mainRate: Prisma.Decimal | null }) =>
      orderRate(o, ctx.main, ctx.rates);

    // Orders and their factories' parts.
    const poIds = ids("purchase_order");
    const orderIds = [...new Set([...ids("order"), ...poIds.map((s) => s.split(":")[0]!)])];
    if (orderIds.length) {
      const orders = await tx.order.findMany({
        where: { id: { in: orderIds } },
        select: {
          id: true,
          refNo: true,
          customerId: true,
          currency: true,
          total: true,
          orderedOn: true,
          status: true,
          cancellation: { select: { cancelledAt: true, reason: true } },
          mainCurrency: true,
          mainRate: true,
          lines: {
            where: { factoryId: { not: null } },
            select: {
              factoryId: true,
              factoryUnitPrice: true,
              factoryCurrency: true,
              factoryTaxRate: true,
              factoryTaxIncluded: true,
              quantity: true,
            },
          },
          papers: { where: { kind: "purchase-order" }, select: { ref: true, number: true, version: true }, orderBy: { version: "desc" } },
        },
      });
      const factoryIds = [...new Set(poIds.map((s) => s.split(":")[1]!))];
      const factories = new Map(
        (await tx.party.findMany({ where: { ...isSupplier, id: { in: factoryIds } }, select: { id: true, name: true } })).map((f) => [f.id, f]),
      );
      const byId = new Map(orders.map((o) => [o.id, o]));
      const docOf = (o: (typeof orders)[number]): OrderDoc => ({
        id: o.id,
        refNo: o.refNo,
        customerId: o.customerId,
        currency: o.currency,
        totalMinor: decimalToMinor(o.total),
        orderedOn: fromDbDate(o.orderedOn),
        rate: rateOf(o),
        cancelled:
          o.status === "cancelled"
            ? { on: o.cancellation ? this.day(o.cancellation.cancelledAt) : fromDbDate(o.orderedOn), reason: o.cancellation?.reason ?? null }
            : null,
      });
      for (const id of ids("order")) {
        const o = byId.get(id);
        if (o) out.push(orderPlan(docOf(o)));
      }
      for (const sid of poIds) {
        const [orderId, factoryId] = sid.split(":") as [string, string];
        const o = byId.get(orderId);
        const f = factories.get(factoryId);
        if (!o || !f) continue;
        const po = o.papers.find((p) => p.ref === factoryId);
        const ref = (po?.number ?? `${o.refNo} · ${f.name}`).slice(0, 60);
        const lines = o.lines.flatMap((l) =>
          l.factoryId && l.factoryUnitPrice !== null && l.factoryCurrency
            ? [
                {
                  factoryId: l.factoryId,
                  currency: l.factoryCurrency,
                  unitPriceMinor: decimalToMinor(l.factoryUnitPrice),
                  taxRate: l.factoryTaxRate?.toString() ?? 0,
                  taxIncluded: l.factoryTaxIncluded,
                  quantity: l.quantity.toString(),
                },
              ]
            : [],
        );
        out.push(purchasePlan(docOf(o), f, lines, ref, ctx));
      }
    }

    const orderSel = { select: { id: true, refNo: true, customerId: true, currency: true, mainCurrency: true, mainRate: true } } as const;
    const orderOf = (o: {
      id: string;
      refNo: string;
      customerId: string;
      currency: string;
      mainCurrency: string | null;
      mainRate: Prisma.Decimal | null;
    }) => ({
      id: o.id,
      refNo: o.refNo,
      customerId: o.customerId,
      currency: o.currency,
      rate: rateOf(o),
    });

    const numberOf = (a: { receiptNo: number | null; order: { refNo: string } | null }) =>
      a.order ? paperNumber(a.order.refNo, "payment-receipt", a.receiptNo) : "";

    if (ids("movement").length) {
      const rows = await tx.moneyMovement.findMany({
        where: { id: { in: ids("movement") } },
        include: {
          allocations: {
            where: { later: false },
            include: { order: orderSel, purchaseOrder: orderSel },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          },
          party: { select: { id: true, name: true } },
          account: { select: { id: true, currency: true } },
          toAccount: { select: { id: true, currency: true } },
        },
      });
      // FP-2026-0031-n: the n-th payment to the suppliers on the order, in the order they were recorded (never renumbered).
      const purchaseIds = rows.flatMap((m) => (m.partyRole === "supplier" ? m.allocations.map((a) => a.id) : []));
      const ranks = purchaseIds.length
        ? await tx.$queryRaw<{ id: string; n: number }[]>`
            select id, n::int from (
              select id, row_number() over (partition by order_id order by created_at, id) as n
                from allocations where target = 'purchase'
                 and purchase_order_id in (select purchase_order_id from allocations where id = any(${purchaseIds}::uuid[]))) x
             where id = any(${purchaseIds}::uuid[])`
        : [];
      const rank = new Map(ranks.map((r) => [r.id, r.n]));
      for (const m of rows) {
        const voided = this.voidOf(m.voidedAt, m.voidReason);
        if (m.direction === "move") {
          out.push(
            transferPlan(
              {
                id: m.id,
                from: m.account!,
                to: m.toAccount!,
                outMinor: decimalToMinor(m.amount),
                inMinor: decimalToMinor(m.allocatable),
                on: fromDbDate(m.valueDate),
                note: m.note,
                voided,
              },
              ctx,
            ),
          );
          continue;
        }
        if (m.partyRole === "supplier") {
          const p = m.allocations[0];
          const po = p?.purchaseOrder;
          if (!p || !po) continue;
          out.push(
            factoryPaymentPlan(
              {
                id: m.id,
                ref: `FP-${po.refNo.replace(/^[A-Za-z]+-/, "")}-${rank.get(p.id) ?? 1}`,
                kind: p.kind as PaymentKind,
                order: orderOf(po),
                factory: m.party!,
                amountMinor: decimalToMinor(m.amount),
                currency: m.currency,
                rate: Number(m.rate),
                accountId: m.accountId,
                paidOn: fromDbDate(m.valueDate),
                voided,
              },
              ctx,
            ),
          );
          continue;
        }
        const numbers = m.allocations.map(numberOf);
        const first = m.allocations[0]?.order;
        out.push(
          movementPlan(
            {
              id: m.id,
              ref: numbers.length ? `${numbers[0]}${numbers.length > 1 ? ` +${numbers.length - 1}` : ""}` : "",
              direction: m.direction as "in" | "out",
              partyId: m.partyId!,
              amountMinor: decimalToMinor(m.amount),
              currency: m.currency,
              allocCurrency: m.allocCurrency,
              rate: Number(m.rate),
              allocatableMinor: decimalToMinor(m.allocatable),
              accountId: m.accountId,
              valueDate: fromDbDate(m.valueDate),
              orderRate: first ? rateOf(first) : null,
              parts: m.allocations.flatMap((a) =>
                a.order
                  ? [
                      {
                        id: a.id,
                        ref: numberOf(a),
                        kind: a.kind as PaymentKind,
                        order: orderOf(a.order),
                        amountMinor: decimalToMinor(a.amount),
                        bankChargesMinor: decimalToMinor(a.bankCharges),
                        voided: !!a.voidedAt,
                      },
                    ]
                  : [],
              ),
              voided,
            },
            ctx,
          ),
        );
      }
    }

    if (ids("allocation").length) {
      const rows = await tx.allocation.findMany({
        where: { id: { in: ids("allocation") } },
        include: { order: orderSel, movement: { select: { partyId: true, allocCurrency: true, voidedAt: true } } },
      });
      for (const a of rows)
        out.push(
          allocationPlan(
            {
              id: a.id,
              ref: numberOf(a),
              target: a.target as "order" | "purchase" | "refund" | "fee",
              partyId: a.movement.partyId!,
              later: a.later,
              amountMinor: decimalToMinor(a.amount),
              bankChargesMinor: decimalToMinor(a.bankCharges),
              currency: a.movement.allocCurrency,
              order: a.order ? { id: a.order.id, refNo: a.order.refNo, rate: rateOf(a.order) } : null,
              on: fromDbDate(a.on),
              note: a.note,
              movementVoided: !!a.movement.voidedAt,
              voided: this.voidOf(a.voidedAt, a.voidReason),
            },
            ctx,
          ),
        );
    }

    if (ids("expense").length) {
      const rows = await tx.expense.findMany({
        where: { id: { in: ids("expense") } },
        include: {
          paidBy: { select: { id: true, name: true } },
          order: {
            select: {
              ...orderSel.select,
              status: true,
              cancellation: { select: { factoryMoney: true } },
              lines: {
                where: { factoryId: { not: null }, factoryUnitPrice: { not: null }, factoryCurrency: { not: null } },
                select: { factoryId: true, factoryCurrency: true },
              },
            },
          },
        },
      });
      for (const e of rows) {
        const currencies = new Map<string, string[]>();
        for (const l of e.order?.lines ?? []) {
          const list = currencies.get(l.factoryId!) ?? [];
          if (!list.includes(l.factoryCurrency!)) list.push(l.factoryCurrency!);
          currencies.set(l.factoryId!, list);
        }
        out.push(
          expensePlan(
            {
              id: e.id,
              category: e.category,
              description: e.description,
              amountMinor: decimalToMinor(e.amount),
              currency: e.currency,
              rate: e.rate.toString(),
              spentOn: fromDbDate(e.spentOn),
              customerId: e.customerId,
              factoryId: e.factoryId,
              paidBy: e.paidBy,
              accountId: e.accountId,
              borneBy: e.borneBy,
              ownMoney: e.ownMoney,
              payLater: e.payLater,
              payee: e.payee,
              repaidOn: fromDbDateOrNull(e.repaidOn),
              repaidAccountId: e.repaidAccountId,
              order: e.order && {
                ...orderOf(e.order),
                cancelled: e.order.status === "cancelled",
                lossOnCancel: e.order.cancellation?.factoryMoney === "loss",
                factoryCurrencies: currencies,
              },
              step: e.step,
              voided: this.voidOf(e.voidedAt, e.voidReason),
            },
            ctx,
          ),
        );
      }
    }

    return out;
  }

  /** The opening balances of these accounts (after what is posted on them before their opening day). */
  private async openingPlans(tx: Tx, accountIds: string[], ctx: RuleCtx): Promise<DocPlan[]> {
    if (!accountIds.length) return [];
    const accounts = await tx.moneyAccount.findMany({ where: { id: { in: accountIds } } });
    if (!accounts.length) return [];
    const before = await tx.$queryRaw<{ id: string; minor: string }[]>`
      select a.id, coalesce(sum(l.debit - l.credit), 0)::text as minor
        from money_accounts a
        join ledger_entries l on l.account = 'money:' || a.id::text and l.date < a.opening_on and l.source_type <> 'account'
       where a.id = any(${accounts.map((a) => a.id)}::uuid[])
       group by a.id`;
    const sums = new Map(before.map((b) => [b.id, decimalToMinor(b.minor as never)]));
    return accounts.map((a) =>
      openingPlan(
        {
          id: a.id,
          name: a.name,
          currency: a.currency,
          openingMinor: decimalToMinor(a.openingBalance),
          openingOn: fromDbDate(a.openingOn),
          beforeMinor: sums.get(a.id) ?? 0,
        },
        ctx,
      ),
    );
  }

  /** Exchange differences of the orders and factory parts touched (from what is posted on them now). */
  private async fxPlans(tx: Tx, touched: Touched, ctx: RuleCtx): Promise<DocPlan[]> {
    const out: DocPlan[] = [];
    const orderIds = [...touched.orders];
    if (orderIds.length) {
      const orders = await tx.order.findMany({
        where: { id: { in: orderIds } },
        select: { id: true, refNo: true, customerId: true, currency: true },
      });
      const sums = await tx.$queryRaw<{ orderId: string; minor: string; base: string; n: number; last: Date | null }[]>`
        select l.order_id as "orderId", sum(l.debit - l.credit)::text as minor, sum(l.debit_base - l.credit_base)::text as base, count(*)::int as n, max(l.date) as last
          from ledger_entries l join orders o on o.id = l.order_id
         where l.order_id = any(${orderIds}::uuid[]) and l.account = 'customer:' || o.customer_id::text and l.currency = o.currency and l.source_type <> 'fx_order'
         group by l.order_id`;
      const by = new Map(sums.map((s) => [s.orderId, s]));
      for (const o of orders) {
        const s = by.get(o.id);
        out.push(
          fxPlan(
            "fx_order",
            o.id,
            {
              account: ledgerAccount.customer(o.customerId),
              currency: o.currency,
              dims: { orderId: o.id, customerId: o.customerId, factoryId: null, userId: null },
              ref: o.refNo,
              memo: `Exchange difference on ${o.refNo}`,
            },
            {
              minor: s ? decimalToMinor(s.minor as never) : 0,
              baseMinor: s ? decimalToMinor(s.base as never) : 0,
              rows: s?.n ?? 0,
              lastDate: s?.last ? fromDbDate(s.last) : null,
            },
            ctx.main,
          ),
        );
      }
    }
    const parts = [...touched.factoryParts].map((k) => k.split(":") as [string, string, string]);
    if (parts.length) {
      const orderIdsF = [...new Set(parts.map((p) => p[0]))];
      const [orders, sums, refs] = await Promise.all([
        tx.order.findMany({ where: { id: { in: orderIdsF } }, select: { id: true, refNo: true, customerId: true } }),
        tx.$queryRaw<{ orderId: string; account: string; currency: string; minor: string; base: string; n: number; last: Date | null }[]>`
          select order_id as "orderId", account, currency, sum(debit - credit)::text as minor, sum(debit_base - credit_base)::text as base, count(*)::int as n, max(date) as last
            from ledger_entries
           where order_id = any(${orderIdsF}::uuid[]) and account like 'factory:%' and source_type <> 'fx_factory'
           group by 1, 2, 3`,
        tx.$queryRaw<{ sourceId: string; ref: string }[]>`
          select distinct on (source_id) source_id as "sourceId", ref from ledger_entries
           where source_type = 'purchase_order' and split_part(source_id, ':', 1) = any(${orderIdsF}::text[])
           order by source_id, entry_no desc`,
      ]);
      const ordersById = new Map(orders.map((o) => [o.id, o]));
      const sumOf = new Map(sums.map((s) => [`${s.orderId}:${s.account.slice("factory:".length)}:${s.currency}`, s]));
      const refOf = new Map(refs.map((r) => [r.sourceId, r.ref]));
      for (const [orderId, factoryId, currency] of parts) {
        const o = ordersById.get(orderId);
        if (!o) continue;
        const s = sumOf.get(`${orderId}:${factoryId}:${currency}`);
        out.push(
          fxPlan(
            "fx_factory",
            `${orderId}:${factoryId}:${currency}`,
            {
              account: ledgerAccount.factory(factoryId),
              currency,
              dims: { orderId, customerId: o.customerId, factoryId, userId: null },
              ref: refOf.get(`${orderId}:${factoryId}`) ?? o.refNo,
              memo: `Exchange difference on what we paid for ${o.refNo}`,
            },
            {
              minor: s ? decimalToMinor(s.minor as never) : 0,
              baseMinor: s ? decimalToMinor(s.base as never) : 0,
              rows: s?.n ?? 0,
              lastDate: s?.last ? fromDbDate(s.last) : null,
            },
            ctx.main,
          ),
        );
      }
    }
    return out;
  }

  /* ---------------------------------------------------------------- comparing and writing */

  private async existing(tx: Tx, plans: DocPlan[]): Promise<Map<string, Existing[]>> {
    const out = new Map<string, Existing[]>();
    if (!plans.length) return out;
    const byType = new Map<string, string[]>();
    for (const p of plans) byType.set(p.sourceType, [...(byType.get(p.sourceType) ?? []), p.sourceId]);
    const rows = await tx.ledgerEntry.findMany({
      where: { OR: [...byType.entries()].map(([sourceType, ids]) => ({ sourceType, sourceId: { in: ids } })) },
      orderBy: [{ entryNo: "asc" }, { line: "asc" }],
    });
    for (const r of rows) {
      const k = `${r.sourceType}:${r.sourceId}`;
      out.set(k, [
        ...(out.get(k) ?? []),
        {
          id: r.id,
          sourceType: r.sourceType,
          sourceId: r.sourceId,
          part: r.part,
          date: fromDbDate(r.date),
          ref: r.ref,
          account: r.account,
          currency: r.currency,
          rate: r.rate?.toString() ?? null,
          orderId: r.orderId,
          customerId: r.customerId,
          factoryId: r.factoryId,
          userId: r.userId,
          moneyAccountId: r.moneyAccountId,
          debit: decimalToMinor(r.debit),
          credit: decimalToMinor(r.credit),
          debitBase: decimalToMinor(r.debitBase),
          creditBase: decimalToMinor(r.creditBase),
          reversesId: r.reversesId,
        },
      ]);
    }
    return out;
  }

  /** Make the posted rows of each document what its plan says; returns the orders, factory parts and accounts touched. */
  private async apply(tx: Tx, plans: DocPlan[], opts: PostOptions, ctx: RuleCtx, result: PostResult): Promise<Touched> {
    const touched: Touched = { orders: new Set(), factoryParts: new Set(), accounts: new Set() };
    if (!plans.length) return touched;
    const existing = await this.existing(tx, plans);
    const today = this.clock.today();
    const reason = opts.reason?.trim().slice(0, 500) || null;
    const postings: Posting[] = [];
    const note = (rows: { account: string; orderId?: string | null; currency: string; moneyAccountId?: string | null }[]) => {
      for (const r of rows) {
        const a = parseLedgerAccount(r.account);
        if (a.kind === "customer" && r.orderId) touched.orders.add(r.orderId);
        if (a.kind === "factory" && r.orderId && a.id) touched.factoryParts.add(`${r.orderId}:${a.id}:${r.currency}`);
        if (r.moneyAccountId) touched.accounts.add(r.moneyAccountId);
      }
    };

    for (const plan of plans) {
      const rows = existing.get(`${plan.sourceType}:${plan.sourceId}`) ?? [];
      note(rows);
      for (const p of plan.parts) note(p.lines.map((l) => ({ ...l, orderId: l.orderId ?? p.dims.orderId })));
      // The number a document without one gets: the one it was first posted with, else the next.
      if (plan.allocRef) {
        const kept =
          rows.find((r) => r.ref)?.ref ??
          (plan.parts.some((p) => !p.ref) ? await this.allocate(tx, plan.allocRef.prefix, plan.allocRef.year) : "");
        for (const p of plan.parts) if (!p.ref) p.ref = kept;
      }
      const reversed = new Set(rows.flatMap((r) => (r.reversesId ? [r.reversesId] : [])));
      const names = [...new Set([...plan.parts.map((p) => p.part), ...rows.map((r) => r.part)])];
      let changed: "posted" | "corrected" | "reversed" | null = null;
      for (const name of names) {
        const partRows = rows.filter((r) => r.part === name);
        const live = partRows.filter((r) => !r.reversesId && !reversed.has(r.id));
        const want = plan.parts.find((p) => p.part === name) ?? null;
        const src = { sourceType: plan.sourceType, sourceId: plan.sourceId };
        if (plan.voided) {
          if (live.length) {
            postings.push({ ...src, rows: this.reversal(live, plan.voided.on, plan.voided.reason ?? reason, "Removed") });
            changed = "reversed";
          } else if (!partRows.length && want) {
            // Removed before the ledger saw it (a rebuild): posted as it was, then reversed on the day it was removed.
            const first = this.rows(want, ctx);
            postings.push({ ...src, rows: first });
            postings.push({ ...src, rows: this.reversal(first, plan.voided.on, plan.voided.reason, "Removed") });
            changed = "reversed";
          }
          continue;
        }
        if (!live.length) {
          if (want) {
            postings.push({ ...src, rows: this.rows(want, ctx) });
            changed ??= "posted";
          }
          continue;
        }
        if (plan.mode === "full") {
          if (want && this.same(plan, live, want)) continue;
          postings.push({ ...src, rows: this.reversal(live, today, reason, want ? "Changed" : "Removed") });
          if (want) postings.push({ ...src, rows: this.rows(want, ctx) });
          changed = want ? "corrected" : "reversed";
          continue;
        }
        // delta: post the difference, key by key.
        if (!want) {
          postings.push({ ...src, rows: this.reversal(live, today, reason, "Removed") });
          changed = "reversed";
          continue;
        }
        const diff = this.difference(plan, partRows, want);
        if (!diff.length) continue;
        postings.push({
          ...src,
          rows: this.rows({ ...want, date: today, type: "correction", memo: `Changed: ${want.memo}`, lines: diff }, ctx, reason),
        });
        changed = "corrected";
      }
      if (changed) result[changed] += 1;
    }
    await this.write(tx, postings, opts.userId);
    result.postings += postings.length;
    result.rows += postings.reduce((t, p) => t + p.rows.length, 0);
    for (const p of postings) note(p.rows);
    return touched;
  }

  /** Whether the live rows are exactly what the part would post (the lines that count, their amounts and day). */
  private same(plan: DocPlan, live: Existing[], want: Part) {
    const sig = (
      r: { account: string; currency: string; side: string; minor: Minor; base: Minor; date: string } & Parameters<typeof key>[0],
    ) => `${key(r)}|${r.side}|${r.minor}${plan.compareBase ? `|${r.base}` : `|${r.date}`}`;
    const a = live
      .filter((r) => primary(plan.sourceType, r.account))
      .map((r) =>
        sig({ ...r, side: r.debit || r.debitBase ? "debit" : "credit", minor: r.debit || r.credit, base: r.debitBase || r.creditBase }),
      )
      .sort();
    const wanted = this.rows(want, null);
    const b = wanted
      .filter((r) => primary(plan.sourceType, r.account))
      .map((r) =>
        sig({ ...r, side: r.debit || r.debitBase ? "debit" : "credit", minor: r.debit || r.credit, base: r.debitBase || r.creditBase }),
      )
      .sort();
    return a.length === b.length && a.every((x, i) => x === b[i]);
  }

  /** What the part's lines come to less what is posted, per account and record (non-zero only), as lines. */
  private difference(plan: DocPlan, posted: Existing[], want: Part): Line[] {
    const net = new Map<string, { minor: Minor; line: Omit<Line, "side" | "minor"> }>();
    for (const r of posted) {
      if (!primary(plan.sourceType, r.account)) continue;
      const k = key(r);
      const cur = net.get(k) ?? {
        minor: 0,
        line: {
          account: r.account,
          currency: r.currency,
          rate: r.rate,
          orderId: r.orderId,
          customerId: r.customerId,
          factoryId: r.factoryId,
          userId: r.userId,
          moneyAccountId: r.moneyAccountId,
        },
      };
      cur.minor -= r.debit - r.credit;
      net.set(k, cur);
    }
    for (const l of want.lines) {
      const full = {
        ...l,
        orderId: l.orderId ?? want.dims.orderId,
        customerId: l.customerId ?? want.dims.customerId,
        factoryId: l.factoryId ?? want.dims.factoryId,
        userId: l.userId ?? want.dims.userId,
      };
      const k = key(full);
      const cur = net.get(k) ?? { minor: 0, line: { ...full } };
      cur.line = { ...cur.line, rate: l.rate };
      cur.minor += l.side === "debit" ? l.minor : -l.minor;
      net.set(k, cur);
    }
    return [...net.values()]
      .filter((v) => v.minor !== 0)
      .map((v) => ({ ...v.line, side: v.minor > 0 ? "debit" : "credit", minor: Math.abs(v.minor) }) as Line);
  }

  /** A part's rows: each line's main amount, the one that takes the rest, and an exchange difference when they still differ. */
  private rows(p: Part, ctx: RuleCtx | null, reason: string | null = null): NewRow[] {
    const lines = p.lines.filter((l) => l.minor > 0 || (l.baseMinor ?? 0) > 0);
    const bases = lines.map((l) => (l.takesRest ? 0 : baseOf(l)));
    const rest = lines.findIndex((l) => l.takesRest);
    if (rest >= 0) {
      const sum = (side: string) => lines.reduce((t, l, i) => t + (i !== rest && l.side === side ? bases[i]! : 0), 0);
      const other = lines[rest]!.side === "debit" ? "credit" : "debit";
      bases[rest] = Math.max(sum(other) - sum(lines[rest]!.side), 0);
    }
    // A line whose value is the rest and whose rate is not known: the rate it was converted at.
    const rateOf = (l: Line, i: number) =>
      l.rate === null || l.rate === undefined
        ? l.takesRest && bases[i]! > 0 && l.minor > 0
          ? String(Math.round((l.minor / bases[i]!) * 1e14) / 1e14)
          : null
        : String(l.rate);
    const out: NewRow[] = lines.map((l, i) => ({
      id: randomUUID(),
      part: p.part,
      date: p.date,
      ref: p.ref,
      type: p.type,
      account: l.account,
      currency: l.currency,
      rate: rateOf(l, i),
      orderId: l.orderId ?? p.dims.orderId,
      customerId: l.customerId ?? p.dims.customerId,
      factoryId: l.factoryId ?? p.dims.factoryId,
      userId: l.userId ?? p.dims.userId,
      moneyAccountId: l.moneyAccountId ?? null,
      debit: l.side === "debit" ? l.minor : 0,
      credit: l.side === "credit" ? l.minor : 0,
      debitBase: l.side === "debit" ? bases[i]! : 0,
      creditBase: l.side === "credit" ? bases[i]! : 0,
      memo: (l.memo ?? p.memo).slice(0, 300),
      reversesId: null,
      reason,
    }));
    const gap = out.reduce((t, r) => t + r.debitBase - r.creditBase, 0);
    if (gap !== 0 && ctx)
      out.push({
        ...out[0]!,
        id: randomUUID(),
        account: "fx_diff",
        currency: ctx.main,
        rate: "1",
        moneyAccountId: null,
        debit: gap < 0 ? -gap : 0,
        credit: gap > 0 ? gap : 0,
        debitBase: gap < 0 ? -gap : 0,
        creditBase: gap > 0 ? gap : 0,
        memo: `Exchange difference: ${p.memo}`.slice(0, 300),
      });
    return out;
  }

  /** Rows that undo these, one for one (sides swapped, in both currencies), on a day, with a reason. */
  private reversal(rows: (Existing | NewRow)[], on: ISODate, reason: string | null, what: "Removed" | "Changed"): NewRow[] {
    return rows.map((r) => ({
      id: randomUUID(),
      part: r.part,
      date: on,
      ref: r.ref,
      type: "correction",
      account: r.account,
      currency: r.currency,
      rate: r.rate,
      orderId: r.orderId,
      customerId: r.customerId,
      factoryId: r.factoryId,
      userId: r.userId,
      moneyAccountId: r.moneyAccountId,
      debit: r.credit,
      credit: r.debit,
      debitBase: r.creditBase,
      creditBase: r.debitBase,
      memo: `${what}: reverses ${r.ref}`.slice(0, 300),
      reversesId: r.id,
      reason: reason?.slice(0, 500) ?? null,
    }));
  }

  /** The next number of a document that has none (EX-2026-0001), from the company's counters. */
  private async allocate(tx: Tx, prefix: string, year: number) {
    return `${prefix}-${year}-${String(await nextCount(tx, `ledger-${prefix}-${year}`)).padStart(4, "0")}`;
  }

  private async write(tx: Tx, postings: Posting[], userId: string | null) {
    const list = postings.filter((p) => p.rows.length);
    if (!list.length) return;
    let entryNo = (await nextCount(tx, "ledger-entry", list.length)) - list.length;
    const data: Prisma.LedgerEntryCreateManyInput[] = [];
    for (const p of list) {
      entryNo += 1;
      const groupId = randomUUID();
      for (const [line, r] of p.rows.entries())
        data.push({
          id: r.id,
          entryNo,
          groupId,
          line,
          date: toDbDate(r.date),
          type: r.type,
          sourceType: p.sourceType,
          sourceId: p.sourceId,
          part: r.part,
          ref: r.ref.slice(0, 60),
          orderId: r.orderId,
          customerId: r.customerId,
          factoryId: r.factoryId,
          userId: r.userId,
          moneyAccountId: r.moneyAccountId,
          account: r.account,
          debit: fromMinor(r.debit),
          credit: fromMinor(r.credit),
          currency: r.currency,
          rate: r.rate,
          debitBase: fromMinor(r.debitBase),
          creditBase: fromMinor(r.creditBase),
          memo: r.memo,
          reversesId: r.reversesId,
          reason: r.reason,
          createdById: userId,
        });
    }
    await tx.ledgerEntry.createMany({ data });
  }

  /* ---------------------------------------------------------------- every record */

  /** Every document of the company, in date order (the rebuild posts them in this order). */
  async allRefs(db: Db): Promise<LedgerRef[]> {
    const rows = await db.$queryRaw<{ type: LedgerSource; id: string; day: Date }[]>`
      select 'order' as type, id::text, ordered_on as day from orders
      union all select 'purchase_order', o.id::text || ':' || l.factory_id::text, min(o.ordered_on) from orders o join order_lines l on l.order_id = o.id where l.factory_id is not null group by 1, 2
      union all select 'movement', id::text, value_date from money_movements
      union all select 'allocation', a.id::text, a."on" from allocations a join money_movements m on m.id = a.movement_id
       where a.later or (a.voided_at is not null and m.voided_at is null)
      union all select 'expense', id::text, spent_on from expenses
      union all select 'account', id::text, opening_on from money_accounts`;
    return rows
      .map((r) => ({ ...r, day: fromDbDate(r.day) }))
      .sort((a, b) =>
        a.day !== b.day ? (a.day < b.day ? -1 : 1) : SOURCE_ORDER[a.type] - SOURCE_ORDER[b.type] || a.id.localeCompare(b.id),
      )
      .map((r) => ({ type: r.type, id: r.id }));
  }

  /**
   * Post every record of the current company that is not posted as it stands (in date order, a batch per
   * transaction): the first time, every record; after that, only what differs. `dryRun`: all of it in one
   * transaction, rolled back, to see what it would write.
   */
  async syncAll(opts: { dryRun?: boolean; batch?: number } = {}): Promise<PostResult & { documents: number }> {
    const refs = await this.allRefs(this.prisma.db);
    const total: PostResult & { documents: number } = {
      postings: 0,
      rows: 0,
      posted: 0,
      corrected: 0,
      reversed: 0,
      documents: refs.length,
    };
    const add = (r: PostResult) => {
      for (const k of ["postings", "rows", "posted", "corrected", "reversed"] as const) total[k] += r[k];
    };
    // Batches in date order; an account's opening balance on its own, once what came before it is posted.
    const size = opts.batch ?? 150;
    const batches: LedgerRef[][] = [];
    let batch: LedgerRef[] = [];
    for (const r of refs) {
      if (r.type === "account" || batch.length >= size) {
        if (batch.length) batches.push(batch);
        batch = [];
      }
      if (r.type === "account") batches.push([r]);
      else batch.push(r);
    }
    if (batch.length) batches.push(batch);
    if (opts.dryRun) {
      const rollback = new Error("dry run");
      await this.prisma.db
        .$transaction(
          async (tx) => {
            for (const b of batches) add(await this.post(tx as Tx, b, { userId: null }));
            throw rollback;
          },
          { timeout: 30 * 60_000, maxWait: 60_000 },
        )
        .catch((e) => {
          if (e !== rollback) throw e;
        });
      return total;
    }
    for (const b of batches)
      add(
        await this.prisma.db.$transaction(async (tx) => this.post(tx as Tx, b, { userId: null }), { timeout: 5 * 60_000, maxWait: 60_000 }),
      );
    await this.prisma.db
      .$executeRaw`insert into ledger_state (built_at) values (now()) on conflict (company_id) do update set built_at = coalesce(ledger_state.built_at, excluded.built_at)`;
    if (total.postings)
      this.log.log(
        `${CompanyContext.require().slug}: posted ${total.posted} document(s), corrected ${total.corrected}, reversed ${total.reversed} (${total.rows} rows)`,
      );
    return total;
  }

  /** Whether the current company's ledger was posted from its records. */
  async built(): Promise<boolean> {
    return !!(await this.prisma.db.ledgerState.findFirst({ where: { builtAt: { not: null } }, select: { companyId: true } }));
  }

  private building = new Map<string, Promise<unknown>>();

  /** Posted from its records, if it never was (first use, a restore, a demo's sample data): once at a time per company. */
  async ensureBuilt(): Promise<void> {
    if (await this.built()) return;
    const company = CompanyContext.require().id;
    let p = this.building.get(company);
    if (!p) {
      p = this.syncAll().finally(() => this.building.delete(company));
      this.building.set(company, p);
    }
    await p;
  }

  /**
   * Start over (the CLI only): every row of the company removed — the one place that may (kebo.ledger_rewrite) —
   * and its numbers reset, then everything posted again.
   */
  async reset(): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${`ledger:${CompanyContext.require().id}`}))`;
      await tx.$executeRaw`set local kebo.ledger_rewrite = 'on'`;
      await tx.$executeRaw`delete from ledger_entries`;
      await tx.$executeRaw`delete from counters where key like 'ledger-%'`;
      await tx.$executeRaw`delete from ledger_state`;
    });
  }
}

interface Touched {
  orders: Set<string>;
  factoryParts: Set<string>;
  accounts: Set<string>;
}

@Global()
@Module({ providers: [LedgerPosting], exports: [LedgerPosting] })
export class LedgerPostingModule {}
