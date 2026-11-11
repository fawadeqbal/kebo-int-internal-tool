import Link from "next/link";
import { Card, CardHeader, cn, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { date, money } from "@/lib/format";
import { amountCell, bigMoney, change, compactMoney, monthYearOf, percent, type Period } from "@/lib/insights-period";
import type { loadOverview } from "@/lib/insights-data";
import { ChartCard } from "./chart-card";
import { SalesProfitChart } from "./facts-charts";
import { Delta, Tile, Tiles } from "./frame";

type Data = Awaited<ReturnType<typeof loadOverview>>;

const plural = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

/** Insights › Overview: eight tiles, sales and gross profit for 12 months, what needs attention, the top five each side. */
export function Overview({ d, p, href }: { d: Data; p: Period; href: (patch: Record<string, string | undefined>) => string }) {
  const c = d.currency;
  const vs = p.vsLabel;
  const overdue = d.now.overdue;
  const recvTotal = Number(d.receivable.total);
  const attention = [
    overdue.customers > 0 && {
      key: "overdue",
      meaning: "bad" as const,
      title: `${plural(overdue.customers, "customer")} overdue · ${bigMoney(Number(overdue.amount), c)}`,
      sub: overdue.list[0] ? `oldest ${plural(overdue.list[0].days, "day")}: ${overdue.list[0].name}` : null,
      link: { href: `${href({ section: "money" })}#owed`, label: "Money" },
    },
    d.now.lateFactories.length > 0 && {
      key: "late",
      meaning: "warn" as const,
      title: `${plural(d.now.lateFactories.length, "factory", "factories")} late on ready dates`,
      sub: d.now.lateFactories
        .slice(0, 2)
        .map((f) => `${f.name} ${plural(f.days, "day")}`)
        .join(" · "),
      link: { href: href({ section: "factories" }), label: "Factories" },
    },
    d.now.lowMargin.orders > 0 && {
      key: "margin",
      meaning: "warn" as const,
      title: `Margin under 10% on ${plural(d.now.lowMargin.orders, "order")}`,
      sub:
        d.now.lowMargin.costsOverPlan && Number(d.now.lowMargin.costsOverPlan) > 0
          ? `costs over plan by ${bigMoney(Number(d.now.lowMargin.costsOverPlan), c)}`
          : `ordered ${p.name}`,
      link: d.seeMoney
        ? { href: href({ section: "money" }), label: "Money" }
        : { href: href({ section: "customers" }), label: "Customers" },
    },
    d.now.expiring.count > 0 && {
      key: "expiring",
      meaning: "info" as const,
      title: `${plural(d.now.expiring.count, "quotation")} expire${d.now.expiring.count === 1 ? "s" : ""} this week`,
      sub: `${bigMoney(Number(d.now.expiring.value), c)} in total`,
      link: { href: "/inquiries?stage=quoted", label: "Quotations" },
    },
  ].filter(Boolean) as {
    key: string;
    meaning: "bad" | "warn" | "info";
    title: string;
    sub: string | null;
    link: { href: string; label: string };
  }[];

  const monthHref = Object.fromEntries(d.months.map((m) => [m.month, `${href({ month: m.month })}#month-orders`]));

  return (
    <div className="flex flex-col gap-4">
      <Tiles>
        <Tile
          label="Sales"
          value={bigMoney(d.sales.now, c)}
          delta={<Delta value={change(d.sales.now, d.sales.before)} vs={vs} />}
          sub={`${plural(d.sales.orders, "order")}${d.sales.orders ? ` · avg ${bigMoney(d.sales.now / d.sales.orders, c)}` : ""}`}
        />
        <Tile
          label="Gross profit"
          value={bigMoney(d.profit.now, c)}
          delta={<Delta value={change(d.profit.now, d.profit.before)} vs={vs} />}
          sub={`margin ${percent(d.profit.margin)}${d.profit.marginBefore !== null ? ` · was ${percent(d.profit.marginBefore)}` : ""}`}
        />
        <Tile
          className="max-sm:hidden"
          label="Cash in"
          value={bigMoney(d.cashIn.now, c)}
          delta={<Delta value={change(d.cashIn.now, d.cashIn.before)} vs={vs} />}
          sub="from customers"
        />
        {d.cashOut ? (
          <Tile
            className="max-sm:hidden"
            label="Cash out"
            value={bigMoney(d.cashOut.now, c)}
            delta={<Delta value={change(d.cashOut.now, d.cashOut.before)} goodWhenUp={false} vs={vs} />}
            sub="factories + costs"
          />
        ) : (
          <Tile
            className="max-sm:hidden"
            label="Shipped on time"
            value={percent(d.shipped?.percent)}
            sub={d.shipped?.withDate ? `${d.shipped.onTime} of ${d.shipped.withDate} by the date promised` : "none shipped with a date yet"}
          />
        )}
        <Tile
          label="Receivable"
          value={bigMoney(recvTotal, c)}
          meter={
            recvTotal > 0
              ? { percent: (Number(overdue.amount) / recvTotal) * 100, label: `${bigMoney(Number(overdue.amount), c)} of it overdue` }
              : undefined
          }
          sub={
            Number(overdue.amount) > 0
              ? `${bigMoney(Number(overdue.amount), c)} overdue · ${plural(overdue.customers, "customer")}`
              : "nothing overdue"
          }
          href={href({ section: "money" })}
        />
        {d.payable ? (
          <Tile
            className="max-sm:hidden"
            label="Payable"
            value={bigMoney(Number(d.payable.total), c)}
            sub={[
              ...d.payOwn
                .filter(([cur]) => cur !== c)
                .slice(0, 1)
                .map(([cur, v]) => bigMoney(v, cur)),
              plural(d.payFactories, "factory", "factories"),
            ].join(" · ")}
            href={href({ section: "money" })}
          />
        ) : (
          <Tile
            className="max-sm:hidden"
            label="Orders"
            value={String(d.sales.orders)}
            delta={<Delta value={change(d.sales.orders, d.sales.ordersBefore)} vs={vs} />}
            sub={`was ${d.sales.ordersBefore}`}
          />
        )}
        <Tile
          className="max-sm:hidden"
          label="Open quotes"
          value={bigMoney(Number(d.now.openQuotes.value), c)}
          sub={`${plural(d.now.openQuotes.count, "quote")}${d.now.openQuotes.likely ? ` · likely ${bigMoney(Number(d.now.openQuotes.likely), c)}` : ""}`}
          href="/inquiries?stage=quoted"
        />
        <Tile
          label="Win rate"
          value={percent(d.winRate.now)}
          delta={
            <Delta
              value={d.winRate.now !== null && d.winRate.before !== null ? Math.round((d.winRate.now - d.winRate.before) * 10) / 10 : null}
              points
              vs={vs}
            />
          }
          sub={`won ${d.winRate.won} · lost ${d.winRate.lost}${d.winRate.before !== null ? ` · was ${percent(d.winRate.before)}` : ""}`}
          href={href({ section: "funnel" })}
        />
      </Tiles>

      <ChartCard
        title="Sales and gross profit, last 12 months"
        description={`${c} · hover a month for its figures · click it to see its orders`}
        table={{
          columns: ["Month", "Orders", `Sales ${c}`, `Gross profit ${c}`, "Margin"],
          rows: d.months.map((m) => [monthYearOf(m.month), m.orders, amountCell(m.sales), amountCell(m.profit), percent(m.margin)]),
        }}
      >
        <SalesProfitChart rows={d.months} currency={c} monthHref={monthHref} />
      </ChartCard>

      {d.month && (
        <Card id="month-orders" className="scroll-mt-20">
          <CardHeader
            title={`Orders · ${new Date(`${d.month.month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}`}
            description="the orders behind the month's bar · click one to open it"
            actions={
              <Link href={href({ month: undefined })} scroll={false} className="text-sm font-medium text-text-2 hover:text-text">
                Close
              </Link>
            }
          />
          {d.month.orders.length === 0 ? (
            <p className="p-4 text-sm text-muted">No order this month.</p>
          ) : (
            <Table>
              <THead>
                <tr>
                  <Th>Order</Th>
                  <Th>Customer</Th>
                  <Th>Ordered</Th>
                  <Th className="text-right">Sales {c}</Th>
                  <Th className="text-right">Margin</Th>
                </tr>
              </THead>
              <tbody>
                {d.month.orders.map((o) => (
                  <Tr key={o.orderId}>
                    <Td>
                      <Link href={`/orders/${o.orderId}`} className="-my-1 inline-block py-1 font-medium hover:text-primary">
                        {o.refNo}
                      </Link>
                    </Td>
                    <Td>{o.customer}</Td>
                    <Td className="whitespace-nowrap">{date(o.orderedOn)}</Td>
                    <Td className="text-right tabular">{amountCell(Number(o.sales))}</Td>
                    <Td className="text-right tabular">{percent(o.marginQuote)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Needs attention" />
          {attention.length === 0 ? (
            <p className="p-4 text-sm text-muted">
              Nothing needs attention: no customer overdue, no factory late, no thin margin, no quotation running out this week.
            </p>
          ) : (
            <ul className="divide-y divide-line px-4">
              {attention.map((a) => (
                <li key={a.key} className="flex items-start gap-3 py-3">
                  <span
                    aria-hidden
                    className={cn(
                      "mt-1.5 size-2.5 shrink-0 rounded-full",
                      a.meaning === "bad" ? "bg-bad" : a.meaning === "warn" ? "bg-warn" : "bg-info",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      <span className="sr-only">{a.meaning === "bad" ? "Late: " : a.meaning === "warn" ? "Check: " : "Soon: "}</span>
                      {a.title}
                    </span>
                    {a.sub && <span className="block text-xs text-muted">{a.sub}</span>}
                  </span>
                  <Link href={a.link.href} className="shrink-0 text-sm font-medium text-primary underline-offset-2 hover:underline">
                    {a.link.label} →
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <TopList
          title="Top customers"
          all={{ href: href({ section: "customers" }), label: "All customers" }}
          empty={`No order ${p.name}.`}
          rows={d.topCustomers.map((r) => ({
            key: r.key,
            href: `/customers/${r.key}`,
            name: r.label,
            sub: `${plural(r.orders, "order")} · ${percent(r.marginQuote)}`,
            value: compactMoney(Number(r.sales), c),
            exact: money(r.sales, c),
          }))}
        />
        <TopList
          title="Top factories"
          all={{ href: href({ section: "factories" }), label: "All factories" }}
          empty={`No order from a factory ${p.name}.`}
          rows={d.topFactories.map((r) => ({
            key: r.key,
            href: `/factories/${r.key}`,
            name: r.label,
            sub: `${plural(r.orders, "order")} · on time ${percent(r.ready.percent)}`,
            value: r.spend === null ? plural(r.orders, "order") : compactMoney(Number(r.spend), c),
            exact: r.spend === null ? undefined : money(r.spend, c),
          }))}
        />
      </div>
    </div>
  );
}

function TopList({
  title,
  all,
  rows,
  empty,
}: {
  title: string;
  all: { href: string; label: string };
  rows: { key: string; href: string; name: string; sub: string; value: string; exact?: string }[];
  empty: string;
}) {
  return (
    <Card>
      <CardHeader
        title={title}
        actions={
          <Link href={all.href} className="text-sm font-medium text-text-2 hover:text-text">
            {all.label}
          </Link>
        }
      />
      {rows.length === 0 ? (
        <p className="p-4 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.key}>
              <Link href={r.href} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-2/60">
                <span className="min-w-0">
                  <span className="block truncate text-sm">{r.name}</span>
                  <span className="block text-xs text-muted">{r.sub}</span>
                </span>
                <span className="shrink-0 text-sm font-semibold tabular" title={r.exact}>
                  {r.value}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
