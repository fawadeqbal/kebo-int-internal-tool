import type {
  PlanDueRule,
  BasisStep,
  CostRowStatus,
  CreditKind,
  ExpenseBearer,
  ExpenseCategory,
  FactoryDueRule,
  FactoryPlanStatus,
  FlowStep,
  InquiryStage,
  LostReason,
  PaymentKind,
  PaymentMethod,
  PaymentRoute,
  InstalmentStatus,
  OrderWord,
  RequestState,
} from "@kebo/shared";
import type { Person } from "./types";

/** A file kept with a record (an expense's receipt, a payment's bank slip), opened at /files/<id>. */
export interface AttachedFileInfo {
  id: string;
  name: string;
  type: string;
  size: number;
}

/** GET /orders/:id/money (each part only for the people who may see it). */
export interface OrderMoney {
  orderId: string;
  refNo: string;
  currency: string;
  total: string;
  /** The balance terms, e.g. "Balance before shipment". */
  terms: string;
  /** How the customer pays, from the route. */
  route: { route: PaymentRoute | null; summary: string | null };
  received: string;
  /** Still due: the total and what was charged to the customer, less what came in. */
  due: string;
  /** Expenses charged to the customer on this order ("Charged to you: …"). */
  charged: { id: string; description: string; spentOn: string; amount: string }[];
  chargedTotal: string;
  plan: {
    items: {
      id: string;
      /** Its payment request's number (PR-2026-0031-2). */
      number: string;
      label: string;
      amount: string;
      dueOn: string | null;
      paid: string;
      open: string;
      status: InstalmentStatus;
      part: string | null;
      /** "T/T", "LC, deferred 90 days". */
      how: string;
      /** When an undated part falls due ("90 days after the papers"). */
      when: string | null;
      /** fixed | on_ready | on_ship_plus_days | after_papers (null: no date yet): the date is worked out from it. */
      dueRule: PlanDueRule | null;
      dueDays: number | null;
      /** "on the ready date", "14 days after shipping" (a fixed date: null). */
      rule: string | null;
      /** The row as a payment request: where it stands and the payments that paid it. */
      request: RequestView;
      /** Days past its due date while still open (0: not late). */
      late: number;
    }[];
    /** Requests that were sent and whose row is no longer in the plan: kept as sent, cancelled. */
    cancelled: { paperId: string; ref: string; number: string; revision: number; sentOn: string; amount: string | null; label: string | null }[];
    /** May send a request to the customer (kept as sent). */
    canSend: boolean;
    /** The order's dates the rules read (the ready date: the latest factory's). */
    dates: { readyOn: string | null; shippedOn: string | null; papersOn: string | null };
    matchesTotal: boolean;
    difference: string;
    next: { label: string; open: string; dueOn: string | null; status: InstalmentStatus } | null;
    canEdit: boolean;
  };
  factories: {
    rows: FactoryOwed[];
    /** Where the customer's money for this order stands, for the person paying its suppliers. */
    customer: { state: string; words: string; warn: boolean };
    payments: FactoryPaymentView[];
    canRecord: boolean;
    /** Each factory's payment plan with what is paid on each part. */
    plans: FactoryPlanView[];
    canPlan: boolean;
  } | null;
  expenses: ExpenseView[] | null;
  /** Spent on the deal before it became this order (managers). */
  dealExpenses: ExpenseView[] | null;
  deal: { id: string };
  profit: {
    revenue: string;
    /** The part of the value whose lines have a cost: profit is worked out on it alone. */
    costedRevenue: string;
    /** Value on lines without a cost: never counted as profit. */
    uncostedRevenue: string;
    goodsCost: string;
    /** Costs to reach the basis it was sold on (to the port, freight…), from the accepted option. */
    basisCost: string;
    basisCosts: { step: BasisStep; amount: string; currency: string; cost: string; note: string | null }[];
    /** All its expenses, and those counted in profit (freight paid for the planned costs is counted there once). */
    expenses: string;
    expensesCounted: string;
    /** Taken by banks from the customer's payments. */
    bankCharges: string;
    earned: string;
    /** Spent on the deal before the sale, and the profit once that is taken off too. */
    beforeSale: string;
    net: string;
    netMarginPercent: number | null;
    marginPercent: number | null;
    coveragePercent: number | null;
    received: string;
    factoryPaid: string;
    cash: string;
  } | null;
  missingRate: string | null;
  cancelled: boolean;
}

