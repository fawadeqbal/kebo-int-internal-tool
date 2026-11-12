import { cache, Suspense } from "react";
import Link from "next/link";
import { can, ORDER_STAGE_LABEL, ORDER_STAGE_TONE, type InquiryStage, type Priority } from "@kebo/shared";
import { Alert, Badge, ButtonLink, Card, CardBody, CardHeader, cn, RefCode, StatTile, StatusBadge, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { ArrowRight, Coins, FileText, Package, PieChart, Plus, ShoppingCart, TrendingUp, Wallet } from "lucide-react";
import type { Aging } from "@/lib/types-facts";
import { getSettings } from "@/lib/loaders";
import type { OrderRow } from "@/lib/types-orders";
import type { Paged } from "@/lib/types";
import { api } from "@/lib/api";
import { requireUser, hasFeature } from "@/lib/session";
import { money, TZ, plural } from "@/lib/format";
import type { Person } from "@/lib/types";
import type { Reminders } from "@/lib/types-insights";
import { loadHome, type AccountRow } from "@/lib/insights-data";
import { amountCell, bigMoney, change, monthYearOf, percent } from "@/lib/insights-period";
import { Delta } from "@/components/insights/frame";
import { ChartCard } from "@/components/insights/chart-card";
import { SalesProfitChart } from "@/components/insights/facts-charts";
import { readableDates } from "@/components/insights/readable-dates";

export const metadata = { title: "Home" };

interface DealLine {
  id: string;
  refNo: string;
  title: string;
  stage: InquiryStage;
  onHold: boolean;
  requiredBy: string | null;
  priority: Priority;
  customer: { id: string; name: string };
  assignee: Person | null;
}
interface Dashboard {
  today: string;
  counts: { new: number; sourcing: number; quoted: number; overdue: number; onHold: number; unassigned: number };
  myDeals: DealLine[];
  workload: { id: string; name: string; openDeals: number; openOrders: number }[] | null;
}


export default async function DashboardPage() {
  const me = await requireUser();
  const insights = can(me, "reports.view") && (await hasFeature("insights"));
  const seeMoney = can(me, "expenses.manage");
  // Only the deal counts are waited for; the figures and lists stream in as they come.
  const [d, settings] = await Promise.all([api.get<Dashboard>("/dashboard"), getSettings()]);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: TZ }).format(new Date()));
  const hello = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="flex flex-col gap-4">
      {/* Welcome (board: Dashboard) */}
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-primary-line bg-primary-soft px-[26px] py-[22px]">
        <div className="min-w-0">
          <p className="text-xs font-bold tracking-[0.08em] text-primary uppercase">{hello}</p>
          <h1 className="my-1 text-[30px] leading-9 font-bold text-text">Welcome back, {me.name.split(" ")[0]}</h1>
          <p className="text-text-2">
            Here is how {settings.company.name} is doing today.
            <Suspense>
              <HowMany />
            </Suspense>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can(me, "inquiries.create") && (
            <ButtonLink href="/inquiries/new" variant="primary">
              <Plus aria-hidden /> New inquiry
            </ButtonLink>
          )}
          {can(me, "payments.record") && (
            <ButtonLink href="/payments/new" variant="secondary">
              <Wallet aria-hidden /> Record payment
            </ButtonLink>
          )}
          {can(me, "expenses.manage") && (
            <ButtonLink href="/payments/new?kind=expense" variant="secondary">
              <Coins aria-hidden /> New expense
            </ButtonLink>
          )}
        </div>
      </section>

      {/* Figures: Sales, Gross profit, Receivable, Payable, Cash & bank, Open orders */}
      <Suspense fallback={<FiguresSkeleton />}>
        <Figures today={d.today} insights={insights} seeMoney={seeMoney} />
      </Suspense>

      {/* Recent sales orders · Sales and costs */}
      <div className="grid items-start gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Suspense fallback={<div className="h-[340px] animate-pulse rounded-2xl bg-surface-2" aria-hidden />}>
          <RecentOrders />
        </Suspense>
        {insights && (
          <Suspense fallback={<div className="h-[340px] animate-pulse rounded-2xl bg-surface-2" aria-hidden />}>
            <SalesChart today={d.today} />
          </Suspense>
        )}
      </div>

      {/* Inquiry pipeline · Needs you · Cash and bank */}
      <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
        <Pipeline counts={d.counts} />
        <Suspense fallback={<div className="h-[240px] animate-pulse rounded-2xl bg-surface-2" aria-hidden />}>
          <NeedsYou />
        </Suspense>
        {seeMoney && (
          <Suspense fallback={<div className="h-[240px] animate-pulse rounded-2xl bg-surface-2" aria-hidden />}>
            <CashAndBank />
          </Suspense>
        )}
      </div>

    </div>
  );
}

