import Link from "next/link";
import { can, EXPENSE_CATEGORY_LABEL, ORDER_STAGE_LABEL, type OrderStage } from "@kebo/shared";
import {
  Alert,
  Badge,
  buildHref,
  Card,
  CardBody,
  CardHeader,
  cn,
  EmptyState,
  LinkTabs,
  PageHeader,
  Segmented,
  Table,
  Td,
  Th,
  THead,
  Tr,
} from "@kebo/ui";
import { addDays, todayIn } from "@kebo/utils";
import { api } from "@/lib/api";
import { requirePermission } from "@/lib/session";
import { date, money } from "@/lib/format";
import type { Person } from "@/lib/types";
import type { ExpenseList, Payable, ProfitAndLoss } from "@/lib/types-money";
import { EditExpense, NewExpense, VoidForm } from "@/components/money/forms";
import { expenseAction, voidExpenseAction } from "./actions";

export const metadata = { title: "Money" };

const TZ = process.env.APP_TIME_ZONE ?? process.env.NEXT_PUBLIC_APP_TIME_ZONE ?? "Asia/Shanghai";
const MONTH = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" });
const monthName = (ym: string) => MONTH.format(new Date(`${ym}-01T00:00:00Z`));
const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

type Search = { tab?: string; year?: string; view?: string; month?: string; kind?: string; mine?: string };

/**
 * The company's money: profit & loss by month (earned and cash), expenses
 * (managers and the super admin), and what we still owe the factories.
 */
export default async function MoneyPage({ searchParams }: { searchParams: Promise<Search> }) {
  const me = await requirePermission("sourcing.manage");
  const sp = await searchParams;
  const managers = can(me, "expenses.manage");
  const tab = managers ? (sp.tab === "expenses" || sp.tab === "owe" ? sp.tab : "pnl") : "owe";
  const today = todayIn(TZ);
  const tabs = [
    ...(managers
      ? [
          { href: "/money", label: "Profit & loss", active: tab === "pnl" },
          { href: "/money?tab=expenses", label: "Expenses", active: tab === "expenses" },
        ]
      : []),
    { href: "/money?tab=owe", label: "What we owe factories", active: tab === "owe" },
  ];
  return (
    <div>
      <PageHeader
        title="Money"
        description={
          managers
            ? "Profit and loss, expenses and what we owe the factories. Only managers see profit and expenses."
            : "What we still owe the factories on our orders."
        }
      />
      <LinkTabs label="Money sections" className="mb-5" tabs={tabs} />
      {tab === "pnl" && <ProfitTab sp={sp} today={today} />}
      {tab === "expenses" && <ExpensesTab sp={sp} today={today} />}
      {tab === "owe" && <OweTab mine={sp.mine === "1"} />}
    </div>
  );
}

/* ---------------------------------------------------------------- profit & loss */