export interface FactoryOwed {
  factory: { id: string; name: string };
  lookedAfterBy: Person | null;
  currency: string;
  lines: number;
  owed: string;
  /** Paid, with the expenses the factory bears. */
  paid: string;
  /** Expenses the factory bears, taken off what we owe it. */
  takenOff: string;
  toPay: string;
  overpaid: string | null;
}

export interface FactoryPaymentView {
  id: string;
  factory: { id: string; name: string };
  recordedBy: { id: string; name: string } | null;
  recordedAt: string;
  /** Set when it was changed after it was recorded. */
  changedAt: string | null;
  /** Paid to that factory so far and still to pay, once it counted (null when removed). */
  after: { paid: string; toPay: string } | null;
  kind: PaymentKind;
  amount: string;
  currency: string;
  rate: number;
  inOrderCurrency: string;
  paidOn: string;
  method: PaymentMethod;
  paidBy: Person | null;
  reference: string | null;
  note: string | null;
  account: { id: string; name: string } | null;
  /** A photo or PDF proving it. */
  file: AttachedFileInfo | null;
  voided: { at: string; reason: string | null } | null;
}

export interface ExpenseView {
  id: string;
  order: { id: string; refNo: string } | null;
  orderId: string | null;
  /** Who it was spent on; an order's expense is always on its customer. Null: the company's own cost. */
  customer: { id: string; name: string } | null;
  /** The deal it was spent on (won or lost); an order's expense is on its deal. */
  deal: { id: string; refNo: string; title: string; stage: InquiryStage } | null;
  /** The factory visited or paid for. */
  factory: { id: string; name: string } | null;
  /** Which of our accounts it was paid from. */
  account: { id: string; name: string } | null;
  category: ExpenseCategory;
  description: string;
  amount: string;
  currency: string;
  rate: number;
  inMain: string;
  spentOn: string;
  paidBy: Person | null;
  reference: string | null;
  note: string | null;
  receipt: AttachedFileInfo | null;
  /** On an order: its step, who bears it, and whether someone paid it from their own money. */
  step: FlowStep | null;
  borneBy: ExpenseBearer;
  ownMoney: boolean;
  /** A bill known before it is paid, who it is owed to, and what made it ("shipment:<id>:freight"). */
  payLater: boolean;
  payee: string | null;
  source: string | null;
  repaid: { on: string; account: { id: string; name: string } | null } | null;
  voided: { at: string; reason: string | null } | null;
}

/** One expense on the order's Costs page (amounts also in the order's currency). */
export interface CostExpense {
  id: string;
  category: ExpenseCategory;
  description: string;
  amount: string;
  currency: string;
  rate: number;
  inMain: string;
  inOrder: string;
  spentOn: string;
  step: FlowStep | null;
  borneBy: ExpenseBearer;
  factory: { id: string; name: string } | null;
  paidBy: Person | null;
  account: { id: string; name: string } | null;
  ownMoney: boolean;
  /** A bill known before it is paid, who it is owed to, and what made it ("shipment:<id>:freight"). */
  payLater: boolean;
  payee: string | null;
  source: string | null;
  repaid: { on: string; account: { id: string; name: string } | null } | null;
  reference: string | null;
  note: string | null;
  receipt: AttachedFileInfo | null;
  recordedBy: Person | null;
  recordedAt: string;
  voided: { at: string; reason: string | null } | null;
}

