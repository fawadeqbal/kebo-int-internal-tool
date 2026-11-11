import { livePart, decimalToMinor, fromDbDate, fromDbDateOrNull, type Prisma } from "@kebo/database";
import { fromMinor, orderCosting, orderMoney, roundHalfAway, toMinor, type Minor } from "@kebo/money";
import {
  factoryReadyActual,
  plannedAndSpent,
  planStatus,
  readSettings,
  readyDelay,
  shippedOnOf,
  shippedOnTime,
  type BasisStep,
  type ExpenseCategory,
} from "@kebo/shared";
import { daysBetween, dateIn, type ISODate } from "@kebo/utils";
import type { PrismaService, Tx } from "../../../database/prisma.service";
import { reachedOn } from "../../checklist/checklist-facts";
import { factoryPlansOf } from "../../billing/api";
import { convert, MainMoney, orderRate } from "../../money/order-money";
import { livePlansOf } from "../../billing/api";
import { factoryPositionOf, fxOf, positionOf, type MoneyCtx, supplierPaidRelation } from "../../billing/api";
import { factoryReadyOf, readyOnOf } from "@kebo/database";
import { optionFigures, worthOf } from "../../quotations/revision-figures";

/*
 * Insights data (PR B): the rows of the three calculated tables, worked out ONLY through the shared rules —
 * positionOf (orderPosition), the order's costing and orderMoney exactly as the order's Costs page reads them,
 * the live plan (planStatus), factoryPositionOf / factoryPlansOf, shippedOnOf, the ready dates per factory,
 * revision worth. No formula of its own: a figure here is one of those, turned into the main currency.
 */

type Db = PrismaService["db"] | Tx;

/** What every row is worked out against: the money rules' settings, the company's day and zone. */
export interface FactsCtx {
  fx: MoneyCtx;
  money: MainMoney;
  timeZone: string;
  today: ISODate;
  /** Settings › the advance a factory asks by default (its plan when none is saved). */
  factoryAdvancePercent: number;
}

/** Settings read fresh from the database (not the 30-second cache), so a change of rates is seen at once. */
export async function factsCtxOf(db: Db, timeZone: string, today: ISODate, expensesOn: boolean): Promise<FactsCtx> {
  const settings = readSettings(Object.fromEntries((await db.setting.findMany()).map((r) => [r.key, r.value])));
  return {
    fx: fxOf(settings, expensesOn),
    money: new MainMoney(settings.sales.currency, settings.sales.exchangeRates),
    timeZone,
    today,
    factoryAdvancePercent: settings.sales.factoryAdvancePercent,
  };
}

/** An open part of a plan, in the main currency: what the aging buckets are read from. */
export interface OpenPart {
  dueOn: ISODate | null;
  open: string;
}

/** A row as written: column → value (money as "1234.50", dates as "YYYY-MM-DD"). */
export type FactRow = Record<string, string | number | boolean | null | OpenPart[]>;

const money = (minor: Minor) => fromMinor(minor);
const sumOpen = (parts: OpenPart[]) => parts.reduce((t, p) => t + toMinor(p.open), 0);

/* ------------------------------------------------------------------------------------------- orders */

const orderSelect = {
  id: true,
  inquiryId: true,
  customerId: true,
  status: true,
  stage: true,
  orderedOn: true,
  shipBy: true,
  deliveredOn: true,
  closedAt: true,
  currency: true,
  total: true,
  depositPercent: true,
  mainCurrency: true,
  mainRate: true,
  customer: { select: { country: true } },
  inquiry: { select: { channel: true, category: true, assigneeId: true } },
  allocations: {
    where: livePart,
    orderBy: [{ on: "asc" }, { createdAt: "asc" }],
    select: { amount: true, bankCharges: true, voidedAt: true, on: true },
  },
  receivables: { orderBy: { sortOrder: "asc" }, select: { amount: true, part: true } },
  expenses: {
    where: { voidedAt: null },
    select: { amount: true, currency: true, rate: true, borneBy: true, voidedAt: true, category: true, factoryId: true },
  },
  costs: { select: { step: true, cost: true } },
  shipments: { select: { departedOn: true } },
  lines: {
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: {
      type: true,
      lineTotal: true,
      unitCost: true,
      quantity: true,
      receivedQty: true,
      receivedOn: true,
      factoryId: true,
      factoryUnitPrice: true,
      factoryCurrency: true,
      factoryTaxRate: true,
      factoryTaxIncluded: true,
      quoteLine: { select: { factoryQuoteLine: { select: { factoryQuote: { select: { factoryId: true } } } } } },
    },
  },
  supplierPaid: supplierPaidRelation,
  factories: { select: { factoryId: true, readyOn: true } },
  _count: { select: { claims: true } },
} satisfies Prisma.OrderSelect;

