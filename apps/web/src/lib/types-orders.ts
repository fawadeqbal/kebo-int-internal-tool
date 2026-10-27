import type { OfferFile } from "./types-deals";
import type { BalanceTerms, Incoterm, LineType, OrderStage, OrderStatus, PaymentKind, PaymentMethod, RevisionStatus } from "@kebo/shared";
import type { Person } from "./types";

/** API response shapes for orders (four stages), their payments and the printed documents. Keep in step with apps/api/src/modules/orders. */

/** What an open order needs from someone now, and by when (null when done or cancelled). */
export interface OrderNeed {
  title: string;
  due: string;
  late: boolean;
}

/** The one button: the stage it moves to and what it says. */
export interface OrderNext {
  to: OrderStage;
  label: string;
  stage: string;
  hint: string;
}

/** A row of GET /orders (the board) and of GET /me/todo. */
export interface OrderRow {
  id: string;
  refNo: string;
  status: OrderStatus;
  stage: OrderStage;
  stageSince: string;
  customer: { id: string; name: string; country: string };
  inquiry: { id: string; refNo: string; title: string; assigneeId: string | null; assignee: Person | null };
  orderedOn: string;
  readyOn: string | null;
  shippedOn: string | null;
  currency: string;
  total: string;
  received: string;
  due: string;
  next: OrderNext | null;
  needs: OrderNeed | null;
}

export type OrderDocumentKind = "proforma" | "packing-list";

/** GET /orders/:id */
export interface OrderView {
  id: string;
  refNo: string;
  status: OrderStatus;
  stage: OrderStage;
  stageSince: string;
  inquiry: { id: string; refNo: string; title: string; assigneeId: string | null; assignee: Person | null };
  customer: { id: string; name: string; country: string };
  orderedOn: string;
  shipBy: string | null;
  readyOn: string | null;
  shippedOn: string | null;
  blNo: string | null;
  documentTitle: string | null;
  portOfDischarge: string | null;
  currency: string;
  total: string;
  depositPercent: number;
  balanceTerms: BalanceTerms;
  incoterm: Incoterm;
  incotermPlace: string | null;
  money: { total: string; deposit: string; received: string; bankCharges: string; due: string; depositDue: string; status: PaymentStatus };
  next: OrderNext | null;
  back: { to: OrderStage; label: string } | null;
  needs: OrderNeed | null;
  history: {
    id: string;
    from: OrderStage | null;
    to: OrderStage;
    note: string | null;
    confirmed: boolean;
    /** Null for moves the system made (e.g. stages set when the order checklist was replaced). */ by: Person | null;
    at: string;
  }[];
  /** Null `at` on orders cancelled before the date was kept (migrated data). */
  cancelled: { at: string | null; reason: string | null } | null;
  lines: OrderLineView[];
  goods: OrderGoodsView;
  documents: ({ kind: "quotation"; label: string; revisionId: string } | { kind: OrderDocumentKind; label: string })[];
  /** The proforma's number once issued (KEB260916TN07); null while it is a draft. */
  proforma: { number: string; issuedOn: string | null } | null;
  /** The chosen factory's own quotation, catalogue and screenshots (people who see factory prices). */
  factoryFiles: (OfferFile & { factory: string })[];
}

/** The packing list figures of one goods line (null until filled in). */
export interface LinePacking {
  packages: number | null;
  packageType: string | null;
  netWeightKg: string | null;
  grossWeightKg: string | null;
  cbm: string | null;
}

/** A line of GET /orders/:id: goods (received from the factory, packed) or a charge. */
export interface OrderLineView {
  id: string;
  /** "1", "2", "2.1" (a part of item 2). */
  no: string;
  type: LineType;
  description: string;
  model: string | null;
  quantity: string;
  unit: string;
  unitPrice: string;
  lineTotal: string;
  /** The factory it was quoted from, when known. */
  factory: { id: string; name: string } | null;
  receivedQty: string;
  receivedOn: string | null;
  packing: LinePacking;
}

/** The goods side of GET /orders/:id: what came in from the factory and the packing list. */
export interface OrderGoodsView {
  /** Goods lines, and how many came in complete. */
  lines: number;
  received: number;
  allReceived: boolean;
  /** Lines still short, e.g. "Maize sheller: 60 of 100 pcs". */
  short: string[];
  packed: boolean;
  packedAt: string | null;
  containerNo: string | null;
  shippingMarks: string | null;
  totals: { packages: number; netWeightKg: string; grossWeightKg: string; cbm: string };
}

export type PaymentStatus = "unpaid" | "partly_paid" | "deposit_paid" | "paid" | "overpaid";

/** GET /orders/:id/payments */
export interface PaymentsView {
  currency: string;
  total: string;
  received: string;
  due: string;
  depositDue: string;
  status: PaymentStatus;
  payments: {
    id: string;
    kind: PaymentKind;
    amount: string;
    bankCharges: string;
    currency: string;
    paidOn: string;
    method: PaymentMethod;
    reference: string | null;
    note: string | null;
    /** Amount plus bank charges: what it settles. */
    counts: string;
    recordedBy: { id: string; name: string } | null;
    recordedAt: string;
    /** Received so far and still due once it counted (null when removed). */
    after: { received: string; due: string } | null;
    voided: { at: string; reason: string | null } | null;
  }[];
}