/** GET /orders/:id/costs (managers with the expenses feature). */
export interface OrderCosts {
  orderId: string;
  refNo: string;
  currency: string;
  mainCurrency: string;
  missingRate: string | null;
  cancelled: boolean;
  canEdit: boolean;
  totals: {
    planned: string;
    spent: string;
    count: number;
    notPlanned: string;
    notPlannedKinds: string[];
    receiptsMissing: number;
    receiptsMissingAmounts: { currency: string; amount: string }[];
    borneByUs: string;
    chargedToCustomer: string;
    takenOffFactory: string;
  };
  planned: {
    key: string;
    label: string;
    basisStep: BasisStep | null;
    categories: ExpenseCategory[];
    planned: string | null;
    spent: string;
    difference: string;
    status: CostRowStatus;
    note: string | null;
  }[];
  steps: Record<FlowStep, { count: number; spent: string }>;
  expenses: CostExpense[];
  profit: {
    sale: string;
    uncosted: string;
    factory: string;
    /** What the factories charge (with tax) and what is still to pay them after payments and what they bear. */
    factoryOwed: { currency: string; amount: string; toPay?: string }[];
    planned: string;
    notPlanned: string;
    bankCharges: string;
    expected: string;
    margin: number | null;
    onQuote: string;
    onQuoteMargin: number | null;
  } | null;
  toRepay: { person: Person; currency: string; amount: string; items: { id: string; description: string; amount: string; spentOn: string }[] }[];
  /** The cost sheet: every cost of the order in one list, with its four figures (in the order's currency; null without a rate). */
  sheet: {
    rows: CostSheetRow[];
    total: string;
    costs: string | null;
    paid: string | null;
    toPay: string | null;
    profit: string | null;
    margin: number | null;
    /** Order value on lines without a cost: left out of profit. */
    uncosted: string;
  };
}

/** One cost of an order, known or paid. */
export interface CostSheetRow {
  key: string;
  kind: "goods" | "cost" | "bank" | "estimate";
  label: string;
  category: ExpenseCategory | null;
  owedTo: string | null;
  /** Where it comes from: the factory order, a shipment, the customer's payments, the quotation, or typed on the sheet. */
  from: "factory" | "shipment" | "payment" | "quotation" | "typed";
  amount: string;
  currency: string;
  inOrder: string | null;
  /** In its own currency. */
  paid: string;
  toPay: string;
  /** In the order's currency (null: not ours to bear, or no rate). */
  paidInOrder: string | null;
  toPayInOrder: string | null;
  state: "paid" | "part_paid" | "to_pay" | "to_repay" | "estimate";
  borneBy: ExpenseBearer;
  expenseId: string | null;
  /** The day it was paid, or the day it is dated while it waits. */
  on: string | null;
}

/** GET /expenses: what is shown, with its totals (in the main currency). */
export interface ExpenseList {
  currency: string;
  total: string;
  count: number;
  /** The company's own costs and the costs spent on customers. */
  company: string;
  customers: string;
  /** Ignores the kind filter, so every kind is still there to pick. */
  byCategory: { category: ExpenseCategory; total: string; count: number }[];
  /** Ignores the customer filter. */
  byCustomer: { customer: { id: string; name: string }; total: string; count: number; orders: number }[];
  /** One page of the list; `listed` is how many rows it has in all. */
  rows: ExpenseView[];
  page: number;
  pageSize: number;
  listed: number;
}

/** GET /money/payables */
export interface Payable {
  factory: { id: string; name: string };
  lookedAfterBy: Person | null;
  currency: string;
  owed: string;
  paid: string;
  toPay: string;
  orders: {
    id: string;
    refNo: string;
    stage: string;
    /** Where the order stands in one word (worked out, as on its own page). */
    word: OrderWord;
    customer: string;
    toPay: string;
    /** The next part of the factory's payment plan and when it is due. */
    next?: { label: string; due: string | null; open: string; status: string } | null;
  }[];
}

