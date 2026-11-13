import Link from "next/link";
import { Card, CardHeader, cn, StatRow, StatTile, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { date, money, plural, whole } from "@/lib/format";
import { amountCell, bigMoney, change, monthYearOf, percent, type Period } from "@/lib/insights-period";
import type { loadOverview } from "@/lib/insights-data";
import { ChartCard } from "./chart-card";
import { SalesProfitChart } from "./facts-charts";
import { Delta } from "./frame";

type Data = Awaited<ReturnType<typeof loadOverview>>;

const MORE = "text-sm font-medium text-primary underline-offset-2 hover:underline";

/**
 * Reports › Overview (design "money, simple", board ROverview): four figures against the period before,
 * sold and profit by month beside the cash we hold, and three short lists that each open the page behind
 * them: who owes us, what we pay this week, which orders make too little.
 */
export function Overview({ d, p, href }: { d: Data; p: Period; href: (patch: Record<string, string | undefined>) => string }) {
  const c = d.currency;
  const vs = p.vsLabel;
  const monthHref = Object.fromEntries(d.months.map((m) => [m.month, `${href({ month: m.month })}#month-orders`]));
  const profitName = d.seeProfit ? "Profit" : "Gross profit";
  const totals = (xs: { currency: string; amount: number }[]) => (xs.length ? xs.map((x) => whole(x.amount, x.currency)).join(" + ") : null);
  /** A loss with a real minus sign in front of the currency, so it is not read as a dash. */
  const signed = (v: number) => (v < 0 ? `− ${whole(-v, c)}` : whole(v, c));

  return (
    <div className="flex flex-col gap-4">
      <StatRow>
        <StatTile
          label="Sold"
          value={bigMoney(d.sold.now, c)}
          delta={<Delta value={change(d.sold.now, d.sold.before)} vs={vs} />}
          sub={plural(d.sold.orders, "order")}
        />
        <StatTile
          label="Collected"
          value={bigMoney(d.collected.now, c)}
          delta={<Delta value={change(d.collected.now, d.collected.before)} vs={vs} />}
          sub="from customers"
          href={d.paidOut ? href({ section: "cash" }) : undefined}
        />
        {d.paidOut ? (
          <StatTile
            label="Paid out"
            value={bigMoney(d.paidOut.now, c)}
            delta={<Delta value={change(d.paidOut.now, d.paidOut.before)} goodWhenUp={false} vs={vs} />}
            sub="suppliers, bills and company costs"
            href={href({ section: "cash" })}
          />
        ) : (
          <StatTile
            label="Win rate"
            value={percent(d.winRate.now)}
            delta={<Delta value={d.winRate.now !== null && d.winRate.before !== null ? Math.round((d.winRate.now - d.winRate.before) * 10) / 10 : null} points vs={vs} />}
            sub={`won ${d.winRate.won} · lost ${d.winRate.lost}`}
            href={href({ section: "funnel" })}
          />
        )}
        <StatTile
          label={profitName}
          value={bigMoney(d.profit.now, c)}
          tone={d.profit.now < 0 ? "bad" : d.seeProfit && d.profit.now > 0 ? "ok" : undefined}
          delta={<Delta value={change(d.profit.now, d.profit.before)} vs={vs} />}
          sub={d.seeProfit ? `${percent(d.profit.margin)} · after company costs` : `${percent(d.profit.margin)} of what was sold`}
          href={d.seeProfit ? href({ section: "money" }) : undefined}
        />
      </StatRow>

      <div className={cn("grid gap-4", d.cash && "lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]")}>
        <ChartCard
          title={`Sold and ${profitName.toLowerCase()}, by month`}
          description={`${c} · a month opens its orders`}
          table={{
            columns: ["Month", "Orders", `Sold ${c}`, `${profitName} ${c}`],
            rows: d.months.map((m) => [monthYearOf(m.month), m.orders, amountCell(m.sales), amountCell(m.profit)]),
          }}
        >
          <SalesProfitChart rows={d.months} currency={c} monthHref={monthHref} names={["Sold", profitName]} />
        </ChartCard>
        {d.cash && (
          <Card className="self-start">
            <CardHeader
              title={
                <>
                  Cash now <span className="font-normal text-text-2">· ≈ {whole(d.cash.total, c)}</span>
                </>
              }
              actions={
                <Link href="/finance/cash-book" className={MORE}>
                  Cash &amp; bank →
                </Link>
              }
            />
            {d.cash.byCurrency.length === 0 ? (
              <p className="p-4 text-sm text-muted">No account yet. Add the first one on Cash &amp; bank.</p>
            ) : (
              <ul className="divide-y divide-line">
                {d.cash.byCurrency.map((x) => (
                  <li key={x.currency} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{x.currency}</span>
                      <span className="block text-xs text-text-2">
                        {plural(x.accounts, "account")}
                        {x.currency !== c && ` · ≈ ${whole(x.inMain, c)}`}
                      </span>
                    </span>
                    <span className={cn("shrink-0 text-sm font-semibold tabular", Number(x.amount) < 0 && "text-bad")}>{money(x.amount, x.currency).replace(`${x.currency} `, "")}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      {d.month && (
        <Card id="month-orders" className="scroll-mt-20">
          <CardHeader
            title={`Orders · ${new Date(`${d.month.month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}`}
            description="the orders behind the month's bar"
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
                  <Th className="text-right">Sold {c}</Th>
                  <Th className="text-right">%</Th>
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
                    <Td className="text-right tabular">{percent(d.seeProfit ? o.margin : o.marginQuote)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {d.owe && (
          <ShortList
            title="Customers owe us"
            total={totals(d.owe.totals.map((x) => ({ currency: x.currency, amount: Number(x.due) })))}
            all={{ href: "/money/due", label: `All ${d.owe.count}` }}
            empty="No customer owes anything."
            rows={d.owe.rows.map((r) => ({
              key: r.id,
              href: `/orders/${r.id}/payment`,
              name: r.customer.name,
              sub: `${r.refNo} · ${r.daysLate > 0 ? `${plural(r.daysLate, "day")} late` : r.next?.dueOn ? `due ${date(r.next.dueOn)}` : "no date yet"}`,
              value: whole(r.due, r.currency),
              tone: r.daysLate > 0 ? ("bad" as const) : undefined,
            }))}
          />
        )}
        {d.pay && (
          <ShortList
            title="To pay in the next 7 days"
            total={totals(d.pay.totals.map(([currency, amount]) => ({ currency, amount })))}
            all={{ href: "/money/due?side=suppliers", label: `All ${d.pay.count}` }}
            empty="Nothing to pay this week."
            rows={d.pay.rows.map((r) => ({
              key: r.key,
              href: "/money/due?side=suppliers",
              name: r.name,
              sub: `${r.what} · ${r.late > 0 ? `${plural(r.late, "day")} late` : r.dueOn ? date(r.dueOn) : "no date"}`,
              value: whole(r.amount, r.currency),
              tone: r.late > 0 ? ("bad" as const) : undefined,
            }))}
          />
        )}
        {d.thin && (
          <ShortList
            title="Thin or no profit"
            total="under 10%"
            all={{ href: href({ section: "money" }), label: "Profit by order" }}
            empty={`Every running order of ${p.name} makes 10% or more.`}
            rows={d.thin.rows.map((r) => ({
              key: r.orderId,
              href: `/orders/${r.orderId}/costs`,
              name: `${r.refNo} · ${r.customer}`,
              sub: r.profit < 0 ? `costs are over what was sold` : `profit ${percent(r.margin)} of the order`,
              value: signed(r.profit),
              tone: r.profit < 0 ? ("bad" as const) : ("warn" as const),
            }))}
          />
        )}
      </div>
    </div>
  );
}

/** A card with at most four lines and a link to the whole list. */
function ShortList({
  title,
  total,
  all,
  rows,
  empty,
}: {
  title: string;
  total: string | null;
  all: { href: string; label: string };
  rows: { key: string; href: string; name: string; sub: string; value: string; tone?: "bad" | "warn" }[];
  empty: string;
}) {
  return (
    <Card>
      <CardHeader
        title={title}
        description={total}
        actions={
          <Link href={all.href} className={cn(MORE, "whitespace-nowrap")}>
            {all.label} →
          </Link>
        }
      />
      {rows.length === 0 ? (
        <p className="p-4 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.key}>
              <Link href={r.href} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-2/60 sm:px-5">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{r.name}</span>
                  <span className="block truncate text-xs text-text-2">{r.sub}</span>
                </span>
                <span className={cn("shrink-0 text-sm font-semibold tabular", r.tone === "bad" && "text-bad", r.tone === "warn" && "text-warn")}>{r.value}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
