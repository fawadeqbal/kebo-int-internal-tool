import { decimalToMinor, fromDbDateOrNull, type Prisma } from "@kebo/database";
import { fromMinor, multiplyMinor, withTaxMinor, type Minor } from "@kebo/money";
import { defaultFactoryPlan, factoryPlanStatus, type FactoryDueRule, type FactoryPlanRow } from "@kebo/shared";
import type { ISODate } from "@kebo/utils";
import type { PrismaService, Tx } from "../../database/prisma.service";

type Db = PrismaService["db"] | Tx;
type FactoryRef = { id: string; name: string };

/**
 * What we owe each factory for the order's goods (the price frozen on each
 * line when the order was made, plus tax, × the quantity), in the factory's
 * currency, keyed "factoryId:currency".
 */
export function owedByFactory<F extends FactoryRef>(
  lines: { factory: F | null; factoryUnitPrice: Prisma.Decimal | null; factoryCurrency: string | null; factoryTaxRate: Prisma.Decimal | null; quantity: Prisma.Decimal }[],
) {
  const owed = new Map<string, { factory: F; currency: string; owedMinor: Minor; lines: number }>();
  for (const l of lines) {
    if (!l.factory || l.factoryUnitPrice === null || !l.factoryCurrency) continue;
    const key = `${l.factory.id}:${l.factoryCurrency}`;
    const unit = withTaxMinor(decimalToMinor(l.factoryUnitPrice), l.factoryTaxRate?.toString() ?? 0);
    const cur = owed.get(key) ?? { factory: l.factory, currency: l.factoryCurrency, owedMinor: 0, lines: 0 };
    cur.owedMinor += multiplyMinor(unit, l.quantity.toString());
    cur.lines += 1;
    owed.set(key, cur);
  }
  return owed;
}

const planLines = {
  where: { factoryId: { not: null } },
  select: {
    factory: { select: { id: true, name: true } },
    factoryUnitPrice: true,
    factoryCurrency: true,
    factoryTaxRate: true,
    quantity: true,
  },
} as const;

/**
 * Each factory's payment plan on an order, with what is paid on each part and
 * where it stands. A factory without a stored plan shows the company's default
 * (advance on order, balance on the ready date) until one is saved; the
 * balance's date follows the order's ready date.
 */
export async function factoryPlansOf(db: Db, orderId: string, advancePercent: number, today: ISODate, soonDays: number) {
  const o = await db.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      factoryOrderedOn: true,
      readyOn: true,
      lines: planLines,
      factoryPaid: { where: { voidedAt: null }, select: { factoryId: true, currency: true, amount: true } },
      factoryPlan: { orderBy: { sortOrder: "asc" }, include: { factory: { select: { id: true, name: true } } } },
    },
  });
  const owed = owedByFactory(o.lines);
  for (const r of o.factoryPlan) {
    const key = `${r.factoryId}:${r.currency}`;
    if (!owed.has(key)) owed.set(key, { factory: r.factory, currency: r.currency, owedMinor: 0, lines: 0 });
  }
  const orderedOn = fromDbDateOrNull(o.factoryOrderedOn);
  const readyOn = fromDbDateOrNull(o.readyOn);
  return [...owed.entries()].map(([key, f]) => {
    const stored = o.factoryPlan.filter((r) => `${r.factoryId}:${r.currency}` === key);
    const rows: FactoryPlanRow[] = stored.length
      ? stored.map((r) => ({
          label: r.label,
          percent: r.percent === null ? null : Number(r.percent),
          amountMinor: decimalToMinor(r.amount),
          dueRule: r.dueRule as FactoryDueRule,
          dueOn: fromDbDateOrNull(r.dueOn),
        }))
      : defaultFactoryPlan(f.owedMinor, advancePercent);
    const paidMinor = o.factoryPaid.filter((p) => `${p.factoryId}:${p.currency}` === key).reduce((t, p) => t + decimalToMinor(p.amount), 0);
    const planMinor = rows.reduce((t, r) => t + r.amountMinor, 0);
    const status = factoryPlanStatus(rows, paidMinor, orderedOn, readyOn, today, soonDays);
    const next = status.find((r) => r.status !== "paid") ?? null;
    return {
      factory: f.factory,
      currency: f.currency,
      owed: fromMinor(f.owedMinor),
      /** Saved for this order (false: the company's default, shown until saved). */
      saved: stored.length > 0,
      /** The plan adds up to something else than we owe (prices changed since): shown to fix. */
      differs: f.owedMinor > 0 && planMinor !== f.owedMinor ? fromMinor(f.owedMinor - planMinor) : null,
      paid: fromMinor(paidMinor),
      toPay: fromMinor(Math.max(f.owedMinor - paidMinor, 0)),
      rows: status.map((r) => ({
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

/** Ordered from the factory: each factory owed on the order gets the default plan, unless it has one. */
export async function seedFactoryPlans(tx: Tx, orderId: string, advancePercent: number) {
  const o = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { lines: planLines, factoryPlan: { select: { factoryId: true, currency: true } } } });
  for (const [key, f] of owedByFactory(o.lines)) {
    if (f.owedMinor <= 0 || o.factoryPlan.some((r) => `${r.factoryId}:${r.currency}` === key)) continue;
    await tx.factoryPaymentPlan.createMany({
      data: defaultFactoryPlan(f.owedMinor, advancePercent).map((r, i) => ({
        orderId,
        factoryId: f.factory.id,
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
