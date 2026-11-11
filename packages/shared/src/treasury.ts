/**
 * Treasury › Payments: every payment in and out in one list, and one page per payment
 * (architecture review §8, work order step 2a). The API builds these from the money records
 * (GET /payments, GET /payments/:kind/:id); the web only draws them.
 */

const values = <const T extends readonly string[]>(...v: T) => v;

/** The record a payment row comes from. */
export const PAYMENT_RECORD_KINDS = values("customer", "receipt", "refund", "supplier", "expense", "transfer", "submission");
export type PaymentRecordKind = (typeof PAYMENT_RECORD_KINDS)[number];

/** Money in (from customers), out (to suppliers, expenses, refunds) or moved between our accounts. */
export const PAYMENT_DIRECTIONS = values("in", "out", "move");
export type PaymentDirection = (typeof PAYMENT_DIRECTIONS)[number];

/**
 * to_verify: sent by staff, waiting for a manager; sent_back: returned to the person who sent it;
 * recorded: counts; void: removed (kept, crossed out).
 */
export const PAYMENT_STATUSES = values("to_verify", "sent_back", "recorded", "void");
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_RECORD_LABEL: Record<PaymentRecordKind, string> = {
  customer: "Customer payment",
  receipt: "Customer payment",
  refund: "Refund to a customer",
  supplier: "Supplier payment",
  expense: "Expense",
  transfer: "Between our accounts",
  submission: "Sent for approval",
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  to_verify: "To verify",
  sent_back: "Sent back",
  recorded: "Recorded",
  void: "Removed",
};

export const PAYMENT_DIRECTION_LABEL: Record<PaymentDirection, string> = { in: "Money in", out: "Money out", move: "Between our accounts" };

/** Where a row links to: a party, an order or an inquiry. */
export interface PaymentLink {
  label: string;
  href: string | null;
}

/** One row of Treasury › Payments. */
export interface PaymentRow {
  kind: PaymentRecordKind;
  id: string;
  /** Its number as posted in the ledger (RC-…, FP-…, EX-…, TR-…); none until it is recorded. */
  number: string | null;
  on: string;
  direction: PaymentDirection;
  /** "Deposit for SO-2026-0032", "Inspection: SGS". */
  what: string;
  amount: string;
  currency: string;
  party: PaymentLink | null;
  /** The orders (or inquiry) it is for. */
  for: PaymentLink[];
  account: string | null;
  reference: string | null;
  status: PaymentStatus;
  /** Paid from the customer's credit: no money moved. */
  fromCredit: boolean;
}

export interface PaymentList {
  rows: PaymentRow[];
  total: number;
  page: number;
  pageSize: number;
  /** In the period and filters, before the direction and status chips. */
  counts: { all: number; in: number; out: number; move: number; to_verify: number };
  /** The order or party the list is for (?order=, ?party=): its number or name. */
  scope: string | null;
  /** What this person may record from the Record payment page. */
  canRecord: { in: boolean; out: boolean; expense: boolean; transfer: boolean };
}

/** One payment's page. */
export interface PaymentView extends PaymentRow {
  title: string;
  /** What it was, in order: label, value, and a link where there is one. */
  fields: { label: string; value: string; href?: string | null }[];
  /** The bank slip, transfer screenshot or receipt photo. */
  file: { name: string; href: string } | null;
  /** The order it is on (its page changes the payment and its proof there). */
  orderId: string | null;
  /** Its posting in the general ledger. */
  ledgerHref: string | null;
  recordedBy: string | null;
  recordedAt: string;
  voided: { at: string; reason: string | null } | null;
  /** Remove it (with a reason): the endpoint that does it, when this person may. */
  voidPath: string | null;
}
