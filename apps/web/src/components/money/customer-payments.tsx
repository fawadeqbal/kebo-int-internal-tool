import Link from "next/link";
import { Paperclip } from "lucide-react";
import { PAYMENT_KIND_LABEL, PAYMENT_METHOD_LABEL } from "@kebo/shared";
import { Badge, cn, EmptyState } from "@kebo/ui";
import { api } from "@/lib/api";
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
 * A customer's payments, in the order page's layout: what they ordered, paid
 * and still owe (per currency), each order with its numbers, then every
 * payment they made. Each order opens on its Payments tab, where payments
 * are recorded and changed.
 */
export async function CustomerPaymentsView({ customerId }: { customerId: string }) {
  const d = await api.get<CustomerPayments>("/payments", { customerId });
  if (d.orders.length === 0)
    return <EmptyState title="No orders yet" description="Payments show here once this customer has an order." className="py-10" />;
  const one = d.totals.length === 1 ? d.totals[0]! : null;

  return (
    <div className="flex flex-col gap-5">
      {d.totals.map((t) => {
        const pct = Number(t.total) > 0 ? Math.min(100, Math.round((Number(t.received) / Number(t.total)) * 100)) : 0;
        const due = Number(t.due) > 0.005;
        return (
          <section
            key={t.currency}
            aria-label={`Money in ${t.currency}`}
            className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4 sm:p-5"
          >
            <dl className="grid grid-cols-3 gap-3 sm:flex sm:gap-10">
              <div className="min-w-0">
                <dt className="truncate text-xs text-muted">
                  Ordered · {t.orders} order{t.orders === 1 ? "" : "s"}
                </dt>
                <dd className="truncate text-base font-bold tabular sm:text-xl">{money(t.total, t.currency)}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-muted">Received</dt>
                <dd className="truncate text-base font-bold text-ok tabular sm:text-xl">{money(t.received, t.currency)}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-muted">Still due</dt>
                <dd className={cn("truncate text-base font-bold tabular sm:text-xl", due ? "text-warn" : "text-ok")}>
                  {money(t.due, t.currency)}
                </dd>
              </div>
            </dl>
            <div className="flex flex-col gap-1.5">
              <div
                className="h-2.5 overflow-hidden rounded-full bg-surface-3"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
                aria-label={`${pct}% received`}
              >
                <div className="h-full rounded-full bg-ok" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-xs text-muted">
                {pct}% of their orders received{d.orders.some((o) => o.status === "cancelled") ? " · cancelled orders not counted" : ""}
              </p>
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
                      <Link href={`/orders/${o.id}/money`} className="font-medium hover:text-primary">
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

      <section aria-label="Payments received" className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">
          Payments received <span className="font-normal text-muted">· newest first; bank charges the banks kept count as paid</span>
        </h2>
        {d.payments.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-4 text-sm text-muted">No payments from them yet.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line bg-surface">
            <table data-fit="" className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-surface-2 text-left text-xs text-text-2">
                  <th scope="col" className={th}>
                    Date
                  </th>
                  <th scope="col" className={th}>
                    Order
                  </th>
                  <th scope="col" className={cn(th, "hidden sm:table-cell")}>
                    For
                  </th>
                  <th scope="col" className={cn(th, "hidden md:table-cell")}>
                    Method · reference
                  </th>
                  <th scope="col" className={cn(th, "text-right")}>
                    Amount
                  </th>
                  <th scope="col" className={cn(th, "hidden text-right sm:table-cell")}>
                    Bank charges
                  </th>
                  <th scope="col" className={cn(th, "hidden w-16 sm:table-cell")}>
                    Proof
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.payments.map((p) => (
                  <tr key={p.id} className={cn("border-t border-line", p.voided && "text-muted [&_td]:line-through")}>
                    <td className={cn(td, "whitespace-nowrap")}>{date(p.paidOn)}</td>
                    <td className={td}>
                      <Link href={`/orders/${p.order.id}/money`} className="hover:text-primary">
                        {p.order.refNo}
                      </Link>
                      <span className="block text-xs text-muted sm:hidden">{PAYMENT_KIND_LABEL[p.kind]}</span>
                    </td>
                    <td className={cn(td, "hidden sm:table-cell")}>
                      {PAYMENT_KIND_LABEL[p.kind]} {p.voided && <Badge tone="bad">Removed</Badge>}
                    </td>
                    <td className={cn(td, "hidden text-text-2 md:table-cell")}>
                      {PAYMENT_METHOD_LABEL[p.method]}
                      {p.reference && ` · ${p.reference}`}
                    </td>
                    <td className={cn(td, "text-right font-semibold whitespace-nowrap tabular")}>{money(p.amount, p.currency)}</td>
                    <td
                      className={cn(
                        td,
                        "hidden text-right whitespace-nowrap tabular sm:table-cell",
                        Number(p.bankCharges) > 0 ? "text-text-2" : "text-muted",
                      )}
                    >
                      {Number(p.bankCharges) > 0 ? money(p.bankCharges, p.currency) : "—"}
                    </td>
                    <td className={cn(td, "hidden sm:table-cell")}>
                      {p.hasFile ? (
                        <Paperclip className="size-4 text-text-2" aria-label="Bank slip kept" />
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
