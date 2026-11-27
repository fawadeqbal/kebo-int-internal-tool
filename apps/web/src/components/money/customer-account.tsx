import Link from "next/link";
import { LOST_REASON_LABEL, type LostReason } from "@kebo/shared";
import { Notice } from "@kebo/ui";
import { api } from "@/lib/api";
import type { CustomerAccount } from "@/lib/types-money";
import { isFailed, part } from "@/lib/part";
import { CouldNotLoad } from "@/components/common/could-not-load";

export const lostReasonLabel = (r: LostReason | "not_said") => (r === "not_said" ? "No reason given" : LOST_REASON_LABEL[r]);

/**
 * "Customer history." on a deal from a customer who has been here before:
 * their orders, the margin on them and how late their deposits come
 * (or their other inquiries and why we lost them, before any order).
 */
export async function CustomerHistoryNote({ customerId, dealId }: { customerId: string; dealId: string }) {
  const a = await part("the customer's history with us", () => api.get<CustomerAccount>(`/customers/${customerId}/account`));
  if (isFailed(a)) return <CouldNotLoad compact what={a.what} />;
  if (!a) return null;
  const others = a.rows.filter((r) => r.id !== dealId);
  if (others.length === 0) return null;
  const orders = others.filter((r) => r.order).length;
  const lost = others.filter((r) => !r.order && r.stage === "lost");
  const parts: string[] = [];
  if (orders > 0) {
    parts.push(`${orders} order${orders === 1 ? "" : "s"}`);
    if (a.margin !== null) parts.push(`avg. margin ${a.margin.toFixed(1)}%`);
    // Said of the other inquiries, not of this one (which may have its order: review 24 Nov, S-27).
  } else parts.push(`${others.length} other inquir${others.length === 1 ? "y" : "ies"}, ${others.length === 1 ? "not ordered" : "none ordered"}`);
  if (lost.length) parts.push(`${lost.length} lost (${[...new Set(lost.map((d) => (d.lostReason ? lostReasonLabel(d.lostReason) : "no reason")))].join(", ").toLowerCase()})`);
  if (a.depositDaysLate !== null)
    parts.push(a.depositDaysLate > 0 ? `pays deposits about ${a.depositDaysLate} day${a.depositDaysLate === 1 ? "" : "s"} late` : "pays deposits on time");
  return (
    <Notice tone="neutral">
      <strong>Customer history.</strong>{" "}
      <Link href={`/customers/${customerId}`} className="text-text-2 hover:underline">
        {a.customer.name}
      </Link>
      : {parts.join(", ")}.
    </Notice>
  );
}
