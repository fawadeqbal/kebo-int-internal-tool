import { decimalToMinor, fromDbDateOrNull, type Prisma } from "@kebo/database";
import { fromMinor } from "@kebo/money";
import { defaultSupplierPlan, supplierPlanStatus, offerPlan, shippedOnOf, storedParts, type SupplierDueRule, type SupplierPlanRow } from "@kebo/shared";
import type { ISODate } from "@kebo/utils";
import type { PrismaService, Tx } from "../../database/prisma.service";
import { supplierReadyOf, readySelect } from "@kebo/database";
import { supplierBorneExpenses, supplierPositionOf, type MoneyCtx, supplierPaidRelation } from "./position";

type Db = PrismaService["db"] | Tx;
type SupplierRef = { id: string; name: string };

/**
 * What we owe each supplier for the order's goods (the price frozen on each
 * line when the order was made, plus tax unless it was included, × the quantity), in the supplier's
 * currency, keyed "supplierId:currency".
 */
export function owedBySupplier<F extends SupplierRef>(
  lines: { factory: F | null; supplierUnitPrice: Prisma.Decimal | null; supplierCurrency: string | null; supplierTaxRate: Prisma.Decimal | null; supplierTaxIncluded: boolean; quantity: Prisma.Decimal }[],
) {
  // The one formula (supplierPosition), without payments or expenses: only what the lines owe.
  const rows = supplierPositionOf({ lines: lines.map((l) => ({ ...l, supplierId: l.factory?.id ?? null })), supplierPaid: [], expenses: [] }, { main: "", rates: {}, expensesOn: false });
  const suppliers = new Map(lines.flatMap((l) => (l.factory ? [[l.factory.id, l.factory] as const] : [])));
  return new Map(rows.map((r) => [r.key, { factory: suppliers.get(r.supplierId)!, currency: r.currency, owedMinor: r.owedMinor, lines: r.lines }]));
}

const planLines = {
  where: { supplierId: { not: null } },
  select: {
    supplierId: true,
    factory: { select: { id: true, name: true } },
    supplierUnitPrice: true,
    supplierCurrency: true,
    supplierTaxRate: true,
    supplierTaxIncluded: true,
    quantity: true,
    // The offer the line was bought on: the advance it asks, and its payment as parts.
    quoteLine: { select: { supplierQuoteLine: { select: { supplierQuote: { select: { advancePercent: true, paymentParts: true } } } } } },
  },
} as const;

type AdvanceLine = {
  supplierId: string | null;
  quoteLine: { supplierQuoteLine: { supplierQuote: { advancePercent: Prisma.Decimal | null; paymentParts?: Prisma.JsonValue } } | null } | null;
};

/**
 * The advance a supplier asks on this order: its offer's (SupplierQuote.advancePercent, the offer the lines
 * were bought on), else the company's default (Settings).
 */
export function advanceOf(lines: AdvanceLine[], supplierId: string, fallback: number): number {
  for (const l of lines) {
    const p = l.supplierId === supplierId ? l.quoteLine?.supplierQuoteLine?.supplierQuote.advancePercent : null;
    if (p !== null && p !== undefined) return Number(p);
  }
  return fallback;
}

/**
 * A supplier's plan on an order until one is saved (design "terms that travel", step 3): its offer's parts when
 * they are more than an advance and the rest when ready; else the company's usual plan — the advance its offer
 * asks (else Settings') when we order, the rest on its ready date — as before.
 */
export function startingPlan(lines: AdvanceLine[], supplierId: string, fallback: number, owedMinor: number): SupplierPlanRow[] {
  for (const l of lines) {
    const parts = l.supplierId === supplierId ? storedParts(l.quoteLine?.supplierQuoteLine?.supplierQuote.paymentParts, "factory") : null;
    const plan = parts ? offerPlan(parts, owedMinor) : null;
    if (plan) return plan;
    if (l.supplierId === supplierId && l.quoteLine?.supplierQuoteLine) break;
  }
  return defaultSupplierPlan(owedMinor, advanceOf(lines, supplierId, fallback));
}

