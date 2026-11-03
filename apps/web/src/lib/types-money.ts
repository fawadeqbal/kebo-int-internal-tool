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
} from "@kebo/shared";
import type { Person } from "./types";

/** A file kept with a record (an expense's receipt, a payment's bank slip). */
export interface AttachedFileInfo {
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
    }[];
    /** The order's dates the rules read (the ready date: the latest factory's). */
    dates: { readyOn: string | null; shippedOn: string | null; papersOn: string | null };
    matchesTotal: boolean;
    difference: string;
    next: { label: string; open: string; dueOn: string | null; status: InstalmentStatus } | null;
    canEdit: boolean;
  };
  factories: {
    rows: FactoryOwed[];
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
  receipt: { name: string; type: string; size: number } | null;
  /** On an order: its step, who bears it, and whether someone paid it from their own money. */
  step: FlowStep | null;
  borneBy: ExpenseBearer;
  ownMoney: boolean;
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
