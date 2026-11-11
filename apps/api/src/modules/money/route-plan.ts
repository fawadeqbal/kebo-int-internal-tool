import { decimalToMinor, fromDbDate, fromDbDateOrNull, livePart, toDbDateOrNull, type Prisma } from "@kebo/database";
import { fromMinor, planDeposit, type Minor } from "@kebo/money";
import { lcChecks, planItemLabel, primaryShipment, rebuildPlan, routePlan, type BalanceWhen, type LcCheck, type LcTerms, type RouteTerms } from "@kebo/shared";
import type { ISODate } from "@kebo/utils";
import type { Tx } from "../../database/prisma.service";

/** The route's terms as stored on an order. */
export const termsOf = (o: { paymentRoute: RouteTerms["route"]; balanceWhen: string | null; lcTerms: string | null; lcDays: number | null }): RouteTerms => ({
  route: o.paymentRoute,
  balanceWhen: (o.balanceWhen as BalanceWhen | null) ?? null,
  lcTerms: (o.lcTerms as LcTerms | null) ?? null,
  lcDays: o.lcDays,
});

type PlanOrder = {
  id: string;
  total: Prisma.Decimal;
  currency: string;
  depositPercent: Prisma.Decimal;
  orderedOn: Date;
  paymentRoute: RouteTerms["route"];
  balanceWhen: string | null;
  lcTerms: string | null;
  lcDays: number | null;
};

/**
 * The route changed (`was`: the terms before): the instalments paid in full stay, and so do the ones
 * changed by hand (a row no longer as the old route built it); the rest is rebuilt from the new route's
 * parts (payments are never touched). The new rows carry their due rules, so their dates follow the
 * order's dates from then on. Returns the plan before and after, for the history.
 */
export async function rebuildRoutePlan(tx: Tx, o: PlanOrder, was: RouteTerms, t: RouteTerms, days: { depositDays: number; balanceDays: number }) {
  const [items, payments] = await Promise.all([
    tx.paymentPlanItem.findMany({ where: { orderId: o.id }, orderBy: { sortOrder: "asc" } }),
    tx.allocation.findMany({ where: { orderId: o.id, ...livePart }, select: { amount: true, bankCharges: true } }),
  ]);
  const totalMinor = decimalToMinor(o.total);
  // What came in (with the bank charges): it pays the instalments oldest first.
  const settled = payments.reduce((t, p) => t + decimalToMinor(p.amount) + decimalToMinor(p.bankCharges), 0);
  const stored = items.map((i) => ({
    id: i.id,
    label: i.label,
    amountMinor: decimalToMinor(i.amount),
    dueOn: fromDbDateOrNull(i.dueOn),
    part: i.part,
    dueRule: i.dueRule,
    dueDays: i.dueDays,
  }));
  const orderedOn = fromDbDate(o.orderedOn);
  const built = routePlan(totalMinor, Number(o.depositPercent), was, orderedOn, days.depositDays, days.balanceDays);
  const fresh = routePlan(totalMinor, Number(o.depositPercent), t, orderedOn, days.depositDays, days.balanceDays);
  const { keep, add } = rebuildPlan(stored, settled, fresh, built);
  await tx.paymentPlanItem.deleteMany({ where: { orderId: o.id, id: { notIn: keep.map((k) => k.id) } } });
  // Kept rows first, in their order; then the new parts.
  for (const [n, k] of keep.entries()) await tx.paymentPlanItem.update({ where: { id: k.id }, data: { sortOrder: n } });
  for (const [n, a] of add.entries())
    await tx.paymentPlanItem.create({
      data: {
        orderId: o.id,
        label: a.label,
        amount: fromMinor(a.amountMinor),
        dueOn: toDbDateOrNull(a.dueRule === "fixed" ? a.dueOn : null),
        part: a.part,
        dueRule: a.dueRule,
        dueDays: a.dueDays,
        sortOrder: keep.length + n,
      },
    });
  const hasDeposit = (rows: { part?: string | null; amountMinor: Minor }[]) => rows.some((r) => r.part === "deposit" && r.amountMinor > 0);
  const describe = (rows: { label: string; part?: string | null; amountMinor: Minor }[], terms: RouteTerms) =>
    rows.map((r) => `${planItemLabel({ label: r.label, part: r.part ?? null, amountMinor: r.amountMinor }, totalMinor, terms, hasDeposit(rows))} ${fromMinor(r.amountMinor)}`).join("; ");
  return { was: describe(stored, was), now: describe([...keep, ...add], t) };
}

/**
 * What an LC must cover: the plan's LC part, else the order's balance after the
 * deposit (the plan's deposit row, else the accepted %). The bill of exchange and
 * the cover letter draw it (never more), and the LC checks compare against it.
 */
export function lcBalanceMinor(o: {
  total: Prisma.Decimal;
  depositPercent: Prisma.Decimal;
  planItems?: { amount: Prisma.Decimal; dueRule: string | null; part?: string | null }[];
}): Minor {
  const plan = o.planItems ?? [];
  const lcPart = plan.filter((p) => p.dueRule === "after_papers").reduce((t, p) => t + decimalToMinor(p.amount), 0);
  if (lcPart > 0) return lcPart;
  const total = decimalToMinor(o.total);
  return total - planDeposit(total, plan.map((p) => ({ amountMinor: decimalToMinor(p.amount), part: p.part ?? null })), Number(o.depositPercent)).depositMinor;
}

/** The LC checked against the order (null: not an LC order). */
export function lcChecksOf(
  o: {
    paymentRoute: string | null;
    currency: string;
    total: Prisma.Decimal;
    depositPercent: Prisma.Decimal;
    /** The order's ready date (the latest factory's). */
    readyOn: ISODate | null;
    /** Our ship-by: checked against the LC's latest shipment date. */
    shipBy: Date | null;
    planItems?: { amount: Prisma.Decimal; dueRule: string | null; part?: string | null }[];
    bankContract: { amount: Prisma.Decimal | null; currency: string | null; latestShipOn: Date | null; expiresOn: Date | null } | null;
    shipments: { id: string; createdAt: Date; eta: Date | null }[];
  },
  courierDays: number,
): LcCheck[] | null {
  if (o.paymentRoute !== "letter_of_credit") return null;
  const b = o.bankContract;
  return lcChecks({
    currency: o.currency,
    balanceMinor: lcBalanceMinor(o),
    lc: b
      ? { amount: b.amount?.toFixed(2) ?? null, currency: b.currency, latestShipOn: fromDbDateOrNull(b.latestShipOn), expiresOn: fromDbDateOrNull(b.expiresOn) }
      : null,
    readyOn: o.readyOn,
    // Shipment 1's ETA: the shipment the papers go with.
    eta: fromDbDateOrNull(primaryShipment(o.shipments)?.eta ?? null),
    courierDays,
    shipBy: fromDbDateOrNull(o.shipBy),
  });
}
