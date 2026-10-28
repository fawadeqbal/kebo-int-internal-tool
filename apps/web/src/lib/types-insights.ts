import type { InquiryChannel, OrderStage } from "@kebo/shared";

/** A figure for the period and the one before; `change` in percent (null with nothing to compare). */
export interface Kpi<T = string | number> {
  value: T | null;
  previous: T | null;
  change: number | null;
}

/** GET /insights */
export interface Insights {
  range: { from: string; to: string };
  previous: { from: string; to: string };
  currency: string;
  seeMoney: boolean;
  /** Managers, when the company's plan includes expenses: profit after expenses and where money is lost. */
  seeExpenses: boolean;
  kpis: {
    revenue: Kpi<string>;
    grossProfit: Kpi<string>;
    margin: Kpi<number>;
    netProfit: Kpi<string> | null;
    expenses: Kpi<string> | null;
    cashIn: Kpi<string>;
    cashOut: Kpi<string> | null;
    orders: Kpi<number>;
    avgOrder: Kpi<string>;
    received: Kpi<number>;
    won: Kpi<number>;
    winRate: Kpi<number>;
    quotesSent: Kpi<number>;
    quotesValue: Kpi<string>;
    quoteDays: Kpi<number>;
    closeDays: Kpi<number>;
    onTime: Kpi<number>;
    newCustomers: Kpi<number>;
    repeatShare: Kpi<number>;
  };
  now: { cashInHand: string | null; toReceive: string; overdue: string; toPay: string | null; pipeline: string; pipelineDeals: number; weightedPipeline: string | null };
  target: { month: string; amount: string | null; reached: string; percent: number | null; canSet: boolean };
  series: {
    month: string;
    revenue: string;
    grossProfit: string;
    expenses: string | null;
    netProfit: string | null;
    cashIn: string;
    cashOut: string | null;
    received: number;
    won: number;
    lastYearRevenue: string;
    target: string | null;
  }[];
  funnel: { received: number; quoted: number; won: number };
  aging: { notDue: string; d30: string; d60: string; d90: string; older: string };
  topCustomers: { customer: { id: string; name: string; country: string }; revenue: string; grossProfit: string; orders: number; isNew: boolean }[];
  categories: { category: string; revenue: string; grossProfit: string; orders: number }[];
  countries: { country: string; revenue: string; orders: number; customers: number }[];
  channels: { channel: InquiryChannel; received: number; won: number; winRate: number | null }[];
  lostReasons: { reason: string; label: string; count: number }[];
  people: { id: string | null; name: string; received: number; won: number; lost: number; winRate: number | null; revenue: string; quoteDays: number | null }[];
  factories: { factory: { id: string; name: string }; spend: string; orders: number }[];
  missingRates: string[];
}

export type ReminderLevel = "bad" | "warn" | "info";

/** GET /reminders */
export interface Reminders {
  items: { key: string; kind: "order" | "quote" | "deal" | "offer" | "money"; level: ReminderLevel; title: string; detail: string | null; due: string | null; href: string; action: string; who: string | null }[];
  counts: { total: number; bad: number; hidden: number };
}

/** GET /money/receivables */
export interface Receivables {
  rows: {
    id: string;
    refNo: string;
    customer: { id: string; name: string };
    handledBy: { id: string; name: string } | null;
    stage: OrderStage;
    closed: boolean;
    currency: string;
    total: string;
    received: string;
    due: string;
    overdue: string;
    daysLate: number;
    next: { label: string; open: string; dueOn: string | null; status: string } | null;
    lastPaid: string | null;
  }[];
  totals: { currency: string; due: string; overdue: string }[];
}