/**
 * Each supplier's payment plan on an order, with what is paid on each part and
 * where it stands. Paid counts what we sent and the expenses the supplier bears
 * (taken off what we owe it, as on the order's money: supplierPosition), so a
 * balance the supplier bore is not shown late. A supplier without a stored plan
 * shows the company's default (advance on order, balance on the ready date)
 * until one is saved (the advance its offer asks, else Settings'); the balance's date follows that
 * supplier's own ready date.
 */
export async function supplierPlansOf(db: Db, orderId: string, advancePercent: number, today: ISODate, soonDays: number, fx: MoneyCtx) {
  const o = await db.order.findUniqueOrThrow({ where: { id: orderId }, select: planSelect });
  return plansOf(o, advancePercent, today, soonDays, fx);
}

/** supplierPlansOf for many orders in one read (lists across orders): each order's plans by its id. */
export async function supplierPlansFor(db: Db, orderIds: string[], advancePercent: number, today: ISODate, soonDays: number, fx: MoneyCtx) {
  const orders = orderIds.length ? await db.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, ...planSelect } }) : [];
  return new Map(orders.map((o) => [o.id, plansOf(o, advancePercent, today, soonDays, fx)] as const));
}

const planSelect = {
  supplierOrderedOn: true,
  ...readySelect,
  // "Days after shipping" parts count from the day the goods left (the earliest shipment).
  shipments: { select: { departedOn: true } },
  lines: planLines,
  supplierPaid: supplierPaidRelation,
  expenses: supplierBorneExpenses,
  payables: { orderBy: { sortOrder: "asc" }, include: { supplier: { select: { id: true, name: true } } } },
} satisfies Prisma.OrderSelect;

function plansOf(o: Prisma.OrderGetPayload<{ select: typeof planSelect }>, advancePercent: number, today: ISODate, soonDays: number, fx: MoneyCtx) {
  const names = new Map<string, SupplierRef>();
  for (const l of o.lines) if (l.factory) names.set(l.factory.id, l.factory);
  for (const r of o.payables) names.set(r.supplier!.id, r.supplier!);
  const positions = supplierPositionOf(o, fx).filter((r) => r.lines > 0);
  const owed = new Map(positions.map((r) => [r.key, { factory: names.get(r.supplierId)!, currency: r.currency, owedMinor: r.owedMinor, settledMinor: r.settledMinor, takenOffMinor: r.takenOffMinor }]));
  for (const r of o.payables) {
    const key = `${r.supplierId}:${r.currency}`;
    if (!owed.has(key)) {
      const paid = o.supplierPaid
        .filter((p) => `${p.movement.partyId}:${p.movement.currency}` === key)
        .reduce((t, p) => t + decimalToMinor(p.share), 0);
      owed.set(key, { factory: r.supplier!, currency: r.currency!, owedMinor: 0, settledMinor: paid, takenOffMinor: 0 });
    }
  }
  const orderedOn = fromDbDateOrNull(o.supplierOrderedOn);
  const shippedOn = shippedOnOf(o.shipments.map((x) => ({ departedOn: fromDbDateOrNull(x.departedOn) })));
  return [...owed.entries()].map(([key, f]) => {
    const stored = o.payables.filter((r) => `${r.supplierId}:${r.currency}` === key);
    const rows: (SupplierPlanRow & { id: string | null; supplierRef: string | null })[] = stored.length
      ? stored.map((r) => ({
          id: r.id,
          supplierRef: r.supplierRef,
          label: r.label,
          percent: r.percent === null ? null : Number(r.percent),
          amountMinor: decimalToMinor(r.amount),
          dueRule: r.dueRule as SupplierDueRule,
          dueOn: fromDbDateOrNull(r.dueOn),
          dueDays: r.dueDays,
        }))
      : startingPlan(o.lines, f.factory.id, advancePercent, f.owedMinor).map((r) => ({ ...r, id: null, supplierRef: null }));
    const paidMinor = f.settledMinor;
    const planMinor = rows.reduce((t, r) => t + r.amountMinor, 0);
    // This supplier's own ready date (one per supplier; the order's is the latest).
    const readyOn = supplierReadyOf(o, f.factory.id);
    const status = supplierPlanStatus(rows, paidMinor, orderedOn, readyOn, today, soonDays, shippedOn);
    const paidBy = paymentsOnParts(
      rows,
      o.supplierPaid.filter((p) => !p.voidedAt && `${p.movement.partyId}:${p.movement.currency}` === key).map((p) => ({ id: p.id, minor: decimalToMinor(p.share) })),
    );
    const next = status.find((r) => r.status !== "paid") ?? null;
    return {
      factory: f.factory,
      currency: f.currency,
      /** The supplier's ready date ("on the ready date" rows fall due then). */
      readyOn,
      owed: fromMinor(f.owedMinor),
      /** Saved for this order (false: the company's default, shown until saved). */
      saved: stored.length > 0,
      /** The plan adds up to something else than we owe (prices changed since): shown to fix. */
      differs: f.owedMinor > 0 && planMinor !== f.owedMinor ? fromMinor(f.owedMinor - planMinor) : null,
      /** Paid, with the expenses the supplier bears (taken off what we owe it). */
      paid: fromMinor(paidMinor),
      takenOff: fromMinor(f.takenOffMinor),
      toPay: fromMinor(Math.max(f.owedMinor - paidMinor, 0)),
      rows: status.map((r, i) => ({
        /** The invoice (null: the company's default, not saved yet). */
        id: r.id,
        /** The supplier's own invoice number, if they sent one. */
        supplierRef: r.supplierRef,
        label: r.label,
        percent: r.percent,
        amount: fromMinor(r.amountMinor),
        dueRule: r.dueRule,
        /** The fixed date as saved (on_order / on_ready rows take theirs from the order). */
        dueOn: r.dueOn,
        /** on_ship_plus_days: how many days after the goods leave. */
        dueDays: r.dueDays ?? null,
        due: r.due,
        paid: fromMinor(r.paidMinor),
        open: fromMinor(r.openMinor),
        status: r.status,
        inDays: r.inDays,
        /** The payments that paid this part (a payment can pay more than one part), oldest first. */
        payments: (paidBy[i] ?? []).map((x) => ({ id: x.id, amount: fromMinor(x.minor) })),
      })),
      next: next && { label: next.label, due: next.due, open: fromMinor(next.openMinor), status: next.status },
    };
  });
}

