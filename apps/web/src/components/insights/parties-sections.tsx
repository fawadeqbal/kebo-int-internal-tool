import Link from "next/link";
import { CHANNEL_LABEL, type InquiryChannel } from "@kebo/shared";
import { Card, CardHeader, DataRow, FilterChip, Meter, Pager, Table, Td, Th, THead, Tr, cn } from "@kebo/ui";
import { DataTable } from "@/components/common/data-table";
import { countryName } from "@/lib/countries";
import { money } from "@/lib/format";
import { amountCell, bigMoney, change, compactMoney, percent, type Period } from "@/lib/insights-period";
import { CUSTOMER_CHIP_LABEL, CUSTOMER_CHIPS, type CustomerChip, type loadCustomers, type loadFactories, type loadFunnel, type loadPeople } from "@/lib/insights-data";
import { BarList, Delta, Spark, Tile, Tiles } from "./frame";

type Href = (patch: Record<string, string | undefined>) => string;
const plural = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

/* ------------------------------------------------------------------------------------------- Customers */

export function CustomersSection({
  d,
  p,
  href,
  chip,
  page,
  params,
}: {
  d: Awaited<ReturnType<typeof loadCustomers>>;
  p: Period;
  href: Href;
  chip: CustomerChip;
  page: number;
  /** The page's other parameters, kept by the pager. */
  params: Record<string, string | undefined>;
}) {
  const c = d.currency;
  const vs = p.vsLabel;
  const rows = d.rows.filter((r) => r.kinds.has(chip));
  const size = 25;
  const shown = rows.slice((page - 1) * size, page * size);
  return (
    <div className="flex flex-col gap-4">
      <Tiles>
        <Tile
          label="Customers who ordered"
          value={String(d.ordered.now)}
          delta={<Delta value={change(d.ordered.now, d.ordered.before)} vs={vs} />}
          sub={`of ${d.total} · ${d.ordered.new} new`}
        />
        <Tile
          label="Repeat share"
          value={percent(d.repeat.now)}
          delta={<Delta value={d.repeat.now !== null && d.repeat.before !== null ? Math.round((d.repeat.now - d.repeat.before) * 10) / 10 : null} points vs={vs} />}
          sub="of orders from returning customers"
        />
        <Tile
          label="Average order"
          value={bigMoney(d.average.now, c)}
          delta={<Delta value={d.average.now !== null && d.average.before !== null ? change(d.average.now, d.average.before) : null} vs={vs} />}
          sub={plural(d.average.orders, "order")}
        />
        <Tile label="Sleeping" value={String(d.sleeping.count)} sub={`no order in 6 months · ${compactMoney(d.sleeping.sales, c)} before`} href={href({ chip: "sleeping", page: undefined })} />
      </Tiles>

      <Card>
        <CardHeader
          title={`Customers · ${p.name}`}
          description="sorted by sales · click a customer for their page"
          actions={
            <nav aria-label="Which customers" className="flex flex-wrap gap-1.5">
              {CUSTOMER_CHIPS.map((k) => (
                <FilterChip key={k} pill href={href({ chip: k === "all" ? undefined : k, page: undefined })} active={chip === k} count={d.counts[k]}>
                  {CUSTOMER_CHIP_LABEL[k]}
                </FilterChip>
              ))}
            </nav>
          }
        />
        {shown.length === 0 ? (
          <p className="p-4 text-sm text-muted">No customer here {chip === "all" ? "yet: customers appear once they order" : `in ${CUSTOMER_CHIP_LABEL[chip].toLowerCase()}`}.</p>
        ) : (
          <DataTable label="Customers">
            <THead>
              <tr>
                <Th>Customer</Th>
                <Th className="text-right">Orders</Th>
                <Th className="text-right">Sales {c}</Th>
                <Th className="text-right">Margin</Th>
                <Th className="text-right">Paid on time</Th>
                <Th className="text-right">Still owed</Th>
                <Th className="text-right">Overdue</Th>
                <Th>6 months</Th>
              </tr>
            </THead>
            <tbody>
              {shown.map((r) => (
                <DataRow key={r.id} href={`/customers/${r.id}`}>
                  <Td>
                    <Link href={`/customers/${r.id}`} className="font-semibold group-hover:text-primary">
                      {r.name}
                    </Link>
                    {r.country && <span className="block text-xs text-muted">{countryName(r.country)}</span>}
                  </Td>
                  <Td className="text-right tabular">{r.orders}</Td>
                  <Td className="text-right tabular">{amountCell(r.sales)}</Td>
                  <Td className="text-right tabular">{percent(r.margin)}</Td>
                  <Td className="text-right tabular">{percent(r.paidOnTime)}</Td>
                  <Td className="text-right tabular">{amountCell(r.owed)}</Td>
                  <Td className={cn("relative text-right tabular", r.overdue > 0 && "font-semibold text-bad")}>
                    {r.overdue > 0 ? (
                      <>
                        {amountCell(r.overdue)}
                        <span className="sr-only"> overdue</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td>
                    <Spark values={r.spark} label={`Sales over 6 months: ${r.spark.map((v) => compactMoney(v, c)).join(", ")}`} />
                  </Td>
                </DataRow>
              ))}
            </tbody>
          </DataTable>
        )}
        <div className="px-4 pb-3 empty:hidden [&>*]:mt-3">
          <Pager base="/insights" params={params} page={page} pageSize={size} total={rows.length} />
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------- Factories */

export function FactoriesSection({ d, p, page, params }: { d: Awaited<ReturnType<typeof loadFactories>>; p: Period; page: number; params: Record<string, string | undefined> }) {
  const c = d.currency;
  const size = 25;
  const shown = d.rows.slice((page - 1) * size, page * size);
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title={`Factories · ${p.name}`}
          description={`click a factory for its page${d.shipped?.withDate ? ` · orders shipped on time: ${percent(d.shipped.percent)} (${d.shipped.onTime} of ${d.shipped.withDate})` : ""}`}
        />
        {d.rows.length === 0 ? (
          <p className="p-4 text-sm text-muted">No factory ordered from or asked for prices {p.name}.</p>
        ) : (
          <DataTable label="Factories">
            <THead>
              <tr>
                <Th>Factory</Th>
                <Th className="text-right">Orders</Th>
                {d.seeMoney && <Th className="text-right">Spend {c}</Th>}
                <Th className="text-right">Ready on time</Th>
                <Th className="text-right">Avg days late</Th>
                <Th className="text-right">Offers won</Th>
                {d.seeMoney && <Th className="text-right">To pay {c}</Th>}
                <Th className="text-right">Claims</Th>
              </tr>
            </THead>
            <tbody>
              {shown.map((r) => {
                const late = r.ready.percent !== null && r.ready.percent < 80;
                return (
                  <DataRow key={r.id} href={`/factories/${r.id}`}>
                    <Td>
                      <Link href={`/factories/${r.id}`} className="font-semibold group-hover:text-primary">
                        {r.name}
                      </Link>
                    </Td>
                    <Td className="text-right tabular">{r.orders}</Td>
                    {d.seeMoney && <Td className="text-right tabular">{amountCell(r.spend)}</Td>}
                    <Td className={cn("relative text-right tabular", late && "font-semibold text-warn")}>
                      {percent(r.ready.percent)}
                      {late && <span className="sr-only"> (often late)</span>}
                    </Td>
                    <Td className="text-right tabular">{r.daysLate === null ? "—" : r.daysLate}</Td>
                    <Td className="text-right tabular">{r.offersSent ? `${r.offersWon} of ${r.offersSent}` : "—"}</Td>
                    {d.seeMoney && <Td className="text-right tabular">{amountCell(r.toPay)}</Td>}
                    <Td className="text-right tabular">{r.claims}</Td>
                  </DataRow>
                );
              })}
            </tbody>
          </DataTable>
        )}
        <div className="px-4 pb-3 empty:hidden [&>*]:mt-3">
          <Pager base="/insights" params={params} page={page} pageSize={size} total={d.rows.length} />
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------- People */

export function PeopleSection({ d, p, canSet, href }: { d: Awaited<ReturnType<typeof loadPeople>>; p: Period; canSet: boolean; href: Href }) {
  const c = d.currency;
  return (
    <div className="flex flex-col gap-4">
      {d.company && (
        <Card>
          <div className="p-4">
            <Meter
              label="The company's target this month"
              figure={`${money(d.company.sold, c)} of ${money(d.company.amount, c)}`}
              percent={d.company.percent ?? 0}
              tone={(d.company.percent ?? 0) >= 100 ? "ok" : undefined}
              hint={(d.company.percent ?? 0) >= 100 ? "Reached" : `${d.company.percent ?? 0}% so far`}
            />
          </div>
        </Card>
      )}
      <Card>
        <CardHeader
          title={`People · ${p.name}`}
          description="the inquiries each person handles, how fast they quote and win, and what they sold"
          actions={
            canSet ? (
              <Link href={href({ view: "targets" })} className="text-sm font-medium text-text-2 hover:text-text">
                Set targets
              </Link>
            ) : undefined
          }
        />
        {d.rows.length === 0 ? (
          <p className="p-4 text-sm text-muted">Nobody handled an inquiry {p.name}.</p>
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Person</Th>
                <Th className="text-right">Inquiries</Th>
                <Th className="text-right">Days to first quote</Th>
                <Th className="text-right">Win rate</Th>
                <Th className="text-right">Sales {c}</Th>
                <Th className="min-w-40">Target this month</Th>
                <Th className="text-right">Profit {c}</Th>
              </tr>
            </THead>
            <tbody>
              {d.rows.map((r) => (
                <Tr key={r.id}>
                  <Td className="font-semibold">
                    {r.id === "nobody" ? (
                      <span className="font-normal text-muted">Nobody</span>
                    ) : (
                      <Link href={`/users/${r.id}`} className="hover:text-primary">
                        {r.name}
                      </Link>
                    )}
                  </Td>
                  <Td className="text-right tabular">{r.inquiries}</Td>
                  <Td className="text-right tabular">{r.daysToQuote === null ? "—" : r.daysToQuote}</Td>
                  <Td className="text-right tabular">{percent(r.winRate)}</Td>
                  <Td className="text-right tabular">{amountCell(r.sales)}</Td>
                  <Td className="relative">
                    {r.target && r.target.percent !== null ? (
                      <span className="flex items-center gap-2" title={`${money(r.target.sold, c)} of ${money(r.target.amount, c)}`}>
                        <span className="h-2 w-24 shrink-0 overflow-hidden rounded-full bg-surface-3" aria-hidden>
                          <span className={cn("block h-full rounded-full", r.target.percent >= 100 ? "bg-ok" : "bg-chart-1")} style={{ width: `${Math.min(100, r.target.percent)}%` }} />
                        </span>
                        <span className="text-sm tabular">
                          {r.target.percent}%<span className="sr-only"> of {money(r.target.amount, c)}{r.target.percent >= 100 ? ", reached" : ""}</span>
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </Td>
                  <Td className="text-right tabular">{amountCell(r.profit)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------- Funnel */

export function FunnelSection({ d, p }: { d: Awaited<ReturnType<typeof loadFunnel>>; p: Period }) {
  const c = d.currency;
  const f = d.funnel;
  const max = Math.max(1, f.inquiries);
  const stages = [
    { label: "Inquiries in", count: f.inquiries, value: null, share: f.inquiries ? "100%" : "—" },
    { label: "Got factory prices", count: f.gotPrices, value: null, share: f.inquiries ? `${percent(Math.round((f.gotPrices / f.inquiries) * 100))} of inquiries` : "—" },
    { label: "Quoted", count: f.quoted, value: Number(f.quotedValue), share: f.gotPrices ? `${percent(Math.round((f.quoted / f.gotPrices) * 100))} of those` : "—" },
    { label: "Won", count: f.won, value: Number(f.wonValue), share: `${percent(f.winRate)} of decided` },
  ];
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title={`From inquiry to order · ${p.name}`} description="counts on the bars; value = what was quoted / won" />
        <div className="flex flex-col gap-3 p-4">
          <ol aria-label="From inquiry to order" className="flex flex-col gap-2.5">
            {stages.map((s) => (
              <li key={s.label} className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_8rem]">
                <span className="truncate">{s.label}</span>
                <span className="h-7">
                  <span
                    className="flex h-7 min-w-9 items-center rounded-r-md bg-chart-1 px-2.5 text-xs font-semibold text-white"
                    style={{ width: `${Math.max(2, (s.count / max) * 100)}%` }}
                  >
                    {s.count}
                  </span>
                </span>
                <span className="text-right">
                  <span className="block text-xs font-semibold tabular">{s.value === null ? "" : compactMoney(s.value, c)}</span>
                  <span className="block text-xs text-muted">{s.share}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="text-xs text-muted">
            Lost {f.lost} · open {f.open} · median days: to first quote {f.medianDaysToFirstQuote ?? "—"}, to decision {f.medianDaysToClose ?? "—"}
          </p>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Why we lose" description={`${f.lost} lost ${p.name}`} />
          <div className="p-4">
            {f.lostReasons.length === 0 ? (
              <p className="text-sm text-muted">No inquiry lost {p.name}.</p>
            ) : (
              <BarList label="Why we lose" tone="chart-4" rows={f.lostReasons.map((r) => ({ key: r.reason, label: r.label, value: r.count, text: String(r.count) }))} />
            )}
          </div>
        </Card>
        <GroupTable title="By channel" head="Channel" c={c} rows={d.channels.map((r) => ({ key: r.key, label: CHANNEL_LABEL[r.key as InquiryChannel] ?? r.label, inquiries: r.inquiries, winRate: r.winRate, last: amountCell(Number(r.wonValue)) }))} lastHead={`Won ${c}`} />
        <GroupTable title="By country" head="Country" c={c} rows={d.countries.map((r) => ({ key: r.key, label: countryName(r.key), inquiries: r.inquiries, winRate: r.winRate, last: amountCell(Number(r.wonValue)) }))} lastHead={`Won ${c}`} />
        <GroupTable title="By product" head="Product" c={c} rows={d.categories.map((r) => ({ key: r.key, label: r.label, inquiries: r.inquiries, winRate: r.winRate, last: percent(r.margin) }))} lastHead="Margin" />
      </div>
    </div>
  );
}

function GroupTable({ title, head, rows, lastHead }: { title: string; head: string; c: string; rows: { key: string; label: string; inquiries: number; winRate: number | null; last: string }[]; lastHead: string }) {
  return (
    <Card>
      <CardHeader title={title} />
      {rows.length === 0 ? (
        <p className="p-4 text-sm text-muted">No inquiry in this period.</p>
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>{head}</Th>
              <Th className="text-right">Inquiries</Th>
              <Th className="text-right">Win rate</Th>
              <Th className="text-right">{lastHead}</Th>
            </tr>
          </THead>
          <tbody>
            {rows.map((r) => (
              <Tr key={r.key}>
                <Td>{r.label}</Td>
                <Td className="text-right tabular">{r.inquiries}</Td>
                <Td className="text-right tabular">{percent(r.winRate)}</Td>
                <Td className="text-right tabular">{r.last}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
