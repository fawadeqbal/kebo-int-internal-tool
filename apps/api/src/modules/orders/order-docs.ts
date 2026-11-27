import { decimalToMinor, fromDbDate, fromDbDateOrNull, livePartsWithEntry, type Prisma } from "@kebo/database";
import { documentTotals, fromMinor } from "@kebo/money";
import {
  BALANCE_TERMS_LABEL,
  balanceTermsOf,
  caseTotals,
  shipmentOfCase,
  leadWords,
  packingListNo,
  portsOf,
  routeAsAccepted,
  orderPaymentSentence,
  paperDetailsOf,
  paymentLineOf,
  warrantyLine,
  type BalanceTerms,
  type BuyerSnapshot,
  type Settings,
} from "@kebo/shared";
import { NotFoundError, type ISODate } from "@kebo/utils";
import type { PrismaService, Tx } from "../../database/prisma.service";
import { chargedExpenses, positionOf, type MoneyCtx } from "../billing/api";
import { termsOf } from "../billing/api";
import { buyerOf } from "./buyer";
import { makeFinal } from "../documents/api";
import { orderLineNumbers } from "./orders.service";
import { orderShipments, shipFacts } from "./shipment-facts";
import { caseRowOf, caseRowsSelect, caseView } from "./line-cases";
import { readyOnOf, readySelect } from "@kebo/database";
import { figuresOf, optionFigures } from "../quotations/revision-figures";

/**
 * The order's own documents, the proforma invoice and the packing list (single source of truth, PR 2:
 * papers that never move). Like every paper the app makes they are final papers with a snapshot:
 *  - the proforma is made final when it is issued (its number given), the packing list once the order is
 *    shipped with its packing filled in; re-printing shows exactly what was printed then;
 *  - "Make again" starts version 2 (a draft printed from the order now, same number), made final the same way;
 *  - proformas issued (and packing lists shipped) before this was so were snapshotted from the data when
 *    the API first started with it: those say "rebuilt from the data on <date>".
 * The internal copy (unit costs, money received, payments) is always read live: it is never sent.
 */
export const ORDER_DOCUMENTS = ["proforma", "packing-list"] as const;
export type OrderDocKind = (typeof ORDER_DOCUMENTS)[number];

const TITLE: Record<OrderDocKind, string> = { proforma: "Proforma invoice", "packing-list": "Packing list" };

/** "30% deposit, balance against B/L copy": only the first letter of the terms is lowered, so "B/L" stays as written. */
export function paymentTermsOf(depositPercent: number, balanceTerms: BalanceTerms): string {
  const terms = BALANCE_TERMS_LABEL[balanceTerms];
  return `${depositPercent > 0 ? `${depositPercent}% deposit, ` : ""}${depositPercent > 0 ? terms.charAt(0).toLowerCase() + terms.slice(1) : terms}`;
}

export const orderDocInclude = {
  paymentTerms: true,
  lines: {
    orderBy: { sortOrder: "asc" },
    include: {
      quoteLine: {
        select: {
          requestedItemId: true,
          requestedItem: { select: { parentId: true } },
          supplierQuoteLineId: true,
          supplierQuoteLine: { select: { parentId: true } },
        },
      },
      // The packing list prints each case (case number, package, size, weights).
      cases: caseRowsSelect,
    },
  },
  // The LC or bank contract: the packing list's "Notify bank".
  bankContract: true,
  // The accepted option's discount and lead time (the revision keeps no figures of its own).
  revision: { include: { quotation: { select: { refNo: true } }, ...optionFigures } },
  allocations: livePartsWithEntry,
  receivables: { orderBy: { sortOrder: "asc" }, select: { amount: true, part: true, dueRule: true, dueDays: true, dueOn: true } },
  expenses: chargedExpenses,
  inquiry: { select: { contactId: true } },
  papers: { where: { kind: { in: [...ORDER_DOCUMENTS] } }, orderBy: { version: "asc" } },
  // The packing list prints the shipment's B/L, date, container and ports (Shipment 1).
  shipments: orderShipments,
  ...readySelect,
} satisfies Prisma.OrderInclude;

