import type { AttachmentKind, BalanceTerms, BasisStep, Incoterm, InquiryChannel, LineType, LostReason, RevisionStatus, SentVia } from "@kebo/shared";

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
  /** New factory offers start with these: prices with tax included or not, and the tax %. */
  factoryTaxIncluded: boolean;
  factoryTaxRate: number;
}

/* ---------------------------------------------------------------- inquiry form */

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
  /** Without tax, or with tax included, as the offer says. */
  unitPrice: string;
  /** This line's tax % (the offer's unless changed): added on top of the price, or included in it. */
  taxRate: number;
  /** e.g. "CNY 100.00 + 13% tax = CNY 113.00", "CNY 113.00, tax 13% included (CNY 13.00)" (factory currency). */
  costNote: string;
  /** One unit's landed cost in the selling currency; null when the exchange rate is missing. */
  unitCost: string | null;
  /** The same product in other factories' offers (copied lines share it). */
  productKey: string;
  /** A quotation is priced from it: changing its price, quantity or place asks why. */
  used: boolean;
  /** Another spec of that line of the offer (its id and number): a choice beside it, left out of the total. */
  alternativeOfId?: string | null;
  alternativeOfNo?: string | null;
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
  /** The factory's prices have the tax in them (shown, never added again), or the tax is added on top. */
  taxIncluded: boolean;
  /** The offer's tax % (its lines take it unless they have their own). */
  taxRate: number;
  /** What the factory's prices already pay for (EXW, FOB…), and where. */
  basis: Incoterm | null;
  basisPlace: string | null;
  leadTime: string | null;
  moq: string | null;
  paymentTerms: string | null;
  /** The warranty the factory gives. */
  warranty: string | null;
  /** The advance the factory asks when we order, in % (null: the company's default). */
  advancePercent: number | null;
  notes: string | null;
  fxRate: number | null;
  lines: FactoryQuoteLineView[];
  /** The lines at the factory's prices, in its currency. */
  factoryTotal: string;
  /** The tax in that: on top (without tax) or inside (tax included), in its currency. */
  taxTotal: string;
  /** What the whole offer costs us in the selling currency (null when a rate is missing). */
  totalCost: string | null;
  /** Lines still without a price (a line priced in its parts does not count). */
  unpriced: number;
  /** Which of the customer's items it answers. */
  coverage: Coverage;
  files: OfferFile[];
}

/** What a factory said on its last offer: a new offer from it starts here (every field can be typed over). */
export interface LastOffer {
  /** The inquiry that offer was for, and when it came. */
  inquiryRef: string;
  receivedOn: string;
  currency: string;
  taxIncluded: boolean;
  taxRate: number;
  basis: Incoterm | null;
  basisPlace: string | null;
  leadTime: string | null;
  moq: string | null;
  paymentTerms: string | null;
  advancePercent: number | null;
  warranty: string | null;
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
  products: {
    key: string;
    description: string;
    quantity: string;
    unit: string;
    cheapestLineId: string | null;
    options: SourcingOption[];
  }[];
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
  /** Costs to reach the basis we sell on (to the port, freight…), part of the cost. */
  extraCostMinor: number;
  extraCost: string;
}

/** A cost between the factory's basis and ours, as saved on an option. */
export interface BasisCost {
  step: BasisStep;
  amount: string;
  currency: string;
  /** In the quotation's currency. */
  cost: string;
  note: string | null;
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
  /** People who see costs: the factory's basis when priced, what it takes to reach ours, and those costs. */
  factoryBasis?: Incoterm | null;
  factoryBasisPlace?: string | null;
  gap?: { needed: BasisStep[]; extra: BasisStep[] } | null;
  costs?: BasisCost[];
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
  validUntil: string;
  /** Read from the options (the revision keeps none of its own): the accepted option's, else Option A's. */
  leadTime: string | null;
  subtotal: string;
  discount: string;
  total: string;
  /** Which option those are ("Option A of 3", "Option B, accepted"); empty with one option. */
  figuresOf: string;
  /** Printed under the payment (beyond the deposit and balance). */
  paymentTerms: string | null;
  /** Printed under the delivery (packing, inspection…). */
  deliveryTerms: string | null;
  /** The warranty printed on the quotation. */
  warranty: string | null;
  notes: string | null;
  sentOn: string | null;
  /** How it went to the customer (null: not said). */
  sentVia: SentVia | null;
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
  charges: {
    type: "service" | "charge";
    description: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    unitCost: number | null;
  }[];
  costs: { step: BasisStep; amount: number; currency: string; note: string | null }[];
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
  /** Printed under the payment (beyond the deposit and balance). */
  paymentTerms: string | null;
  /** Printed under the delivery (packing, inspection…). */
  deliveryTerms: string | null;
  warranty: string | null;
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
  /** Settings' exchange rates (1 mainCurrency buys N), for costs entered in other currencies. */
  mainCurrency: string;
  rates: Record<string, number>;
  offers: {
    factoryQuoteId: string;
    factory: { id: string; name: string };
    currency: string;
    basis: Incoterm | null;
    basisPlace: string | null;
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
  /** Sales whose lines have no cost: left out of profit and margin. */
  uncostedRevenue: string;
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
  /** From coming in to won or lost, on average (days), for the inquiries that came in in the span. */
  turnaroundDays: { won: number | null; lost: number | null };
  lostReasons: { reason: LostReason | "not_said"; label: string; count: number }[];
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
  /** Currencies with no exchange rate: their amounts are left out. */
  missingRates: string[];
}