type OrderData = Prisma.OrderGetPayload<{ select: typeof orderSelect }>;

/** The day each inquiry's first quotation went out (as Insights reads it: the earliest sent day of a revision kept). */
async function firstQuotesOf(db: Db, inquiryIds: string[]): Promise<Map<string, ISODate>> {
  if (!inquiryIds.length) return new Map();
  const rows = await db.$queryRaw<{ inquiryId: string; on: ISODate }[]>`
    select q.inquiry_id as "inquiryId", to_char(min(r.sent_on), 'YYYY-MM-DD') as "on"
    from quotations q join quotation_revisions r on r.quotation_id = q.id
    where q.inquiry_id = any(${[...new Set(inquiryIds)]}::uuid[]) and r.deleted_at is null and r.sent_on is not null
    group by 1`;
  return new Map(rows.map((r) => [r.inquiryId, r.on]));
}

/** The order's money exactly as its Costs page works it out, in the order's currency (null: no rate to turn its expenses). */
function orderMoneyOf(o: OrderData, ctx: FactsCtx) {
  const perMain = orderRate(o, ctx.fx.main, ctx.fx.rates);
  const position = positionOf(o, ctx.fx);
  // Expenses are a plan feature: without it, no costs beyond the plan (as the order's money shows).
  const ours = ctx.fx.expensesOn ? o.expenses.filter((e) => e.borneBy === "us") : [];
  const inOrder = (e: { amount: Prisma.Decimal; rate: Prisma.Decimal }) => (perMain === null ? 0 : roundHalfAway(convert(decimalToMinor(e.amount), Number(e.rate)) * perMain));
  const plan = plannedAndSpent(
    o.costs.map((c) => ({ step: c.step as BasisStep, costMinor: decimalToMinor(c.cost) })),
    ours.map((e) => ({ category: e.category as ExpenseCategory, minor: inOrder(e) })),
  );
  const costing = orderCosting(
    o.lines.map((l) => ({ lineTotalMinor: decimalToMinor(l.lineTotal), quantity: l.quantity.toString(), unitCostMinor: l.unitCost === null ? null : decimalToMinor(l.unitCost) })),
    decimalToMinor(o.total),
    plan.plannedMinor,
  );
  const m = orderMoney({
    ...costing,
    receivedMinor: position.receivedMinor,
    factoryPaidMinor: 0,
    expensesMinor: plan.spentMinor,
    basisPaidMinor: plan.coveredMinor,
    bankChargesMinor: position.bankChargesMinor,
  });
  return { position, costing, plan, m };
}

