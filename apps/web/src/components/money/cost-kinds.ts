import type { ExpenseView } from "@/lib/types-money";
import type { CostFor } from "./cost-window";
import { expenseShort, type ExpenseCategory } from "@kebo/shared";

/** A kind's short name, the same on every chip and table ("To the port", "Internet and bills"). Plain, for the server and the browser. */
export const costKind = (c: ExpenseCategory) => (c === "utilities" ? "Internet and bills" : expenseShort(c));

/** A cost of the company itself (on no customer, inquiry or order). */
export const COMPANY: CostFor = { place: "company", id: null, label: "The company" };

/** Who an expense was for, as the window shows it. */
export function costForOf(e: Pick<ExpenseView, "order" | "deal" | "customer">): CostFor {
  const who = e.customer ? ` · ${e.customer.name}` : "";
  if (e.order) return { place: "order", id: e.order.id, customerId: e.customer?.id ?? null, label: `Order ${e.order.refNo}${who}` };
  if (e.deal) return { place: "deal", id: e.deal.id, customerId: e.customer?.id ?? null, label: `Inquiry ${e.deal.refNo}${e.deal.stage === "lost" ? " (lost)" : ""}${who}` };
  if (e.customer) return { place: "customer", id: e.customer.id, customerId: e.customer.id, label: e.customer.name };
  return COMPANY;
}