export type DocOrder = Prisma.OrderGetPayload<{ include: typeof orderDocInclude }>;

export interface DocCtx {
  settings: Settings;
  fx: MoneyCtx;
  today: ISODate;
  /** The internal copy's unit costs (people who see supplier prices). */
  seeCosts: boolean;
  buyer: BuyerSnapshot;
}

/** The document's number: the proforma's once issued (null before), the packing list's from the order's. */
export const docNumber = (o: { refNo: string; proformaNo: string | null }, kind: OrderDocKind) =>
  kind === "proforma" ? o.proformaNo : packingListNo(o.refNo);

/** The packing list is made final once the order is shipped and its packing is filled in. */
export const packingFinalNow = (o: { stage: string; packedAt: Date | null }) => !!o.packedAt && (o.stage === "shipped" || o.stage === "done");

/** The quotation's own payment text is printed: the route is still the accepted one, or someone chose to print it. */
export const quotedTermsPrinted = (o: Parameters<typeof termsOf>[0] & { balanceTerms: BalanceTerms; printQuotedTerms: boolean }) =>
  o.printQuotedTerms || routeAsAccepted(termsOf(o), o.balanceTerms);

/** The document made from the order as it is now (a draft, or what a final version keeps). */
export function buildOrderDoc(o: DocOrder, kind: OrderDocKind, c: DocCtx, only?: { shipmentId: string }) {
  const rev = o.revision;
  const t = documentTotals(o.lines.map((l) => ({ quantity: l.quantity.toString(), unitPrice: l.unitPrice.toString() })), figuresOf(rev).discount);
  // Where the order stands, as on every screen: the plan's deposit (a plan edited to 50% says 50%), what was charged.
  const position = positionOf(o, c.fx);
  const depositPercent = position.depositPercent;
  // The shipment's, never the order's: shipped on (the earliest departure), Shipment 1's B/L, container and ports.
  const all = shipFacts(o.shipments);
  // One shipment's packing list (packing for machines, 25 Nov 2026): its own B/L, container, ports and date, and
  // only the packages it takes.
  const one = only ? (all.list.find((x) => x.id === only.shipmentId) ?? null) : null;
  if (only && (!one || kind !== "packing-list")) throw new NotFoundError("Shipment");
  const ship = one
    ? { ...all, primary: one, shippedOn: fromDbDateOrNull(one.departedOn), blNo: one.blNo, containerNo: one.containerNo, containerType: one.containerType }
    : all;
  const shippedOn = ship.shippedOn;
  const goodsOnly = kind === "packing-list";
  const shipmentIds = all.list.map((x) => x.id);
  const lines = o.lines
    .filter((l) => !goodsOnly || l.type === "goods")
    .map((l) => (one ? packedIn(l, one.id, shipmentIds) : l))
    .filter((l) => !one || l.cases.length > 0);
  const numbers = orderLineNumbers(lines);
  // The terms follow the route; the quotation's own text only while the route is still the accepted one (or chosen).
  const terms = termsOf(o);
  const quoted = quotedTermsPrinted(o);
  const b = c.buyer;
  const bc = o.bankContract;
  const ports = portsOf(o, ship.primary);
  // Under the title (design "papers in the customer's format", 25 Nov 2026): shipper, buyer, the bank by the
  // route (the packing list; the proforma is what the LC is opened against) and the shipping.
  const details = paperDetailsOf({
    company: c.settings.company,
    buyer: b,
    route: terms.route,
    withBank: goodsOnly,
    contract: bc
      ? { number: bc.number, reference: bc.reference, customerBank: bc.customerBank, customerBankAddress: bc.customerBankAddress, openedOn: fromDbDateOrNull(bc.openedOn) }
      : null,
    proformaIssuedOn: fromDbDateOrNull(o.proformaIssuedOn),
    ports,
    hsCodes: o.lines.filter((l) => l.type === "goods").map((l) => ({ customer: l.hsCode, china: l.hsCodeCn })),
  });
  const plan = o.receivables.map((r) => ({ amountMinor: decimalToMinor(r.amount), part: r.part, dueRule: r.dueRule, dueDays: r.dueDays, dueOn: fromDbDateOrNull(r.dueOn) }));
  const paymentSentence = orderPaymentSentence({
    depositPercent,
    terms,
    accepted: o.balanceTerms,
    quote: rev,
    plan,
    totalMinor: decimalToMinor(o.total),
  });
  const parts = plan.filter((r) => r.amountMinor > 0);
  const paymentTerms = paymentTermsOf(depositPercent, balanceTermsOf(terms, o.balanceTerms));

  return {
    kind,
    title: TITLE[kind],
    // The proforma has its own number once issued (KEB260916TN07); before that it is a draft without one.
    number: one ? `${docNumber(o, kind)}-${all.list.indexOf(one) + 1}` : docNumber(o, kind),
    /** The proforma not issued yet: printed as a draft, without a number (a next version's draft: see DocumentsService.get). */
    draft: kind === "proforma" && !o.proformaNo,
    date: kind === "proforma" ? (fromDbDateOrNull(o.proformaIssuedOn) ?? c.today) : (shippedOn ?? c.today),
    company: { ...c.settings.company, stamp: c.settings.company.stamp || null },
    /** The buyer as on the order (frozen when the order was made; refreshed from the customer only with a reason). */
    customer: { name: b.name, country: b.country, address: b.address, taxNo: b.taxNo, regNo: b.regNo, contact: b.contact },
    order: {
      id: o.id,
      refNo: o.refNo,
      stage: o.stage,
      status: o.status,
      orderedOn: fromDbDate(o.orderedOn),
      shipBy: fromDbDateOrNull(o.shipBy),
      readyOn: readyOnOf(o),
      shippedOn,
      blNo: ship.blNo,
      incoterm: o.incoterm,
      incotermPlace: o.incotermPlace,
      quotation: `${rev.quotation.refNo} R${rev.number}`,
      /** Heading over the lines, e.g. "COMPLETE AUTOMATIC LIQUID SYRUP FILLING LINE". */
      documentTitle: o.documentTitle,
      portOfDischarge: o.portOfDischarge,
      /** e.g. "90 days after receiving advance payment": the order's own agreed days first (review 24 Nov, O-29). */
      leadTime: o.leadDays !== null && o.leadDays !== undefined ? leadWords(o.leadDays, o.leadFrom, "customer") : figuresOf(rev).leadTime,
      /** The warranty agreed, as papers print it ("12 months from shipment, parts and service."). */
      warranty: warrantyLine({ warrantyMonths: o.warrantyMonths ?? null, warrantyFrom: o.warrantyFrom ?? null, warranty: o.warrantyWords ?? null }),
      /** The customer's own order number, when they gave one. */
      customerRef: o.customerRef ?? null,
      /** The proforma's number once issued: the packing list names it as its invoice. */
      proformaNo: o.proformaNo,
    },
    /**
     * The packing list: the shipment it goes with (Shipment 1), its ports as the papers print them (its own,
     * else from the terms). Versions made before this was so have none (they printed the order's).
     */
    shipment: goodsOnly ? { mode: ship.primary?.mode ?? "sea", ...ports } : null,
    paymentTerms,
    /** The payment terms from the route, e.g. "Our usual payment is made by 30% Advance deposit and 70% before shipment." */
    paymentSentence,
    /** Shipper, buyer, the bank by the route and the shipping, under the title (versions made before 25 Nov 2026 have none). */
    details,
    /** The packing list's "Payment:" line: "100% irrevocable LC at sight (LC No. …) Ref. No. …". */
    paymentLine: goodsOnly
      ? paymentLineOf({
          depositPercent,
          terms,
          plainPlan: parts.length <= 1 || (parts.length === 2 && parts[0]!.part === "deposit" && parts[1]!.part === "balance"),
          termsText: paymentTerms,
          sentence: paymentSentence,
          contract: bc ? { number: bc.number, reference: bc.reference } : null,
        })
      : null,
    currency: o.currency,
    showPrices: !goodsOnly,
    lines: lines.map((l, i) => ({
      id: l.id,
      /** "1", "2", "2.1" (a part of item 2). */
      no: numbers[i],
      type: l.type,
      description: l.description,
      /** The item in Chinese (printed under the English in English + 中文); null until written. */
      descriptionZh: l.descriptionZh,
      model: l.model,
      quantity: l.quantity.toString(),
      unit: l.unit,
      unitPrice: goodsOnly ? null : l.unitPrice.toFixed(2),
      lineTotal: goodsOnly ? null : l.lineTotal.toFixed(2),
      /** The internal copy only, for people who may see supplier costs (sales currency, per unit). */
      unitCost: goodsOnly || !c.seeCosts ? null : (l.unitCost?.toFixed(2) ?? null),
      // Packing list only: what the packing list form recorded (null until filled in).
      packing: goodsOnly
        ? {
            packages: l.packages,
            packageType: l.packageType,
            netWeightKg: l.netWeightKg?.toFixed(2) ?? null,
            grossWeightKg: l.grossWeightKg?.toFixed(2) ?? null,
            cbm: l.cbm?.toFixed(3) ?? null,
            /** Case by case, as the packing list prints them (what the totals above add up). */
            cases: l.cases.map(caseView),
          }
        : null,
    })),
    packing: goodsOnly
      ? {
          done: o.packedAt !== null,
          containerNo: ship.containerNo,
          shippingMarks: o.shippingMarks,
          totals: {
            packages: lines.reduce((s, l) => s + (l.packages ?? 0), 0),
            netWeightKg: lines.reduce((s, l) => s + Number(l.netWeightKg ?? 0), 0).toFixed(2),
            grossWeightKg: lines.reduce((s, l) => s + Number(l.grossWeightKg ?? 0), 0).toFixed(2),
            cbm: lines.reduce((s, l) => s + Number(l.cbm ?? 0), 0).toFixed(3),
          },
        }
      : null,
    totals: goodsOnly
      ? null
      : {
          subtotal: fromMinor(t.subtotal),
          discount: fromMinor(t.discount),
          total: fromMinor(t.total),
          deposit: fromMinor(position.depositMinor),
          depositPercent,
          /** Expenses charged to the customer: part of what is due. */
          charged: fromMinor(position.chargedMinor),
          received: fromMinor(position.settledMinor),
          due: fromMinor(position.dueMinor),
        },
    /** The quotation's own payment and delivery terms (free text, printed as bullets). */
    paymentTermsText: kind === "packing-list" || !quoted ? null : rev.paymentTerms,
    deliveryTermsText: kind === "packing-list" ? null : rev.deliveryTerms,
    bankDetails: kind === "packing-list" ? null : c.settings.company.bankDetails || null,
    /** The internal copy: every payment received (the customer's copy shows only the total). */
    payments: goodsOnly
      ? []
      : o.allocations.map((p) => ({
          paidOn: fromDbDate(p.on),
          kind: p.kind,
          amount: p.amount.toFixed(2),
          bankCharges: p.bankCharges.toFixed(2),
          currency: p.movement.allocCurrency,
          reference: p.later ? null : p.movement.reference,
        })),
    notes: kind === "packing-list" ? null : rev.notes,
    footer: c.settings.company.invoiceFooter || null,
  };
}

