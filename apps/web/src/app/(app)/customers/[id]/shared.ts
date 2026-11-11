import type { StatusMeaning } from "@kebo/ui";
import type { CustomerPayments } from "@/lib/types-money";

type PayOrder = CustomerPayments["orders"][number];

/** An order the customer still owes on. */
export const owes = (o: PayOrder) => o.status !== "cancelled" && Number(o.due) > 0.005;
/** …with an instalment past its due day. */
export const late = (o: PayOrder, today: string) => owes(o) && !!o.next?.dueOn && o.next.dueOn < today;

/** The customer's status, from what they owe (Overdue · Owes money · Paid up · No order yet · New). */
export function customerStatus(
  pay: CustomerPayments | null,
  c: { orders: { status: string }[]; inquiries: unknown[] },
  today: string,
): { meaning: StatusMeaning; label: string } {
  const rows = pay?.orders ?? [];
  if (rows.some((o) => late(o, today))) return { meaning: "bad", label: "Overdue" };
  if (rows.some(owes)) return { meaning: "info", label: "Owes money" };
  if (c.orders.some((o) => o.status !== "cancelled")) return { meaning: "ok", label: "Paid up" };
  return { meaning: "neutral", label: c.inquiries.length ? "No order yet" : "New" };
}

/** Inquiries still being worked on. */
export const OPEN_STAGES = ["new", "sourcing", "quoted"];
