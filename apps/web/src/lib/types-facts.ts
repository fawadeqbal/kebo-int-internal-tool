/** Insights data (GET /insights/facts/*): the three calculated tables, added up. Money in the main currency. */

export interface OrderGroupRow {
  period: string;
  key: string;
  label: string;
  /** By customer only. */
  country?: string | null;
  orders: number;
  customers: number;
  sales: string;
  costed: string;
  profitQuote: string;
  marginQuote: number | null;
  cost: string | null;
  profitExpected: string | null;
  margin: number | null;
  expenses: string | null;
  costsOverPlan: string | null;
  ordersOverPlan: number | null;
  profitDone: string | null;
  received: string;
  due: string;
  overdue: string;
  shipped: { withDate: number; onTime: number; percent: number | null };
  daysToShip: number | null;
  daysQuoteToOrder: number | null;
  paid: { inFull: number; onTime: number; percent: number | null };
  daysToPay: number | null;
  firstOrderedOn: string;
  lastOrderedOn: string;
  missingRate: number;
}

export interface OrderGroups {
  currency: string;
  seeMoney: boolean;
  seeExpenses: boolean;
  period: string;
  by: string;
  rows: OrderGroupRow[];
}

export interface InquiryGroupRow {
  period: string;
  key: string;
  label: string;
  inquiries: number;
  gotPrices: number;
  quoted: number;
  quotedValue: string;
  won: number;
  lost: number;
  open: number;
  winRate: number | null;
  wonValue: string;
  daysToFirstQuote: number | null;
  medianDaysToFirstQuote: number | null;
  daysToWin: number | null;
  medianDaysToClose: number | null;
}

export interface InquiryGroups {
  currency: string;
  period: string;
  by: string;
  rows: InquiryGroupRow[];
}

export interface Funnel {
  inquiries: number;
  gotPrices: number;
  quoted: number;
  quotedValue: string;
  won: number;
  wonValue: string;
  lost: number;
  open: number;
  winRate: number | null;
  medianDaysToFirstQuote: number | null;
  medianDaysToClose: number | null;
  lostReasons: { reason: string; label: string; count: number }[];
}

export interface FactoryGroupRow {
  period: string;
  key: string;
  label: string;
  orders: number;
  spend: string | null;
  paid: string | null;
  toPay: string | null;
  own: { currency: string; owed: string; toPay: string }[] | null;
  ready: { known: number; onTime: number; percent: number | null };
  daysLate: number | null;
  daysLateWhenLate: number | null;
  offersSent: number;
  offersWon: number;
  claims: number;
  firstOrderedOn: string | null;
  lastOrderedOn: string | null;
}

export interface FactoryGroups {
  currency: string;
  seeMoney: boolean;
  period: string;
  by: string;
  rows: FactoryGroupRow[];
}

export type AgeBucket = "notDue" | "d30" | "d60" | "d90" | "older";

export interface Aging {
  side: "receivable" | "payable";
  currency: string;
  today: string;
  total: string;
  notDue: string;
  d30: string;
  d60: string;
  d90: string;
  older: string;
  over60: string;
  orders: { orderId: string; refNo: string; customer: string; factory: string | null; amount: string }[] | null;
}

export interface CashFacts {
  currency: string;
  from: string;
  to: string;
  seeMoney: boolean;
  seeExpenses: boolean;
  months: { month: string; in: string; out: string | null; factories: string | null; expenses: string | null; net: string | null }[];
  byKind: { category: string; amount: string; orders: number }[] | null;
  missingRates: string[];
}

export interface FactOrderRow {
  orderId: string;
  refNo: string;
  customerId: string;
  customer: string;
  handledBy: string | null;
  country: string;
  channel: string;
  category: string;
  status: string;
  stage: string;
  orderedOn: string;
  sales: string;
  costed: string;
  cost: string | null;
  profitQuote: string;
  profitExpected: string | null;
  marginQuote: number | null;
  margin: number | null;
  expenses: string | null;
  costsOverPlan: string | null;
  received: string;
  due: string;
  overdue: string;
}

export interface FactOrders {
  currency: string;
  seeMoney: boolean;
  rows: FactOrderRow[];
}

export interface FactsNow {
  currency: string;
  today: string;
  seeMoney: boolean;
  seeExpenses: boolean;
  openQuotes: { count: number; value: string; winRate: number | null; likely: string | null };
  expiring: { count: number; value: string };
  overdue: { customers: number; amount: string; list: { customerId: string; name: string; amount: string; days: number }[] };
  lateFactories: { factoryId: string; name: string; days: number; orders: number }[];
  lowMargin: { orders: number; costsOverPlan: string | null };
  byCurrency: { currency: string; toReceive: string; toPay: string }[] | null;
}
