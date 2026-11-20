import Link from "next/link";
import { PhoneList, PhoneRow, buildHref, Card, cn, DataRow, EmptyState, LinkTabs, PAGE_SIZE, Pager, Table, Td, Th, THead, toPage, Tr, Notice } from "@kebo/ui";
import { ArrowRight } from "lucide-react";
import { FilterCard } from "@/components/common/filter-card";
import { PageHeader } from "@kebo/ui";
import { api } from "@/lib/api";
import { requirePermission } from "@/lib/session";
import { money, companyToday } from "@/lib/format";
import { ExportCsv } from "@/components/sheets/export-link";
import { DataTable } from "@/components/common/data-table";
import { EntryPanel } from "@/components/ledger/entry-panel";
import { EntryBody } from "@/components/ledger/entry-body";
import { AgeingTiles, amount, entryCells, LedgerFilters, partyHref, periodOf } from "@/components/ledger/ledger-parts";
import type { LedgerAccounts, LedgerAgeing, LedgerEntries, LedgerEntry } from "@/lib/types-ledger";
import type { OrderRow } from "@/lib/types-orders";

export const metadata = { title: "Ledger" };

type Search = {
  view?: string;
  who?: string;
  q?: string;
  has?: string;
  period?: string;
  from?: string;
  to?: string;
  type?: string;
  cur?: string;
  removed?: string;
  account?: string;
  order?: string;
  page?: string;
  panel?: string;
  id?: string;
};

const VIEWS = [
  { key: "balances", label: "Balances" },
  { key: "all", label: "All entries" },
  { key: "accounts", label: "By account" },
  { key: "customers", label: "Customers" },
  { key: "factories", label: "Suppliers" },
  { key: "staff", label: "Staff" },
  { key: "orders", label: "Orders" },
] as const;
type View = (typeof VIEWS)[number]["key"];

const PATH = "/finance/ledger";

/**
 * Finance › Ledger (approved page 34): every money record, posted from its document. Views over the same rows:
 * All entries · By account · Customers · Factories · Staff · Orders. A click on a row opens the entry in the side
 * panel (both sides, what it settles, the document). Nothing here is typed: change the document, the ledger follows.
 */
export default async function LedgerPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requirePermission("ledger.view");
  const sp = await searchParams;
  const today = companyToday();
  // Balances first (board General ledger); a link into the entries (an account, an order, a period) opens them.
  const entriesAsked = !!(sp.account || sp.order || sp.type || sp.period || sp.from || sp.cur || sp.removed || sp.page);
  const view: View = VIEWS.some((v) => v.key === sp.view) ? (sp.view as View) : entriesAsked ? "all" : "balances";
  const period = periodOf(sp, today);
  const all = sp as Record<string, string | undefined>;
  const entry =
    sp.panel === "entry" && sp.id && /^[0-9a-f-]{36}$/i.test(sp.id)
      ? await api.get<LedgerEntry>(`/ledger/entries/${sp.id}`).catch(() => null)
      : null;
  const main = (await api.get<LedgerAccounts>("/ledger/accounts")).mainCurrency;

  return (
    <div>
      <PageHeader
        kind="list"
        crumbs={[{ label: "Money" }, { label: "Ledger" }]}
        title="Ledger"
        more={
          view === "all" ? (
            <ExportCsv
              what="ledger"
              query={{
                from: period.from,
                to: period.to,
                type: sp.type,
                cur: sp.cur,
                removed: sp.removed,
                account: sp.account,
                order: sp.order,
              }}
            />
          ) : undefined
        }
      />
      <LinkTabs
        label="Ledger views"
        className="mb-4"
        tabs={VIEWS.map((v) => ({
          href: buildHref(PATH, {}, { view: v.key === "balances" ? undefined : v.key, period: sp.period, from: sp.from, to: sp.to }),
          label: v.label,
          active: v.key === view,
        }))}
      />
      {view === "balances" ? (
        <Balances sp={sp} />
      ) : view === "all" || view === "orders" ? (
        <Entries sp={sp} all={all} view={view} period={period} today={today} main={main} />
      ) : view === "accounts" ? (
        <Accounts period={period} />
      ) : (
        <Parties side={view === "customers" ? "receivable" : view === "factories" ? "payable" : "staff"} />
      )}
      {entry && (
        <EntryPanel
          title={`${entry.ref || `Entry ${entry.entryNo}`} · ${entry.typeLabel}`}
          description={`posted ${entry.date} from ${entry.source.label || "its document"}${entry.source.approvedBy ? ` · approved by ${entry.source.approvedBy}` : ""}`}
        >
          <EntryBody e={entry} main={main} back={buildHref(PATH, all, { panel: undefined, id: undefined })} />
        </EntryPanel>
      )}
    </div>
  );
}

