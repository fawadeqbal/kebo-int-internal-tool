import Link from "next/link";
import { Banknote, ChartNoAxesCombined, ChevronLeft, ChevronRight, Landmark, Wallet, X } from "lucide-react";
import {
  can,
  CURRENCIES,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABEL,
  MONEY_ACCOUNT_KIND_LABEL,
  ORDER_STAGE_LABEL,
  type ExpenseCategory,
  type OrderStage,
} from "@kebo/shared";
import {
  Alert,
  Badge,
  buildHref,
  buttonClass,
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
  Pagination,
  toPage,
} from "@kebo/ui";
import { addDays, todayIn } from "@kebo/utils";
import { api } from "@/lib/api";
import { ExportLink } from "@/components/sheets/export-link";
import { hasFeature, requirePermission } from "@/lib/session";
import { redirect } from "next/navigation";
import type { Receivables } from "@/lib/types-insights";
import { date, money } from "@/lib/format";
import type { Person } from "@/lib/types";
import type { CashBook, CashRow, ExpenseList, Payable } from "@/lib/types-money";
import { NewExpense, VoidForm, type ExpenseChoices } from "@/components/money/forms";
import { EditAccount, MoveMoney, NewAccount, PutOnAccount, type AccountRow } from "@/components/money/cash-forms";
import { ExpenseRecord } from "@/components/money/expense-record";
import { expenseAction, voidTransferAction } from "./actions";

export const metadata = { title: "Money" };

const TZ = process.env.APP_TIME_ZONE ?? process.env.NEXT_PUBLIC_APP_TIME_ZONE ?? "Asia/Shanghai";
const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

type Search = {
  tab?: string;
  year?: string;
  view?: string;
  month?: string;
  p?: string;
  kind?: string;
  customer?: string;
  category?: string;
  mine?: string;
  acct?: string;
  cur?: string;
  page?: string;
};

/**
 * The company's money records: the cash book (where the money is), expenses,
 * what customers still owe us, and what we still owe the factories. The
 * numbers and charts are on Insights.
 */
