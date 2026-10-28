import Link from "next/link";
import { AlertTriangle, CheckCircle2, OctagonAlert } from "lucide-react";
import { Card, CardBody, CardHeader, cn, LinkTabs, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { money } from "@/lib/format";
import type { LeakCustomer, LeakGroup, LeaksReport } from "@/lib/types-money";

export type LeakView = "attention" | "deals" | "orders" | "customers" | "spending";
export const LEAK_VIEWS: readonly LeakView[] = ["attention", "deals", "orders", "customers", "spending"];

const MONTH = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" });

function Figure({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: "bad" | "ok" | "warn" }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3 sm:p-4">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={cn("mt-1 truncate text-lg font-semibold tabular xl:text-xl", tone === "bad" && "text-bad", tone === "ok" && "text-ok", tone === "warn" && "text-warn")} title={value}>
        {value}
      </p>
      <p className="mt-0.5 text-xs text-muted">{hint}</p>
    </div>
  );
}

function Bar({ share, tone = "primary" }: { share: number; tone?: "primary" | "bad" | "warn" }) {
  return (
    <span className="mt-1 block h-1.5 rounded-full bg-surface-2" aria-hidden>
      <span className={cn("block h-1.5 rounded-full", tone === "bad" ? "bg-bad" : tone === "warn" ? "bg-warn" : "bg-primary")} style={{ width: `${Math.max(Math.min(share, 100), 1)}%` }} />
    </span>
  );
}