/* ---------------------------------------------------------------- printed documents */

/**
 * Kebo's letterhead as it was when the document was sent (the company settings).
 * Snapshots imported from the old system may lack any field, so all but the name are optional.
 */
export interface CompanySnapshot {
  name: string;
  nameLocal?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  email2?: string | null;
  website?: string | null;
  taxNo?: string | null;
  bankDetails?: string | null;
  invoiceFooter?: string | null;
  /** The company stamp as a data URL (printed on the proforma). */
  stamp?: string | null;
}

/** The customer as it was when the document was sent (imported snapshots may lack fields). */
export interface CustomerSnapshot {
  name: string;
  country?: string | null;
  address?: string | null;
  taxNo?: string | null;
  regNo?: string | null;
  contact?: { name?: string | null; email?: string | null; phone?: string | null } | null;
}

/** GET /orders/:id/documents/:kind — made from the order whenever it is opened. */
export interface OrderDocument {
  kind: OrderDocumentKind;
  title: string;
  /** null: a proforma not issued yet (a draft). */
  number: string | null;
  draft: boolean;
  date: string;
  company: CompanySnapshot;
  customer: CustomerSnapshot;
  order: {
    id: string;
    refNo: string;
    stage: OrderStage;
    status: OrderStatus;
    orderedOn: string;
    shipBy: string | null;
    readyOn: string | null;
    shippedOn: string | null;
    blNo: string | null;
    incoterm: Incoterm;
    incotermPlace: string | null;
    quotation: string;
    documentTitle: string | null;
    portOfDischarge: string | null;
    leadTime: string | null;
  };
  paymentTerms: string;
  /** "Our usual payment is made by 30% Advance deposit and 70% before shipment." */
  paymentSentence: string;
  currency: string;
  showPrices: boolean;
  lines: {
    /** "1", "2", "2.1" */
    no: string;
    type: LineType;
    description: string;
    model: string | null;
    quantity: string;
    unit: string;
    unitPrice: string | null;
    lineTotal: string | null;
    /** Internal copy, for people who may see factory costs: one unit's cost in the order currency. */
    unitCost?: string | null;
    /** Packing list only. */
    packing: LinePacking | null;
  }[];
  /** Packing list only: whether it is filled in, the container, the marks and the totals. */
  packing: {
    done: boolean;
    containerNo: string | null;
    shippingMarks: string | null;
    totals: { packages: number; netWeightKg: string; grossWeightKg: string; cbm: string };
  } | null;
  totals: {
    subtotal: string;
    discount: string;
    total: string;
    deposit: string;
    depositPercent: number;
    received: string;
    due: string;
  } | null;
  /** The quotation's own payment and delivery terms (free text). */
  paymentTermsText: string | null;
  deliveryTermsText: string | null;
  bankDetails: string | null;
  /** Every payment received (the internal copy lists them; the customer's copy only the total). */
  payments: { paidOn: string; kind: string; amount: string; bankCharges: string; currency: string; reference: string | null }[];
  notes: string | null;
  footer: string | null;
}

export interface DocLine {
  id: string;
  /** "1", "2", "2.1" */
  no: string;
  type: LineType;
  description: string;
  model: string | null;
  quantity: string;
  unit: string;
  unitPrice: string;
  lineTotal: string;
  /** For people who may see factory costs. */
  unitCost?: string | null;
}

/** GET /revisions/:id (printing a quotation). */
export interface RevisionDoc {
  quotation: { id: string; refNo: string; inquiryId: string };
  id: string;
  number: number;
  status: RevisionStatus;
  currency: string;
  incoterm: Incoterm;
  incotermPlace: string | null;
  depositPercent: number;
  balanceTerms: BalanceTerms;
  leadTime: string | null;
  validUntil: string;
  subtotal: string;
  discount: string;
  total: string;
  /** Printed under the payment (beyond the deposit and balance). */
  paymentTerms: string | null;
  /** Printed under the delivery (packing, inspection, warranty…). */
  deliveryTerms: string | null;
  notes: string | null;
  sentOn: string | null;
  customerSnapshot: CustomerSnapshot | null;
  companySnapshot: CompanySnapshot | null;
  createdAt: string;
  /** The options A, B… (one when there is no choice); once accepted, one is "accepted" and the others "not_chosen". */
  options: {
    id: string;
    letter: string;
    status: "open" | "accepted" | "not_chosen";
    factory: { id: string; name: string } | null;
    leadTime: string | null;
    subtotal: string;
    discount: string;
    total: string;
    lines: DocLine[];
    /** For people who may see factory costs. */
    costing?: {
      cost: string;
      sales: string;
      profit: string;
      marginPercent: number | null;
      uncostedLines: number;
      costMinor: number;
      /** Part of the cost: freight and the like to reach the basis we sell on. */
      extraCostMinor: number;
      extraCost: string;
    } | null;
    factoryBasis?: Incoterm | null;
    factoryBasisPlace?: string | null;
  }[];
}

/** For documents not yet sent (no snapshot yet): the customer as it is now. */
export interface CustomerNow {
  id: string;
  name: string;
  country: string;
  address: string | null;
  taxNo: string | null;
  contacts: { id: string; name: string; email: string | null; phone: string | null; whatsapp: string | null; isPrimary: boolean }[];
}