export type SupplierPlanView = Awaited<ReturnType<typeof supplierPlansOf>>[number];

/**
 * Which payments paid each part of a plan: payments pay the parts in order (the oldest first, as
 * supplierPlanStatus counts them), so each part lists the payments, or the shares of them, that went to
 * it. What is paid beyond the plan's parts goes to none. A part paid by what the supplier bears (an
 * expense taken off what we owe it) has no payment of its own.
 */
export function paymentsOnParts(parts: { amountMinor: number }[], payments: { id: string; minor: number }[]): { id: string; minor: number }[][] {
  const out = parts.map(() => [] as { id: string; minor: number }[]);
  let i = 0;
  let room = parts[0]?.amountMinor ?? 0;
  for (const p of payments) {
    let left = p.minor;
    while (left > 0 && i < parts.length) {
      if (room <= 0) {
        i += 1;
        room = parts[i]?.amountMinor ?? 0;
        continue;
      }
      const take = Math.min(left, room);
      out[i]!.push({ id: p.id, minor: take });
      left -= take;
      room -= take;
    }
  }
  return out;
}

/** Ordered from the supplier: each supplier owed on the order gets the default plan (its offer's advance), unless it has one. */
export async function seedSupplierPlans(tx: Tx, orderId: string, advancePercent: number) {
  const o = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { lines: planLines, payables: { select: { supplierId: true, currency: true } } } });
  for (const [key, f] of owedBySupplier(o.lines)) {
    if (f.owedMinor <= 0 || o.payables.some((r) => `${r.supplierId}:${r.currency}` === key)) continue;
    await tx.invoice.createMany({
      data: startingPlan(o.lines, f.factory.id, advancePercent, f.owedMinor).map((r, i) => ({
        purchaseOrderId: orderId,
        supplierId: f.factory.id,
        label: r.label,
        percent: r.percent,
        amount: fromMinor(r.amountMinor),
        currency: f.currency,
        dueRule: r.dueRule,
        dueDays: r.dueDays ?? null,
        sortOrder: i,
      })),
    });
  }
}
