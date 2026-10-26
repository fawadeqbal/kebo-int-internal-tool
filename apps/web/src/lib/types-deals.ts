import type { AttachmentKind, BalanceTerms, Incoterm, InquiryChannel, LineType, LostReason, RevisionStatus } from "@kebo/shared";

/** Response shapes for the deal-work screens: inquiry form, factory prices, quotation, reports. */

/* ---------------------------------------------------------------- pickers */

export interface CustomerOption {
  id: string;
  name: string;
  country: string;
  primaryContact: { id: string; name: string } | null;
}

export interface ContactOption {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  isPrimary: boolean;
}

export interface FactoryOption {
  id: string;
  name: string;
  contactPerson: string | null;
}

export interface PersonWithRole {
  id: string;
  name: string;
  role: string;
}

export interface SalesSettings {
  currency: string;
  exchangeRates: Record<string, number>;
  defaultMarginPercent: number;
  categories: string[];
}

/* ---------------------------------------------------------------- inquiry form */

/** What the inquiry form edits (strings, as typed). */
export interface DealFormItem {
  id: string | null;
  /** Client-only key for React lists. */
  key: string;
  description: string;
  model: string;
  quantity: string;
  unit: string;
  targetPrice: string;
  /** A part of another item: that row's key. Parts come right after their item and are numbered under it ("2.1"). */
  parentKey: string | null;
  /** A factory has priced it: changing or removing it asks why. */
  priced: boolean;
}

export interface DealFormValues {
  customer: CustomerOption | null;
  contactId: string;
  channel: InquiryChannel;
  category: string;
  title: string;
  requirements: string;
  priority: string;
  requiredBy: string;
  assigneeId: string;
  items: DealFormItem[];
}

/* ---------------------------------------------------------------- sourcing */

export interface FactoryQuoteLineView {
  id: string;
  /** "1", "2", "2.1" within the offer (the factory's own breakdown). */
  no: string;
  /** A part of this line of the same offer. */
  parentId: string | null;
  requestedItemId: string | null;
  /** The customer's item it answers, by number. */
  answersNo: string | null;
  description: string;
  model: string | null;
  quantity: string;
  unit: string;
  /** Without tax. */
  unitPrice: string;
  /** Tax % added on top of the price (13 unless changed). */
  taxRate: number;
  /** e.g. "CNY 100.00 + 13% tax = CNY 113.00" (factory currency). */
  costNote: string;
  /** One unit's landed cost in the selling currency; null when the exchange rate is missing. */
  unitCost: string | null;
  /** The same product in other factories' offers (copied lines share it). */
  productKey: string;
  /** A quotation is priced from it: changing its price, quantity or place asks why. */
  used: boolean;
}

/** A file kept with a factory offer: its quotation, catalogue, screenshots (internal). */
export interface OfferFile {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  kind: AttachmentKind;
  note: string | null;
  uploadedOn: string;
}

export interface FactoryQuoteView {
  id: string;
  factory: { id: string; name: string };
  reference: string | null;
  receivedOn: string;
  validUntil: string | null;
  currency: string;
  priceBasis: string | null;
  leadTime: string | null;
  moq: string | null;
  paymentTerms: string | null;
  notes: string | null;
  fxRate: number | null;
  lines: FactoryQuoteLineView[];
  /** What the whole offer costs us in the selling currency (null when a rate is missing). */
  totalCost: string | null;
  /** Lines still without a price (a line priced in its parts does not count). */
  unpriced: number;
  /** Which of the customer's items it answers. */
  coverage: Coverage;
  files: OfferFile[];
}

export interface SourcingOption extends FactoryQuoteLineView {
  factory: { id: string; name: string };
  quoteId: string;
  currency: string;
}

export interface SourcingView {
  currency: string;
  missingRates: string[];
  quotes: FactoryQuoteView[];
  items: {
    id: string;
    /** "2", "2.1" (a part of item 2). */
    no: string;
    parentId: string | null;
    /** Split into parts: the parts are priced, not the item itself. */
    hasParts: boolean;
    description: string;
    model: string | null;
    quantity: string;
    unit: string;
    cheapestLineId: string | null;
    options: SourcingOption[];
  }[];
  /** Without the customer's list: the same products across offers (lines copied from each other). */
  products: { key: string; description: string; quantity: string; unit: string; cheapestLineId: string | null; options: SourcingOption[] }[];
}

/* ---------------------------------------------------------------- quotation */

