import Link from "next/link";
import { Badge, cn, EmptyState } from "@kebo/ui";
import { date, money } from "@/lib/format";
import type { CustomerPayments } from "@/lib/types-money";

const PAY_STATUS: Record<CustomerPayments["orders"][number]["payStatus"], { label: string; tone: "neutral" | "warn" | "info" | "ok" }> = {
  unpaid: { label: "Nothing received", tone: "warn" },
  partly_paid: { label: "Part-paid", tone: "warn" },
  deposit_paid: { label: "Deposit received", tone: "info" },
  paid: { label: "Paid in full", tone: "ok" },
  overpaid: { label: "Overpaid", tone: "warn" },
};

const th = "px-3 py-2 font-medium whitespace-nowrap";
const td = "px-3 py-2.5 align-top";

/**
 * A customer's money, in the order page's layout: what they ordered, paid
 * and still owe (per currency) and each order with its numbers. The payments
 * themselves are on Treasury › Payments (View payments).
 */
export function CustomerPaymentsBody({ d }: { d: CustomerPayments }) {
  if (d.orders.length === 0)
    return <EmptyState title="No orders yet" description="Payments show here once this customer has an order." className="py-10" />;
  const one = d.totals.length === 1 ? d.totals[0]! : null;

  return (
    <div className="flex flex-col gap-5">
      {d.totals.map((t) => {
        const pct = Number(t.total) > 0 ? Math.min(100, Math.round((Number(t.received) / Number(t.total)) * 100)) : 0;
        const due = Number(t.due) > 0.005;
        const owing = d.orders.filter((o) => o.currency === t.currency && o.status !== "cancelled" && Number(o.due) > 0.005).length;
        return (
          <section key={t.currency} aria-label={`Money in ${t.currency}`} className="grid gap-3 sm:grid-cols-3">
            <div className="min-w-0 rounded-xl border border-line bg-surface p-4">
              <p className="truncate text-xs text-muted">
                Ordered · {t.orders} order{t.orders === 1 ? "" : "s"}
              </p>
              <p className="truncate text-xl font-bold tabular">{money(t.total, t.currency)}</p>
            </div>
            <div className="min-w-0 rounded-xl border border-line bg-surface p-4">
              <p className="text-xs text-muted">Received</p>
              <p className="truncate text-xl font-bold text-ok tabular">{money(t.received, t.currency)}</p>
              <div
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
                aria-label={`${pct}% received`}
              >
                <div className="h-full rounded-full bg-ok" style={{ width: `${pct}%` }} />
              </div>
            </div>
            <div className="min-w-0 rounded-xl border border-line bg-surface p-4">
              <p className="text-xs text-muted">Still due</p>
              <p className={cn("truncate text-xl font-bold tabular", due ? "text-warn" : "text-ok")}>{money(t.due, t.currency)}</p>
              <p className="text-xs text-text-2">{due ? `on ${owing} order${owing === 1 ? "" : "s"}` : "nothing owed"}</p>
            </div>
          </section>
        );
      })}

      <section aria-label="By order" className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">
          By order <span className="font-normal text-muted">· open one to record or change its payments</span>
        </h2>
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          <table data-fit="" className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-surface-2 text-left text-xs text-text-2">
                <th scope="col" className={th}>
                  Order
                </th>
                <th scope="col" className={cn(th, "hidden md:table-cell")}>
                  Ordered
                </th>
                <th scope="col" className={cn(th, "hidden sm:table-cell")}>
                  Status
                </th>
                <th scope="col" className={cn(th, "hidden text-right sm:table-cell")}>
                  Total
                </th>
                <th scope="col" className={cn(th, "hidden text-right sm:table-cell")}>
                  Received
                </th>
                <th scope="col" className={cn(th, "text-right")}>
                  Still due
                </th>
                <th scope="col" className={cn(th, "hidden w-36 lg:table-cell")}>
                  Paid
                </th>
              </tr>
            </thead>
            <tbody>
              {d.orders.map((o) => {
                const st = PAY_STATUS[o.payStatus];
                const cancelled = o.status === "cancelled";
                const pct = Number(o.total) > 0 ? Math.min(100, Math.round((Number(o.received) / Number(o.total)) * 100)) : 0;
                return (
                  <tr key={o.id} className={cn("border-t border-line", cancelled && "text-muted")}>
                    <td className={td}>
                      <Link href={`/orders/${o.id}/payment`} className="-my-1 inline-block py-1 font-medium hover:text-primary">
                        {o.refNo}
                      </Link>
                      <span className="block sm:hidden">
                        <Badge tone={cancelled ? "neutral" : st.tone}>{cancelled ? "Cancelled" : st.label}</Badge>
                      </span>
                    </td>
                    <td className={cn(td, "hidden whitespace-nowrap text-text-2 md:table-cell")}>{date(o.orderedOn)}</td>
                    <td className={cn(td, "hidden sm:table-cell")}>
                      <Badge tone={cancelled ? "neutral" : st.tone} dot>
                        {cancelled ? "Cancelled" : st.label}
                      </Badge>
                      {o.lastPaidOn && <span className="block text-xs text-muted">last paid {date(o.lastPaidOn)}</span>}
                    </td>
                    <td className={cn(td, "hidden text-right whitespace-nowrap tabular sm:table-cell")}>{money(o.total, o.currency)}</td>
                    <td
                      className={cn(
                        td,
                        "hidden text-right whitespace-nowrap tabular sm:table-cell",
                        Number(o.received) > 0 ? "text-ok" : "text-muted",
                      )}
                    >
                      {money(o.received, o.currency)}
                    </td>
                    <td
                      className={cn(
                        td,
                        "text-right whitespace-nowrap tabular",
                        !cancelled && Number(o.due) > 0.005 ? "font-semibold text-warn" : "",
                      )}
                    >
                      {cancelled ? "—" : money(o.due, o.currency)}
                    </td>
                    <td className={cn(td, "hidden lg:table-cell")}>
                      <div className="h-2 overflow-hidden rounded-full bg-surface-3" aria-hidden>
                        <div className="h-full rounded-full bg-ok" style={{ width: `${cancelled ? 0 : pct}%` }} />
                      </div>
                      <span className="text-xs text-muted">{cancelled ? "cancelled" : `${pct}%`}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {one && d.orders.length > 1 && (
              <tfoot>
                <tr className="border-t border-line bg-surface-2 font-semibold">
                  <td className={td}>Total</td>
                  <td className={cn(td, "hidden md:table-cell")} />
                  <td className={cn(td, "hidden sm:table-cell")} />
                  <td className={cn(td, "hidden text-right whitespace-nowrap tabular sm:table-cell")}>{money(one.total, one.currency)}</td>
                  <td className={cn(td, "hidden text-right whitespace-nowrap tabular sm:table-cell")}>
                    {money(one.received, one.currency)}
                  </td>
                  <td className={cn(td, "text-right whitespace-nowrap tabular")}>{money(one.due, one.currency)}</td>
                  <td className={cn(td, "hidden lg:table-cell")} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>
    </div>
  );
}
