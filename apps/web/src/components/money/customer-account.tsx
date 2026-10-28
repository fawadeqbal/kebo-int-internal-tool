import Link from "next/link";
import { LOST_REASON_LABEL, type LostReason } from "@kebo/shared";
import { cn } from "@kebo/ui";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import type { CustomerAccount } from "@/lib/types-money";

export const lostReasonLabel = (r: LostReason | "not_said") => (r === "not_said" ? "No reason given" : LOST_REASON_LABEL[r]);

/**
 * A short note on a deal from a customer who has been here before: their
 * other deals, why we lost them, what we spent, and what they are worth.
 */
export async function CustomerHistoryNote({ customerId, dealId }: { customerId: string; dealId: string }) {
  const a = await api.get<CustomerAccount>(`/customers/${customerId}/account`).catch(() => null);
  if (!a) return null;
  const others = a.rows.filter((r) => r.id !== dealId);
  if (others.length === 0 && Number(a.totals.otherCosts) === 0) return null;
  const won = others.filter((r) => r.order).length;
  const lost = others.filter((r) => !r.order && r.stage === "lost");
  const c = a.currency;
  const net = Number(a.totals.net);
  return (
    <aside
      aria-label="This customer's history"
      className={cn("mb-4 rounded-xl border px-4 py-3 text-sm", net < 0 ? "border-bad/30 bg-bad-soft/40" : "border-info/30 bg-info-soft/40")}
    >
      <p className="font-medium">
        {a.customer.name} has been here before: {others.length} other deal{others.length === 1 ? "" : "s"} · {won} won · {lost.length} lost
        {a.winRate !== null && ` · ${a.winRate}% won`}
      </p>
      <p className="mt-0.5 text-text-2">
        Spent on them so far {money(a.totals.spent, c)}
        {Number(a.totals.lostDeals) > 0 && <>, of it {money(a.totals.lostDeals, c)} on deals we lost</>}. Net result{" "}
        <span className={cn("font-medium tabular", net < 0 ? "text-bad" : "text-ok")}>{money(a.totals.net, c)}</span>.
      </p>
      {lost.length > 0 && (
        <p className="mt-0.5 text-xs text-muted">
          Lost before: {lost.map((d) => `${d.refNo} (${d.lostReason ? lostReasonLabel(d.lostReason) : "no reason"})`).join(", ")}
        </p>
      )}
      <Link href={`/customers/${customerId}`} className="mt-1 inline-block text-xs text-primary hover:underline">
        Open their account
      </Link>
    </aside>
  );
}