export interface QuoteLineView {
  id: string;
  /** "1", "2", "2.1" */
  no: string;
  requestedItemId: string | null;
  type: LineType;
  description: string;
  model: string | null;
  quantity: string;
  unit: string;
  unitPrice: string;
  lineTotal: string;
  /** Only for people who may see costs. */
  unitCost?: string | null;
  factoryQuoteLineId?: string | null;
  fxRate?: string | null;
}

export interface Costing {
  costMinor: number;
  salesMinor: number;
  profitMinor: number;
  marginPercent: number | null;
  uncostedLines: number;
  cost: string;
  sales: string;
  profit: string;
}

export type OptionStatus = "open" | "accepted" | "not_chosen";

/** Which of the customer's items (by number) an offer or option covers. */
export interface Coverage {
  covered: string[];
  missing: string[];
}

/** One option of a revision: one factory's offer (or the customer's items priced by hand). */
export interface OptionView {
  id: string;
  letter: string;
  status: OptionStatus;
  /** Internal: whose offer it is (people who see costs). */
  factory: { id: string; name: string } | null;
  factoryQuoteId: string | null;
  leadTime: string | null;
  subtotal: string;
  discount: string;
  total: string;
  coverage: Coverage;
  lines: QuoteLineView[];
  costing: Costing | null;
}

export interface RevisionView {
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
  terms: string | null;
  notes: string | null;
  sentOn: string | null;
  answeredOn: string | null;
  createdAt: string;
  options: OptionView[];
  canAnswer: boolean;
  editable: boolean;
}

export interface QuotationView {
  inquiry: { id: string; refNo: string; stage: string };
  quotation: { id: string; refNo: string } | null;
  revisions: RevisionView[];
  canStartRevision: boolean;
  whyNotStart: string | null;
}

/** One option as the editor sends it: our price per line (factory line, or customer item without factory prices), charges, discount, lead time. */
export interface OptionValues {
  factoryQuoteId: string | null;
  leadTime: string | null;
  discount: number;
  prices: { lineId: string; unitPrice: number }[];
  charges: { type: "service" | "charge"; description: string; quantity: number; unit: string; unitPrice: number; unitCost: number | null }[];
}

/** GET …/quotation/draft and GET /revisions/:id/values: the editor's values (the API's revision input). */
export interface RevisionDraft {
  number: number;
  currency: string;
  incoterm: Incoterm;
  incotermPlace: string | null;
  depositPercent: number;
  balanceTerms: BalanceTerms;
  validUntil: string;
  terms: string | null;
  notes: string | null;
  options: OptionValues[];
}

/** A line of a factory offer as the quotation editor shows it (locked; costs in the quotation currency). */
export interface OfferLine {
  id: string;
  no: string;
  parentId: string | null;
  requestedItemId: string | null;
  answersNo: string | null;
  description: string;
  model: string | null;
  quantity: string;
  unit: string;
  unitCost: string | null;
}

/** GET …/quotation/offers?currency=: what a revision can offer. */
export interface QuoteOffers {
  currency: string;
  defaultMargin: number;
  offers: {
    factoryQuoteId: string;
    factory: { id: string; name: string };
    currency: string;
    receivedOn: string;
    validUntil: string | null;
    leadTime: string | null;
    coverage: Coverage;
    missingRate: boolean;
    totalCost: string | null;
    lines: OfferLine[];
  }[];
  /** The customer's items, for an option priced by hand. */
  items: { id: string; no: string; parentId: string | null; description: string; model: string | null; quantity: string; unit: string }[];
}

/* ---------------------------------------------------------------- reports */

export interface ProfitRow {
  revenue: string;
  cost: string;
  profit: string;
  marginPercent: number | null;
  coveragePercent: number | null;
  orders: number;
}

export interface ReportView {
  range: { from: string; to: string };
  currency: string;
  funnel: { received: number; quoted: number; won: number; lost: number; winRatePercent: number | null };
  turnaroundMs: { won: number | null; lost: number | null };
  lostReasons: { reason: LostReason; count: number }[];
  byChannel: { key: InquiryChannel; count: number }[];
  byCategory: { key: string; count: number }[];
  people: { person: string; won: number; lost: number; winRatePercent: number }[];
  wonValue: string;
  profit: {
    total: ProfitRow;
    byCustomer: (ProfitRow & { key: string })[];
    byCategory: (ProfitRow & { key: string })[];
    byPerson: (ProfitRow & { key: string })[];
  };
  trend: { month: string; received: number; won: number }[];
}
