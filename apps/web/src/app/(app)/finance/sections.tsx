import Link from "next/link";
import { Banknote, ChevronLeft, ChevronRight, Landmark, Wallet, X } from "lucide-react";
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
import { Alert, Badge, buildHref, Card, CardBody, CardHeader, cn, EmptyState, FilterChip, Segmented, Table, Td, Th, THead, Tr, Pagination, toPage, StatTile } from "@kebo/ui";
import { addDays } from "@kebo/utils";
import { api } from "@/lib/api";
import { ExportLink } from "@/components/sheets/export-link";
import { hasFeature } from "@/lib/session";
import { PeriodBar, periodOf } from "@/components/common/period";
import type { Receivables } from "@/lib/types-insights";
import { date, money, TZ } from "@/lib/format";
import type { CashBook, CashRow, ExpenseList, OpenInvoices, Payable } from "@/lib/types-money";
import { recordPaymentHref } from "@/components/money/pay-links";
import { NewExpense, VoidForm, type ExpenseChoices } from "@/components/money/forms";
import { EditAccount, MoveMoney, NewAccount, PutOnAccount, type AccountRow } from "@/components/money/cash-forms";
import { ExpenseRecord } from "@/components/money/expense-record";
import { expenseAction, voidTransferAction } from "../money/actions";
import { UUID } from "@/lib/ids";
import { getSettings, getPeople } from "@/lib/loaders";

const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

export type Search = {
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
 * The company's money records, one page each (they were the tabs of Cash & accounts): the cash
 * book (where the money is), expenses, what customers still owe us (Finance) and what we still
 * owe the factories (Purchasing). The numbers and charts are on Profit & loss and Reports.
 */

/** Who may open which: the pages check it, the sidebar hides what they may not. */
export async function moneyAccess(me: Parameters<typeof can>[0]) {
  const managers = can(me, "expenses.manage");
  return {
    managers,
    recorders: managers || can(me, "payments.record"),
    cashBook: managers && (await hasFeature("cash_book")),
    expenses: managers && (await hasFeature("expenses")),
  };
}

/* ---------------------------------------------------------------- expenses */

const percent = (part: string, whole: string) => (Number(whole) > 0 ? Math.round((Number(part) / Number(whole)) * 100) : 0);

/**
 * Every cost in a month or a year: what the company spends to run (rent,
 * salaries, bills) and what is spent on each customer (tickets, hotels,
 * dinners, samples, and their orders' freight and inspection), with totals by
 * kind and by customer. Clicking a kind or a customer narrows the list.
 */
export async function ExpensesBody({ sp, today }: { sp: Search; today: string }) {
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
    getPeople(),
    api.get<ExpenseChoices>("/expenses/targets"),
    getSettings(),
  ]);
  const customers = choices.customers;
  const fx = { main: settings.sales.currency, rates: settings.sales.exchangeRates };
  const c = list.currency;
  const keep = { p: period === thisMonth ? undefined : period, kind, customer, category };
  const href = (change: Record<string, string | undefined>) => buildHref("/finance/expenses", keep, change);
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
        <StatTile label={`Spent in ${periodName}`} value={money(list.total, c)} sub={`${list.count} expense${list.count === 1 ? "" : "s"}`} />
        <StatTile
          label="Running the company"
          value={money(list.company, c)}
          sub="Rent, salaries, bills, office"
          href={kind === "general" ? undefined : href({ kind: "general", customer: undefined })}
        />
        <StatTile
          label="Spent on customers"
          value={money(list.customers, c)}
          sub={`${list.byCustomer.length} customer${list.byCustomer.length === 1 ? "" : "s"}, with their orders`}
          href={kind === "customer" ? undefined : href({ kind: "customer" })}
        />
        <StatTile
          size="sm"
          label="Biggest kind"
          value={biggest ? EXPENSE_CATEGORY_LABEL[biggest.category] : "—"}
          sub={biggest ? `${money(biggest.total, c)} · ${percent(biggest.total, String(kindsTotal))}%` : "Nothing spent yet"}
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
          <Pagination base="/finance/expenses" params={{ p: sp.p, month: sp.month, kind, customer, category }} page={list.page} pageSize={list.pageSize} total={list.listed} />
        )}
      </Card>
    </div>
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

const KIND_ICON = { cash: Banknote, bank: Landmark, wallet: Wallet } as const;

/**
 * Where our money is (each account and its balance today), and every amount in
 * and out in a month or a year: from customers, to factories, expenses, and
 * moves between our accounts. One account shows its balance line by line, like
 * a bank statement, so the two can be checked against each other.
 */
