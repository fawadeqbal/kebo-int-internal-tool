import { decimalToMinor, fromDbDate, fromDbDateOrNull, type Prisma } from "@kebo/database";
import { fromMinor } from "@kebo/money";
import { routeFromQuotation, type ChecklistFacts } from "@kebo/shared";
import { SHIPMENT_ORDER, shipFacts } from "../orders/shipment-facts";
import { lcChecksOf, termsOf } from "../money/route-plan";
import { readyByOf, readyOnOf, readySelect } from "../orders/ready";
import { chargedExpenses, positionOf, type MoneyCtx } from "../money/position";
import { dateIn, type ISODate } from "@kebo/utils";

/** What one order's checklist is worked out from, read in one query. */
export const checklistOrderInclude = {
  payments: {
    where: { voidedAt: null },
    orderBy: { paidOn: "asc" },
    select: { amount: true, bankCharges: true, paidOn: true },
  },
  bankContract: true,
  planItems: { orderBy: { sortOrder: "asc" }, select: { amount: true, dueRule: true, part: true } },
  expenses: chargedExpenses,
  // Shipment 1 (the primary) first: the facts list them in their order.
  shipments: { orderBy: SHIPMENT_ORDER },
  documents: { select: { kind: true, status: true, number: true, issuedOn: true, shipmentId: true } },
  bankSteps: true,
  satChecks: { select: { result: true } },
  claims: { select: { status: true } },
  lines: {
    select: { type: true, quantity: true, receivedQty: true, packages: true, grossWeightKg: true, cbm: true, factoryId: true, factory: { select: { name: true } } },
  },
  // Each factory's ready date (the order's is the latest of them).
  ...readySelect,
} satisfies Prisma.OrderInclude;

export type ChecklistOrderRow = Prisma.OrderGetPayload<{ include: typeof checklistOrderInclude }>;

/** The first payment date by which the money (with the bank charges) reached `targetMinor`. */
function reachedOn(payments: ChecklistOrderRow["payments"], targetMinor: number): ISODate | null {
  let sum = 0;
  for (const p of payments) {
    sum += decimalToMinor(p.amount) + decimalToMinor(p.bankCharges);
    if (sum >= targetMinor) return fromDbDate(p.paidOn);
  }
  return null;
}

/**
 * The checklist's facts for one order. `factories` comes from the order's money
 * (null when the person may not see factory money).
 */
export function checklistFactsOf(o: ChecklistOrderRow, factories: ChecklistFacts["factories"], timeZone: string, fx: MoneyCtx, lcCourierDays = 4): ChecklistFacts {
  // Where the order stands with the customer, as everywhere: the plan's deposit, what was charged to them.
  const position = positionOf(o, fx);
  const percent = position.depositPercent;
  const deposit = position.depositMinor;
  const depositIn = position.depositReceived;
  const goods = o.lines.filter((l) => l.type === "goods");
  const received = goods.filter((l) => Number(l.receivedQty) >= Number(l.quantity)).length;
  const sum = (f: (l: (typeof goods)[number]) => number) => goods.reduce((t, l) => t + f(l), 0);
  const b = o.bankContract;
  const ship = shipFacts(o.shipments);
  // A B/L or AWB row prints its shipment's number (Shipment 1's when it names none).
  const blOf = (shipmentId: string | null) => (ship.list.find((s) => s.id === shipmentId) ?? ship.primary)?.blNo ?? null;
  return {
    currency: o.currency,
    route: o.paymentRoute,
    shipMode: ship.primary?.mode ?? null,
    bankContract: b
      ? {
          status: b.status,
          number: b.number,
          amount: b.amount?.toFixed(2) ?? null,
          currency: b.currency,
          openedOn: fromDbDateOrNull(b.openedOn),
        }
      : null,
    depositPercent: percent,
    depositIn,
    depositOn: depositIn && deposit > 0 ? reachedOn(o.payments, deposit) : null,
    deposit: fromMinor(deposit),
    due: fromMinor(position.dueMinor),
    paidInFullOn: position.dueMinor === 0 ? reachedOn(o.payments, position.owedMinor) : null,
    factoryOrderedOn: fromDbDateOrNull(o.factoryOrderedOn),
    factoryOrderNo: o.factoryOrderNo,
    factories,
    lcChecks: lcChecksOf({ ...o, readyOn: readyOnOf(o) }, lcCourierDays),
    routeFromQuotation: routeFromQuotation(termsOf(o), o.balanceTerms),
    readyOn: readyOnOf(o),
    // Each factory's own date (production items per factory); one row when the lines name no factory.
    readyBy: readyByOf(o).map((r) => ({ factory: o.lines.find((l) => l.factoryId === r.factoryId)?.factory?.name ?? null, readyOn: r.readyOn })),
    goods: { lines: goods.length, received },
    packedAt: o.packedAt ? dateIn(o.packedAt, timeZone) : null,
    packing: o.packedAt
      ? {
          packages: sum((l) => l.packages ?? 0),
          grossKg: sum((l) => Number(l.grossWeightKg ?? 0)).toLocaleString("en-US", { maximumFractionDigits: 2 }),
          cbm: sum((l) => Number(l.cbm ?? 0)).toFixed(2),
        }
      : null,
    shipments: ship.list.map((s) => ({
      status: s.status,
      mode: s.mode,
      forwarder: s.forwarder,
      bookingNo: s.bookingNo,
      containerNo: s.containerNo,
      sealNo: s.sealNo,
      loadedOn: fromDbDateOrNull(s.loadedOn),
      vessel: s.vessel,
      blNo: s.blNo,
      etd: fromDbDateOrNull(s.etd),
      eta: fromDbDateOrNull(s.eta),
      departedOn: fromDbDateOrNull(s.departedOn),
      arrivedOn: fromDbDateOrNull(s.arrivedOn),
      portOfDischarge: s.portOfDischarge,
    })),
    shippedOn: ship.shippedOn,
    blNo: ship.blNo,
    proforma: o.proformaNo ? { number: o.proformaNo, issuedOn: fromDbDateOrNull(o.proformaIssuedOn) } : null,
    documents: o.documents.map((d) => ({
      kind: d.kind,
      status: d.status,
      number: d.kind === "bill_of_lading" || d.kind === "airway_bill" ? blOf(d.shipmentId) : d.number,
      issuedOn: fromDbDateOrNull(d.issuedOn),
    })),
    bankSteps: o.bankSteps.map((s) => ({ step: s.step, doneOn: fromDbDate(s.doneOn), reference: s.reference })),
    deliveredOn: fromDbDateOrNull(o.deliveredOn),
    satDoneOn: fromDbDateOrNull(o.satDoneOn),
    satSignedBy: o.satSignedBy,
    claims: { open: o.claims.filter((c) => c.status === "open" || c.status === "with_factory").length, total: o.claims.length },
    closedOn: o.status === "closed" ? (o.closedAt ? dateIn(o.closedAt, timeZone) : fromDbDate(o.orderedOn)) : null,
  };
}
