import { decimalToMinor, fromDbDateOrNull, type Prisma } from "@kebo/database";
import { fromMinor } from "@kebo/money";
import { defaultFactoryPlan, factoryPlanStatus, type FactoryDueRule, type FactoryPlanRow } from "@kebo/shared";
import type { ISODate } from "@kebo/utils";
import type { PrismaService, Tx } from "../../database/prisma.service";
import { factoryReadyOf, readySelect } from "@kebo/database";
import { factoryBorneExpenses, factoryPositionOf, type MoneyCtx, supplierPaidRelation } from "./position";

type Db = PrismaService["db"] | Tx;
type FactoryRef = { id: string; name: string };

/**
 * What we owe each factory for the order's goods (the price frozen on each
 * line when the order was made, plus tax unless it was included, × the quantity), in the factory's
 * currency, keyed "factoryId:currency".
 */
export function owedByFactory<F extends FactoryRef>(
  lines: { factory: F | null; factoryUnitPrice: Prisma.Decimal | null; factoryCurrency: string | null; factoryTaxRate: Prisma.Decimal | null; factoryTaxIncluded: boolean; quantity: Prisma.Decimal }[],
) {
  // The one formula (factoryPosition), without payments or expenses: only what the lines owe.
  const rows = factoryPositionOf({ lines: lines.map((l) => ({ ...l, factoryId: l.factory?.id ?? null })), supplierPaid: [], expenses: [] }, { main: "", rates: {}, expensesOn: false });
  const factories = new Map(lines.flatMap((l) => (l.factory ? [[l.factory.id, l.factory] as const] : [])));
  return new Map(rows.map((r) => [r.key, { factory: factories.get(r.factoryId)!, currency: r.currency, owedMinor: r.owedMinor, lines: r.lines }]));
}

const planLines = {
  where: { factoryId: { not: null } },
  select: {
    factoryId: true,
    factory: { select: { id: true, name: true } },
    factoryUnitPrice: true,
    factoryCurrency: true,
    factoryTaxRate: true,
    factoryTaxIncluded: true,
    quantity: true,
    // The offer the line was bought on: the advance it asks.
    quoteLine: { select: { factoryQuoteLine: { select: { factoryQuote: { select: { advancePercent: true } } } } } },
  },
} as const;

type AdvanceLine = { factoryId: string | null; quoteLine: { factoryQuoteLine: { factoryQuote: { advancePercent: Prisma.Decimal | null } } | null } | null };

/**
 * The advance a factory asks on this order: its offer's (FactoryQuote.advancePercent, the offer the lines
 * were bought on), else the company's default (Settings).
 */
export function advanceOf(lines: AdvanceLine[], factoryId: string, fallback: number): number {
  for (const l of lines) {
    const p = l.factoryId === factoryId ? l.quoteLine?.factoryQuoteLine?.factoryQuote.advancePercent : null;
    if (p !== null && p !== undefined) return Number(p);
  }
  return fallback;
}

/**
 * Each factory's payment plan on an order, with what is paid on each part and
 * where it stands. Paid counts what we sent and the expenses the factory bears
 * (taken off what we owe it, as on the order's money: factoryPosition), so a
 * balance the factory bore is not shown late. A factory without a stored plan
 * shows the company's default (advance on order, balance on the ready date)
 * until one is saved (the advance its offer asks, else Settings'); the balance's date follows that
 * factory's own ready date.
 */