function GroupTable({ title, description, rows, c }: { title: string; description: string; rows: LeakGroup[]; c: string }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader title={title} description={description} />
      {rows.length === 0 ? (
        <CardBody>
          <p className="text-sm text-muted">No inquiry was won or lost in this period.</p>
        </CardBody>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <THead>
              <tr>
                <Th />
                <Th className="text-right">Won</Th>
                <Th className="text-right">Lost</Th>
                <Th className="text-right">Win rate</Th>
                <Th className="text-right">Selling cost</Th>
                <Th className="text-right">Per order won</Th>
              </tr>
            </THead>
            <tbody>
              {rows.map((g) => (
                <Tr key={g.key}>
                  <Td className="max-w-40 truncate font-medium">{g.key}</Td>
                  <Td className="text-right tabular">{g.won}</Td>
                  <Td className="text-right tabular">{g.lost}</Td>
                  <Td className={cn("text-right tabular", g.winRate !== null && g.winRate < 30 && "text-bad")}>{g.winRate === null ? "—" : `${g.winRate}%`}</Td>
                  <Td className="text-right whitespace-nowrap tabular">{money(g.spent, c)}</Td>
                  <Td className="text-right whitespace-nowrap tabular">{g.costPerWin === null ? <span className="text-muted">—</span> : money(g.costPerWin, c)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </Card>
  );
}

function CustomerList({ title, description, rows, c, empty }: { title: string; description: string; rows: LeakCustomer[]; c: string; empty: string }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      {rows.length === 0 ? (
        <CardBody>
          <p className="text-sm text-muted">{empty}</p>
        </CardBody>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {rows.map((x) => (
            <li key={x.customer.id}>
              <Link href={`/customers/${x.customer.id}`} className="flex items-baseline justify-between gap-3 px-4 py-2.5 text-sm hover:bg-surface-2/60">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{x.customer.name}</span>
                  <span className="text-xs text-muted">
                    Sales {money(x.sales, c)} · profit {money(x.profit, c)} · spent {money(x.spent, c)}
                  </span>
                </span>
                <span className={cn("shrink-0 font-semibold tabular", Number(x.net) < 0 ? "text-bad" : "text-ok")}>{money(x.net, c)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * Where we lose money (managers): the summary, then what needs attention, the
 * deals we lose, profit planned against kept, customers, and spending and cash.
 * Shown on Insights → Profit.
 */
export function LeaksBody({ r, view, href }: { r: LeaksReport; view: LeakView; href: (v: LeakView) => string }) {
  const c = r.currency;
  const s = r.summary;
  const maxReason = Math.max(1, ...r.lostReasons.map((x) => x.deals));
  const maxTrend = Math.max(1, ...r.trend.map((t) => Math.max(Number(t.sales), Number(t.expenses))));
  return (
    <div>
      <section aria-label="Summary" className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Figure label="Inquiries lost" value={String(s.lostDeals)} hint={`${money(s.lostSpent, c)} spent on them`} tone={s.lostDeals ? "bad" : undefined} />
        <Figure label="Win rate" value={s.winRate === null ? "—" : `${s.winRate}%`} hint="Won ÷ (won + lost)" />
        <Figure label="Profit planned" value={money(s.planned, c)} hint="Orders placed: value less goods" />
        <Figure
          label="Profit kept"
          value={money(s.actual, c)}
          hint={s.keptPercent === null ? "After every cost" : `${s.keptPercent}% kept · ${money(s.leaked, c)} went on costs`}
          tone={Number(s.actual) < 0 ? "bad" : s.keptPercent !== null && s.keptPercent < 75 ? "warn" : "ok"}
        />
        <Figure label="Stuck with factories" value={money(s.stuck, c)} hint="Paid to them before the customer paid us" tone={Number(s.stuck) > 0 ? "warn" : undefined} />
      </section>

      <LinkTabs
        label="Report sections"
        className="mb-5"
        tabs={[
          { href: href("attention"), label: "Needs attention", count: r.warnings.length || undefined, alert: r.warnings.some((w) => w.level === "bad"), active: view === "attention" },
          { href: href("deals"), label: "Inquiries we lose", active: view === "deals" },
          { href: href("orders"), label: "Profit kept", active: view === "orders" },
          { href: href("customers"), label: "Customers", active: view === "customers" },
          { href: href("spending"), label: "Spending and cash", active: view === "spending" },
        ]}
      />
      {view === "attention" && (
        <>
      <Card className="mb-5">
        <CardHeader title="Needs attention" description="Raised when an inquiry, an order or a customer crosses a line" />
        {r.warnings.length === 0 ? (
          <CardBody>
            <p className="flex items-center gap-2 text-sm text-ok">
              <CheckCircle2 className="size-4" aria-hidden /> Nothing needs attention.
            </p>
          </CardBody>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {r.warnings.map((w, i) => {
              const Icon = w.level === "bad" ? OctagonAlert : AlertTriangle;
              const body = (
                <span className="flex items-start gap-2.5 px-4 py-2.5 text-sm">
                  <Icon className={cn("mt-0.5 size-4 shrink-0", w.level === "bad" ? "text-bad" : "text-warn")} aria-hidden />
                  <span className="min-w-0 flex-1">{w.text}</span>
                  {w.href && <span className="shrink-0 text-xs text-primary">Open</span>}
                </span>
              );
              return <li key={i}>{w.href ? <Link href={w.href} className="block hover:bg-surface-2/60">{body}</Link> : body}</li>;
            })}
          </ul>
        )}
      </Card>

        </>
      )}
      {view === "deals" && (
        <>
      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Why we lose inquiries" description="Inquiries lost in the period and what we had spent on them" />
          {r.lostReasons.length === 0 ? (
            <CardBody>
              <p className="text-sm text-muted">No inquiry lost in this period.</p>
            </CardBody>
          ) : (
            <ul className="flex flex-col gap-3 p-4">
              {r.lostReasons.map((x) => (
                <li key={x.reason} className="text-sm">
                  <span className="flex justify-between gap-3">
                    <span>
                      <span className="font-medium">{x.label}</span> <span className="text-xs text-muted">{x.deals} {x.deals === 1 ? "inquiry" : "inquiries"}</span>
                    </span>
                    <span className="tabular">{money(x.spent, c)} spent</span>
                  </span>
                  <Bar share={(x.deals / maxReason) * 100} tone="bad" />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Lost inquiries that cost the most" description="Trips, samples and visits spent on inquiries we did not win" />
          {r.lostDeals.filter((d) => Number(d.spent) > 0).length === 0 ? (
            <CardBody>
              <p className="text-sm text-muted">Nothing was spent on the inquiries lost in this period.</p>
            </CardBody>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {r.lostDeals
                .filter((d) => Number(d.spent) > 0)
                .map((d) => (
                  <li key={d.id}>
                    <Link href={`/inquiries/${d.id}`} className="flex items-baseline justify-between gap-3 px-4 py-2.5 text-sm hover:bg-surface-2/60">
                      <span className="min-w-0">
                        <span className="font-medium">{d.refNo}</span> <span className="text-text-2">{d.customer.name}</span>
                        <span className="block truncate text-xs text-muted">
                          {d.title} · {r.lostReasons.find((x) => x.reason === (d.reason ?? "not_said"))?.label} · {d.assignee}
                        </span>
                      </span>
                      <span className="shrink-0 font-medium text-bad tabular">{money(d.spent, c)}</span>
                    </Link>
                  </li>
                ))}
            </ul>
          )}
        </Card>
      </div>

        </>
      )}

      {view === "orders" && (
        <>
      <Card className="mb-5 overflow-hidden">
        <CardHeader title="Profit planned against profit kept" description="Orders placed in the period, the biggest leak first: what the quote promised and what costs took after it" />
        {r.orders.length === 0 ? (
          <CardBody>
            <p className="text-sm text-muted">No order placed in this period.</p>
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <tr>
                  <Th>Order</Th>
                  <Th className="text-right">Planned</Th>
                  <Th className="text-right">Order costs</Th>
                  <Th className="text-right">Before the sale</Th>
                  <Th className="text-right">Paid factories extra</Th>
                  <Th className="text-right">Kept</Th>
                </tr>
              </THead>
              <tbody>
                {r.orders.map((o) => {
                  const kept = Number(o.planned) > 0 ? Math.round((Number(o.actual) / Number(o.planned)) * 100) : null;
                  return (
                    <Tr key={o.id} className="hover:bg-surface-2/50">
                      <Td>
                        <Link href={`/orders/${o.id}/money`} className="font-medium hover:text-primary">
                          {o.refNo}
                        </Link>
                        <span className="block max-w-48 truncate text-xs text-muted">
                          {o.customer.name}
                          {o.uncosted && " · some lines without a factory cost"}
                        </span>
                      </Td>
                      <Td className="text-right whitespace-nowrap tabular">{money(o.planned, c)}</Td>
                      <Td className="text-right whitespace-nowrap tabular">{Number(o.orderCosts) ? `− ${money(o.orderCosts, c)}` : <span className="text-muted">—</span>}</Td>
                      <Td className="text-right whitespace-nowrap tabular">{Number(o.beforeSale) ? `− ${money(o.beforeSale, c)}` : <span className="text-muted">—</span>}</Td>
                      <Td className="text-right whitespace-nowrap tabular">{Number(o.factoryExtra) ? `− ${money(o.factoryExtra, c)}` : <span className="text-muted">—</span>}</Td>
                      <Td className={cn("text-right font-semibold whitespace-nowrap tabular", Number(o.actual) < 0 ? "text-bad" : kept !== null && kept < 75 ? "text-warn" : "")}>
                        {money(o.actual, c)}
                        {kept !== null && <span className="block text-xs font-normal text-muted">{kept}% kept</span>}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        )}
      </Card>

        </>
      )}

      {view === "customers" && (
        <>
      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <CustomerList title="Customers who earn us most" description="Profit from their orders less what was spent on them" rows={r.customers.best} c={c} empty="No customer earned us money in this period yet." />
        <CustomerList title="Customers who cost more than they earn" description="Spent on them more than their orders brought" rows={r.customers.costing} c={c} empty="None: every customer we spent on earned it back." />
      </div>

        </>
      )}

      {view === "deals" && (
        <>
      <div className="mb-5 grid gap-5 xl:grid-cols-2">
        <GroupTable title="By person" description="Inquiries they won and lost, and what was spent to win them" rows={r.byPerson} c={c} />
        <GroupTable title="By product category" description="Where we win, and what winning costs" rows={r.byCategory} c={c} />
      </div>

        </>
      )}

      {view === "spending" && (
        <>
      <Card className="mb-5">
        <CardHeader title="Expenses against sales" description="Month by month to the end of the period: orders placed and everything spent" />
        <ul className="flex flex-col gap-2.5 p-4">
          {r.trend.map((t) => (
            <li key={t.month} className="grid grid-cols-[3rem_1fr_auto] items-center gap-3 text-sm">
              <span className="text-muted">{MONTH.format(new Date(`${t.month}-01T00:00:00Z`))}</span>
              <span className="flex flex-col gap-1" aria-hidden>
                <span className="block h-2 rounded-full bg-ok/70" style={{ width: `${Math.max((Number(t.sales) / maxTrend) * 100, 0.5)}%` }} />
                <span className="block h-2 rounded-full bg-warn" style={{ width: `${Math.max((Number(t.expenses) / maxTrend) * 100, 0.5)}%` }} />
              </span>
              <span className="text-right text-xs tabular">
                {money(t.sales, c)}
                <span className="block text-muted">
                  − {money(t.expenses, c)}
                  {t.percent !== null && ` · ${t.percent}%`}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <p className="flex gap-4 px-4 pb-3 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-ok/70" aria-hidden /> Sales
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-warn" aria-hidden /> Expenses
          </span>
        </p>
      </Card>

        </>
      )}

      {(view === "orders" || view === "spending") && (
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Money stuck with factories" description="Open orders where we paid the factory more than the customer has paid us" />
          {r.stuck.length === 0 ? (
            <CardBody>
              <p className="text-sm text-muted">None: customers have paid ahead of the factories.</p>
            </CardBody>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {r.stuck.map((x) => (
                <li key={x.id}>
                  <Link href={`/orders/${x.id}/money`} className="flex items-baseline justify-between gap-3 px-4 py-2.5 text-sm hover:bg-surface-2/60">
                    <span className="min-w-0">
                      <span className="font-medium">{x.refNo}</span> <span className="text-text-2">{x.customer.name}</span>
                      <span className="block text-xs text-muted">Since {x.days} day{x.days === 1 ? "" : "s"}</span>
                    </span>
                    <span className={cn("shrink-0 font-medium tabular", x.days >= 30 && "text-warn")}>{money(x.amount, x.currency)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Visits and costs at factories" description="Expenses that name a factory: trips to check products, inspections there" />
          {r.factories.length === 0 ? (
            <CardBody>
              <p className="text-sm text-muted">No expense names a factory in this period.</p>
            </CardBody>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {r.factories.map((f) => (
                <li key={f.factory.id}>
                  <Link href={`/factories/${f.factory.id}`} className="flex items-baseline justify-between gap-3 px-4 py-2.5 text-sm hover:bg-surface-2/60">
                    <span>
                      <span className="font-medium">{f.factory.name}</span> <span className="text-xs text-muted">{f.count} expense{f.count === 1 ? "" : "s"}</span>
                    </span>
                    <span className="tabular">{money(f.spent, c)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      )}
    </div>
  );
}