export async function CashBody({ sp, today }: { sp: Search; today: string }) {
  const pr = periodOf(sp.p, today);
  const accounts = await api.get<AccountRow[]>("/money/accounts");
  const acct = sp.acct === "none" || accounts.some((a) => a.id === sp.acct) ? sp.acct : undefined;
  const cur = (CURRENCIES as readonly string[]).includes(sp.cur ?? "") ? sp.cur : undefined;
  const book = await api.get<CashBook>("/money/cash-book", { from: pr.from, to: pr.to, account: acct, currency: acct && acct !== "none" ? undefined : cur });
  const keep = { p: pr.period === pr.thisMonth ? undefined : pr.period, acct, cur };
  const href = (change: Record<string, string | undefined>) => buildHref("/finance/cash-book", keep, change);
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
            <StatTile label={`On ${date(pr.from)}`} value={money(book.opening ?? "0", one.currency)} sub="Balance before the period" />
          ) : (
            <StatTile label={`Opened ${date(one.openingOn)}`} value={money(book.opening ?? "0", one.currency)} sub="Balance it started with" />
          )}
          <StatTile label="In" value={money(book.totals[0]?.in ?? "0", one.currency)} sub="Customers and moves in" />
          <StatTile label="Out" value={money(book.totals[0]?.out ?? "0", one.currency)} sub="Factories, expenses, moves out" />
          <StatTile label={`On ${date(pr.to)}`} value={money(book.closing ?? "0", one.currency)} sub="Check it against the statement" />
        </div>
      ) : (
        book.totals.length > 0 && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {book.totals
              .filter((t) => Number(t.in) !== 0 || Number(t.out) !== 0)
              .map((t) => (
              <StatTile key={t.currency} label={`${t.currency} in ${pr.name}`} value={money(t.net, t.currency)} sub={`In ${money(t.in, t.currency)} · out ${money(t.out, t.currency)}`} />
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
export async function ReceiveBody() {
  const r = await api.get<Receivables>("/money/receivables");
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {r.totals.map((t) => (
          <StatTile
            key={t.currency}
            label={`Customers owe us (${t.currency})`}
            value={money(t.net ?? t.due, t.currency)}
            sub={
              Number(t.credit ?? 0) > 0
                ? `${money(t.credit!, t.currency)} credit taken off${Number(t.overdue) > 0 ? ` · ${money(t.overdue, t.currency)} overdue` : ""}`
                : Number(t.overdue) > 0
                  ? `${money(t.overdue, t.currency)} overdue`
                  : "Nothing overdue"
            }
          />
        ))}
        {(r.held ?? []).map((h) => (
          <StatTile
            key={`held-${h.currency}`}
            label={`Held for customers (${h.currency})`}
            value={money(h.amount, h.currency)}
            sub={`credit · ${h.customers} customer${h.customers === 1 ? "" : "s"}`}
          />
        ))}
      </div>
      <Card className="overflow-hidden">
        <CardHeader
          title="Receivables"
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
                  <Th className="hidden sm:table-cell">How</Th>
                  <Th className="text-right">Received</Th>
                  <Th className="text-right">Still due</Th>
                </tr>
              </THead>
              <tbody>
                {r.rows.map((o) => (
                  <Tr key={o.id} className="hover:bg-surface-2/50">
                    <Td>
                      <Link href={`/orders/${o.id}/payment`} className="-my-1 inline-block py-1 font-medium hover:text-primary">
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
                            {o.daysLate > 0 ? `${o.daysLate} days late` : o.next.dueOn ? `due ${date(o.next.dueOn)}` : (o.next.when ?? "no due date")}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </Td>
                    <Td className="hidden sm:table-cell">{o.how ? <Badge>{o.how}</Badge> : <span className="text-muted">—</span>}</Td>
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

/* ---------------------------------------------------------------- invoice by invoice (Billing) */

/**
 * The open invoices of one side, instalment by instalment (Billing): a customer's with its payment
 * request number, a supplier's with their own number once given. Late first. Each is paid in due order
 * from the order's payments, so this is the same money as the order-by-order view, split by instalment.
 */
export async function InvoicesBody({ side, mine = false }: { side: "receivable" | "payable"; mine?: boolean }) {
  const r = await api.get<OpenInvoices>("/billing/invoices", { side, mine: mine ? "true" : undefined });
  const receivable = side === "receivable";
  const back = receivable ? "/finance/to-receive" : "/purchasing/to-pay";
  return (
    <div className="flex flex-col gap-4">
      {r.totals.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {r.totals.map((t) => (
            <StatTile
              key={t.currency}
              label={`${receivable ? "Open customer invoices" : "Open supplier invoices"} (${t.currency})`}
              value={money(t.open, t.currency)}
              sub={`${t.count} invoice${t.count === 1 ? "" : "s"}${Number(t.late) > 0 ? ` · ${money(t.late, t.currency)} late` : " · nothing late"}`}
            />
          ))}
        </div>
      )}
      <Card className="overflow-hidden">
        <CardHeader
          title={receivable ? "Customer invoices" : "Supplier invoices"}
          description={
            receivable
              ? "Each instalment still open, with its payment request number. Late first."
              : "Each part we still owe a supplier, with their invoice number once they send one. Late first."
          }
        />
        {r.rows.length === 0 ? (
          <EmptyState
            title={receivable ? "Nothing to receive" : "Nothing to pay"}
            description={receivable ? "Every customer has paid what they owe." : "Every supplier is paid for the goods on our orders."}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <tr>
                  <Th>Invoice</Th>
                  <Th>{receivable ? "Customer" : "Supplier"}</Th>
                  <Th>Due</Th>
                  <Th className="text-right">Paid</Th>
                  <Th className="text-right">Open</Th>
                  <Th>
                    <span className="sr-only">Record payment</span>
                  </Th>
                </tr>
              </THead>
              <tbody>
                {r.rows.map((i, n) => (
                  <Tr key={i.id ?? `${i.order.id}-${n}`} className="hover:bg-surface-2/50">
                    <Td>
                      <span className="block font-medium">{i.number ?? <span className="text-muted">No number yet</span>}</span>
                      <span className="block text-xs text-muted">
                        {i.label} ·{" "}
                        <Link href={`/orders/${i.order.id}/${receivable ? "payment" : "money"}`} className="hover:text-primary">
                          {i.order.refNo}
                        </Link>
                      </span>
                    </Td>
                    <Td>
                      <Link href={`/${receivable ? "customers" : "factories"}/${i.party.id}`} className="hover:text-primary">
                        {i.party.name}
                      </Link>
                      {i.lookedAfterBy && <span className="block text-xs text-muted">{i.lookedAfterBy.name}</span>}
                    </Td>
                    <Td className="text-sm whitespace-nowrap">
                      {i.dueOn ? date(i.dueOn) : <span className="text-muted">No date yet</span>}
                      {i.late > 0 ? (
                        <span className="block text-xs font-medium text-bad">{i.late} days late</span>
                      ) : i.soon ? (
                        <span className="block text-xs text-warn">Due soon</span>
                      ) : null}
                    </Td>
                    <Td className="text-right whitespace-nowrap tabular">
                      {money(i.paid, i.currency)}
                      <span className="block text-xs text-muted">of {money(i.amount, i.currency)}</span>
                    </Td>
                    <Td className={cn("text-right font-semibold whitespace-nowrap tabular", i.late > 0 && "text-bad")}>{money(i.open, i.currency)}</Td>
                    <Td className="text-right">
                      <Link
                        href={recordPaymentHref(
                          receivable
                            ? { kind: "in", order: i.order.id, amount: i.open, back }
                            : { kind: "out", order: i.order.id, factory: i.party.id, amount: i.open, back },
                        )}
                        className="text-sm font-medium whitespace-nowrap text-primary hover:underline"
                      >
                        Record payment
                      </Link>
                    </Td>
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

export async function OweBody({ mine }: { mine: boolean }) {
  const rows = await api.get<Payable[]>("/money/payables", { mine: mine ? "true" : undefined });
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.currency, (totals.get(r.currency) ?? 0) + Number(r.toPay));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Which factories"
          options={[
            { href: "/purchasing/to-pay?view=factories", label: "All factories", active: !mine },
            { href: "/purchasing/to-pay?view=factories&mine=1", label: "My factories", active: mine },
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
                    <Link href={`/orders/${o.id}`} className="-my-1 inline-block py-1 font-medium hover:text-primary">
                      {o.refNo}
                    </Link>{" "}
                    <span className="text-text-2">{o.customer}</span>{" "}
                    <span className="text-xs text-muted">· {ORDER_STAGE_LABEL[o.stage as OrderStage]}</span>
                    {o.next && (
                      <span className={cn("block text-xs", o.next.status === "late" ? "font-medium text-bad" : "text-muted")}>
                        Next: {o.next.label} {money(o.next.open, r.currency)}
                        {o.next.due ? ` · ${o.next.status === "late" ? "late since" : "due"} ${date(o.next.due)}` : " · when the ready date is known"}
                      </span>
                    )}
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

export { TZ };