/** Order and order × factory rows for these orders (orders that are gone simply have none). */
export async function orderFactsOf(db: Db, ids: string[], ctx: FactsCtx): Promise<{ orders: FactRow[]; factories: FactRow[] }> {
  if (!ids.length) return { orders: [], factories: [] };
  const orders = await db.order.findMany({ where: { id: { in: ids } }, select: orderSelect });
  // One after the other: inside a transaction they share one connection.
  const plans = await livePlansOf(db, orders.map((o) => o.id));
  const firstQuotes = await firstQuotesOf(db, orders.map((o) => o.inquiryId));
  const offers = await db.factoryQuote.groupBy({
    by: ["inquiryId", "factoryId"],
    where: { deletedAt: null, inquiryId: { in: [...new Set(orders.map((o) => o.inquiryId))] } },
    _count: { _all: true },
  });
  const offersOf = (inquiryId: string, factoryId: string) => offers.find((x) => x.inquiryId === inquiryId && x.factoryId === factoryId)?._count._all ?? 0;
  const main = ctx.fx.main;
  const out: FactRow[] = [];
  const factoryRows: FactRow[] = [];
  for (const o of orders) {
    const inMain = (minor: Minor) => ctx.money.order(minor, o);
    const { position, costing, plan, m } = orderMoneyOf(o, ctx);
    const live = o.status !== "cancelled";
    const orderedOn = fromDbDate(o.orderedOn);
    const shippedOn = shippedOnOf(o.shipments.map((s) => ({ departedOn: fromDbDateOrNull(s.departedOn) })));
    const shipBy = fromDbDateOrNull(o.shipBy);
    const firstQuote = firstQuotes.get(o.inquiryId) ?? null;

    // What is still open, part by part, as the plan stands today (charged expenses the plan does not date: no date).
    const parts = planStatus(plans.get(o.id)?.items ?? [], position.settledMinor, ctx.today, 0);
    const openParts: OpenPart[] = [];
    if (live && position.dueMinor > 0) {
      const charged = position.dueMinor - parts.reduce((t, p) => t + Math.max(p.openMinor, 0), 0);
      for (const p of parts) if (p.openMinor > 0) openParts.push({ dueOn: p.dueOn, open: money(inMain(p.openMinor)) });
      if (charged > 0) openParts.push({ dueOn: null, open: money(inMain(charged)) });
    }
    const overdue = overdueOf(openParts, ctx.today);
    // Paid on time: once paid in full, each dated part was settled by its date.
    const paidInFullOn = position.dueMinor === 0 && position.owedMinor > 0 ? reachedOn(o.allocations, position.owedMinor) : null;
    let cumulative = 0;
    const partsOnTime = parts.map((p) => {
      cumulative += p.amountMinor;
      const settledOn = reachedOn(o.allocations, cumulative);
      return !p.dueOn || (!!settledOn && settledOn <= p.dueOn);
    });
    out.push({
      order_id: o.id,
      inquiry_id: o.inquiryId,
      customer_id: o.customerId,
      handled_by: o.inquiry.assigneeId,
      country: o.customer.country,
      channel: o.inquiry.channel,
      category: o.inquiry.category,
      status: o.status,
      stage: o.stage,
      ordered_on: orderedOn,
      ship_by: shipBy,
      ready_on: readyOnOf(o),
      shipped_on: shippedOn,
      delivered_on: fromDbDateOrNull(o.deliveredOn),
      closed_on: o.closedAt ? dateIn(o.closedAt, ctx.timeZone) : null,
      currency: o.currency,
      main_currency: main,
      rate_known: ctx.money.known(o),
      total_main: money(inMain(costing.revenueMinor)),
      costed_main: money(inMain(costing.costedRevenueMinor)),
      cost_main: money(inMain(costing.goodsCostMinor + costing.basisCostMinor)),
      profit_quote_main: money(inMain(m.grossOnQuoteMinor)),
      profit_expected_main: money(inMain(m.expectedMinor)),
      margin_quote: m.grossMarginPercent,
      margin: m.marginPercent,
      expenses_main: money(inMain(plan.spentMinor)),
      costs_over_plan_main: money(inMain(m.grossOnQuoteMinor - m.expectedMinor)),
      received_main: money(inMain(position.settledMinor)),
      due_main: money(live ? inMain(position.dueMinor) : 0),
      overdue_main: money(overdue),
      open_parts: openParts,
      paid_in_full_on: paidInFullOn,
      paid_on_time: paidInFullOn ? partsOnTime.every(Boolean) : null,
      on_time: shippedOnTime(shipBy, shippedOn),
      days_quote_to_order: firstQuote ? daysBetween(firstQuote, orderedOn) : null,
      days_to_ship: shippedOn ? daysBetween(orderedOn, shippedOn) : null,
    });

    // One row per factory its lines are bought from.
    const factoryIds = [...new Set(o.lines.flatMap((l) => (l.factoryId ? [l.factoryId] : [])))];
    if (!factoryIds.length) continue;
    const positions = factoryPositionOf(o, ctx.fx).filter((r) => r.lines > 0);
    const factoryPlans = await factoryPlansOf(db, o.id, ctx.factoryAdvancePercent, ctx.today, 0, ctx.fx);
    for (const factoryId of factoryIds) {
      const mine = positions.filter((r) => r.factoryId === factoryId);
      const one = mine.length === 1 ? mine[0]! : null;
      const toMain = (minor: Minor, currency: string) => ctx.money.live(minor, currency);
      const toPayMain = mine.reduce((t, r) => t + toMain(r.toPayMinor, r.currency), 0);
      // Its plan's open parts in the main currency; what the plan does not date (prices changed since): no date.
      const parts: OpenPart[] = [];
      for (const fp of factoryPlans.filter((p) => p.factory.id === factoryId))
        for (const r of fp.rows) if (toMinor(r.open) > 0) parts.push({ dueOn: r.due, open: money(toMain(toMinor(r.open), fp.currency)) });
      const undated = toPayMain - sumOpen(parts);
      if (undated > 0) parts.push({ dueOn: null, open: money(undated) });
      const goods = o.lines.filter((l) => l.factoryId === factoryId && l.type === "goods");
      const promised = factoryReadyOf(o, factoryId);
      const actual = factoryReadyActual(
        goods.map((l) => ({ quantity: l.quantity.toString(), receivedQty: l.receivedQty.toString(), receivedOn: fromDbDateOrNull(l.receivedOn) })),
        shippedOn,
      );
      const delay = readyDelay(promised, actual);
      factoryRows.push({
        order_id: o.id,
        factory_id: factoryId,
        status: o.status,
        ordered_on: orderedOn,
        currency: one?.currency ?? null,
        owed: one ? money(one.owedMinor) : null,
        paid: one ? money(one.settledMinor) : null,
        to_pay: one ? money(one.toPayMinor) : null,
        main_currency: main,
        owed_main: money(mine.reduce((t, r) => t + toMain(r.owedMinor, r.currency), 0)),
        paid_main: money(mine.reduce((t, r) => t + toMain(r.settledMinor, r.currency), 0)),
        to_pay_main: money(toPayMain),
        open_parts: live ? parts : [],
        ready_promised: promised,
        ready_actual: actual,
        days_late: delay.daysLate,
        on_time: delay.onTime,
        offers_sent: offersOf(o.inquiryId, factoryId),
        offer_won: o.lines.some((l) => l.factoryId === factoryId && l.quoteLine?.factoryQuoteLine?.factoryQuote.factoryId === factoryId),
        claims: o._count.claims,
      });
    }
  }
  return { orders: out, factories: factoryRows };
}

