import Link from "next/link";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { can, EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABEL, ORDER_STAGE_LABEL, type ExpenseCategory, type OrderStage } from "@kebo/shared";
import {
  Alert,
  buildHref,
  Card,
  CardBody,
  CardHeader,
  cn,
  EmptyState,
  FilterChip,
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
import { money } from "@/lib/format";
import type { Person } from "@/lib/types";
import type { ExpenseList, Payable, ProfitAndLoss } from "@/lib/types-money";
import { NewExpense, type ExpenseChoices } from "@/components/money/forms";
import { ExpenseRecord } from "@/components/money/expense-record";
import { expenseAction } from "./actions";

export const metadata = { title: "Money" };

const TZ = process.env.APP_TIME_ZONE ?? process.env.NEXT_PUBLIC_APP_TIME_ZONE ?? "Asia/Shanghai";
const MONTH = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" });
const monthName = (ym: string) => MONTH.format(new Date(`${ym}-01T00:00:00Z`));
const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

type Search = { tab?: string; year?: string; view?: string; month?: string; p?: string; kind?: string; customer?: string; category?: string; mine?: string };

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

/* ---------------------------------------------------------------- expenses */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const percent = (part: string, whole: string) => (Number(whole) > 0 ? Math.round((Number(part) / Number(whole)) * 100) : 0);

/**
 * Every cost in a month or a year: what the company spends to run (rent,
 * salaries, bills) and what is spent on each customer (tickets, hotels,
 * dinners, samples, and their orders' freight and inspection), with totals by
 * kind and by customer. Clicking a kind or a customer narrows the list.
 */
async function ExpensesTab({ sp, today }: { sp: Search; today: string }) {
  const thisMonth = today.slice(0, 7);
  const asked = sp.p ?? sp.month ?? "";
  const period = /^\d{4}(-\d{2})?$/.test(asked) && asked <= thisMonth ? asked : thisMonth;
  const isYear = period.length === 4;
  const from = isYear ? `${period}-01-01` : `${period}-01`;
  const to = isYear ? `${period}-12-31` : addDays(`${addDays(`${period}-28`, 4).slice(0, 7)}-01`, -1);
  const prev = isYear ? String(Number(period) - 1) : addDays(from, -1).slice(0, 7);
  const next = isYear ? String(Number(period) + 1) : addDays(`${period}-28`, 4).slice(0, 7);
  const hasNext = isYear ? next <= today.slice(0, 4) : next <= thisMonth;
  const kind = sp.kind === "general" || sp.kind === "customer" ? sp.kind : undefined;
  const customer = UUID.test(sp.customer ?? "") ? sp.customer : undefined;
  const category = (EXPENSE_CATEGORIES as readonly string[]).includes(sp.category ?? "") ? (sp.category as ExpenseCategory) : undefined;

  const [list, people, choices, settings] = await Promise.all([
    api.get<ExpenseList>("/expenses", { from, to, kind, customerId: customer, category }),
    api.get<Person[]>("/users/people"),
    api.get<ExpenseChoices>("/expenses/targets"),
    api.get<{ sales: { currency: string; exchangeRates: Record<string, number> } }>("/settings"),
  ]);
  const customers = choices.customers;
  const fx = { main: settings.sales.currency, rates: settings.sales.exchangeRates };
  const c = list.currency;
  const keep = { tab: "expenses", p: period === thisMonth ? undefined : period, kind, customer, category };
  const href = (change: Record<string, string | undefined>) => buildHref("/money", keep, change);
  const periodName = isYear ? period : MONTH_YEAR.format(new Date(`${period}-01T00:00:00Z`));
  const customerName = customer ? (list.byCustomer.find((x) => x.customer.id === customer)?.customer.name ?? customers.find((x) => x.id === customer)?.name) : undefined;
  const kindsTotal = list.byCategory.reduce((t, k) => t + Number(k.total), 0);
  const customersTotal = list.byCustomer.reduce((t, k) => t + Number(k.total), 0);
  const biggest = list.byCategory[0];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <nav aria-label="Period" className="inline-flex items-center rounded-lg border border-line bg-surface-2 p-0.5">
            <Link href={href({ p: prev })} className="inline-flex size-7 items-center justify-center rounded-md text-muted hover:text-text" aria-label={`Previous ${isYear ? "year" : "month"}`}>
              <ChevronLeft className="size-4" aria-hidden />
            </Link>
            <span className="min-w-28 px-2 text-center text-sm font-medium">{periodName}</span>
            {hasNext ? (
              <Link href={href({ p: next === thisMonth ? undefined : next })} className="inline-flex size-7 items-center justify-center rounded-md text-muted hover:text-text" aria-label={`Next ${isYear ? "year" : "month"}`}>
                <ChevronRight className="size-4" aria-hidden />
              </Link>
            ) : (
              <span className="inline-flex size-7 items-center justify-center text-line-strong" aria-hidden>
                <ChevronRight className="size-4" />
              </span>
            )}
          </nav>
          <Segmented
            label="Show a month or a year"
            options={[
              { href: href({ p: isYear ? (period === today.slice(0, 4) ? undefined : `${period}-12`) : period === thisMonth ? undefined : period }), label: "Month", active: !isYear },
              { href: href({ p: period.slice(0, 4) }), label: "Year", active: isYear },
            ]}
          />
        </div>
        <Segmented
          label="Which expenses"
          options={[
            { href: href({ kind: undefined }), label: "All", active: !kind },
            { href: href({ kind: "general", customer: undefined }), label: "Company", active: kind === "general" },
            { href: href({ kind: "customer" }), label: "On customers", active: kind === "customer" },
          ]}
        />
      </div>

      <NewExpense action={expenseAction.bind(null, null, null)} people={people} mainCurrency={c} fx={fx} today={today} choices={choices} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label={`Spent in ${periodName}`} value={money(list.total, c)} hint={`${list.count} expense${list.count === 1 ? "" : "s"}`} />
        <Tile
          label="Running the company"
          value={money(list.company, c)}
          hint="Rent, salaries, bills, office"
          href={kind === "general" ? undefined : href({ kind: "general", customer: undefined })}
        />
        <Tile
          label="Spent on customers"
          value={money(list.customers, c)}
          hint={`${list.byCustomer.length} customer${list.byCustomer.length === 1 ? "" : "s"}, with their orders`}
          href={kind === "customer" ? undefined : href({ kind: "customer" })}
        />
        <Tile
          small
          label="Biggest kind"
          value={biggest ? EXPENSE_CATEGORY_LABEL[biggest.category] : "—"}
          hint={biggest ? `${money(biggest.total, c)} · ${percent(biggest.total, String(kindsTotal))}%` : "Nothing spent yet"}
          href={biggest && category !== biggest.category ? href({ category: biggest.category }) : undefined}
        />
      </div>

      {(customer || category) && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Showing only</span>
          {customerName && (
            <FilterChip href={href({ customer: undefined })} active>
              {customerName} <X className="size-3" aria-label="Show every customer" />
            </FilterChip>
          )}
          {category && (
            <FilterChip href={href({ category: undefined })} active>
              {EXPENSE_CATEGORY_LABEL[category]} <X className="size-3" aria-label="Show every kind" />
            </FilterChip>
          )}
          {customer && (
            <Link href={`/customers/${customer}`} className="text-xs text-primary hover:underline">
              Open the customer
            </Link>
          )}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="By kind" description={customerName ? `Spent on ${customerName}` : "Click a kind to see only those"} />
          {list.byCategory.length === 0 ? (
            <CardBody>
              <p className="text-sm text-muted">Nothing spent in {periodName}.</p>
            </CardBody>
          ) : (
            <ul className="flex flex-col p-2">
              {list.byCategory.map((k) => (
                <BarRow
                  key={k.category}
                  href={href({ category: category === k.category ? undefined : k.category })}
                  active={category === k.category}
                  label={EXPENSE_CATEGORY_LABEL[k.category]}
                  sub={`${k.count} expense${k.count === 1 ? "" : "s"}`}
                  amount={money(k.total, c)}
                  share={percent(k.total, String(kindsTotal))}
                />
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="By customer" description={category ? `${EXPENSE_CATEGORY_LABEL[category]} only` : "Everything spent on each customer, with their orders"} />
          {list.byCustomer.length === 0 ? (
            <CardBody>
              <p className="text-sm text-muted">{kind === "general" ? "Company costs are not on a customer." : `Nothing spent on a customer in ${periodName}.`}</p>
            </CardBody>
          ) : (
            <ul className="flex flex-col p-2">
              {list.byCustomer.slice(0, 10).map((x) => (
                <BarRow
                  key={x.customer.id}
                  href={href({ customer: customer === x.customer.id ? undefined : x.customer.id, kind: kind === "general" ? undefined : kind })}
                  active={customer === x.customer.id}
                  label={x.customer.name}
                  sub={`${x.count} expense${x.count === 1 ? "" : "s"}${x.orders ? ` · ${x.orders} order${x.orders === 1 ? "" : "s"}` : ""}`}
                  amount={money(x.total, c)}
                  share={percent(x.total, String(customersTotal))}
                />
              ))}
              {list.byCustomer.length > 10 && <li className="px-2 py-1.5 text-xs text-muted">and {list.byCustomer.length - 10} more</li>}
            </ul>
          )}
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader
          title="Expenses"
          description={`${list.count} in ${periodName}${customerName ? ` for ${customerName}` : ""}${category ? ` · ${EXPENSE_CATEGORY_LABEL[category]}` : ""}. Click one for its details and receipt.`}
          actions={<span className="text-sm font-semibold tabular">{money(list.total, c)}</span>}
        />
        {list.rows.length === 0 ? (
          <EmptyState
            title={`No expenses in ${periodName}`}
            description="Add tickets, hotels, dinners and samples on the customer they were for, and rent, salaries and bills on the company."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-line" aria-label="Expenses">
            {list.rows.map((e) => (
              <ExpenseRecord key={e.id} e={e} mainCurrency={c} people={people} fx={fx} today={today} choices={choices} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** A total at the top of Expenses; two across on a phone. Links narrow the list. */
function Tile({ label, value, hint, href, small }: { label: string; value: string; hint: string; href?: string; small?: boolean }) {
  const body = (
    <div className={cn("h-full rounded-xl border border-line bg-surface p-3 transition-colors sm:p-4", href && "hover:border-line-strong")}>
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={cn("mt-1 truncate font-semibold tabular", small ? "text-base sm:text-lg" : "text-lg sm:text-2xl")} title={value}>
        {value}
      </p>
      <p className="mt-0.5 text-xs text-muted">{hint}</p>
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

/** A line with a share bar, that filters the list when clicked. */
function BarRow({ href, active, label, sub, amount, share }: { href: string; active: boolean; label: string; sub: string; amount: string; share: number }) {
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? "true" : undefined}
        className={cn("flex flex-col gap-1.5 rounded-lg px-2 py-2 transition-colors hover:bg-surface-2/70", active && "bg-primary-soft hover:bg-primary-soft")}
      >
        <span className="flex items-baseline justify-between gap-3 text-sm">
          <span className="min-w-0 truncate">
            <span className="font-medium">{label}</span> <span className="text-xs text-muted">{sub}</span>
          </span>
          <span className="shrink-0 tabular">
            {amount} <span className="text-xs text-muted">{share}%</span>
          </span>
        </span>
        <span className="h-1.5 rounded-full bg-surface-2" aria-hidden>
          <span className="block h-1.5 rounded-full bg-primary" style={{ width: `${Math.max(share, 1)}%` }} />
        </span>
      </Link>
    </li>
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
