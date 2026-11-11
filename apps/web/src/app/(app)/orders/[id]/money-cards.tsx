import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Badge, cn } from "@kebo/ui";
import { money } from "@/lib/format";
import type { OrderMoney } from "@/lib/types-money";
import { ViewPaymentsLink } from "@/components/money/pay-links";

/**
 * What we owe each factory for this order (their prices plus tax × the
 * quantities ordered), what we paid and what is left. The payments themselves
 * are on Treasury › Payments (View payments); for people who see costs.
 */
export function FactoriesView({ m, pay }: { m: OrderMoney; pay?: React.ReactNode }) {
  const f = m.factories!;
  return (
    <div className="flex flex-col gap-5">
      <section aria-label="What we owe each factory" className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">What we owe</h3>
        {f.rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-4 text-sm text-muted">
            No line on this order was quoted from a factory price, so there is nothing to work out what we owe.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line bg-surface">
            <table data-fit="" className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-surface-2 text-left text-xs text-text-2">
                  <th scope="col" className="px-3 py-2 font-medium">
                    Factory
                  </th>
                  <th scope="col" className="hidden px-3 py-2 font-medium md:table-cell">
                    Looked after by
                  </th>
                  <th scope="col" className="hidden px-3 py-2 text-right font-medium sm:table-cell">
                    Order cost
                  </th>
                  <th scope="col" className="hidden px-3 py-2 text-right font-medium sm:table-cell">
                    Paid
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Left to pay
                  </th>
                  <th scope="col" className="hidden w-44 px-3 py-2 font-medium lg:table-cell">
                    Progress
                  </th>
                </tr>
              </thead>
              <tbody>
                {f.rows.map((r) => {
                  const pct = Number(r.owed) > 0 ? Math.min(100, Math.round((Number(r.paid) / Number(r.owed)) * 100)) : 0;
                  return (
                    <tr key={`${r.factory.id}:${r.currency}`} className="border-t border-line">
                      <td className="px-3 py-2.5 align-top">
                        <Link href={`/factories/${r.factory.id}`} className="-my-1 inline-block py-1 font-medium hover:text-primary">
                          {r.factory.name}
                        </Link>
                        <span className="block text-xs text-muted sm:hidden tabular">
                          {money(r.paid, r.currency)} of {money(r.owed, r.currency)} paid
                        </span>
                        {r.overpaid && (
                          <span className="block text-xs text-warn">
                            Paid {money(r.overpaid, r.currency)} more than its prices add up to.
                          </span>
                        )}
                      </td>
                      <td className={cn("hidden px-3 py-2.5 align-top md:table-cell", r.lookedAfterBy ? "text-text-2" : "text-warn")}>
                        {r.lookedAfterBy?.name ?? "Nobody yet"}
                      </td>
                      <td className="hidden px-3 py-2.5 text-right align-top whitespace-nowrap tabular sm:table-cell">
                        {money(r.owed, r.currency)}
                      </td>
                      <td className="hidden px-3 py-2.5 text-right align-top whitespace-nowrap text-ok tabular sm:table-cell">
                        {money(r.paid, r.currency)}
                      </td>
                      <td className="px-3 py-2.5 text-right align-top whitespace-nowrap tabular">
                        {Number(r.toPay) > 0 ? (
                          <span className="font-semibold text-warn">{money(r.toPay, r.currency)}</span>
                        ) : (
                          <Badge tone="ok">Paid</Badge>
                        )}
                      </td>
                      <td className="hidden px-3 py-2.5 align-top lg:table-cell">
                        <div
                          className="h-2 overflow-hidden rounded-full bg-surface-3"
                          role="progressbar"
                          aria-valuenow={pct}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`${r.factory.name}: ${pct}% paid`}
                        >
                          <div className="h-full rounded-full bg-ok" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-muted">{pct}% paid</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {f.rows.length > 0 && f.rows.every((r) => Number(r.toPay) <= 0) && (
          <p className="flex items-center gap-1.5 text-sm text-ok">
            <CheckCircle2 className="size-4" aria-hidden /> Every factory is paid in full for this order.
          </p>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <ViewPaymentsLink order={m.orderId} />
        {pay}
      </div>
    </div>
  );
}
