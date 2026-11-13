import Link from "next/link";
import { ORDER_STAGE_LABEL, type OrderStage } from "@kebo/shared";
import { Badge, Card, CardHeader, cn, Pager, Segmented, StatRow, StatTile, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { plural } from "@/lib/format";
import { bigMoney, change, monthYearOf, type Period } from "@/lib/insights-period";
import { PROFIT_SORT_LABEL, PROFIT_SORTS, type loadProfit, type ProfitSort } from "@/lib/insights-data";
import { Delta } from "./frame";

type Data = Awaited<ReturnType<typeof loadProfit>>;

const PAGE = 25;
const n2 = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** A minus as a real minus sign, set apart, so a loss is not read as a dash. */
const signed = (v: number) => (v < 0 ? `− ${n2(-v)}` : n2(v));
/** "14.6%", "− 9.1%"; a loss too small to show a digit is "0%". */
const percent = (v: number | null) => {
  if (v === null) return "—";
  const r = Math.round(v * 10) / 10;
  return r < 0 ? `− ${(-r).toLocaleString("en-US", { maximumFractionDigits: 1 })}%` : `${r.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
};
/** Under 10% of what was sold is thin; under zero is a loss. */
const toneOf = (profit: number, margin: number | null) => (profit < 0 ? "text-bad" : margin !== null && margin < 10 ? "text-warn" : undefined);

/**
 * Reports › Profit (design "money, simple", board RProfit): sold, the orders' costs, the company's own costs,
 * and what is left. Then the same by month, and every order of the period with its profit now.
 */
export function ProfitSection({
  d,
  p,
  sort,
  page,
  base,
  params,
  href,
}: {
  d: Data;
  p: Period;
  sort: ProfitSort;
  page: number;
  base: string;
  params: Record<string, string | undefined>;
  href: (patch: Record<string, string | undefined>) => string;
}) {
  const c = d.currency;
  const t = d.total;
  const shown = d.orders.slice((page - 1) * PAGE, page * PAGE);
  const tone = (v: number) => (v < 0 ? ("bad" as const) : v > 0 ? ("ok" as const) : undefined);
  return (
    <div className="flex flex-col gap-4">
      <StatRow>
        <StatTile label="Sold" value={bigMoney(t.sold, c)} delta={<Delta value={change(t.sold, d.totalBefore.sold)} vs={p.vsLabel} />} sub={plural(t.orders, "order")} />
        <StatTile label="Costs of the orders" value={bigMoney(t.costs, c)} sub="goods, freight and the rest" />
        <StatTile label="Company costs" value={bigMoney(t.company, c)} sub="rent, salaries, office" href="/money/company-costs" />
        <StatTile
          label="Profit"
          value={bigMoney(t.profit, c)}
          tone={tone(t.profit)}
          delta={<Delta value={change(t.profit, d.totalBefore.profit)} vs={p.vsLabel} />}
          sub={t.margin === null ? "nothing sold yet" : `${percent(t.margin)} of what was sold`}
        />
      </StatRow>
      {t.uncosted > 0.005 && (
        <p className="text-xs text-text-2">
          {bigMoney(t.uncosted, c)} of what was sold has no cost yet (no factory price), so it is in Sold and not in the profit.
        </p>
      )}

      <Card className="overflow-hidden">
        <CardHeader title="By month" description={`${c} · an order counts in the month it was ordered, with the costs known today`} />
        <Table>
          <THead>
            <tr>
              <Th>Month</Th>
              <Th className="text-right hidden sm:table-cell">Orders</Th>
              <Th className="text-right">Sold</Th>
              <Th className="text-right hidden md:table-cell">Costs of the orders</Th>
              <Th className="text-right hidden md:table-cell">Profit from orders</Th>
              <Th className="text-right hidden md:table-cell">Company costs</Th>
              <Th className="text-right">Profit</Th>
              <Th className="text-right hidden sm:table-cell">%</Th>
            </tr>
          </THead>
          <tbody>
            {d.months.map((m) => (
              <Tr key={m.month}>
                <Td className="font-semibold whitespace-nowrap">{monthYearOf(m.month)}</Td>
                <Td className="text-right tabular whitespace-nowrap hidden sm:table-cell">{m.orders}</Td>
                <Td className="text-right tabular whitespace-nowrap">{n2(m.sold)}</Td>
                <Td className="text-right tabular whitespace-nowrap hidden md:table-cell">{n2(m.costs)}</Td>
                <Td className="text-right tabular whitespace-nowrap hidden md:table-cell">{signed(m.fromOrders)}</Td>
                <Td className="text-right tabular whitespace-nowrap hidden md:table-cell">{n2(m.company)}</Td>
                <Td className={cn("text-right font-semibold tabular whitespace-nowrap", toneOf(m.profit, m.margin))}>{signed(m.profit)}</Td>
                <Td className={cn("text-right tabular whitespace-nowrap hidden sm:table-cell", toneOf(m.profit, m.margin))}>{percent(m.margin)}</Td>
              </Tr>
            ))}
            {d.months.length > 1 && (
              <Tr className="font-semibold">
                <Td>Total</Td>
                <Td className="text-right tabular whitespace-nowrap hidden sm:table-cell">{t.orders}</Td>
                <Td className="text-right tabular whitespace-nowrap">{n2(t.sold)}</Td>
                <Td className="text-right tabular whitespace-nowrap hidden md:table-cell">{n2(t.costs)}</Td>
                <Td className="text-right tabular whitespace-nowrap hidden md:table-cell">{signed(t.fromOrders)}</Td>
                <Td className="text-right tabular whitespace-nowrap hidden md:table-cell">{n2(t.company)}</Td>
                <Td className={cn("text-right tabular whitespace-nowrap", toneOf(t.profit, t.margin))}>{signed(t.profit)}</Td>
                <Td className={cn("text-right tabular whitespace-nowrap hidden sm:table-cell", toneOf(t.profit, t.margin))}>{percent(t.margin)}</Td>
              </Tr>
            )}
          </tbody>
        </Table>
      </Card>

      <Card id="orders" className="scroll-mt-20 overflow-hidden">
        <CardHeader
          title="By order"
          description={`${plural(d.orders.length, "order")} ${p.name} · an order opens its costs`}
          actions={
            <Segmented
              label="Order of the list"
              options={PROFIT_SORTS.map((s) => ({ href: `${href({ sort: s === "low" ? undefined : s, page: undefined })}#orders`, label: PROFIT_SORT_LABEL[s], active: s === sort }))}
            />
          }
        />
        {d.orders.length === 0 ? (
          <p className="p-4 text-sm text-muted">No order {p.name}.</p>
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Order</Th>
                <Th className="hidden sm:table-cell">Customer</Th>
                <Th className="hidden md:table-cell">Stands</Th>
                <Th className="text-right hidden sm:table-cell">Sold</Th>
                <Th className="text-right hidden md:table-cell">Costs so far</Th>
                <Th className="text-right">Profit now</Th>
                <Th className="text-right">%</Th>
              </tr>
            </THead>
            <tbody>
              {shown.map((o) => (
                <Tr key={o.orderId}>
                  <Td>
                    <Link href={`/orders/${o.orderId}/costs`} className="-my-1 inline-block py-1 font-semibold text-primary hover:underline">
                      {o.refNo}
                    </Link>
                    <span className="block text-xs text-text-2 sm:hidden">{o.customer}</span>
                  </Td>
                  <Td className="font-medium hidden sm:table-cell">{o.customer}</Td>
                  <Td className="hidden md:table-cell">
                    <Badge tone={o.status === "closed" || o.stage === "done" ? "ok" : o.stage === "confirmed" ? "warn" : "info"}>
                      {o.status === "closed" ? "Closed" : (ORDER_STAGE_LABEL[o.stage as OrderStage] ?? o.stage)}
                    </Badge>
                  </Td>
                  <Td className="text-right tabular whitespace-nowrap hidden sm:table-cell">{n2(o.sold)}</Td>
                  <Td className="text-right tabular whitespace-nowrap hidden md:table-cell">{o.uncosted > 0.005 && o.costs === 0 ? <span className="text-muted">no cost yet</span> : n2(o.costs)}</Td>
                  <Td className={cn("text-right font-semibold tabular whitespace-nowrap", toneOf(o.profit, o.margin) ?? (o.profit > 0 ? "text-ok" : undefined))}>{signed(o.profit)}</Td>
                  <Td className={cn("text-right tabular whitespace-nowrap", toneOf(o.profit, o.margin))}>{percent(o.margin)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pager base={base} params={{ ...params, page: undefined }} page={page} pageSize={PAGE} total={d.orders.length} />
      </Card>
    </div>
  );
}