export default async function MoneyPage({ searchParams }: { searchParams: Promise<Search> }) {
  const me = await requirePermission("sourcing.manage");
  const sp = await searchParams;
  const managers = can(me, "expenses.manage");
  const recorders = managers || can(me, "payments.record");
  type Tab = "cash" | "expenses" | "receive" | "owe";
  // The cash book is a plan feature.
  const cashBook = await hasFeature("cash_book");
  const allowed: Tab[] = [...(managers && cashBook ? (["cash"] as const) : []), ...(managers ? (["expenses"] as const) : []), ...(recorders ? (["receive"] as const) : []), "owe"];
  // Old links to profit & loss now open on Insights.
  if (sp.tab === "pnl") redirect("/insights?tab=profit&sub=pnl");
  const tab: Tab = allowed.includes(sp.tab as Tab) ? (sp.tab as Tab) : allowed[0]!;
  const today = todayIn(TZ);
  const label: Record<Tab, string> = { cash: "Cash book", expenses: "Expenses", receive: "To receive", owe: "What we owe factories" };
  const tabs = allowed.map((t) => ({ href: t === allowed[0] ? "/money" : `/money?tab=${t}`, label: label[t], active: tab === t }));
  return (
    <div>
      <PageHeader
        title="Money"
        description={
          managers
            ? "Where the money is, what was spent, what customers owe us and what we owe the factories. Charts and profit are on Insights."
            : "What customers owe us and what we still owe the factories."
        }
        actions={
          can(me, "reports.view") && (await hasFeature("insights")) ? (
            <Link href="/insights?tab=profit" className={buttonClass("secondary", "sm")}>
              <ChartNoAxesCombined aria-hidden /> Profit on Insights
            </Link>
          ) : undefined
        }
      />
      <LinkTabs label="Money sections" className="mb-5" tabs={tabs} />
      {tab === "expenses" && <ExpensesTab sp={sp} today={today} />}
      {tab === "cash" && <CashTab sp={sp} today={today} />}
      {tab === "receive" && <ReceiveTab />}
      {tab === "owe" && <OweTab mine={sp.mine === "1"} />}
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
    api.get<ExpenseList>("/expenses", { from, to, kind, customerId: customer, category, page: String(toPage(sp.page)), pageSize: "50" }),
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
          actions={
            <span className="flex items-center gap-3">
              <span className="text-sm font-semibold tabular">{money(list.total, c)}</span>
              {list.count > 0 && <ExportLink what="expenses" query={{ from, to, kind, customer, category }} />}
            </span>
          }
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
        {list.listed > list.pageSize && (
          <Pagination base="/money" params={{ tab: "expenses", p: sp.p, month: sp.month, kind, customer, category }} page={list.page} pageSize={list.pageSize} total={list.listed} />
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

/* ---------------------------------------------------------------- cash book */

/** A month (YYYY-MM) or a year (YYYY) from ?p=, never after today. */
function periodOf(asked: string | undefined, today: string) {
  const thisMonth = today.slice(0, 7);
  const period = /^\d{4}(-\d{2})?$/.test(asked ?? "") && asked! <= thisMonth ? asked! : thisMonth;
  const isYear = period.length === 4;
  const from = isYear ? `${period}-01-01` : `${period}-01`;
  const to = isYear ? `${period}-12-31` : addDays(`${addDays(`${period}-28`, 4).slice(0, 7)}-01`, -1);
  const prev = isYear ? String(Number(period) - 1) : addDays(from, -1).slice(0, 7);
  const next = isYear ? String(Number(period) + 1) : addDays(`${period}-28`, 4).slice(0, 7);
  const hasNext = isYear ? next <= today.slice(0, 4) : next <= thisMonth;
  const name = isYear ? period : MONTH_YEAR.format(new Date(`${period}-01T00:00:00Z`));
  return { period, isYear, from, to: to > today ? today : to, prev, next, hasNext, name, thisMonth };
}

function PeriodBar({ pr, href, today }: { pr: ReturnType<typeof periodOf>; href: (c: Record<string, string | undefined>) => string; today: string }) {
  const p = (v: string) => (v === pr.thisMonth ? undefined : v);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <nav aria-label="Period" className="inline-flex items-center rounded-lg border border-line bg-surface-2 p-0.5">
        <Link href={href({ p: pr.prev })} className="inline-flex size-7 items-center justify-center rounded-md text-muted hover:text-text" aria-label={`Previous ${pr.isYear ? "year" : "month"}`}>
          <ChevronLeft className="size-4" aria-hidden />
        </Link>
        <span className="min-w-28 px-2 text-center text-sm font-medium">{pr.name}</span>
        {pr.hasNext ? (
          <Link href={href({ p: p(pr.next) })} className="inline-flex size-7 items-center justify-center rounded-md text-muted hover:text-text" aria-label={`Next ${pr.isYear ? "year" : "month"}`}>
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
          { href: href({ p: pr.isYear ? (pr.period === today.slice(0, 4) ? undefined : `${pr.period}-12`) : p(pr.period) }), label: "Month", active: !pr.isYear },
          { href: href({ p: pr.period.slice(0, 4) }), label: "Year", active: pr.isYear },
        ]}
      />
    </div>
  );
}

const KIND_ICON = { cash: Banknote, bank: Landmark, wallet: Wallet } as const;

/**
 * Where our money is (each account and its balance today), and every amount in
 * and out in a month or a year: from customers, to factories, expenses, and
 * moves between our accounts. One account shows its balance line by line, like
 * a bank statement, so the two can be checked against each other.
 */
async function CashTab({ sp, today }: { sp: Search; today: string }) {
  const pr = periodOf(sp.p, today);
  const accounts = await api.get<AccountRow[]>("/money/accounts");
  const acct = sp.acct === "none" || accounts.some((a) => a.id === sp.acct) ? sp.acct : undefined;
  const cur = (CURRENCIES as readonly string[]).includes(sp.cur ?? "") ? sp.cur : undefined;
  const book = await api.get<CashBook>("/money/cash-book", { from: pr.from, to: pr.to, account: acct, currency: acct && acct !== "none" ? undefined : cur });
  const keep = { tab: "cash", p: pr.period === pr.thisMonth ? undefined : pr.period, acct, cur };
  const href = (change: Record<string, string | undefined>) => buildHref("/money", keep, change);
  const one = book.account;
  const open = accounts.filter((a) => !a.archived);
  const byCurrency = new Map<string, number>();
  for (const a of open) byCurrency.set(a.currency, (byCurrency.get(a.currency) ?? 0) + Number(a.balance));
  const kindOf = (k: CashRow["kind"]) => (k === "in" ? "From a customer" : k === "factory" ? "To a factory" : k === "expense" ? "Expense" : "Between our accounts");

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader
          title="Our accounts"
          description={
            open.length
              ? `Balance today: ${[...byCurrency.entries()].map(([c, v]) => money(v, c)).join(" · ")}`
              : "Add the office cash box, each bank account and wallet, with what is in it today."
          }
          actions={<div className="flex flex-wrap justify-end gap-2"><MoveMoney accounts={accounts} today={today} /></div>}
        />
        <CardBody className="flex flex-col gap-3">
          {accounts.length > 0 && (
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {accounts.map((a) => {
                const Icon = KIND_ICON[a.kind];
                return (
                  <li key={a.id} className={cn("flex items-start justify-between gap-2 rounded-lg border p-3", acct === a.id ? "border-primary ring-1 ring-primary/30" : "border-line", a.archived && "opacity-60")}>
                    <Link href={href({ acct: acct === a.id ? undefined : a.id, cur: undefined })} className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-sm font-medium">
                        <Icon className="size-4 shrink-0 text-muted" aria-hidden />
                        <span className="truncate">{a.name}</span>
                        {a.archived && <Badge tone="neutral">Closed</Badge>}
                      </span>
                      <span className={cn("mt-1 block text-lg font-semibold tabular", Number(a.balance) < 0 && "text-bad")}>{money(a.balance, a.currency)}</span>
                      <span className="text-xs text-muted">
                        {MONEY_ACCOUNT_KIND_LABEL[a.kind]} · from {date(a.openingOn)}
                      </span>
                    </Link>
                    <EditAccount account={a} today={today} />
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <NewAccount today={today} />
          </div>
        </CardBody>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <PeriodBar pr={pr} href={href} today={today} />
        {!one && acct !== "none" && (
          <Segmented
            label="Currency"
            options={[
              { href: href({ cur: undefined }), label: "All", active: !cur },
              ...CURRENCIES.map((c) => ({ href: href({ cur: c }), label: c, active: cur === c })),
            ]}
          />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <FilterChip href={href({ acct: undefined })} active={!acct}>
          Every account
        </FilterChip>
        {open.map((a) => (
          <FilterChip key={a.id} href={href({ acct: a.id, cur: undefined })} active={acct === a.id}>
            {a.name}
          </FilterChip>
        ))}
        <FilterChip href={href({ acct: "none", cur: undefined })} active={acct === "none"}>
          Not on an account{book.unassigned > 0 && acct !== "none" ? ` (${book.unassigned})` : ""}
        </FilterChip>
      </div>
      {acct !== "none" && book.unassigned > 0 && (
        <Alert tone="warning">
          {book.unassigned} {one ? `${one.currency} ` : ""}amount{book.unassigned === 1 ? " is" : "s are"} not on an account in {pr.name}, so the balances leave{" "}
          {book.unassigned === 1 ? "it" : "them"} out.{" "}
          <Link href={href({ acct: "none", cur: undefined })} className="font-medium underline">
            Put {book.unassigned === 1 ? "it" : "them"} on an account
          </Link>
        </Alert>
      )}

      {one ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {pr.from >= one.openingOn ? (
            <Tile label={`On ${date(pr.from)}`} value={money(book.opening ?? "0", one.currency)} hint="Balance before the period" />
          ) : (
            <Tile label={`Opened ${date(one.openingOn)}`} value={money(book.opening ?? "0", one.currency)} hint="Balance it started with" />
          )}
          <Tile label="In" value={money(book.totals[0]?.in ?? "0", one.currency)} hint="Customers and moves in" />
          <Tile label="Out" value={money(book.totals[0]?.out ?? "0", one.currency)} hint="Factories, expenses, moves out" />
          <Tile label={`On ${date(pr.to)}`} value={money(book.closing ?? "0", one.currency)} hint="Check it against the statement" />
        </div>
      ) : (
        book.totals.length > 0 && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {book.totals
              .filter((t) => Number(t.in) !== 0 || Number(t.out) !== 0)
              .map((t) => (
              <Tile key={t.currency} label={`${t.currency} in ${pr.name}`} value={money(t.net, t.currency)} hint={`In ${money(t.in, t.currency)} · out ${money(t.out, t.currency)}`} />
            ))}
          </div>
        )
      )}

      <Card className="overflow-hidden">
        <CardHeader
          title={one ? one.name : acct === "none" ? "Not on an account" : "Cash book"}
          description={
            one
              ? "Like a bank statement: the balance after each line."
              : acct === "none"
                ? "Choose the account each amount went through, so the balances match the bank and the cash box."
                : "Money in from customers and out to factories and expenses. Moves between our accounts are shown but not counted."
          }
          actions={book.rows.length > 0 ? <ExportLink what="cash-book" query={{ from: pr.from, to: pr.to, account: acct, currency: acct && acct !== "none" ? undefined : cur }} /> : undefined}
        />
        {book.rows.length === 0 ? (
          <EmptyState title={`Nothing in ${pr.name}`} description="Money recorded on orders and expenses shows here by its date." />
        ) : (
          <>
          {/* Phone: one line per amount. */}
          <ul className="flex flex-col divide-y divide-line sm:hidden" aria-label="Cash book">
            {book.rows.map((r) => {
              const n = Number(r.amount);
              return (
                <li key={r.key} className={cn("flex flex-col gap-1 px-4 py-2.5 text-sm", r.voided && "text-muted line-through")}>
                  <span className="flex items-start justify-between gap-3">
                    {r.href ? (
                      <Link href={r.href} className="min-w-0 font-medium hover:text-primary">
                        {r.what}
                      </Link>
                    ) : (
                      <span className="min-w-0 font-medium">{r.what}</span>
                    )}
                    <span className={cn("shrink-0 font-medium tabular", n > 0 && r.kind === "in" && "text-ok")}>
                      {n > 0 ? "+ " : "− "}
                      {money(Math.abs(n), r.currency)}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted">
                    <span>
                      {date(r.on)} · {kindOf(r.kind)}
                      {r.party && ` · ${r.party.name}`}
                      {!one && r.account && ` · ${r.account.name}`}
                    </span>
                    {one && r.balance && <span className="tabular">Balance {money(r.balance, r.currency)}</span>}
                  </span>
                  {!one && !r.account && (r.kind === "in" || r.kind === "factory" || r.kind === "expense") && (
                    <PutOnAccount kind={r.kind} id={r.id} currency={r.currency} accounts={accounts} />
                  )}
                </li>
              );
            })}
          </ul>
          <div className="hidden overflow-x-auto sm:block">
            <Table>
              <THead>
                <tr>
                  <Th>Date</Th>
                  <Th>What</Th>
                  {!one && <Th>Account</Th>}
                  <Th className="text-right">In</Th>
                  <Th className="text-right">Out</Th>
                  {one && <Th className="text-right">Balance</Th>}
                </tr>
              </THead>
              <tbody>
                {book.rows.map((r) => {
                  const n = Number(r.amount);
                  const isMove = r.kind === "transfer_in" || r.kind === "transfer_out";
                  return (
                    <Tr key={r.key} className={cn("align-top", r.voided && "text-muted line-through")}>
                      <Td className="text-sm whitespace-nowrap">{date(r.on)}</Td>
                      <Td className="min-w-56">
                        {r.href ? (
                          <Link href={r.href} className="text-sm font-medium hover:text-primary">
                            {r.what}
                          </Link>
                        ) : (
                          <span className="text-sm font-medium">{r.what}</span>
                        )}
                        <span className="block text-xs text-muted">
                          {kindOf(r.kind)}
                          {r.party && (
                            <>
                              {" · "}
                              {r.party.href ? (
                                <Link href={r.party.href} className="hover:text-primary">
                                  {r.party.name}
                                </Link>
                              ) : (
                                r.party.name
                              )}
                            </>
                          )}
                          {r.reference && ` · ${r.reference}`}
                        </span>
                      </Td>
                      {!one && (
                        <Td className="text-sm">
                          {r.account ? (
                            r.account.name
                          ) : r.kind === "in" || r.kind === "factory" || r.kind === "expense" ? (
                            <PutOnAccount kind={r.kind} id={r.id} currency={r.currency} accounts={accounts} />
                          ) : null}
                        </Td>
                      )}
                      <Td className={cn("text-right whitespace-nowrap tabular", !isMove && n > 0 && "text-ok")}>{n > 0 ? money(n, r.currency) : ""}</Td>
                      <Td className="text-right whitespace-nowrap tabular">{n < 0 ? money(-n, r.currency) : ""}</Td>
                      {one && <Td className={cn("text-right font-medium whitespace-nowrap tabular", r.balance && Number(r.balance) < 0 && "text-bad")}>{r.balance ? money(r.balance, r.currency) : ""}</Td>}
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
          </>
        )}
      </Card>
      {book.rows.some((r) => r.kind === "transfer_out") && (
        <Card>
          <CardHeader title="Moves between our accounts" description="Remove one typed by mistake." />
          <ul className="flex flex-col divide-y divide-line">
            {book.rows
              .filter((r) => r.kind === "transfer_out" && !r.voided)
              .map((r) => (
                <li key={r.key} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                  <span>
                    {date(r.on)} · {r.party?.name} · <span className="tabular">{money(-Number(r.amount), r.currency)}</span>
                  </span>
                  <VoidForm action={voidTransferAction.bind(null, r.id)} label="this move" />
                </li>
              ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- to receive */

/** What customers still owe us, order by order, the most overdue first. */
async function ReceiveTab() {
  const r = await api.get<Receivables>("/money/receivables");
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {r.totals.map((t) => (
          <Tile
            key={t.currency}
            label={`Customers owe us (${t.currency})`}
            value={money(t.due, t.currency)}
            hint={Number(t.overdue) > 0 ? `${money(t.overdue, t.currency)} overdue` : "Nothing overdue"}
          />
        ))}
      </div>
      <Card className="overflow-hidden">
        <CardHeader
          title="To receive"
          description="Open orders with money still due. Overdue first: remind those customers today."
          actions={r.rows.length > 0 ? <ExportLink what="receivables" /> : undefined}
        />
        {r.rows.length === 0 ? (
          <EmptyState title="Nothing to receive" description="Every customer has paid what they owe." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <tr>
                  <Th>Order</Th>
                  <Th>Next</Th>
                  <Th className="text-right">Received</Th>
                  <Th className="text-right">Still due</Th>
                </tr>
              </THead>
              <tbody>
                {r.rows.map((o) => (
                  <Tr key={o.id} className="hover:bg-surface-2/50">
                    <Td>
                      <Link href={`/orders/${o.id}/money`} className="font-medium hover:text-primary">
                        {o.refNo}
                      </Link>
                      <span className="block text-xs text-muted">
                        <Link href={`/customers/${o.customer.id}`} className="hover:text-primary">
                          {o.customer.name}
                        </Link>
                        {o.handledBy && ` · ${o.handledBy.name}`}
                        {o.closed && " · closed"}
                      </span>
                    </Td>
                    <Td className="text-sm">
                      {o.next ? (
                        <>
                          {o.next.label} <span className="tabular">{money(o.next.open, o.currency)}</span>
                          <span className={cn("block text-xs", o.daysLate > 0 ? "font-medium text-bad" : "text-muted")}>
                            {o.daysLate > 0 ? `${o.daysLate} days late` : o.next.dueOn ? `due ${date(o.next.dueOn)}` : "no due date"}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </Td>
                    <Td className="text-right whitespace-nowrap tabular">
                      {money(o.received, o.currency)}
                      <span className="block text-xs text-muted">of {money(o.total, o.currency)}</span>
                    </Td>
                    <Td className={cn("text-right font-semibold whitespace-nowrap tabular", Number(o.overdue) > 0 && "text-bad")}>{money(o.due, o.currency)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
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
        <p className="flex flex-wrap items-center gap-3 text-sm">
          Still to pay{" "}
          <span className="font-semibold tabular">{[...totals.entries()].map(([cur, v]) => money(v, cur)).join(" + ") || "nothing"}</span>
          {rows.length > 0 && <ExportLink what="payables" query={{ mine: mine ? "1" : undefined }} />}
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
