import { decimalToMinor, fromDbDate, fromDbDateOrNull, type Prisma } from "@kebo/database";
import { fromMinor, type Fx } from "@kebo/money";
import type { ChecklistFacts } from "@kebo/shared";
import { lcChecksOf } from "../money/route-plan";
import { chargedExpenses, positionOf } from "../money/position";
import { dateIn, type ISODate } from "@kebo/utils";

/** What one order's checklist is worked out from, read in one query. */
export const checklistOrderInclude = {
  payments: {
    where: { voidedAt: null },
    orderBy: { paidOn: "asc" },
    select: { currency: true, amount: true, bankCharges: true, paidOn: true },
  },
  bankContract: true,
  planItems: { orderBy: { sortOrder: "asc" }, select: { amount: true, dueRule: true, part: true } },
  expenses: chargedExpenses,
  shipments: { orderBy: { createdAt: "asc" } },
  documents: { select: { kind: true, status: true, number: true, issuedOn: true } },
  bankSteps: true,
  satChecks: { select: { result: true } },
  claims: { select: { status: true } },
  lines: { select: { type: true, quantity: true, receivedQty: true, packages: true, grossWeightKg: true, cbm: true } },
} satisfies Prisma.OrderInclude;

export type ChecklistOrderRow = Prisma.OrderGetPayload<{ include: typeof checklistOrderInclude }>;

/** The first payment date by which the money (with the bank charges) reached `targetMinor`. */
function reachedOn(payments: ChecklistOrderRow["payments"], currency: string, targetMinor: number): ISODate | null {
  let sum = 0;
  for (const p of payments.filter((x) => x.currency === currency)) {
    sum += decimalToMinor(p.amount) + decimalToMinor(p.bankCharges);
    if (sum >= targetMinor) return fromDbDate(p.paidOn);
  }
  return null;
}

/**
 * The checklist's facts for one order. `factories` comes from the order's money
 * (null when the person may not see factory money).
 */
export function checklistFactsOf(o: ChecklistOrderRow, factories: ChecklistFacts["factories"], timeZone: string, fx: Fx, lcCourierDays = 4): ChecklistFacts {
  // Where the order stands with the customer, as everywhere: the plan's deposit, what was charged to them.
  const position = positionOf(o, fx);
  const percent = position.depositPercent;
  const deposit = position.depositMinor;
  const depositIn = position.depositReceived;
  const goods = o.lines.filter((l) => l.type === "goods");
  const received = goods.filter((l) => Number(l.receivedQty) >= Number(l.quantity)).length;
  const sum = (f: (l: (typeof goods)[number]) => number) => goods.reduce((t, l) => t + f(l), 0);
  const b = o.bankContract;
  return {
    currency: o.currency,
    route: o.paymentRoute,
    shipMode: o.shipments[0]?.mode ?? null,
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
    depositOn: depositIn && deposit > 0 ? reachedOn(o.payments, o.currency, deposit) : null,
    deposit: fromMinor(deposit),
    due: fromMinor(position.dueMinor),
    paidInFullOn: position.dueMinor === 0 ? reachedOn(o.payments, o.currency, position.owedMinor) : null,
    factoryOrderedOn: fromDbDateOrNull(o.factoryOrderedOn),
    factoryOrderNo: o.factoryOrderNo,
    factories,
    lcChecks: lcChecksOf(o, lcCourierDays),
    readyOn: fromDbDateOrNull(o.readyOn),
    goods: { lines: goods.length, received },
    packedAt: o.packedAt ? dateIn(o.packedAt, timeZone) : null,
    packing: o.packedAt
      ? {
          packages: sum((l) => l.packages ?? 0),
          grossKg: sum((l) => Number(l.grossWeightKg ?? 0)).toLocaleString("en-US", { maximumFractionDigits: 2 }),
          cbm: sum((l) => Number(l.cbm ?? 0)).toFixed(2),
        }
      : null,
    shipments: o.shipments.map((s) => ({
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
    shippedOn: fromDbDateOrNull(o.shippedOn),
    blNo: o.blNo,
    proforma: o.proformaNo ? { number: o.proformaNo, issuedOn: fromDbDateOrNull(o.proformaIssuedOn) } : null,
    documents: o.documents.map((d) => ({ kind: d.kind, status: d.status, number: d.number, issuedOn: fromDbDateOrNull(d.issuedOn) })),
    bankSteps: o.bankSteps.map((s) => ({ step: s.step, doneOn: fromDbDate(s.doneOn), reference: s.reference })),
    deliveredOn: fromDbDateOrNull(o.deliveredOn),
    satDoneOn: fromDbDateOrNull(o.satDoneOn),
    satSignedBy: o.satSignedBy,
    claims: { open: o.claims.filter((c) => c.status === "open" || c.status === "with_factory").length, total: o.claims.length },
    closedOn: o.status === "closed" ? (o.closedAt ? dateIn(o.closedAt, timeZone) : fromDbDate(o.orderedOn)) : null,
  };
}