interface EarnedMonth {
  orders: number;
  revenue: string;
  /** The part of the value with a cost recorded: profit is worked out on it alone. */
  costedRevenue: string;
  /** Value without a cost recorded: left out of profit. */
  uncostedRevenue: string;
  goodsCost: string;
  /** Costs to reach the basis sold on (to the port, freight…). */
  basisCost: string;
  orderExpenses: string;
  bankCharges: string;
  generalExpenses: string;
  profit: string;
}
interface CashMonth {
  in: string;
  factories: string;
  expenses: string;
  net: string;
}

/** GET /money/profit-and-loss?year= */
export interface ProfitAndLoss {
  year: number;
  currency: string;
  months: { month: string; earned: EarnedMonth; cash: CashMonth }[];
  total: { earned: EarnedMonth; cash: CashMonth };
  orders: {
    id: string;
    refNo: string;
    customer: string;
    month: string;
    revenue: string;
    uncostedRevenue: string;
    goodsCost: string;
    basisCost: string;
    expenses: string;
    profit: string;
  }[];
  missingRates: string[];
}

/** GET /expenses/targets: what an expense can be for. */
export interface ExpenseTargets {
  customers: { id: string; name: string }[];
  deals: { id: string; refNo: string; title: string; stage: InquiryStage; customerId: string; customer: string }[];
  orders: { id: string; refNo: string; dealId: string; customerId: string; customer: string }[];
  factories: { id: string; name: string }[];
}

/** GET /customers/:id/account (managers): in the main currency. */
export interface CustomerAccount {
  customer: { id: string; name: string; since: string };
  currency: string;
  deals: { total: number; won: number; lost: number; open: number };
  winRate: number | null;
  margin: number | null;
  depositDaysLate: number | null;
  totals: {
    sales: string;
    goodsCost: string;
    orderCosts: string;
    profit: string;
    beforeSale: string;
    lostDeals: string;
    openDeals: string;
    otherCosts: string;
    spent: string;
    net: string;
    sellingCostPerWin: string | null;
    received: string;
    factoryPaid: string;
    cash: string;
    uncostedRevenue: string;
    bankCharges: string;
  };
  lostReasons: { reason: LostReason | "not_said"; deals: number; spent: string }[];
  rows: {
    id: string;
    refNo: string;
    title: string;
    stage: InquiryStage;
    lostReason: LostReason | null;
    lostNote: string | null;
    receivedOn: string;
    closedAt: string | null;
    assignee: { id: string; name: string } | null;
    spent: string;
    beforeSale: string;
    order: {
      id: string;
      refNo: string;
      stage: string;
      status: string;
      revenue: string;
      uncostedRevenue: string;
      goodsCost: string;
      costs: string;
      profit: string;
      net: string;
    } | null;
  }[];
  timeline: {
    on: string;
    kind: "deal" | "won" | "lost" | "order" | "shipped" | "payment" | "expense";
    text: string;
    amount?: string;
    currency?: string;
    href?: string;
  }[];
  missingRates: string[];
}

/** One line of GET /money/cash-book. */
export interface CashRow {
  key: string;
  id: string;
  kind: "in" | "factory" | "expense" | "transfer_out" | "transfer_in" | "refund";
  on: string;
  /** Signed: in positive, out negative. */
  amount: string;
  currency: string;
  account: { id: string; name: string } | null;
  what: string;
  party: { name: string; href: string | null } | null;
  reference: string | null;
  href: string | null;
  voided: boolean;
  /** One account shown: its balance after this line. */
  balance: string | null;
}

/** GET /money/cash-book */
export interface CashBook {
  from: string;
  to: string;
  account: { id: string; name: string; currency: string; kind: string; openingOn: string } | null;
  opening: string | null;
  closing: string | null;
  totals: { currency: string; in: string; out: string; net: string }[];
  unassigned: number;
  rows: CashRow[];
}

