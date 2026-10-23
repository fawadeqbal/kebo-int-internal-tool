import type { InvoiceStatus, PaymentMethod, Priority, QuerySource, QueryStatus, QuotationStatus } from "@/lib/db/schema";

/** Business words used everywhere in the UI (one place to rename anything). */
export const QUERY_STATUS_LABEL: Record<QueryStatus, string> = {
  pending: "Pending",
  processing: "Processing",
  completed: "Completed",
  not_completed: "Not Completed",
};

export const QUOTATION_STATUS_LABEL: Record<QuotationStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  rejected: "Rejected",
  expired: "Expired",
};

export type InvoiceDisplayStatus = InvoiceStatus | "overdue";
export const INVOICE_STATUS_LABEL: Record<InvoiceDisplayStatus, string> = {
  unpaid: "Unpaid",
  partially_paid: "Partially Paid",
  paid: "Paid",
  cancelled: "Cancelled",
  overdue: "Overdue",
};

/** Order = how often Kebo receives RFQs through each channel. */
export const SOURCE_LABEL: Record<QuerySource, string> = {
  website: "Website form",
  whatsapp: "WhatsApp",
  wechat: "WeChat",
  email: "Email",
  phone: "Phone",
  walk_in: "Visit / trade fair",
  other: "Other",
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  bank_transfer: "Bank transfer (T/T)",
  lc: "Letter of credit (L/C)",
  cash: "Cash",
  cheque: "Cheque",
  online: "Online payment",
  other: "Other",
};

export type Tone = "neutral" | "primary" | "trust" | "money" | "ok" | "warn" | "bad" | "info" | "outline";

export const QUERY_STATUS_TONE: Record<QueryStatus, Tone> = {
  pending: "warn",
  processing: "info",
  completed: "ok",
  not_completed: "neutral",
};

export const QUOTATION_STATUS_TONE: Record<QuotationStatus, Tone> = {
  draft: "neutral",
  sent: "info",
  accepted: "ok",
  rejected: "bad",
  expired: "warn",
};

export const INVOICE_STATUS_TONE: Record<InvoiceDisplayStatus, Tone> = {
  unpaid: "warn",
  partially_paid: "info",
  paid: "ok",
  cancelled: "neutral",
  overdue: "bad",
};

export const PRIORITY_TONE: Record<Priority, Tone> = {
  low: "outline",
  normal: "neutral",
  high: "warn",
  urgent: "bad",
};
