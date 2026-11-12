import Link from "next/link";
import { LOST_REASON_LABEL, type LostReason } from "@kebo/shared";
import { Alert, cn } from "@kebo/ui";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import type { CustomerAccount } from "@/lib/types-money";

export const lostReasonLabel = (r: LostReason | "not_said") => (r === "not_said" ? "No reason given" : LOST_REASON_LABEL[r]);

/**
 * "Customer history." on a deal from a customer who has been here before:
 * their orders, the margin on them and how late their deposits come
 * (or their other inquiries and why we lost them, before any order).
 */
export async function CustomerHistoryNote({ customerId, dealId }: { customerId: string; dealId: string }) {
  const a = await api.get<CustomerAccount>(`/customers/${customerId}/account`).catch(() => null);
  if (!a) return null;
  const others = a.rows.filter((r) => r.id !== dealId);
  if (others.length === 0) return null;
  const orders = others.filter((r) => r.order).length;
  const lost = others.filter((r) => !r.order && r.stage === "lost");
  const parts: string[] = [];
  if (orders > 0) {
    parts.push(`${orders} order${orders === 1 ? "" : "s"}`);
    if (a.margin !== null) parts.push(`avg. margin ${a.margin.toFixed(1)}%`);
  } else parts.push(`${others.length} other inquir${others.length === 1 ? "y" : "ies"}, no order yet`);
  if (lost.length) parts.push(`${lost.length} lost (${[...new Set(lost.map((d) => (d.lostReason ? lostReasonLabel(d.lostReason) : "no reason")))].join(", ").toLowerCase()})`);
  if (a.depositDaysLate !== null)
    parts.push(a.depositDaysLate > 0 ? `pays deposits about ${a.depositDaysLate} day${a.depositDaysLate === 1 ? "" : "s"} late` : "pays deposits on time");
  return (
    <Alert tone="neutral">
      <strong>Customer history.</strong>{" "}
      <Link href={`/customers/${customerId}`} className="text-text-2 hover:underline">
        {a.customer.name}
      </Link>
      : {parts.join(", ")}.
    </Alert>
  );
}