/** GET /reports/leaks (managers): where we lose money, in the main currency. */
export interface LeaksReport {
  range: { from: string; to: string };
  currency: string;
  summary: {
    lostDeals: number;
    lostSpent: string;
    winRate: number | null;
    planned: string;
    actual: string;
    leaked: string;
    keptPercent: number | null;
    stuck: string;
    /** Value on lines without a cost: left out of planned and actual profit. */
    uncostedRevenue: string;
  };
  lostReasons: { reason: LostReason | "not_said"; label: string; deals: number; spent: string }[];
  lostDeals: {
    id: string;
    refNo: string;
    title: string;
    customer: { id: string; name: string };
    reason: LostReason | null;
    assignee: string;
    spent: string;
  }[];
  byPerson: LeakGroup[];
  byCategory: LeakGroup[];
  orders: {
    id: string;
    refNo: string;
    customer: { id: string; name: string };
    revenue: string;
    planned: string;
    orderCosts: string;
    beforeSale: string;
    factoryExtra: string;
    actual: string;
    leaked: string;
    uncosted: boolean;
    uncostedRevenue: string;
  }[];
  customers: { best: LeakCustomer[]; costing: LeakCustomer[] };
  trend: { month: string; sales: string; expenses: string; percent: number | null }[];
  stuck: { id: string; refNo: string; customer: { id: string; name: string }; currency: string; amount: string; days: number }[];
  factories: { factory: { id: string; name: string }; spent: string; count: number }[];
  warnings: { level: "bad" | "warn"; text: string; href: string | null }[];
  missingRates: string[];
}
export interface LeakGroup {
  key: string;
  won: number;
  lost: number;
  winRate: number | null;
  spent: string;
  costPerWin: string | null;
}
export interface LeakCustomer {
  customer: { id: string; name: string };
  sales: string;
  profit: string;
  spent: string;
  net: string;
}

/** GET /payments?customerId= — a customer's orders with what was received and is due, and every payment. */
export interface CustomerPayments {
  totals: { currency: string; orders: number; total: string; received: string; due: string }[];
  orders: {
    id: string;
    refNo: string;
    status: "open" | "closed" | "cancelled";
    stage: string;
    /** Where the order stands in one word (worked out, as on its own page). */
    word: OrderWord;
    currency: string;
    orderedOn: string;
    total: string;
    received: string;
    due: string;
    depositDue: string;
    payStatus: "unpaid" | "partly_paid" | "deposit_paid" | "paid" | "overpaid";
    lastPaidOn: string | null;
    /** The next unpaid instalment (a transfer pays the oldest due first). */
    next: { label: string; dueOn: string | null; open: string } | null;
  }[];
  /** The money we hold for the customer. */
  credit: CustomerCreditView;
  payments: {
    id: string;
    order: { id: string; refNo: string };
    kind: PaymentKind;
    amount: string;
    bankCharges: string;
    currency: string;
    paidOn: string;
    method: PaymentMethod;
    reference: string | null;
    receivedAmount: string;
    receivedCurrency: string;
    receiptId: string | null;
    voided: boolean;
    hasFile: boolean;
  }[];
}

export interface FactoryPlanView {
  factory: { id: string; name: string };
  currency: string;
  /** This factory's own ready date (its "on the ready date" parts fall due then). */
  readyOn?: string | null;
  owed: string;
  /** Saved for this order (false: the company's default until saved). */
  saved: boolean;
  /** The plan does not add up to what we owe (prices changed since). */
  differs: string | null;
  /** Paid, with the expenses the factory bears (taken off what we owe it). */
  paid: string;
  takenOff?: string;
  toPay: string;
  rows: {
    /** The invoice (null: the company's default, not saved yet). */
    id: string | null;
    /** The supplier's own invoice number, if they sent one. */
    supplierRef: string | null;
    label: string;
    percent: number | null;
    amount: string;
    dueRule: FactoryDueRule;
    dueOn: string | null;
    due: string | null;
    paid: string;
    open: string;
    status: FactoryPlanStatus;
    inDays: number | null;
  }[];
  next: { label: string; due: string | null; open: string; status: FactoryPlanStatus } | null;
}