/** A line with only the packages one shipment takes, and its totals as those add up. */
function packedIn<L extends DocOrder["lines"][number]>(l: L, shipmentId: string, shipmentIds: string[]): L {
  const cases = l.cases.filter((x) => shipmentOfCase(caseRowOf(x), shipmentIds) === shipmentId);
  const t = caseTotals(cases.map(caseRowOf));
  // Read as the stored decimals are (toFixed, Number()).
  const dec = (n: number | null) => (n === null ? null : ({ toFixed: (p: number) => n.toFixed(p), toString: () => String(n), valueOf: () => n } as unknown as NonNullable<L["cbm"]>));
  return { ...l, cases, packages: t.packages, packageType: t.packageType, netWeightKg: dec(t.netWeightKg), grossWeightKg: dec(t.grossWeightKg), cbm: dec(t.cbm) };
}

export type OrderDocData = ReturnType<typeof buildOrderDoc>;
/** What a final version keeps: the customer's copy as printed, and whether it was rebuilt from the data. */
export type OrderDocSnapshot = OrderDocData & { rebuiltOn: ISODate | null };

/**
 * A final version's snapshot shown again: exactly what was printed, with only the internal copy's parts
 * read live (unit costs for people who see them, money received, payments) and the order's status (a
 * cancelled order's paper says so).
 */
