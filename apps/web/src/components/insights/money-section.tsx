import Link from "next/link";
import { EXPENSE_CATEGORY_LABEL, type ExpenseCategory } from "@kebo/shared";
import { Card, CardHeader, Table, Td, Th, THead, Tr, StatTile } from "@kebo/ui";
import { amountCell, bigMoney, change, monthYearOf, percent, type Period } from "@/lib/insights-period";
import { BUCKETS, bucketValue, type loadMoney } from "@/lib/insights-data";
import type { Aging } from "@/lib/types-facts";
import { ChartCard } from "./chart-card";
import { CashChart, PairBars } from "./facts-charts";
import { BarList, Delta, SegmentBar, Tiles } from "./frame";

type Data = Awaited<ReturnType<typeof loadMoney>>;
type Href = (patch: Record<string, string | undefined>) => string;

const monthName = monthYearOf;
const signedMoney = (v: number, c: string) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${bigMoney(Math.abs(v), c)}`;

/** Insights › Money (people who may see money): cash, what is owed each way, profit, costs, currencies, leaks. */
export function MoneySection({ d, p, href }: { d: Data; p: Period; href: Href }) {
  const c = d.currency;
  const vs = p.vsLabel;
  return (
    <div className="flex flex-col gap-4">
      <Tiles>
        <StatTile
          label="Net cash"
          value={signedMoney(d.netCash.now, c)}
          delta={<Delta value={change(d.netCash.now, d.netCash.before)} vs={vs} />}
          sub={`in ${amountCell(d.netCash.in)} · out ${amountCell(d.netCash.out)}`}
        />
        <StatTile
          label="Profit expected"
          value={bigMoney(d.profitExpected.now, c)}
          delta={<Delta value={change(d.profitExpected.now, d.profitExpected.before)} vs={vs} />}
          sub={`on the period's orders · ${percent(d.profitExpected.margin)}`}
        />
        <StatTile
          label="Profit so far"
          value={bigMoney(d.profitDone.now, c)}
          delta={<Delta value={change(d.profitDone.now, d.profitDone.before)} vs={vs} />}
          sub="on orders already paid and shipped"
        />
        <StatTile
          label="Costs over plan"
          value={bigMoney(d.overPlan.now, c)}
          delta={<Delta value={change(d.overPlan.now, d.overPlan.before)} goodWhenUp={false} vs={vs} />}
          sub={`${d.overPlan.orders} order${d.overPlan.orders === 1 ? "" : "s"} · ${d.byKind[0] ? `most in ${kindLabel(d.byKind[0].category).toLowerCase()}` : "none"}`}
        />
      </Tiles>

      <ChartCard
        title="Cash in and out by month"
        description={`${c} · in above the line, out below · net is the dark line`}
        table={{
          columns: ["Month", `Cash in ${c}`, `Cash out ${c}`, `Net ${c}`],
          rows: d.cashMonths.map((m) => [monthName(m.month), amountCell(m.in), amountCell(m.out), amountCell(m.net)]),
        }}
      >
        <CashChart rows={d.cashMonths} currency={c} />
      </ChartCard>

      <div id="owed" className="grid scroll-mt-20 gap-4 lg:grid-cols-2">
        <AgeCard
          title="Owed to us, by age"
          description="from customers · click an age to see the orders"
          a={d.receivable}
          side="receivable"
          d={d}
          href={href}
        />
        <AgeCard
          title="We owe factories, by age"
          description="after factory-borne costs · click an age to see the orders"
          a={d.payable}
          side="payable"
          d={d}
          href={href}
        />
      </div>

      {d.age && (
        <Card id="age-orders" className="scroll-mt-20">
          <CardHeader
            title={`${d.age.side === "receivable" ? "Owed to us" : "We owe factories"} · ${BUCKETS.find((b) => b.key === d.age!.bucket)?.label.toLowerCase()}`}
            description="the orders in this age · click one to open it"
            actions={
              <Link
                href={href({ age: undefined, side: undefined })}
                scroll={false}
                className="text-sm font-medium text-text-2 hover:text-text"
              >
                Close
              </Link>
            }
          />
          {d.age.orders.length === 0 ? (
            <p className="p-4 text-sm text-muted">Nothing in this age.</p>
          ) : (
            <Table>
              <THead>
                <tr>
                  <Th>Order</Th>
                  <Th>Customer</Th>
                  {d.age.side === "payable" && <Th>Factory</Th>}
                  <Th className="text-right">Amount {c}</Th>
                </tr>
              </THead>
              <tbody>
                {d.age.orders.map((o) => (
                  <Tr key={`${o.orderId}-${o.factory ?? ""}`}>
                    <Td>
                      <Link href={`/orders/${o.orderId}/payment`} className="-my-1 inline-block py-1 font-medium hover:text-primary">
                        {o.refNo}
                      </Link>
                    </Td>
                    <Td>{o.customer}</Td>
                    {d.age!.side === "payable" && <Td>{o.factory}</Td>}
                    <Td className="text-right tabular">{amountCell(Number(o.amount))}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <ChartCard
          title="Profit by month: expected vs now"
          description={`${c} · a gap means costs or prices moved after the order`}
          table={{
            columns: ["Month", `Expected at order ${c}`, `Now ${c}`],
            rows: d.profitMonths.map((m) => [monthName(m.month), amountCell(m.a), amountCell(m.b)]),
          }}
        >
          <PairBars rows={d.profitMonths} currency={c} a="Expected at order" b="Now" />
        </ChartCard>
        <Card>
          <CardHeader title="Costs by kind" description={`${c} · on orders and the company, ${p.name}`} />
          <div className="p-4">
            {d.byKind.length === 0 ? (
              <p className="text-sm text-muted">No cost recorded {p.name}.</p>
            ) : (
              <BarList
                label="Costs by kind"
                tone="chart-3"
                rows={d.byKind.slice(0, 8).map((k) => ({
                  key: k.category,
                  label: kindLabel(k.category),
                  sub: k.orders ? `${k.orders} order${k.orders === 1 ? "" : "s"}` : "company",
                  value: Number(k.amount),
                  text: bigMoney(Number(k.amount), c),
                }))}
              />
            )}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:items-start xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card>
          <CardHeader title="Money by currency" description="as held, before conversion · today" />
          <Table>
            <THead>
              <tr>
                <Th>Currency</Th>
                <Th className="text-right">Receivable</Th>
                <Th className="text-right">Payable</Th>
                <Th className="text-right">In hand</Th>
              </tr>
            </THead>
            <tbody>
              {d.currencies.map((x) => (
                <Tr key={x.currency}>
                  <Td className="font-medium">{x.currency}</Td>
                  <Td className="text-right tabular">{x.toReceive ? amountCell(x.toReceive) : "—"}</Td>
                  <Td className="text-right tabular">{x.toPay ? amountCell(x.toPay) : "—"}</Td>
                  <Td className="text-right tabular">{x.inHand === null ? "—" : amountCell(x.inHand)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card>
          <CardHeader
            title="Where money leaks"
            description={`orders of ${p.name} whose costs went over plan · ${c}`}
            actions={
              <Link href={href({ view: "leaks" })} className="text-sm font-medium text-text-2 hover:text-text">
                More
              </Link>
            }
          />
          {d.leaks.length === 0 ? (
            <p className="p-4 text-sm text-muted">No order of {p.name} went over its planned costs.</p>
          ) : (
            <Table>
              <THead>
                <tr>
                  <Th>Order</Th>
                  <Th>Customer</Th>
                  <Th className="text-right">Planned cost</Th>
                  <Th className="text-right">Cost now</Th>
                  <Th className="text-right">Over</Th>
                  <Th className="text-right">Margin now</Th>
                </tr>
              </THead>
              <tbody>
                {d.leaks.map((l) => (
                  <Tr key={l.orderId}>
                    <Td className="whitespace-nowrap">
                      <Link href={`/orders/${l.orderId}/costs`} className="-my-1 inline-block py-1 font-medium hover:text-primary">
                        {l.refNo}
                      </Link>
                    </Td>
                    <Td className="max-w-40 truncate">{l.customer}</Td>
                    <Td className="text-right tabular">{amountCell(l.planned)}</Td>
                    <Td className="text-right tabular">{amountCell(l.actual)}</Td>
                    <Td className="relative text-right font-semibold text-bad tabular">
                      +{amountCell(l.over)}
                      <span className="sr-only"> over plan</span>
                    </Td>
                    <Td className="text-right tabular">{percent(l.margin)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <p className="text-sm text-text-2">
        Also here:{" "}
        <Link href={href({ view: "pnl" })} className="font-medium text-primary hover:underline">
          Profit and loss, month by month
        </Link>{" "}
        ·{" "}
        <Link href={href({ view: "leaks" })} className="font-medium text-primary hover:underline">
          Where we lose money (deals, orders, customers, spending)
        </Link>
      </p>
    </div>
  );
}

const kindLabel = (k: string) => EXPENSE_CATEGORY_LABEL[k as ExpenseCategory] ?? k;

function AgeCard({
  title,
  description,
  a,
  side,
  d,
  href,
}: {
  title: string;
  description: string;
  a: Aging;
  side: "receivable" | "payable";
  d: Data;
  href: Href;
}) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <div className="p-4">
        <SegmentBar
          label={title}
          total={bigMoney(Number(a.total), a.currency)}
          parts={BUCKETS.map((b) => ({
            key: b.key,
            label: b.label,
            value: bucketValue(a, b.key),
            text: bigMoney(bucketValue(a, b.key), a.currency),
            href: `${href({ age: b.key, side })}#age-orders`,
            active: d.age?.side === side && d.age.bucket === b.key,
          }))}
        />
      </div>
    </Card>
  );
}
