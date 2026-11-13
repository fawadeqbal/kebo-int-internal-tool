import type { OrderStage } from "@kebo/shared";

export type ReminderLevel = "bad" | "warn" | "info";

/** GET /reminders */
export interface Reminders {
  items: {
    key: string;
    kind: "order" | "quote" | "deal" | "offer" | "money" | "ship";
    level: ReminderLevel;
    title: string;
    detail: string | null;
    due: string | null;
    href: string;
    action: string;
    who: string | null;
  }[];
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
    /** Expenses charged to the customer (part of due). */
    charged?: string;
    due: string;
    overdue: string;
    daysLate: number;
    next: { label: string; open: string; dueOn: string | null; status: string; when?: string | null } | null;
    /** How it comes (the route): "LC", "Informal", "Bank contract". */
    how?: string | null;
    lastPaid: string | null;
  }[];
  totals: { currency: string; due: string; overdue: string; credit?: string; net?: string }[];
  /** Money held for customers (their credit). */
  held?: { currency: string; amount: string; customers: number }[];
}

/** A sentence of Home's "What stands out": worked out from the numbers by a rule, shown only when it fires. */
export interface Standout {
  key: "sales" | "late" | "cost" | "supplier" | "quotes";
  level: "bad" | "warn" | "ok" | "info";
  /** The bold start of the sentence. */
  lead: string;
  text: string;
  href: string;
  link: string;
}

/** A stage of the orders or inquiries that are open now: how many, what to know about them. */
export interface HomeStage {
  key: string;
  label: string;
  count: number;
  value: string | null;
  note: string;
  level: "bad" | "warn" | null;
}

/** GET /insights/home (people who see the reports): Home's figures. Money in the main currency. */
export interface HomeFigures {
  currency: string;
  today: string;
  seeMoney: boolean;
  seeProfit: boolean;
  month: {
    name: string;
    before: string;
    /** `before`: by the same day of last month. */
    sold: { now: string; before: string; orders: number };
    collected: { now: string; before: string; payments: number } | null;
    profit: { now: string; margin: number | null; marginBefore: number | null; afterCompanyCosts: boolean };
    cash: { total: string; byCurrency: { currency: string; accounts: number; amount: string; inMain: string }[] } | null;
  };
  standout: Standout[];
  /** The next four weeks from today: what should come in and go out by its date, and the cash after. */
  weeks: { from: string; to: string; in: string; out: string; after: string }[] | null;
  months: { month: string; orders: number; sold: string; profit: string }[];
  orders: { open: number; value: string; stages: HomeStage[] };
  thin: { count: number; rows: { orderId: string; refNo: string; customer: string; sold: string; costs: string; profit: string; margin: number }[]; others: number; othersFrom: number | null } | null;
  inquiries: { open: number; stages: HomeStage[]; won: { won: number; answered: number; rate: number | null; rateBefore: number | null } };
}