// One request each per page view, however many sections use them.
const getHome = cache((today: string) => loadHome(today).catch(() => null));
const getReminders = cache(() => api.get<Reminders>("/reminders"));

/** " 4 things need you." after the welcome line, once the list is in (bold, as on the board). */
async function HowMany() {
  const r = await getReminders();
  const n = r.counts.total;
  if (n === 0) return <> Nothing needs you right now.</>;
  return (
    <>
      {" "}
      <strong className="font-semibold text-text">
        {n} thing{n === 1 ? "" : "s"} need{n === 1 ? "s" : ""} you.
      </strong>
      {r.counts.bad > 0 && <span className="font-medium text-bad"> {r.counts.bad} urgent.</span>}
    </>
  );
}

/** Six figures in a row (board): this month's sales and gross profit, what customers owe, what we owe factories, our cash and bank, open orders. */
async function Figures({ today, insights, seeMoney }: { today: string; insights: boolean; seeMoney: boolean }) {
  const [h, payable, accounts, orders] = await Promise.all([
    insights ? getHome(today) : null,
    insights && seeMoney ? api.get<Aging>("/insights/facts/aging", { side: "payable" }).catch(() => null) : null,
    seeMoney ? api.get<AccountRow[]>("/money/accounts").catch(() => null) : null,
    api.get<Paged<OrderRow>>("/orders/page", { status: "open", page: 1, pageSize: 1 }).catch(() => null),
  ]);
  const c = h?.currency ?? "";
  const overdue = h ? Number(h.now.overdue.amount) : 0;
  const owed = h ? Number(h.receivable.total) : 0;
  // The main currency's balance first (the one the other figures are in), then the others.
  const cash = cashTotals(accounts ?? []).sort((x, y) => Number(y.currency === c) - Number(x.currency === c));
  return (
    <>
      {h && h.missingRates.length > 0 && (
        <Alert tone="warning">
          There is no exchange rate for {h.missingRates.join(", ")} in Settings, so amounts in {h.missingRates.length === 1 ? "it are" : "them are"} left out of these figures.
        </Alert>
      )}
      <section aria-label="Figures" className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
        {h && (
          <StatTile
            icon={TrendingUp}
            iconColor={1}
            label="Sales this month"
            value={bigMoney(h.sales.now, c)}
            sub={<Delta value={change(h.sales.now, h.sales.before)} vs={h.p.vsLabel} />}
            href="/reports?period=month"
          />
        )}
        {h && (
          <StatTile
            icon={PieChart}
            iconColor={3}
            label="Gross profit"
            value={bigMoney(h.profit.now, c)}
            sub={`margin ${percent(h.profit.margin)}`}
            href="/reports?period=month"
          />
        )}
        {h && (
          <StatTile
            icon={FileText}
            iconColor={2}
            label="Receivable"
            value={bigMoney(owed, c)}
            tone={overdue > 0.005 ? "bad" : undefined}
            sub={overdue > 0.005 ? `${bigMoney(overdue, c)} late` : "nothing late"}
            href="/finance/to-receive"
          />
        )}
        {payable && (
          <StatTile
            icon={ShoppingCart}
            iconColor={4}
            label="Payable"
            value={bigMoney(Number(payable.total), payable.currency)}
            sub={Number(payable.d30) + Number(payable.d60) + Number(payable.d90) + Number(payable.older) > 0.005 ? "some past its date" : "to factories"}
            href="/purchasing/to-pay"
          />
        )}
        {accounts && (
          <StatTile
            icon={Wallet}
            iconColor={5}
            label="Cash & bank"
            value={cash[0] ? bigMoney(cash[0].amount, cash[0].currency) : "—"}
            sub={cash.length > 1 ? cash.slice(1).map((x) => bigMoney(x.amount, x.currency)).join(" · ") : plural(accounts.filter((a) => !a.archived).length, "account")}
            href="/finance/cash-book"
          />
        )}
        <StatTile icon={Package} iconColor={2} label="Open orders" value={orders?.total ?? "—"} sub="not closed yet" href="/orders" />
      </section>
    </>
  );
}