/** The customer's credit (GET /customers/:id/credit, and in the customer's payments). */
export interface CustomerCreditView {
  balances: { currency: string; amount: string }[];
  entries: {
    id: string;
    kind: CreditKind;
    amount: string;
    currency: string;
    on: string;
    note: string | null;
    order: { id: string; refNo: string } | null;
    account: { id: string; name: string } | null;
    receipt: { id: string; received: string; method: string; paidOn: string } | null;
    voided: { at: string; reason: string | null } | null;
  }[];
  canRecord: boolean;
}

/** GET /billing/invoices: the open invoices of one side, instalment by instalment (late first). */
export interface OpenInvoices {
  side: "receivable" | "payable";
  rows: {
    /** null: a supplier's default plan, not saved yet. */
    id: string | null;
    /** The payment request's number (PR-2026-0031-2), or the supplier's own number if known. */
    number: string | null;
    label: string;
    order: { id: string; refNo: string };
    party: { id: string; name: string };
    lookedAfterBy: { id: string; name: string } | null;
    currency: string;
    amount: string;
    paid: string;
    open: string;
    dueOn: string | null;
    /** Days late (0: not late). */
    late: number;
    soon: boolean;
    /** A customer's instalment as a payment request (null: a supplier's, or not on a request). */
    request: { state: RequestState; with: SentWith | null; sentOn: string | null; revision: number | null; changed: boolean; through: "customer" | "bank" } | null;
  }[];
  totals: { currency: string; open: string; late: string; count: number }[];
}

/** How a payment request was asked for: the request itself, the proforma (the deposit), the papers at the bank (a bank route's balance). */
export type SentWith = "request" | "proforma" | "bank";

/** A plan row as a payment request (the API's RequestView). */
export interface RequestView {
  state: RequestState;
  with: SentWith | null;
  sentOn: string | null;
  sentBy: { id: string; name: string } | null;
  /** R1, R2… of the request (null: not sent as a request). */
  revision: number | null;
  proformaNo: string | null;
  /** How it is asked for: a request to the customer, or the papers through the banks (a bank route's balance). */
  through: "customer" | "bank";
  /** Sent, still open, and the row no longer says what was sent: send it again. */
  changed: boolean;
  receipts: RowReceipt[];
}

/** A payment that paid (part of) a request, with its receipt and how it came. */
export interface RowReceipt {
  id: string;
  /** The receipt's number (RC-2026-0041-2). */
  number: string;
  /** What of this payment went to the request. */
  amount: string;
  paidOn: string;
  /** The whole payment on the order: more than `amount` when it also paid another request. */
  whole: string;
  method: string;
  reference: string | null;
  account: string | null;
  recordedBy: string | null;
  hasProof: boolean;
  /** Its page in Payments (null: paid from the customer's credit). */
  entryId: string | null;
}

type InvoiceStatus = "paid" | "part_paid" | "unpaid";
interface InvoiceRef {
  kind: "commercial" | "proforma";
  number: string;
  issuedOn: string;
  version: number;
}

/** GET /billing/customer-invoices */
export interface CustomerInvoices {
  rows: {
    invoice: InvoiceRef;
    order: { id: string; refNo: string };
    customer: { id: string; name: string };
    lookedAfterBy: { id: string; name: string } | null;
    currency: string;
    total: string;
    paid: string;
    due: string;
    status: InvoiceStatus;
    nextDue: string | null;
    late: number;
  }[];
}

