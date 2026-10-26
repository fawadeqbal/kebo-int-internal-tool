import type { ExpenseCategory, PaymentKind, PaymentMethod, InstalmentStatus } from "@kebo/shared";
import type { Person } from "./types";

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
  profit: {
    revenue: string;
    goodsCost: string;
    uncostedRevenue: string;
    expenses: string;
    earned: string;
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
  voided: { at: string; reason: string | null } | null;
}

export interface ExpenseView {
  id: string;
  order: { id: string; refNo: string } | null;
  orderId: string | null;
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
  voided: { at: string; reason: string | null } | null;
}

/** GET /expenses */
export interface ExpenseList {
  currency: string;
  total: string;
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
