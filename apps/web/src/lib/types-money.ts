import type { ExpenseCategory, InquiryStage, LostReason, PaymentKind, PaymentMethod, InstalmentStatus } from "@kebo/shared";
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
  received: string;
  due: string;
  plan: {
    items: { id: string; label: string; amount: string; dueOn: string | null; paid: string; open: string; status: InstalmentStatus }[];
    matchesTotal: boolean;
    difference: string;
    next: { label: string; open: string; dueOn: string | null; status: InstalmentStatus } | null;
    canEdit: boolean;
  };
  factories: {
    rows: FactoryOwed[];
    payments: FactoryPaymentView[];
    canRecord: boolean;
  } | null;
  expenses: ExpenseView[] | null;
  /** Spent on the deal before it became this order (managers). */
  dealExpenses: ExpenseView[] | null;
  deal: { id: string };
  profit: {
    revenue: string;
    goodsCost: string;
    uncostedRevenue: string;
    expenses: string;
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
  paid: string;
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
  voided: { at: string; reason: string | null } | null;
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
  rows: ExpenseView[];
}

/** GET /money/payables */
export interface Payable {
  factory: { id: string; name: string };
  lookedAfterBy: Person | null;
  currency: string;
  owed: string;
  paid: string;
  toPay: string;
  orders: { id: string; refNo: string; stage: string; customer: string; toPay: string }[];
}

interface EarnedMonth {
  orders: number;
  revenue: string;
  goodsCost: string;
  orderExpenses: string;
  generalExpenses: string;
  profit: string;
  uncostedRevenue: string;
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
    goodsCost: string;
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
    order: { id: string; refNo: string; stage: string; status: string; revenue: string; goodsCost: string; costs: string; profit: string; net: string } | null;
  }[];
  timeline: { on: string; kind: "deal" | "won" | "lost" | "order" | "shipped" | "payment" | "expense"; text: string; amount?: string; currency?: string; href?: string }[];
  missingRates: string[];
}

/** One line of GET /money/cash-book. */
export interface CashRow {
  key: string;
  id: string;
  kind: "in" | "factory" | "expense" | "transfer_out" | "transfer_in";
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
  summary: { lostDeals: number; lostSpent: string; winRate: number | null; planned: string; actual: string; leaked: string; keptPercent: number | null; stuck: string };
  lostReasons: { reason: LostReason | "not_said"; label: string; deals: number; spent: string }[];
  lostDeals: { id: string; refNo: string; title: string; customer: { id: string; name: string }; reason: LostReason | null; assignee: string; spent: string }[];
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
