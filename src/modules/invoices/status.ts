import type { InvoiceStatus } from "@/lib/db/schema";
import type { InvoiceDisplayStatus } from "@/lib/labels";
import { toCents } from "@/lib/utils/money";

/** Overdue is not stored — it is derived from the due date, so it is always correct. */
export function invoiceDisplayStatus(inv: { status: InvoiceStatus; dueDate: string }, today: string): InvoiceDisplayStatus {
  if ((inv.status === "unpaid" || inv.status === "partially_paid") && inv.dueDate < today) return "overdue";
  return inv.status;
}

/** Payment status follows from the amount paid. */
export function paymentStatus(total: string | number, paid: string | number): InvoiceStatus {
  const t = toCents(total);
  const p = toCents(paid);
  if (p <= 0) return "unpaid";
  if (p >= t) return "paid";
  return "partially_paid";
}
