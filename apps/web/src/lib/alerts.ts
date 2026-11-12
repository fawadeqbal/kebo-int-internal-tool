import type { Tone } from "@kebo/shared";

/** The Alerts page's chips beside All and Unread (the API's `group`). */
export const ALERT_GROUPS = [
  { key: "payments", label: "Payments" },
  { key: "inquiries", label: "Inquiries" },
  { key: "orders", label: "Orders" },
  { key: "followUps", label: "Follow-ups" },
  { key: "mentions", label: "Mentions" },
] as const;
export type AlertGroup = (typeof ALERT_GROUPS)[number]["key"];

/** Exact types first, then by how the type starts. */
const KINDS: [test: string, label: string, tone: Tone][] = [
  ["payment.recorded", "Payment to verify", "ok"],
  ["payment.in", "Payment received", "ok"],
  ["approval.waiting", "To approve", "warn"],
  ["approval.approved", "Approved", "ok"],
  ["approval.sentBack", "Sent back", "bad"],
  ["inquiry.created", "New inquiry", "info"],
  ["inquiry.assigned", "Given to you", "neutral"],
  ["inquiry.won", "Inquiry won", "ok"],
  ["inquiry.lost", "Inquiry lost", "bad"],
  ["inquiry.", "Inquiry moved", "info"],
  ["quotation.accepted", "Quotation accepted", "ok"],
  ["quotation.rejected", "Quotation turned down", "bad"],
  ["quotation.", "Quotation", "info"],
  ["order.created", "Order made", "ok"],
  ["order.", "Order moved", "info"],
  ["reminder.orderEscalated", "Order late", "bad"],
  ["reminder.order", "Order needs you", "warn"],
  ["reminder.instalment", "Payment due", "warn"],
  ["reminder.new", "Still new", "warn"],
  ["reminder.sourcing", "Sourcing too long", "warn"],
  ["reminder.overdue", "Past needed-by", "bad"],
  ["reminder.dueSoon", "Needed soon", "warn"],
  ["reminder.quotationExpired", "Quotation expired", "bad"],
  ["reminder.quotationDue", "Quotation ending", "warn"],
  ["followUp.assigned", "Follow-up for you", "neutral"],
  ["followUp.due", "Follow-up due", "warn"],
  ["mention.", "Mentioned you", "neutral"],
  ["two_step", "Your account", "warn"],
];

/** The label and colour of a notification's type ("Payment to verify", ok). */
export function alertKind(type: string): { label: string; tone: Tone } {
  const hit = KINDS.find(([t]) => (t.endsWith(".") ? type.startsWith(t) : type === t)) ?? KINDS.find(([t]) => type.startsWith(t));
  return hit ? { label: hit[1], tone: hit[2] } : { label: "Update", tone: "neutral" };
}