/** Of the open parts, what was due before `today` (minor units of the main currency). */
export function overdueOf(parts: readonly OpenPart[], today: ISODate): Minor {
  return parts.reduce((t, p) => t + (p.dueOn && p.dueOn < today ? toMinor(p.open) : 0), 0);
}

/* ---------------------------------------------------------------------------------------- inquiries */

const inquirySelect = {
  id: true,
  customerId: true,
  assigneeId: true,
  channel: true,
  category: true,
  stage: true,
  lostReason: true,
  createdAt: true,
  closedAt: true,
  customer: { select: { country: true } },
  _count: { select: { factoryQuotes: { where: { deletedAt: null } } } },
  quotation: {
    select: {
      revisions: {
        where: { deletedAt: null },
        orderBy: { number: "desc" },
        select: { status: true, sentOn: true, currency: true, ...optionFigures },
      },
    },
  },
} satisfies Prisma.InquirySelect;

/** Inquiry rows (inquiries deleted or gone have none). */
export async function inquiryFactsOf(db: Db, ids: string[], ctx: FactsCtx): Promise<FactRow[]> {
  if (!ids.length) return [];
  const inquiries = await db.inquiry.findMany({ where: { id: { in: ids }, deletedAt: null }, select: inquirySelect });
  return inquiries.map((i) => {
    const receivedOn = dateIn(i.createdAt, ctx.timeZone);
    const revisions = i.quotation?.revisions ?? [];
    const sent = revisions.map((r) => fromDbDateOrNull(r.sentOn)).filter((d): d is ISODate => !!d).sort();
    const firstQuote = sent[0] ?? null;
    // The latest quotation that went out, at its accepted option, else its lowest (revision worth).
    const latest = revisions.find((r) => r.status !== "draft");
    const outcome = i.stage === "won" || i.stage === "lost" ? i.stage : "open";
    const closedOn = outcome !== "open" && i.closedAt ? dateIn(i.closedAt, ctx.timeZone) : null;
    return {
      inquiry_id: i.id,
      customer_id: i.customerId,
      handled_by: i.assigneeId,
      channel: i.channel,
      country: i.customer.country,
      category: i.category,
      stage: i.stage,
      received_on: receivedOn,
      first_quote_on: firstQuote,
      got_prices: i._count.factoryQuotes > 0,
      quoted_value_main: latest ? money(ctx.money.live(worthOf(latest).lowMinor, latest.currency)) : null,
      main_currency: ctx.fx.main,
      outcome,
      lost_reason: outcome === "lost" ? i.lostReason : null,
      closed_on: closedOn,
      days_to_first_quote: firstQuote ? daysBetween(receivedOn, firstQuote) : null,
      days_to_close: closedOn ? daysBetween(receivedOn, closedOn) : null,
    };
  });
}
