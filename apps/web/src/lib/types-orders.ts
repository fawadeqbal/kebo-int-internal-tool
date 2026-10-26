import type {
  BalanceTerms,
  FactoryOrderStatus,
  Incoterm,
  InvoiceStatus,
  InvoiceType,
  LineType,
  PaymentKind,
  PaymentMethod,
  RevisionStatus,
  ShipmentStatus,
} from "@kebo/shared";

/** API response shapes for an order's factory orders, payments, invoices, shipments and the printed documents. */

/** Kebo's letterhead as it was when the document was sent or issued (the company settings). */
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

/** The customer as it was when the document was sent or issued. */
export interface CustomerSnapshot {
  name: string;
  country: string;
  address: string | null;
  taxNo: string | null;
  contact: { name: string; email: string | null; phone: string | null } | null;
}

/* ---------------------------------------------------------------- factory orders */

export interface FactoryOrderLine {
  id: string;
  orderLineId: string | null;
  factoryQuoteLineId: string | null;
  description: string;
  model: string | null;
  quantity: string;
  unit: string;
  unitPrice: string;
  vatRate: number;
  lineTotal: string;
  sortOrder: number;
}

export interface FactoryOrder {
  id: string;
  refNo: string;
  status: FactoryOrderStatus;
  factory: { id: string; name: string };
  currency: string;
  pricesIncludeVat: boolean;
  total: string;
  depositPercent: number;
  deposit: string;
  paid: string;
  outstanding: string;
  paymentStatus: string;
  paymentTerms: string | null;
  readyOn: string | null;
  sentOn: string | null;
  confirmedOn: string | null;
  vatInvoiceNo: string | null;
  vatInvoiceOn: string | null;
  notes: string | null;
  lines: FactoryOrderLine[];
  payments: {
    id: string;
    kind: PaymentKind;
    amount: string;
    bankCharges: string;
    paidOn: string;
    reference: string | null;
    voided: boolean;
  }[];
}

/** One line of a factory order as the form edits and the API takes it. */
export interface FactoryOrderLineInput {
  orderLineId: string | null;
  factoryQuoteLineId: string | null;
  description: string;
  model: string | null;
  quantity: number;
  unit: string;
  unitPrice: number;
  vatRate: number;
}

export interface FactoryOrderDrafts {
  groups: { factory: { id: string; name: string }; currency: string; pricesIncludeVat: boolean; lines: FactoryOrderLineInput[] }[];
  unsourced: { orderLineId: string; description: string }[];
}

export interface FactoryDetail {
  id: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  wechat: string | null;
  email: string | null;
  address: string | null;
  bankDetails: string | null;
}

/* ---------------------------------------------------------------- payments */

export interface Payment {
  id: string;
  direction: "in" | "out";
  kind: PaymentKind;
  amount: string;
  bankCharges: string;
  currency: string;
  paidOn: string;
  method: PaymentMethod;
  reference: string | null;
  note: string | null;
  factory: { id: string; name: string } | null;
  factoryOrder: { id: string; refNo: string } | null;
  voided: { at: string; reason: string | null } | null;
}

export interface PaymentsView {
  currency: string;
  customer: { due: string; received: string; bankCharges: string; outstanding: string; depositOutstanding: string; status: string };
  payments: Payment[];
}

/* ---------------------------------------------------------------- invoices */

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

export interface Invoice {
  id: string;
  type: InvoiceType;
  number: string | null;
  orderId: string;
  shipmentId: string | null;
  status: InvoiceStatus;
  issueDate: string | null;
  dueDate: string | null;
  currency: string;
  vatRate: number;
  pricesIncludeVat: boolean;
  subtotal: string;
  discount: string;
  vatAmount: string;
  total: string;
  depositPercent: number | null;
  deposit: string | null;
  notes: string | null;
  voidReason: string | null;
  customerSnapshot: CustomerSnapshot | null;
  companySnapshot: CompanySnapshot | null;
  createdAt: string;
  lines: DocLine[];
}

export interface InvoiceDoc extends Invoice {
  order: { id: string; refNo: string; incoterm: Incoterm; incotermPlace: string | null; balanceTerms: BalanceTerms };
}

/* ---------------------------------------------------------------- shipments */

export interface ShipmentLine {
  id: string;
  orderLineId: string | null;
  description: string;
  model: string | null;
  hsCode: string | null;
  quantity: string;
  unit: string;
  packages: number;
  packageType: string;
  netWeightKg: string;
  grossWeightKg: string;
  cbm: string;
  sortOrder: number;
}

export interface Shipment {
  id: string;
  refNo: string;
  orderId: string;
  status: ShipmentStatus;
  forwarder: string | null;
  portOfLoading: string | null;
  portOfDischarge: string | null;
  finalDestination: string | null;
  transport: string | null;
  containerNos: string | null;
  sealNos: string | null;
  blNo: string | null;
  etd: string | null;
  eta: string | null;
  departedOn: string | null;
  documentsReleasedOn: string | null;
  marks: string | null;
  notes: string | null;
  customerSnapshot: CustomerSnapshot | null;
  companySnapshot: CompanySnapshot | null;
  createdAt: string;
  lines: ShipmentLine[];
  invoices: { id: string; number: string | null; status: InvoiceStatus }[];
  totals: { packages: number; netKg: number; grossKg: number; cbm: number };
}

export interface ShipmentDoc extends Shipment {
  order: { id: string; refNo: string; incoterm: Incoterm; incotermPlace: string | null };
}

export interface ShipmentsView {
  remaining: { orderLineId: string; description: string; unit: string; ordered: number; packed: number; left: number }[];
  shipments: Shipment[];
}

/** One packed line as the form edits and the API takes it. */
export interface ShipmentLineInput {
  orderLineId: string;
  description: string;
  quantity: number;
  packages: number;
  packageType: string;
  netWeightKg: number;
  grossWeightKg: number;
  cbm: number;
}

/* ---------------------------------------------------------------- quotation revisions (printing) */

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

/** For documents not yet sent/issued (no snapshot yet): the customer as it is now. */
export interface CustomerNow {
  id: string;
  name: string;
  country: string;
  address: string | null;
  taxNo: string | null;
  contacts: { id: string; name: string; email: string | null; phone: string | null; whatsapp: string | null; isPrimary: boolean }[];
}
