import { decimalToMinor, fromDbDate, fromDbDateOrNull, toDbDate, toDbDateOrNull, type Prisma } from "@kebo/database";
import { fromMinor, planDeposit, type Minor } from "@kebo/money";
import { lcChecks, primaryShipment, rebuildPlan, routePlan, shippedOnOf, type BalanceWhen, type LcCheck, type LcTerms, type RouteTerms } from "@kebo/shared";
import { addDays, type ISODate } from "@kebo/utils";
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
  stage: string;
  readyOn: Date | null;
};

/**
 * The route changed: the instalments paid in full stay, the rest is rebuilt
 * from the new route's parts (payments are never touched). New balances get a
 * date when it is already known (the ready or ship date, or the day the papers
 * reached the customer's bank). Returns the plan before and after, for the history.
 */
export async function rebuildRoutePlan(tx: Tx, o: PlanOrder, t: RouteTerms, days: { depositDays: number; balanceDays: number }) {
  const [items, payments, papers] = await Promise.all([
    tx.paymentPlanItem.findMany({ where: { orderId: o.id }, orderBy: { sortOrder: "asc" } }),
    tx.payment.findMany({ where: { orderId: o.id, voidedAt: null, currency: o.currency }, select: { amount: true, bankCharges: true } }),
    tx.orderBankStep.findFirst({ where: { orderId: o.id, step: "customer_bank_received" } }),
  ]);
  const totalMinor = decimalToMinor(o.total);
  // What came in (with the bank charges): it pays the instalments oldest first.
  const settled = payments.reduce((t, p) => t + decimalToMinor(p.amount) + decimalToMinor(p.bankCharges), 0);
  const stored = items.map((i) => ({ id: i.id, label: i.label, amountMinor: decimalToMinor(i.amount), dueOn: fromDbDateOrNull(i.dueOn) }));
  const fresh = routePlan(totalMinor, Number(o.depositPercent), t, fromDbDate(o.orderedOn), days.depositDays, papers ? fromDbDate(papers.doneOn) : null);
  const { keep, add } = rebuildPlan(stored, settled, fresh);
  // A balance not tied to the papers is dated as the stage dates it: ready date (before shipment), ship date (+ days).
  // The ship date is the shipments' (the earliest day one left).
  const departures = await tx.shipment.findMany({ where: { orderId: o.id }, select: { departedOn: true } });
  const shipped = shippedOnOf(departures.map((d) => ({ departedOn: fromDbDateOrNull(d.departedOn) })));
  const ready = o.readyOn ? fromDbDate(o.readyOn) : null;
  const before = (t.route === "informal" || t.route === null) && t.balanceWhen !== "against_bl_copy";
  const knownDue = (): ISODate | null => {
    if ((o.stage === "shipped" || o.stage === "done") && shipped) return before ? shipped : addDays(shipped, days.balanceDays);
    if (o.stage === "in_production" && ready && before) return ready;
    return null;
  };
  await tx.paymentPlanItem.deleteMany({ where: { orderId: o.id, id: { notIn: keep.map((k) => k.id) } } });
  for (const [n, a] of add.entries())
    await tx.paymentPlanItem.create({
      data: {
        orderId: o.id,
        label: a.label,
        amount: fromMinor(a.amountMinor),
        dueOn: toDbDateOrNull(a.dueOn ?? (a.part === "balance" && !a.dueRule ? knownDue() : null)),
        part: a.part,
        dueRule: a.dueRule,
        dueDays: a.dueDays,
        sortOrder: keep.length + n,
      },
    });
  const describe = (rows: { label: string; amountMinor: Minor }[]) => rows.map((r) => `${r.label} ${fromMinor(r.amountMinor)}`).join("; ");
  return { was: describe(stored), now: describe([...keep, ...add]) };
}

/** "Papers reached their bank" ticked (or undone): an LC balance's date follows it (+ its deferred days). */
export async function datePapers(tx: Tx, orderId: string, papersOn: ISODate | null) {
  const items = await tx.paymentPlanItem.findMany({ where: { orderId, dueRule: "after_papers" } });
  for (const i of items)
    await tx.paymentPlanItem.update({ where: { id: i.id }, data: { dueOn: papersOn ? toDbDate(addDays(papersOn, i.dueDays ?? 0)) : null } });
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
    readyOn: Date | null;
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
    readyOn: fromDbDateOrNull(o.readyOn),
    // Shipment 1's ETA: the shipment the papers go with.
    eta: fromDbDateOrNull(primaryShipment(o.shipments)?.eta ?? null),
    courierDays,
    shipBy: fromDbDateOrNull(o.shipBy),
  });
}