export async function factoryPlansOf(db: Db, orderId: string, advancePercent: number, today: ISODate, soonDays: number, fx: MoneyCtx) {
  const o = await db.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      factoryOrderedOn: true,
      ...readySelect,
      lines: planLines,
      supplierPaid: supplierPaidRelation,
      expenses: factoryBorneExpenses,
      payables: { orderBy: { sortOrder: "asc" }, include: { supplier: { select: { id: true, name: true } } } },
    },
  });
  const names = new Map<string, FactoryRef>();
  for (const l of o.lines) if (l.factory) names.set(l.factory.id, l.factory);
  for (const r of o.payables) names.set(r.supplier!.id, r.supplier!);
  const positions = factoryPositionOf(o, fx).filter((r) => r.lines > 0);
  const owed = new Map(positions.map((r) => [r.key, { factory: names.get(r.factoryId)!, currency: r.currency, owedMinor: r.owedMinor, settledMinor: r.settledMinor, takenOffMinor: r.takenOffMinor }]));
  for (const r of o.payables) {
    const key = `${r.supplierId}:${r.currency}`;
    if (!owed.has(key)) {
      const paid = o.supplierPaid
        .filter((p) => `${p.movement.partyId}:${p.movement.currency}` === key)
        .reduce((t, p) => t + decimalToMinor(p.share), 0);
      owed.set(key, { factory: r.supplier!, currency: r.currency!, owedMinor: 0, settledMinor: paid, takenOffMinor: 0 });
    }
  }
  const orderedOn = fromDbDateOrNull(o.factoryOrderedOn);
  return [...owed.entries()].map(([key, f]) => {
    const stored = o.payables.filter((r) => `${r.supplierId}:${r.currency}` === key);
    const rows: (FactoryPlanRow & { id: string | null; supplierRef: string | null })[] = stored.length
      ? stored.map((r) => ({
          id: r.id,
          supplierRef: r.supplierRef,
          label: r.label,
          percent: r.percent === null ? null : Number(r.percent),
          amountMinor: decimalToMinor(r.amount),
          dueRule: r.dueRule as FactoryDueRule,
          dueOn: fromDbDateOrNull(r.dueOn),
        }))
      : defaultFactoryPlan(f.owedMinor, advanceOf(o.lines, f.factory.id, advancePercent)).map((r) => ({ ...r, id: null, supplierRef: null }));
    const paidMinor = f.settledMinor;
    const planMinor = rows.reduce((t, r) => t + r.amountMinor, 0);
    // This factory's own ready date (one per factory; the order's is the latest).
    const readyOn = factoryReadyOf(o, f.factory.id);
    const status = factoryPlanStatus(rows, paidMinor, orderedOn, readyOn, today, soonDays);
    const next = status.find((r) => r.status !== "paid") ?? null;
    return {
      factory: f.factory,
      currency: f.currency,
      /** The factory's ready date ("on the ready date" rows fall due then). */
      readyOn,
      owed: fromMinor(f.owedMinor),
      /** Saved for this order (false: the company's default, shown until saved). */
      saved: stored.length > 0,
      /** The plan adds up to something else than we owe (prices changed since): shown to fix. */
      differs: f.owedMinor > 0 && planMinor !== f.owedMinor ? fromMinor(f.owedMinor - planMinor) : null,
      /** Paid, with the expenses the factory bears (taken off what we owe it). */
      paid: fromMinor(paidMinor),
      takenOff: fromMinor(f.takenOffMinor),
      toPay: fromMinor(Math.max(f.owedMinor - paidMinor, 0)),
      rows: status.map((r) => ({
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
        due: r.due,
        paid: fromMinor(r.paidMinor),
        open: fromMinor(r.openMinor),
        status: r.status,
        inDays: r.inDays,
      })),
      next: next && { label: next.label, due: next.due, open: fromMinor(next.openMinor), status: next.status },
    };
  });
}

export type FactoryPlanView = Awaited<ReturnType<typeof factoryPlansOf>>[number];

/** Ordered from the factory: each factory owed on the order gets the default plan (its offer's advance), unless it has one. */
export async function seedFactoryPlans(tx: Tx, orderId: string, advancePercent: number) {
  const o = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { lines: planLines, payables: { select: { supplierId: true, currency: true } } } });
  for (const [key, f] of owedByFactory(o.lines)) {
    if (f.owedMinor <= 0 || o.payables.some((r) => `${r.supplierId}:${r.currency}` === key)) continue;
    await tx.invoice.createMany({
      data: defaultFactoryPlan(f.owedMinor, advanceOf(o.lines, f.factory.id, advancePercent)).map((r, i) => ({
        purchaseOrderId: orderId,
        supplierId: f.factory.id,
        label: r.label,
        percent: r.percent,
        amount: fromMinor(r.amountMinor),
        currency: f.currency,
        dueRule: r.dueRule,
        sortOrder: i,
      })),
    });
  }
}
