import type { Incoterm, PaymentRoute } from "../enums";
import { PAYMENT_ROUTE_SHORT } from "../workflows/flow";
import { basisText } from "../workflows/basis";
import { partsWords, warrantyLine, type TermPart, type TermsSide, type WarrantyFacts } from "../workflows/terms";

/*
 * Papers (canvas "RFQ Desk — the pieces", board "Papers: one shape for four records"): a supplier offer, a
 * quotation, an order and a purchase order hold the same things under different column names. One reader per
 * record turns its columns into a Paper; the boxes read the Paper, so each row is said the same way on every
 * paper. Started on the supplier offer; the quotation, the order and the purchase order join as they move.
 */

/** A paper's terms, the same shape whatever record it is. ("Paper" here is one of these four records; the printed documents are PAPER_KINDS.) */
export interface PaperTerms {
  /** Whose words: what we promise the customer, or what a supplier gives us. */
  side: TermsSide;
  incoterm: Incoterm | null;
  place: string | null;
  /** Where the goods land (a quotation's port of discharge). */
  port?: string | null;
  /** More on the delivery, as typed (a quotation's delivery terms). */
  deliveryNote?: string | null;
  /** How the customer pays (a quotation: informal, bank contract, LC). */
  route?: PaymentRoute | null;
  /** The lead time in words ("35 days after the deposit"). */
  leadWords: string | null;
  parts: TermPart[];
  paymentNote: string | null;
  warranty: WarrantyFacts;
  moq: string | null;
  notes: string | null;
}

/** The rows of a paper's boxes, by box, with their labels. */
const ROWS = {
  terms: {
    incoterm: "Incoterm",
    port: "Port of discharge",
    leadTime: "Lead time",
    deliveryNote: "Delivery note",
    route: "How they pay",
    payment: "Payment",
    paymentNote: "Payment note",
  },
  conditions: { warranty: "Warranty", moq: "Minimum order", notes: "Notes" },
} as const;
export type PaperTermsBox = keyof typeof ROWS;
export type PaperTermsRow<B extends PaperTermsBox = PaperTermsBox> = B extends PaperTermsBox ? keyof (typeof ROWS)[B] : never;

/** Which rows each paper shows, in order (a row a paper does not keep is left out). */
const KINDS = {
  offer: {
    terms: ["incoterm", "leadTime", "payment", "paymentNote"],
    conditions: ["warranty", "moq", "notes"],
  },
  quotation: {
    terms: ["incoterm", "port", "leadTime", "deliveryNote", "route", "payment", "paymentNote"],
    conditions: ["warranty", "notes"],
  },
} as const satisfies Record<string, { [B in PaperTermsBox]: readonly PaperTermsRow<B>[] }>;
export type PaperTermsKind = keyof typeof KINDS;

/** Rows left out when the paper says nothing there (most rows show —, so a gap is seen). */
const OPTIONAL: readonly PaperTermsRow[] = ["port", "deliveryNote"];

/** A supplier offer as a paper (its basis is the Incoterm, its payment terms the payment note). */
function ofOffer(q: {
  basis: Incoterm | null;
  basisPlace: string | null;
  leadTime: string | null;
  paymentParts: TermPart[];
  paymentTerms: string | null;
  warranty: string | null;
  warrantyMonths: number | null;
  warrantyFrom: string | null;
  moq: string | null;
  notes: string | null;
}): PaperTerms {
  return {
    side: "factory",
    incoterm: q.basis,
    place: q.basisPlace,
    leadWords: q.leadTime,
    parts: q.paymentParts,
    paymentNote: q.paymentTerms,
    warranty: { warranty: q.warranty, warrantyMonths: q.warrantyMonths, warrantyFrom: q.warrantyFrom },
    moq: q.moq,
    notes: q.notes,
  };
}

/** A quotation as a paper: what we promise the customer (the lead time is its option's, when it has one). */
function ofRevision(r: {
  incoterm: Incoterm | null;
  incotermPlace: string | null;
  portOfDischarge: string | null;
  leadTime: string | null;
  deliveryTerms: string | null;
  paymentRoute: PaymentRoute | null;
  paymentParts: TermPart[];
  paymentTerms: string | null;
  warranty: string | null;
  warrantyMonths: number | null;
  warrantyFrom: string | null;
  notes: string | null;
}): PaperTerms {
  return {
    side: "customer",
    incoterm: r.incoterm,
    place: r.incotermPlace,
    port: r.portOfDischarge,
    leadWords: r.leadTime,
    deliveryNote: r.deliveryTerms,
    route: r.paymentRoute,
    parts: r.paymentParts,
    paymentNote: r.paymentTerms,
    warranty: { warranty: r.warranty, warrantyMonths: r.warrantyMonths, warrantyFrom: r.warrantyFrom },
    moq: null,
    notes: r.notes,
  };
}

/** A row's words, or null when the paper says nothing there (the box shows —). Notes are as typed. */
function text(p: PaperTerms, row: PaperTermsRow): string | null {
  switch (row) {
    case "incoterm":
      return p.incoterm ? basisText(p.incoterm, p.place) : null;
    case "port":
      return p.port || null;
    case "leadTime":
      return p.leadWords || null;
    case "deliveryNote":
      return p.deliveryNote || null;
    case "route":
      return p.route ? PAYMENT_ROUTE_SHORT[p.route] : null;
    case "payment":
      return p.parts.length ? partsWords(p.parts, p.side) : null;
    case "paymentNote":
      return p.paymentNote || null;
    case "warranty":
      return warrantyLine(p.warranty)?.replace(/\.$/, "") ?? null;
    case "moq":
      return p.moq || null;
    case "notes":
      return p.notes || null;
  }
}

/** The papers' terms: the rows' labels, which rows each paper shows, the readers, and a row's words. */
export const PAPER = { rows: ROWS, kinds: KINDS, optional: OPTIONAL, ofOffer, ofRevision, text } as const;