/** All entries (or one order's): one line per posting side, newest first, with the totals of the filtered rows. */
async function Entries({
  sp,
  all,
  view,
  period,
  today,
  main,
}: {
  sp: Search;
  all: Record<string, string | undefined>;
  view: View;
  period: ReturnType<typeof periodOf>;
  today: string;
  main: string;
}) {
  const page = toPage(sp.page);
  const order = view === "orders" && sp.order && /^[0-9a-f-]{36}$/i.test(sp.order) ? sp.order : undefined;
  if (view === "orders" && !order) return <OrderPicker />;
  const data = await api.get<LedgerEntries>("/ledger/entries", {
    from: order ? undefined : period.from,
    to: order ? undefined : period.to,
    type: sp.type,
    currency: sp.cur,
    removed: sp.removed === "0" ? "false" : undefined,
    account: sp.account,
    orderId: order,
    lead: "true",
    page: String(page),
    pageSize: String(PAGE_SIZE),
  });
  const keep = { view: view === "all" ? undefined : view, order, account: sp.account };
  const open = (groupId: string) => buildHref(PATH, all, { panel: "entry", id: groupId });
  return (
    <>
      <LedgerFilters path={PATH} sp={all} period={period} keep={keep} />
      {sp.account && (
        <Notice tone="info" className="mb-3">
          One account:{" "}
          <strong className="font-semibold">{data.rows[0]?.account === sp.account ? data.rows[0]?.accountLabel : sp.account}</strong>.{" "}
          <Link href={buildHref(PATH, all, { account: undefined, page: undefined })} className="font-medium underline">
            Show every account
          </Link>
        </Notice>
      )}
      <Card className="overflow-clip p-0">
        {data.rows.length === 0 ? (
          <EmptyState
            framed
            title="No entries in this period"
            description="Try a longer period, another type or currency, or show removed entries."
          />
        ) : (
          <DataTable label="Ledger entries">
            <THead>
              <tr>
                <Th>Day</Th>
                <Th>Type</Th>
                <Th>Reference</Th>
                <Th>With</Th>
                <Th>Order</Th>
                <Th>Debit → credit</Th>
                <Th className="text-right">{main}</Th>
                <Th>As recorded</Th>
              </tr>
            </THead>
            <tbody>
              {data.rows.map((r) => {
                const c = entryCells(r, main, today, open(r.groupId));
                return (
                  <DataRow key={r.id} href={open(r.groupId)}>
                    <Td className="whitespace-nowrap tabular">{c.day}</Td>
                    <Td>{c.type}</Td>
                    <Td className="whitespace-nowrap">{c.ref}</Td>
                    <Td>{c.with}</Td>
                    <Td className="whitespace-nowrap">{c.order}</Td>
                    <Td className="min-w-48">{c.what}</Td>
                    <Td className="text-right whitespace-nowrap tabular">{c.base}</Td>
                    <Td className="whitespace-nowrap">{c.recorded}</Td>
                  </DataRow>
                );
              })}
            </tbody>
          </DataTable>
        )}
      </Card>
      <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-1 px-1 py-3 text-sm">
        <span className="text-text-2">
          {data.totals.entries} {data.totals.entries === 1 ? "entry" : "entries"} ·{" "}
          {data.totals.balanced ? "every debit has its credit" : "debits and credits differ"}
        </span>
        <b className="font-semibold tabular">Debits {money(data.totals.debit, main)}</b>
        <b className="font-semibold tabular">Credits {money(data.totals.credit, main)}</b>
      </div>
      <Pager base={PATH} params={{ ...all, panel: undefined, id: undefined }} page={page} total={data.total} pageSize={data.pageSize} bare />
    </>
  );
}

/** Orders: pick one to see exactly its rows (the order, its factories' parts, money in and out, its expenses). */
async function OrderPicker() {
  const orders = await api.get<OrderRow[]>("/orders").catch(() => [] as OrderRow[]);
  return (
    <Card className="overflow-clip p-0">
      {orders.length === 0 ? (
        <EmptyState framed title="No orders yet" description="An order's rows appear here once a customer accepts a quotation." />
      ) : (
        <DataTable label="Orders">
          <THead>
            <tr>
              <Th>Order</Th>
              <Th>Customer</Th>
              <Th className="text-right">Total</Th>
            </tr>
          </THead>
          <tbody>
            {orders.slice(0, 100).map((o) => (
              <DataRow key={o.id} href={buildHref(PATH, {}, { view: "orders", order: o.id })}>
                <Td>
                  <Link href={buildHref(PATH, {}, { view: "orders", order: o.id })} className="font-medium tabular hover:text-primary">
                    {o.refNo}
                  </Link>
                </Td>
                <Td>{o.customer?.name ?? "—"}</Td>
                <Td className="text-right tabular">{o.total && o.currency ? money(o.total, o.currency) : "—"}</Td>
              </DataRow>
            ))}
          </tbody>
        </DataTable>
      )}
    </Card>
  );
}