export function overlayLive(snap: OrderDocSnapshot, live: OrderDocData): OrderDocSnapshot {
  const cost = new Map(live.lines.map((l) => [l.id, l.unitCost]));
  return {
    ...snap,
    draft: false,
    order: { ...snap.order, status: live.order.status, stage: live.order.stage },
    lines: snap.lines.map((l) => ({ ...l, unitCost: l.id ? (cost.get(l.id) ?? null) : null })),
    totals:
      snap.totals && live.totals
        ? {
            ...snap.totals,
            deposit: live.totals.deposit,
            depositPercent: live.totals.depositPercent,
            charged: live.totals.charged,
            received: live.totals.received,
            due: live.totals.due,
          }
        : snap.totals,
    payments: live.payments,
  };
}

type Db = Tx | PrismaService["db"];

/**
 * Makes the document's open version final (version 1 when there is none): keeps exactly what it prints now
 * as the snapshot. `rebuilt`: taken afterwards from the data (issued before snapshots were kept).
 * Returns the version made final, or null when the latest is already final.
 */
export async function freezeOrderDoc(
  tx: Db,
  orderId: string,
  kind: OrderDocKind,
  ctx: { settings: Settings; fx: MoneyCtx; today: ISODate; byId: string; rebuilt?: boolean },
): Promise<number | null> {
  const o = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: orderDocInclude });
  const number = docNumber(o, kind);
  if (!number) return null;
  const rows = o.papers.filter((p) => p.kind === kind);
  const latest = rows.at(-1);
  if (latest?.status === "final") return null;
  const doc = buildOrderDoc(o, kind, { ...ctx, seeCosts: false, buyer: await buyerOf(tx, o, ctx.today) });
  const version = latest?.version ?? 1;
  const snapshot: OrderDocSnapshot = {
    ...doc,
    draft: false,
    // A later version is dated the day it is made final.
    date: version > 1 ? ctx.today : doc.date,
    payments: [],
    rebuiltOn: ctx.rebuilt ? ctx.today : null,
  };
  await makeFinal(tx, latest ?? null, { orderId, kind, number, byId: ctx.byId, snapshot: snapshot as unknown as Prisma.InputJsonValue });
  return version;
}

/** Orders whose proforma was issued, or packing list shipped, before snapshots were kept (no version yet). */
export async function ordersToRebuild(db: Db) {
  const [proformas, packing] = await Promise.all([
    db.order.findMany({ where: { proformaNo: { not: null }, papers: { none: { kind: "proforma" } } }, select: { id: true, createdById: true } }),
    db.order.findMany({
      where: { packedAt: { not: null }, stage: { in: ["shipped", "done"] }, papers: { none: { kind: "packing-list" } } },
      select: { id: true, createdById: true },
    }),
  ]);
  return [
    ...proformas.map((o) => ({ ...o, kind: "proforma" as const })),
    ...packing.map((o) => ({ ...o, kind: "packing-list" as const })),
  ];
}
