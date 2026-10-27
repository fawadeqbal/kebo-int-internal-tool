import Link from "next/link";
import { Alert, Card, CardBody, CardHeader, cn, Segmented, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { todayIn } from "@kebo/utils";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import type { ProfitAndLoss } from "@/lib/types-money";

const TZ = process.env.APP_TIME_ZONE ?? process.env.NEXT_PUBLIC_APP_TIME_ZONE ?? "Asia/Shanghai";
const MONTH = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" });
const monthName = (ym: string) => MONTH.format(new Date(`${ym}-01T00:00:00Z`));


/**
 * The company's profit & loss for a year, month by month: earned (orders in
 * the month they shipped) or cash (money as it moved). Insights → Profit.
 */
export async function ProfitTable({ year: asked, cash, href }: { year?: string; cash: boolean; href: (change: Record<string, string | undefined>) => string }) {
  const today = todayIn(TZ);
  const thisYear = Number(today.slice(0, 4));
  const year = Number(asked) >= 2020 && Number(asked) <= thisYear ? Number(asked) : thisYear;
  const pnl = await api.get<ProfitAndLoss>("/money/profit-and-loss", { year });
  const c = pnl.currency;
  const shownMonths = pnl.months.filter((m) => m.month <= today.slice(0, 7));
  const values = shownMonths.map((m) => Number(cash ? m.cash.net : m.earned.profit));
  const scale = Math.max(1, ...values.map(Math.abs));
  const t = pnl.total;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Year"
          options={[thisYear - 1, thisYear].map((y) => ({
            href: href({ year: y === thisYear ? undefined : String(y) }),
            label: String(y),
            active: y === year,
          }))}
        />
        <Segmented
          label="View"
          options={[
            { href: href({ pl: undefined }), label: "Earned", active: !cash },
            { href: href({ pl: "cash" }), label: "Cash", active: cash },
          ]}
        />
        <p className="text-xs text-muted">
          {cash
            ? "Cash: money in from customers less what we paid factories and all expenses, in the month it moved."
            : "Earned: each order counts in the month it shipped — its value less its goods and expenses — less the company's own expenses that month."}
        </p>
      </div>
      {pnl.missingRates.length > 0 && (
        <Alert tone="warning">
          There is no exchange rate for {pnl.missingRates.join(", ")} in Settings, so some amounts in those currencies are left out.
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-4">
        {(cash
          ? [
              ["In from customers", t.cash.in],
              ["Paid to factories", t.cash.factories],
              ["Expenses", t.cash.expenses],
              ["Net cash", t.cash.net],
            ]
          : [
              ["Orders shipped", null, t.earned.orders],
              ["Value", t.earned.revenue],
              [
                "Costs and expenses",
                String(Number(t.earned.goodsCost) + Number(t.earned.orderExpenses) + Number(t.earned.generalExpenses)),
              ],
              ["Profit", t.earned.profit],
            ]
        ).map(([label, value, count]) => (
          <div key={label as string} className="rounded-xl border border-line bg-surface p-4">
            <p className="text-xs text-muted">{label}</p>
            <p className={cn("mt-1 text-lg font-semibold tabular", value !== null && Number(value) < 0 && "text-bad")}>
              {value === null ? count : money(value as string, c)}
            </p>
          </div>
        ))}
      </div>

      <Card className="overflow-hidden p-0">
        <Table>
          <THead>
            {cash ? (
              <tr>
                <Th>Month</Th>
                <Th className="text-right">In</Th>
                <Th className="text-right">To factories</Th>
                <Th className="text-right">Expenses</Th>
                <Th className="text-right">Net</Th>
                <Th className="hidden w-40 md:table-cell">
                  <span className="sr-only">Chart</span>
                </Th>
              </tr>
            ) : (
              <tr>
                <Th>Month</Th>
                <Th className="text-right">Orders</Th>
                <Th className="text-right">Value</Th>
                <Th className="text-right">Goods</Th>
                <Th className="text-right">Order expenses</Th>
                <Th className="text-right">Company expenses</Th>
                <Th className="text-right">Profit</Th>
                <Th className="hidden w-40 md:table-cell">
                  <span className="sr-only">Chart</span>
                </Th>
              </tr>
            )}
          </THead>
          <tbody>
            {shownMonths.map((m, i) => {
              const v = values[i]!;
              return (
                <Tr key={m.month}>
                  <Td className="font-medium">{monthName(m.month)}</Td>
                  {cash ? (
                    <>
                      <Td className="text-right tabular">{money(m.cash.in, c)}</Td>
                      <Td className="text-right tabular">{money(m.cash.factories, c)}</Td>
                      <Td className="text-right tabular">{money(m.cash.expenses, c)}</Td>
                    </>
                  ) : (
                    <>
                      <Td className="text-right tabular">{m.earned.orders || <span className="text-muted">0</span>}</Td>
                      <Td className="text-right tabular">{money(m.earned.revenue, c)}</Td>
                      <Td className="text-right tabular">{money(m.earned.goodsCost, c)}</Td>
                      <Td className="text-right tabular">{money(m.earned.orderExpenses, c)}</Td>
                      <Td className="text-right tabular">{money(m.earned.generalExpenses, c)}</Td>
                    </>
                  )}
                  <Td className={cn("text-right font-semibold tabular", v < 0 && "text-bad")}>{money(v, c)}</Td>
                  <Td className="hidden md:table-cell">
                    <div className="flex h-2 w-36" aria-hidden>
                      <div className="flex w-1/2 justify-end">
                        {v < 0 && <div className="h-2 rounded-l bg-bad" style={{ width: `${(Math.abs(v) / scale) * 100}%` }} />}
                      </div>
                      <div className="w-1/2 border-l border-line">
                        {v > 0 && <div className="h-2 rounded-r bg-ok" style={{ width: `${(v / scale) * 100}%` }} />}
                      </div>
                    </div>
                  </Td>
                </Tr>
              );
            })}
            <Tr className="bg-surface-2/60 font-semibold">
              <Td>{year}</Td>
              {cash ? (
                <>
                  <Td className="text-right tabular">{money(t.cash.in, c)}</Td>
                  <Td className="text-right tabular">{money(t.cash.factories, c)}</Td>
                  <Td className="text-right tabular">{money(t.cash.expenses, c)}</Td>
                  <Td className={cn("text-right tabular", Number(t.cash.net) < 0 && "text-bad")}>{money(t.cash.net, c)}</Td>
                </>
              ) : (
                <>
                  <Td className="text-right tabular">{t.earned.orders}</Td>
                  <Td className="text-right tabular">{money(t.earned.revenue, c)}</Td>
                  <Td className="text-right tabular">{money(t.earned.goodsCost, c)}</Td>
                  <Td className="text-right tabular">{money(t.earned.orderExpenses, c)}</Td>
                  <Td className="text-right tabular">{money(t.earned.generalExpenses, c)}</Td>
                  <Td className={cn("text-right tabular", Number(t.earned.profit) < 0 && "text-bad")}>{money(t.earned.profit, c)}</Td>
                </>
              )}
              <Td className="hidden md:table-cell" />
            </Tr>
          </tbody>
        </Table>
      </Card>
      {!cash && Number(t.earned.uncostedRevenue) > 0 && (
        <p className="text-xs text-warn">
          {money(t.earned.uncostedRevenue, c)} of the value has no factory cost recorded (freight or hand-priced lines), so profit may be
          too high by that much at most.
        </p>
      )}

      {!cash && (
        <Card>
          <CardHeader
            title={`Orders shipped in ${year}`}
            description="Most profit first. Other expenses are not shared out over orders."
          />
          {pnl.orders.length === 0 ? (
            <CardBody>
              <p className="text-sm text-muted">No order shipped in {year} yet.</p>
            </CardBody>
          ) : (
            <Table>
              <THead>
                <tr>
                  <Th>Order</Th>
                  <Th>Shipped</Th>
                  <Th className="text-right">Value</Th>
                  <Th className="text-right">Goods</Th>
                  <Th className="text-right">Expenses</Th>
                  <Th className="text-right">Profit</Th>
                </tr>
              </THead>
              <tbody>
                {pnl.orders.map((o) => (
                  <Tr key={o.id} className="hover:bg-surface-2/50">
                    <Td>
                      <Link href={`/orders/${o.id}`} className="font-medium hover:text-primary">
                        {o.refNo}
                      </Link>
                      <span className="block max-w-60 truncate text-xs text-muted">{o.customer}</span>
                    </Td>
                    <Td className="text-sm">{monthName(o.month)}</Td>
                    <Td className="text-right tabular">{money(o.revenue, c)}</Td>
                    <Td className="text-right tabular">{money(o.goodsCost, c)}</Td>
                    <Td className="text-right tabular">{money(o.expenses, c)}</Td>
                    <Td className={cn("text-right font-semibold tabular", Number(o.profit) < 0 && "text-bad")}>{money(o.profit, c)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}