/** GET /billing/customer-invoices/:orderId */
export interface CustomerInvoice {
  /** Null: not issued yet (the proforma comes first). */
  invoice: InvoiceRef | null;
  order: { id: string; refNo: string; status: string };
  customer: { id: string; name: string };
  lookedAfterBy: { id: string; name: string } | null;
  currency: string;
  lines: { id: string; type: string; description: string; model: string | null; quantity: string; unit: string; unitPrice: string; amount: string }[];
  discount: string | null;
  orderTotal: string;
  charged: string;
  total: string;
  paid: string;
  due: string;
  status: InvoiceStatus;
  parts: {
    ref: string;
    number: string;
    label: string;
    dueOn: string | null;
    rule: string | null;
    amount: string;
    paid: string;
    late: number;
    request: { state: RequestState; with: SentWith | null; sentOn: string | null; revision: number | null; changed: boolean; through: "customer" | "bank" };
    lastPaidOn: string | null;
  }[];
  terms: { priceBasis: string; payment: string };
  linked: {
    quotation: { refNo: string; revision: number; inquiryId: string } | null;
    proforma: { number: string; versions: number } | null;
    commercial: { number: string; versions: number } | null;
  };
}

/** One copy kept when a request was sent. */
export interface KeptCopy {
  paperId: string;
  ref: string;
  number: string;
  revision: number;
  sentOn: string;
  sentBy: { id: string; name: string } | null;
  amount: string | null;
  dueOn: string | null;
  label: string | null;
}

/** GET /orders/:id/requests/:ref */
export interface RequestPage {
  orderId: string;
  refNo: string;
  orderStatus: string;
  customer: { id: string; name: string };
  currency: string;
  ref: string;
  copies: KeptCopy[];
  number: string;
  label: string;
  amount: string;
  dueOn: string | null;
  paid: string;
  open: string;
  late: number;
  part: string | null;
  rule: string | null;
  cancelled: boolean;
  request: RequestView | null;
  canSend: boolean;
  canPay: boolean;
}

/** GET /billing/requests */
export interface RequestList {
  rows: {
    order: { id: string; refNo: string };
    customer: { id: string; name: string };
    lookedAfterBy: { id: string; name: string } | null;
    currency: string;
    ref: string;
    number: string;
    label: string;
    amount: string;
    paid: string;
    open: string;
    dueOn: string | null;
    late: number;
    soon: boolean;
    state: RequestState | "cancelled";
    with: SentWith | null;
    sentOn: string | null;
    revision: number | null;
    changed: boolean;
    through: "customer" | "bank";
  }[];
  canPay: boolean;
  canSend: boolean;
}

/** GET /money/bills: the bills known and not paid yet, and the people to pay back, across the company. */
export interface OpenBills {
  rows: {
    id: string;
    kind: "bill" | "repay";
    owedTo: string | null;
    category: ExpenseCategory;
    description: string;
    reference: string | null;
    order: { id: string; refNo: string } | null;
    amount: string;
    currency: string;
    /** The day it is dated, and how many days it has waited. */
    on: string;
    days: number;
    fromShipment: boolean;
  }[];
  totals: { currency: string; open: string; count: number }[];
}

/** GET /billing/to-pay: the open parts of every supplier's plan (Money › To receive and to pay). */
export interface ToPayList {
  rows: {
    key: string;
    ref: string | null;
    label: string;
    supplierRef: string | null;
    part: "deposit" | "balance";
    supplier: { id: string; name: string };
    lookedAfterBy: Person | null;
    order: { id: string; refNo: string };
    customer: { id: string; name: string };
    po: string | null;
    currency: string;
    amount: string;
    paid: string;
    open: string;
    dueOn: string | null;
    dueRule: FactoryDueRule;
    late: number;
    status: FactoryPlanStatus;
    /** The order's route and what the customer has paid on it (in the order's currency). */
    customerMoney: { route: PaymentRoute | null; currency: string; total: string; received: string; state: string; words: string; warn: boolean };
  }[];
  totals: { currency: string; open: string; late: string; count: number }[];
  canPay: boolean;
}
