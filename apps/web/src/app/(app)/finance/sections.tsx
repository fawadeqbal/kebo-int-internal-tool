import Link from "next/link";
import { Banknote, Landmark, Wallet } from "lucide-react";
import { can, CURRENCIES, MONEY_ACCOUNT_KIND_LABEL } from "@kebo/shared";
import { Alert, Badge, buildHref, Card, CardBody, CardHeader, cn, EmptyState, FilterChip, Segmented, Table, Td, Th, THead, Tr, StatRow, StatTile } from "@kebo/ui";
import { convertAmount } from "@kebo/money";
import { addDays } from "@kebo/utils";
import { api } from "@/lib/api";
import { ExportLink } from "@/components/sheets/export-link";
import { hasFeature } from "@/lib/session";
import { PeriodBar, periodOf } from "@/components/common/period";
import { date, money, TZ, whole } from "@/lib/format";
import type { CashBook, CashRow } from "@/lib/types-money";
import { VoidForm } from "@/components/money/forms";
import { EditAccount, MoveMoney, NewAccount, PutOnAccount, type AccountRow } from "@/components/money/cash-forms";
import { voidTransferAction } from "../money/actions";
import { getSettings } from "@/lib/loaders";

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

/* ---------------------------------------------------------------- cash book */

const KIND_ICON = { cash: Banknote, bank: Landmark, wallet: Wallet } as const;

/**
 * The vault at a glance (board Vault): all money at today's rates, each currency, the rates; a card per
 * account (click one for its statement); the latest moves of the first (or chosen) account.
 */
export async function VaultOverview({ today }: { today: string }) {
  const [accounts, settings] = await Promise.all([api.get<AccountRow[]>("/money/accounts"), getSettings()]);
  const open = accounts.filter((a) => !a.archived);
  const main = settings.sales.currency;
  const rates = settings.sales.exchangeRates as Record<string, number>;
  const byCurrency = new Map<string, number>();
  for (const a of open) byCurrency.set(a.currency, (byCurrency.get(a.currency) ?? 0) + Number(a.balance));
  let all = 0;
  let missing = false;
  for (const [c, v] of byCurrency) {
    const x = convertAmount(v, c, main, main, rates);
    if (x === null) missing = true;
    else all += x;
  }
  const first = open[0];
  const book = first ? await api.get<CashBook>("/money/cash-book", { from: addDays(today, -90), to: today, account: first.id }) : null;
  const latest = (book?.rows ?? []).slice(-6).reverse();
  return (
    <div className="flex flex-col gap-4">
      <StatRow>
        <StatTile icon={Landmark} iconColor={1} label="All money" value={`≈ ${whole(all, main)}`} sub={missing ? "some rates missing" : "at today's rates"} />
        {[...byCurrency.entries()].slice(0, 3).map(([c, v]) => {
          const n = open.filter((x) => x.currency === c).length;
          const eq = c === main ? null : convertAmount(v, c, main, main, rates);
          return (
            <StatTile
              key={c}
              label={c}
              value={v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              sub={`${eq !== null ? `≈ ${whole(eq, main)} · ` : ""}${n} account${n === 1 ? "" : "s"}`}
            />
          );
        })}
      </StatRow>
      {open.length === 0 ? (
        <EmptyState framed title="No accounts yet" description="Add the office cash box, each bank account and wallet, with what is in it today." />
      ) : (
        <Card className="overflow-clip p-0">
          <CardHeader
            title={
              <>
                Accounts <span className="text-xs font-normal text-text-2">· {open.length}</span>
              </>
            }
          />
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <tr>
                  <Th>Account</Th>
                  <Th>Kind</Th>
                  <Th className="text-right">Balance</Th>
                  <Th className="text-right">In {main}</Th>
                  <Th>
                    <span className="sr-only">Statement</span>
                  </Th>
                </tr>
              </THead>
              <tbody>
                {open.map((a) => {
                  const eq = a.currency === main ? Number(a.balance) : convertAmount(Number(a.balance), a.currency, main, main, rates);
                  return (
                    <Tr key={a.id}>
                      <Td>
                        <Link href={`/finance/cash-book?acct=${a.id}`} className="font-semibold hover:text-primary">
                          {a.name}
                        </Link>
                      </Td>
                      <Td className="text-text-2">{MONEY_ACCOUNT_KIND_LABEL[a.kind]}</Td>
                      <Td className={cn("text-right whitespace-nowrap tabular", Number(a.balance) < 0 && "font-semibold text-bad")}>{money(a.balance, a.currency)}</Td>
                      <Td className="text-right whitespace-nowrap tabular">{eq === null ? <span className="text-muted">no rate</span> : eq.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Td>
                      <Td className="text-right">
                        <Link href={`/finance/cash-book?acct=${a.id}`} className="text-[13px] font-medium whitespace-nowrap text-primary hover:underline">
                          Statement
                        </Link>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line-strong font-bold">
                  <td className="px-3.5 py-3" colSpan={3}>
                    Total{missing ? " (without the currencies that have no rate)" : ""}
                  </td>
                  <td className="px-3.5 py-3 text-right tabular">{all.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td />
                </tr>
              </tfoot>
            </Table>
          </div>
        </Card>
      )}
      {first && book && (
        <Card className="p-0">
          <CardHeader
            title={
              <>
                {first.name} <span className="text-xs font-normal text-text-2">· latest moves</span>
              </>
            }
            actions={
              <Link href={`/finance/cash-book?acct=${first.id}`} className="text-sm font-medium text-primary hover:underline">
                Full statement →
              </Link>
            }
          />
          {latest.length === 0 ? (
            <EmptyState title="Nothing in the last 90 days" description="Money recorded on orders and expenses shows here by its date." />
          ) : (
            <Table>
              <THead>
                <tr>
                  <Th>Date</Th>
                  <Th>What</Th>
                  <Th className="text-right">In</Th>
                  <Th className="text-right">Out</Th>
                  <Th className="text-right">Balance</Th>
                </tr>
              </THead>
              <tbody>
                {latest.map((r) => {
                  const n = Number(r.amount);
                  return (
                    <Tr key={r.key} className={r.voided ? "text-muted line-through" : undefined}>
                      <Td className="whitespace-nowrap">{date(r.on)}</Td>
                      <Td>{r.href ? <Link href={r.href} className="hover:text-primary">{r.what}</Link> : r.what}</Td>
                      <Td className="text-right tabular">{n > 0 ? Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2 }) : ""}</Td>
                      <Td className="text-right tabular">{n < 0 ? Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2 }) : ""}</Td>
                      <Td className="text-right tabular">{r.balance ? Number(r.balance).toLocaleString("en-US", { minimumFractionDigits: 2 }) : ""}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      )}
      <p className="text-sm text-text-2">
        <Link href="/finance/cash-book?book=1" className="font-medium text-primary hover:underline">
          The whole cash book
        </Link>{" "}
        · every amount in and out by month, every account, and what is not on an account yet.
      </p>
    </div>
  );
}

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

/* ---------------------------------------------------------------- invoice by invoice (Billing) */

/* ---------------------------------------------------------------- payables */

export { TZ };
