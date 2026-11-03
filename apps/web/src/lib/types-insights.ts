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