type BalanceRow = { account: string; kind: "customer" | "supplier" | "account" | "person"; id: string | null; label: string; currency: string; in: string; out: string; balance: string };
const WHO = [
  { key: "all", label: "All" },
  { key: "customer", label: "Customers" },
  { key: "supplier", label: "Suppliers" },
  { key: "account", label: "Bank accounts" },
  { key: "person", label: "People" },
] as const;

/** Balances (board General ledger): who, currency, charged / in, paid / out, balance, and their statement. */
async function Balances({ sp }: { sp: Search }) {
  const rows = await api.get<BalanceRow[]>("/ledger/balances");
  const who = WHO.some((w) => w.key === sp.who) ? sp.who! : "all";
  const q = sp.q?.trim().toLowerCase() ?? "";
  const currencies = [...new Set(rows.map((r) => r.currency))].sort();
  const all = sp.has === "all";
  const shown = rows
    .filter((r) => who === "all" || r.kind === who)
    .filter((r) => !q || r.label.toLowerCase().includes(q))
    .filter((r) => !sp.cur || r.currency === sp.cur)
    .filter((r) => all || Math.abs(Number(r.balance)) >= 0.005)
    .sort((a, b) => Math.abs(Number(b.balance)) - Math.abs(Number(a.balance)));
  const statement = (r: BalanceRow) =>
    !r.id ? null : r.kind === "account" ? `/finance/cash-book?acct=${r.id}` : partyHref(r.kind === "customer" ? "customer" : r.kind === "supplier" ? "factory" : "staff", r.id);
  const fmt = (v: string) => Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <div className="flex flex-col gap-4">
      <div>
        <FilterCard
          search="Search…"
          value={sp.q}
          clearHref={buildHref(PATH, { cur: sp.cur, has: sp.has }, {})}
          selects={[
            // Whose balances: a filter like the others (one row of tabs on the page: the ledger's views).
            { name: "who", label: "Who", value: who === "all" ? undefined : who, options: WHO.filter((w) => w.key !== "all").map((w) => ({ value: w.key, label: w.label })) },
            { name: "cur", label: "Currency", value: sp.cur, options: currencies.map((c) => ({ value: c, label: c })) },
            { name: "has", label: "Has balance", value: sp.has, options: [{ value: "all", label: "Any" }], all: "Yes", showDefault: true },
          ]}
        />
        <Card className="overflow-x-auto p-0">
          {shown.length === 0 ? (
            <EmptyState title="Nothing here" description="Balances appear when money is recorded: orders, payments, expenses, transfers." />
          ) : (
            <>
            {/* A phone: one row each — who, what they are, the balance (the statement opens from the row). */}
            <PhoneList label="Balances">
              {shown.map((r) => (
                <PhoneRow
                  key={`${r.account}:${r.currency}`}
                  href={statement(r) ?? undefined}
                  title={r.label}
                  line={`${r.kind === "person" ? "person · own money" : r.kind} · ${r.currency}`}
                  figure={<span className={cn(Number(r.balance) < 0 && "text-bad")}>{fmt(r.balance)}</span>}
                />
              ))}
            </PhoneList>
            <div className="max-sm:hidden">
            <Table>
              <THead>
                <tr>
                  <Th>Who</Th>
                  <Th>Currency</Th>
                  <Th className="text-right">Charged / in</Th>
                  <Th className="text-right">Paid / out</Th>
                  <Th className="text-right">Balance</Th>
                  <Th>
                    <span className="sr-only">Statement</span>
                  </Th>
                </tr>
              </THead>
              <tbody>
                {shown.map((r) => {
                  const href = statement(r);
                  return (
                    <Tr key={`${r.account}:${r.currency}`} href={href ?? undefined}>
                      <Td>
                        <span className="block font-semibold">{r.label}</span>
                        <span className="block text-xs text-text-2">{r.kind === "person" ? "person · own money" : r.kind}</span>
                      </Td>
                      <Td>{r.currency}</Td>
                      <Td className="text-right tabular">{fmt(r.in)}</Td>
                      <Td className="text-right tabular">{fmt(r.out)}</Td>
                      <Td className={cn("text-right font-semibold tabular", Number(r.balance) < 0 && "text-bad")}>{fmt(r.balance)}</Td>
                      <Td className="text-right">
                        {href && (
                          <Link href={href} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                            <ArrowRight className="size-4" aria-hidden /> Statement
                          </Link>
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
            </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

/** By account: every account's balance (as the cash book, the customers', the factories'…), and debits equal credits. */
async function Accounts({ period }: { period: { to: string } }) {
  const a = await api.get<LedgerAccounts>("/ledger/accounts", { to: period.to });
  return (
    <div className="flex flex-col gap-4">
      {a.check && a.check.differences > 0 && (
        <Notice tone="todo">
          The last check found {a.check.differences} difference(s) between the ledger and today&rsquo;s figures. They are in the platform
          log.
        </Notice>
      )}
      {a.groups.length === 0 ? (
        <Card>
          <EmptyState
            title="Nothing posted yet"
            description="Entries appear when money is recorded: orders, payments, expenses, transfers."
          />
        </Card>
      ) : (
        a.groups.map((g) => (
          <Card key={g.group} className="overflow-clip p-0">
            <Table aria-label={g.group} className="table-fixed">
              <THead>
                <tr>
                  <Th>{g.group}</Th>
                  <Th className="w-[45%] text-right">Balance</Th>
                  <Th className="w-36 text-right">{a.mainCurrency}</Th>
                </tr>
              </THead>
              <tbody>
                {g.accounts.map((acc) => (
                  <Tr key={acc.account} href={buildHref(PATH, {}, { account: acc.account, period: "all" })}>
                    <Td>
                      <Link href={buildHref(PATH, {}, { account: acc.account, period: "all" })} className="font-medium hover:text-primary">
                        {acc.label}
                      </Link>
                      <span className="block text-xs text-muted">
                        {acc.rows} {acc.rows === 1 ? "row" : "rows"}
                      </span>
                    </Td>
                    <Td className="text-right tabular">{acc.balances.map((b) => money(b.balance, b.currency)).join(" · ")}</Td>
                    <Td className="text-right font-medium tabular">{amount(Number(acc.base))}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        ))
      )}
      <p className="px-1 text-right text-sm text-text-2">
        Debits {money(a.totals.debit, a.mainCurrency)} · Credits {money(a.totals.credit, a.mainCurrency)} ·{" "}
        {a.totals.balanced ? "every debit has its credit" : "they differ"}
      </p>
    </div>
  );
}

/** Customers, factories or staff: what each owes us or we owe them, by how late, and their own ledger. */
async function Parties({ side }: { side: "receivable" | "payable" | "staff" }) {
  const a = await api.get<LedgerAgeing>("/ledger/ageing", { side });
  const kind = side === "receivable" ? "customer" : side === "payable" ? "factory" : "staff";
  const what = side === "receivable" ? "Customers owe us" : side === "payable" ? "We owe suppliers" : "We owe staff back";
  return (
    <div className="flex flex-col gap-4">
      <AgeingTiles buckets={a.buckets} currency={a.mainCurrency} label={`${what}, by how late`} />
      <Card className="overflow-clip p-0">
        {a.rows.length === 0 ? (
          <EmptyState
            framed
            title={side === "receivable" ? "Nothing to receive" : side === "payable" ? "Nothing to pay" : "Nothing to repay"}
            description="Their ledgers are still here: open one from its page."
          />
        ) : (
          <DataTable label={what}>
            <THead>
              <tr>
                <Th>{side === "receivable" ? "Customer" : side === "payable" ? "Supplier" : "Person"}</Th>
                <Th className="text-right">Open</Th>
                {a.buckets.map((b) => (
                  <Th key={b.bucket} className="text-right">
                    {b.label}
                  </Th>
                ))}
              </tr>
            </THead>
            <tbody>
              {a.rows.map((r) => (
                <DataRow key={r.party.id} href={partyHref(kind, r.party.id)}>
                  <Td>
                    <Link href={partyHref(kind, r.party.id)} className="font-medium hover:text-primary">
                      {r.party.name}
                    </Link>
                    <span className="block text-xs text-muted">{r.byCurrency.map((c) => money(c.amount, c.currency)).join(" · ")}</span>
                  </Td>
                  <Td className="text-right font-semibold tabular">{amount(Number(r.total))}</Td>
                  {a.buckets.map((b) => (
                    <Td key={b.bucket} className={cn("text-right tabular", Number(r.buckets[b.bucket]) === 0 && "text-muted")}>
                      {amount(Number(r.buckets[b.bucket]))}
                    </Td>
                  ))}
                </DataRow>
              ))}
            </tbody>
          </DataTable>
        )}
      </Card>
      <p className="px-1 text-xs text-muted">
        In {a.mainCurrency}. From each plan row&rsquo;s due date{side === "staff" ? " (for staff: the day they paid)" : ""}. Open a{" "}
        {kind === "staff" ? "person" : kind} for their ledger and statement.
      </p>
    </div>
  );
}