/** Our accounts' balances added up per currency, the biggest first. */
function cashTotals(accounts: AccountRow[]) {
  const by = new Map<string, number>();
  for (const a of accounts) if (!a.archived) by.set(a.currency, (by.get(a.currency) ?? 0) + Number(a.balance ?? 0));
  return [...by].map(([currency, amount]) => ({ currency, amount })).sort((x, y) => y.amount - x.amount);
}


/** Inquiry pipeline (board): open inquiries by stage, a bar each. */
function Pipeline({ counts }: { counts: Dashboard["counts"] }) {
  const rows = [
    { label: "New", n: counts.new, href: "/inquiries?stage=new", hint: counts.unassigned ? `${counts.unassigned} not assigned` : "not started" },
    { label: "Sourcing", n: counts.sourcing, href: "/inquiries?stage=sourcing", hint: "getting prices" },
    { label: "Quoted", n: counts.quoted, href: "/inquiries?stage=quoted", hint: "waiting for answers" },
    { label: "Past needed-by", n: counts.overdue, href: "/inquiries?stage=overdue", hint: "late", late: true },
  ];
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <Card>
      <CardHeader
        title="Inquiry pipeline"
        actions={
          <Link href="/inquiries/board" className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary hover:underline">
            Board <ArrowRight className="size-4" aria-hidden />
          </Link>
        }
      />
      <CardBody>
        <ul className="flex flex-col gap-3">
          {rows.map((r) => (
            <li key={r.label}>
              <Link href={r.href} className="flex flex-col gap-1.5 rounded-lg hover:text-primary">
                <span className="flex justify-between text-[13px]">
                  <span>
                    {r.label} <span className="text-muted">· {r.hint}</span>
                  </span>
                  <strong className={cn("tabular", r.late && r.n > 0 && "text-bad")}>{r.n}</strong>
                </span>
                <span className="h-2 rounded bg-surface-3">
                  <span className={cn("block h-2 rounded", r.late ? "bg-chart-2" : "bg-chart-1")} style={{ width: `${(r.n / max) * 100}%` }} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

/** Needs you (board): the four most urgent things, one line each, with when. */
async function NeedsYou() {
  const r = await getReminders().catch(() => null);
  if (!r) return null;
  const top = r.items.slice(0, 4);
  const tone = (lvl: string) => (lvl === "bad" ? "bg-bad-soft text-bad" : lvl === "warn" ? "bg-warn-soft text-warn" : "bg-info-soft text-info");
  return (
    <Card>
      <CardHeader title="Needs you" actions={r.counts.total ? <Badge tone={r.counts.bad ? "bad" : "info"}>{r.counts.total}</Badge> : undefined} />
      <CardBody>
        {top.length ? (
          <ol className="flex flex-col gap-3">
            {top.map((i) => (
              <li key={i.key}>
                <Link href={i.href} className="flex gap-2.5 hover:text-primary">
                  <span className={cn("grid size-[30px] shrink-0 place-items-center rounded-full text-[11px] font-bold", tone(i.level))} aria-hidden>
                    !
                  </span>
                  <span className="min-w-0 text-[13px]">
                    <span className="block">{readableDates(i.title)}</span>
                    {i.detail && <span className="block truncate text-xs text-muted">{readableDates(i.detail)}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted">Nothing needs you right now.</p>
        )}
      </CardBody>
    </Card>
  );
}

/** Cash and bank (board): each account's balance. */
async function CashAndBank() {
  const accounts = await api.get<(AccountRow & { id: string; name: string })[]>("/money/accounts").catch(() => null);
  if (!accounts) return null;
  const live = accounts.filter((a) => !a.archived);
  return (
    <Card>
      <CardHeader
        title="Cash and bank"
        actions={
          <Link href="/finance/cash-book" className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary hover:underline">
            Vault <ArrowRight className="size-4" aria-hidden />
          </Link>
        }
      />
      <CardBody>
        {live.length ? (
          <ul className="flex flex-col gap-2.5 text-[13px]">
            {live.map((a) => (
              <li key={a.id} className="flex justify-between gap-3">
                <span className="truncate">{a.name}</span>
                <strong className="tabular">{money(a.balance ?? 0, a.currency)}</strong>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No accounts yet.</p>
        )}
      </CardBody>
    </Card>
  );
}

async function SalesChart({ today }: { today: string }) {
  const h = await getHome(today);
  if (!h) return null;
  const c = h.currency;
  return (
    <ChartCard
      title="Sales and costs"
      description={c}
      actions={
        <Link href="/reports" className="text-sm text-primary hover:underline">
          Open Reports
        </Link>
      }
      table={{
        columns: ["Month", "Orders", `Sales ${c}`, `Gross profit ${c}`, "Margin"],
        rows: h.months.map((m) => [monthYearOf(m.month), m.orders, amountCell(m.sales), amountCell(m.profit), percent(m.margin)]),
      }}
    >
      <SalesProfitChart rows={h.months} currency={c} />
    </ChartCard>
  );
}





/** The latest open sales orders (the board's "Recent sales orders"): what each is worth, what is still due, where it is. */
async function RecentOrders() {
  const data = await api.get<Paged<OrderRow>>("/orders/page", { status: "open", page: 1 }).catch(() => null);
  if (!data || !data.rows.length) return null;
  const rows = data.rows.slice(0, 6);
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Recent sales orders"
        description={`${data.total} open`}
        actions={
          <ButtonLink href="/orders" variant="secondary" size="sm">
            View all <ArrowRight aria-hidden />
          </ButtonLink>
        }
      />
      <Table>
        <THead>
          <tr>
            <Th>Order</Th>
            <Th>Customer</Th>
            <Th className="text-right">Total</Th>
            <Th className="text-right">Due</Th>
            <Th>Status</Th>
          </tr>
        </THead>
        <tbody>
          {rows.map((o) => (
            <Tr key={o.id}>
              <Td>
                <RefCode href={`/orders/${o.id}`}>{o.refNo}</RefCode>
              </Td>
              <Td className="max-w-56 truncate font-semibold">{o.customer.name}</Td>
              <Td className="text-right whitespace-nowrap tabular">{money(o.total, o.currency)}</Td>
              <Td className="text-right whitespace-nowrap tabular">{Number(o.due) > 0.005 ? money(o.due, o.currency) : "—"}</Td>
              <Td>
                <StatusBadge meaning={ORDER_STAGE_TONE[o.stage]}>{ORDER_STAGE_LABEL[o.stage]}</StatusBadge>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}


function FiguresSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]" aria-hidden>
      {[0, 1, 2, 3, 4, 5].map((k) => (
        <div key={k} className="h-[92px] animate-pulse rounded-[14px] bg-surface-2" />
      ))}
    </div>
  );
}


