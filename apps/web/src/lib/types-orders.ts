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

export type OrderDocumentKind = "proforma" | "invoice" | "packing-list";

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
  history: { id: string; from: OrderStage | null; to: OrderStage; note: string | null; confirmed: boolean; by: Person; at: string }[];
  cancelled: { at: string; reason: string | null } | null;
  documents: ({ kind: "quotation"; label: string; revisionId: string } | { kind: OrderDocumentKind; label: string })[];
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
    voided: { at: string; reason: string | null } | null;
  }[];
}

/* ---------------------------------------------------------------- printed documents */

/** Kebo's letterhead as it was when the document was sent (the company settings). */
export interface CompanySnapshot {
  name: string;
  nameLocal?: string;
  address?: string;
  phone?: string;
  email?: string;
  email2?: string;
  website?: string;
  taxNo?: string;
  bankDetails?: string;
  invoiceFooter?: string;
}

/** The customer as it was when the document was sent. */
export interface CustomerSnapshot {
  name: string;
  country: string;
  address: string | null;
  taxNo: string | null;
  contact: { name: string; email: string | null; phone: string | null } | null;
}

/** GET /orders/:id/documents/:kind — made from the order whenever it is opened. */
export interface OrderDocument {
  kind: OrderDocumentKind;
  title: string;
  number: string;
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
  };
  paymentTerms: string;
  currency: string;
  showPrices: boolean;
  lines: { type: LineType; description: string; model: string | null; hsCode: string | null; quantity: string; unit: string; unitPrice: string | null; lineTotal: string | null }[];
  totals: {
    subtotal: string;
    discount: string;
    vatRate: number;
    pricesIncludeVat: boolean;
    vat: string;
    total: string;
    deposit: string;
    depositPercent: number;
    received: string;
    due: string;
  } | null;
  terms: string | null;
  bankDetails: string | null;
  footer: string | null;
}

export interface DocLine {
  id: string;
  type: LineType;
  description: string;
  model: string | null;
  hsCode: string | null;
  quantity: string;
  unit: string;
  unitPrice: string;
  lineTotal: string;
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
  vatRate: number;
  pricesIncludeVat: boolean;
  subtotal: string;
  discount: string;
  vatAmount: string;
  total: string;
  terms: string | null;
  notes: string | null;
  sentOn: string | null;
  customerSnapshot: CustomerSnapshot | null;
  companySnapshot: CompanySnapshot | null;
  createdAt: string;
  lines: DocLine[];
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