async function ProfitTab({ sp, today }: { sp: Search; today: string }) {
  const thisYear = Number(today.slice(0, 4));
  const year = Number(sp.year) >= 2020 && Number(sp.year) <= thisYear ? Number(sp.year) : thisYear;
  const cash = sp.view === "cash";
  const pnl = await api.get<ProfitAndLoss>("/money/profit-and-loss", { year });
  const c = pnl.currency;
  const keep = { tab: undefined, year: year === thisYear ? undefined : String(year), view: cash ? "cash" : undefined };
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
            href: buildHref("/money", keep, { year: y === thisYear ? undefined : String(y) }),
            label: String(y),
            active: y === year,
          }))}
        />
        <Segmented
          label="View"
          options={[
            { href: buildHref("/money", keep, { view: undefined }), label: "Earned", active: !cash },
            { href: buildHref("/money", keep, { view: "cash" }), label: "Cash", active: cash },
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
            description="Most profit first. The company's own expenses are not shared out over orders."
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

/* ---------------------------------------------------------------- expenses */

async function ExpensesTab({ sp, today }: { sp: Search; today: string }) {
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : today.slice(0, 7);
  const kind = sp.kind === "order" || sp.kind === "general" ? sp.kind : undefined;
  const from = `${month}-01`;
  const next = addDays(`${month}-28`, 4).slice(0, 7);
  const to = addDays(`${next}-01`, -1);
  const prev = addDays(from, -1).slice(0, 7);
  const [list, people, orders, settings] = await Promise.all([
    api.get<ExpenseList>("/expenses", { from, to, kind }),
    api.get<Person[]>("/users/people"),
    api.get<{ id: string; refNo: string; customer: { name: string } }[]>("/orders", { status: "open" }),
    api.get<{ sales: { currency: string; exchangeRates: Record<string, number> } }>("/settings"),
  ]);
  const fx = { main: settings.sales.currency, rates: settings.sales.exchangeRates };
  const openOrders = orders.map((o) => ({ id: o.id, refNo: o.refNo, label: o.customer.name }));
  const keep = { tab: "expenses", month: month === today.slice(0, 7) ? undefined : month, kind };
  const c = list.currency;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Month"
            options={[
              { href: buildHref("/money", keep, { month: prev }), label: "←", active: false },
              {
                href: buildHref("/money", keep, { month: undefined }),
                label: MONTH_YEAR.format(new Date(`${month}-01T00:00:00Z`)),
                active: true,
              },
              ...(month < today.slice(0, 7) ? [{ href: buildHref("/money", keep, { month: next }), label: "→", active: false }] : []),
            ]}
          />
          <Segmented
            label="Which expenses"
            options={[
              { href: buildHref("/money", keep, { kind: undefined }), label: "All", active: !kind },
              { href: buildHref("/money", keep, { kind: "order" }), label: "Orders", active: kind === "order" },
              { href: buildHref("/money", keep, { kind: "general" }), label: "Company", active: kind === "general" },
            ]}
          />
        </div>
        <p className="text-sm">
          Total <span className="font-semibold tabular">{money(list.total, c)}</span>
        </p>
      </div>
      <NewExpense
        action={expenseAction.bind(null, null, null)}
        people={people}
        mainCurrency={settings.sales.currency}
        fx={fx}
        today={today}
        orders={openOrders}
      />
      <Card className="overflow-hidden p-0">
        {list.rows.length === 0 ? (
          <EmptyState
            title="No expenses this month"
            description="Add rent, salaries and other company costs here. Costs of one order are best added on the order."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {list.rows.map((e) => (
              <li
                key={e.id}
                className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm", e.voided && "text-muted")}
              >
                <div className="min-w-0">
                  <p>
                    <span className={cn("font-medium tabular", e.voided && "line-through")}>{money(e.amount, e.currency)}</span>{" "}
                    <span className="text-text-2">{e.description}</span>{" "}
                    {e.order ? (
                      <Link href={`/orders/${e.order.id}`} className="text-xs text-primary hover:underline">
                        {e.order.refNo}
                      </Link>
                    ) : (
                      <Badge tone="neutral">Company</Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted">
                    {EXPENSE_CATEGORY_LABEL[e.category]} · {date(e.spentOn)}
                    {e.currency !== c && ` · ≈ ${money(e.inMain, c)}`}
                    {e.paidBy && ` · paid by ${e.paidBy.name}`}
                    {e.reference && ` · ${e.reference}`}
                  </p>
                  {e.voided && (
                    <p className="text-xs">
                      <Badge tone="bad">Removed</Badge> {e.voided.reason}
                    </p>
                  )}
                </div>
                {!e.voided && (
                  <div className="flex w-full flex-wrap items-center gap-1 sm:w-auto">
                    <EditExpense
                      action={expenseAction.bind(null, null, e.id)}
                      people={people}
                      mainCurrency={c}
                      fx={fx}
                      today={today}
                      expense={e}
                      orders={openOrders}
                    />
                    <VoidForm action={voidExpenseAction.bind(null, e.orderId, e.id)} label="the expense" />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------- payables */

async function OweTab({ mine }: { mine: boolean }) {
  const rows = await api.get<Payable[]>("/money/payables", { mine: mine ? "true" : undefined });
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.currency, (totals.get(r.currency) ?? 0) + Number(r.toPay));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Which factories"
          options={[
            { href: "/money?tab=owe", label: "All factories", active: !mine },
            { href: "/money?tab=owe&mine=1", label: "My factories", active: mine },
          ]}
        />
        <p className="text-sm">
          Still to pay{" "}
          <span className="font-semibold tabular">{[...totals.entries()].map(([cur, v]) => money(v, cur)).join(" + ") || "nothing"}</span>
        </p>
      </div>
      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title="Nothing to pay"
            description={
              mine ? "The factories you look after are paid for every order." : "Every factory is paid for the goods on our orders."
            }
          />
        </Card>
      ) : (
        rows.map((r) => (
          <Card key={`${r.factory.id}:${r.currency}`}>
            <CardHeader
              title={
                <Link href={`/factories/${r.factory.id}`} className="hover:text-primary">
                  {r.factory.name}
                </Link>
              }
              description={`${r.lookedAfterBy ? `Looked after by ${r.lookedAfterBy.name}` : "Nobody looks after it yet"} · paid ${money(r.paid, r.currency)} of ${money(r.owed, r.currency)}`}
              actions={<span className="text-sm font-semibold tabular">{money(r.toPay, r.currency)} to pay</span>}
            />
            <ul className="flex flex-col divide-y divide-line">
              {r.orders.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                  <span className="min-w-0">
                    <Link href={`/orders/${o.id}`} className="font-medium hover:text-primary">
                      {o.refNo}
                    </Link>{" "}
                    <span className="text-text-2">{o.customer}</span>{" "}
                    <span className="text-xs text-muted">· {ORDER_STAGE_LABEL[o.stage as OrderStage]}</span>
                  </span>
                  <span className="tabular">{money(o.toPay, r.currency)}</span>
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}
    </div>
  );
}
