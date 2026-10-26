import type { BalanceTerms, Incoterm, InquiryChannel, LineType, LostReason, RevisionStatus } from "@kebo/shared";

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
  defaultVatRate: string;
  pricesIncludeVat: boolean;
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
  requestedItemId: string | null;
  description: string;
  model: string | null;
  quantity: string;
  unit: string;
  unitPrice: string;
  vatRate: number;
  rebateRate: number;
  /** One unit's landed cost in the selling currency; null when the exchange rate is missing. */
  unitCost: string | null;
}

export interface FactoryQuoteView {
  id: string;
  factory: { id: string; name: string };
  reference: string | null;
  receivedOn: string;
  validUntil: string | null;
  currency: string;
  pricesIncludeVat: boolean;
  priceBasis: string | null;
  leadTime: string | null;
  moq: string | null;
  paymentTerms: string | null;
  notes: string | null;
  fxRate: number | null;
  lines: FactoryQuoteLineView[];
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
    description: string;
    model: string | null;
    quantity: string;
    unit: string;
    preferredLineId: string | null;
    cheapestLineId: string | null;
    options: SourcingOption[];
  }[];
}

/* ---------------------------------------------------------------- quotation */

export interface QuoteLineView {
  id: string;
  requestedItemId: string | null;
  type: LineType;
  description: string;
  model: string | null;
  hsCode: string | null;
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
  vatRate: number;
  pricesIncludeVat: boolean;
  subtotal: string;
  discount: string;
  vatAmount: string;
  total: string;
  terms: string | null;
  notes: string | null;
  sentOn: string | null;
  answeredOn: string | null;
  createdAt: string;
  lines: QuoteLineView[];
  costing: Costing | null;
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

/** GET …/quotation/draft: the starting values of the next revision (the API's revision input). */
export interface RevisionDraft {
  number: number;
  currency: string;
  incoterm: Incoterm;
  incotermPlace: string | null;
  depositPercent: number;
  balanceTerms: BalanceTerms;
  leadTime: string | null;
  validUntil: string;
  vatRate: number;
  pricesIncludeVat: boolean;
  discount: number;
  terms: string | null;
  notes: string | null;
  lines: {
    requestedItemId: string | null;
    type: LineType;
    description: string;
    model: string | null;
    hsCode: string | null;
    quantity: number;
    unit: string;
    unitPrice: number;
    unitCost: number | null;
    factoryQuoteLineId: string | null;
    fxRate: number | null;
  }[];
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
