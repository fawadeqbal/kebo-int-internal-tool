import { cache, Suspense } from "react";
import Link from "next/link";
import { can, ORDER_STAGE_LABEL, ORDER_STAGE_TONE, type FlowStep, type InquiryStage, type Priority } from "@kebo/shared";
import { Alert, Badge, ButtonLink, Card, CardBody, CardHeader, cn, Meter, PriorityBadge, RefCode, StageBadge, StatTile, StatusBadge, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { ArrowRight, Coins, FileText, Package, PieChart, Plus, ShoppingCart, TrendingUp, Wallet } from "lucide-react";
import type { Aging } from "@/lib/types-facts";
import { getSettings } from "@/lib/loaders";
import type { OrderRow } from "@/lib/types-orders";
import type { Paged } from "@/lib/types";
import { api } from "@/lib/api";
import { requireUser, hasFeature } from "@/lib/session";
import { date, money, TZ, plural } from "@/lib/format";
import type { Person } from "@/lib/types";
import type { Reminders } from "@/lib/types-insights";
import { loadHome, type AccountRow } from "@/lib/insights-data";
import { amountCell, bigMoney, change, monthYearOf, percent } from "@/lib/insights-period";
import { TargetRing } from "@/components/insights/kpi";
import { TargetEditor } from "@/components/insights/targets";
import { Delta } from "@/components/insights/frame";
import { ChartCard } from "@/components/insights/chart-card";
import { SalesProfitChart } from "@/components/insights/facts-charts";
import { ReminderList } from "@/components/insights/reminder-list";
import { readableDates } from "@/components/insights/readable-dates";
import type { Today } from "@/lib/types-notes";
import { FollowUpRow } from "@/components/notes/cards";

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

function DealList({ rows, empty }: { rows: DealLine[]; empty: string }) {
  if (!rows.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="flex flex-col divide-y divide-line">
      {rows.map((d) => (
        <li key={d.id}>
          <Link href={`/inquiries/${d.id}`} className="flex items-center gap-3 py-2.5 hover:text-primary">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {d.refNo} · {d.title}
              </p>
              <p className="truncate text-xs text-muted">
                {d.customer.name}
                {d.requiredBy ? ` · needed by ${date(d.requiredBy)}` : ""}
              </p>
            </div>
            <PriorityBadge priority={d.priority} />
            <StageBadge stage={d.stage} onHold={d.onHold} />
          </Link>
        </li>
      ))}
    </ul>
  );
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

      {/* The rest of the day's work, in the same cards */}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <div className="flex flex-col gap-4">
          <Suspense fallback={<AttentionSkeleton />}>
            <Attention all={can(me, "inquiries.viewAll")} />
          </Suspense>
          <Card>
            <CardHeader title="My open inquiries" description="Earliest needed-by first" />
            <CardBody>
              <DealList rows={d.myDeals} empty="No open inquiries assigned to you." />
            </CardBody>
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          <Suspense fallback={<div className="h-[140px] animate-pulse rounded-2xl bg-surface-2" aria-hidden />}>
            <FollowUpsToday />
          </Suspense>
          {insights && (
            <Suspense>
              <MonthTarget today={d.today} />
            </Suspense>
          )}
          <Suspense>
            <MyTarget />
          </Suspense>
          <Suspense>
            <MyOrders />
          </Suspense>
          <Suspense>
            <ThisWeek today={d.today} />
          </Suspense>
          {d.workload && (
            <Card>
              <CardHeader title="Team" description="Open inquiries and orders per person" />
              <CardBody>
                <ul className="flex flex-col gap-2">
                  {d.workload.map((p) => (
                    <li key={p.id}>
                      <Link href={`/inquiries?assignee=${p.id}`} className="flex items-center justify-between rounded-[10px] border border-line px-3 py-2 text-sm hover:border-line-strong">
                        <span className="font-medium">{p.name}</span>
                        <span className="text-xs text-muted tabular">
                          {p.openDeals} {p.openDeals === 1 ? "inquiry" : "inquiries"} · {p.openOrders} order{p.openOrders === 1 ? "" : "s"}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
        </div>
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
            value={cash[0] ? money(cash[0].amount, cash[0].currency) : "—"}
            sub={cash.length > 1 ? cash.slice(1).map((x) => money(x.amount, x.currency)).join(" · ") : plural(accounts.filter((a) => !a.archived).length, "account")}
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

/** This month's company target (managers), in its own card. */
async function MonthTarget({ today }: { today: string }) {
  const h = await getHome(today);
  if (!h) return null;
  return (
    <Card>
      <CardHeader title="This month's target" actions={h.target.canSet ? <TargetEditor month={h.target.month} current={h.target.amount} currency={h.currency} /> : undefined} />
      <CardBody>
        {h.target.amount && h.target.percent !== null ? (
          <TargetRing percent={h.target.percent} reached={h.target.reached} amount={h.target.amount} currency={h.currency} size={112} />
        ) : (
          <p className="text-sm text-muted">No target yet. Set one to see at a glance how the month is going.</p>
        )}
      </CardBody>
    </Card>
  );
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
        <p className="mt-3 text-xs text-muted">On hold: {counts.onHold}</p>
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
      title="Sales and gross profit, last 6 months"
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

/** My own sales target this month, when a manager set one (Insights › Targets). */
async function MyTarget() {
  if (!(await hasFeature("insights"))) return null;
  const t = await api.get<{ month: string; target: string | null; sold: string | null; percent: number | null; currency: string | null; daysLeft: number | null }>("/me/target").catch(() => null);
  if (!t || t.target === null || t.currency === null) return null;
  const left = Math.max(Number(t.target) - Number(t.sold ?? 0), 0);
  const monthName = new Date(`${t.month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
  return (
    <Card className="rounded-2xl">
      <CardHeader title={`My ${monthName} target`} description={`${money(t.sold, t.currency)} of ${money(t.target, t.currency)}`} />
      <CardBody>
        <Meter
          label="Sold this month"
          figure={`${t.percent ?? 0}%`}
          percent={Math.min(t.percent ?? 0, 100)}
          tone={(t.percent ?? 0) >= 100 ? "ok" : undefined}
          hint={
            (t.percent ?? 0) >= 100
              ? "Reached. Well done."
              : t.daysLeft
                ? `${t.daysLeft} day${t.daysLeft === 1 ? "" : "s"} left · ${money(left / t.daysLeft, t.currency)} a day to make it`
                : `${money(left, t.currency)} to go`
          }
        />
      </CardBody>
    </Card>
  );
}

/** My open orders by where they are in the flow (orders board module); each count opens the board at that step. */
async function MyOrders() {
  if (!(await hasFeature("orders_board"))) return null;
  const board = await api.get<{ items: { id: string; current: { key: FlowStep } | null }[] }>("/order-board", { mine: "true" }).catch(() => null);
  if (!board || !board.items.length) return null;
  const cols: [string, string, FlowStep[]][] = [
    ["Payment", "payment", ["payment"]],
    ["Factory", "production", ["factory", "production"]],
    ["Shipping", "shipping", ["shipping"]],
    ["Papers", "documents", ["documents"]],
    ["SAT", "delivery", ["delivery"]],
  ];
  const count = (steps: FlowStep[]) => board.items.filter((i) => (i.current ? steps.includes(i.current.key) : steps.includes("delivery"))).length;
  return (
    <Card className="rounded-2xl">
      <CardHeader title="My orders" description={`${board.items.length} open, by where they are`} />
      <CardBody className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {cols.map(([label, key, steps]) => (
          <Link key={key} href={`/orders/board?mine=1&stage=${key}`} className="rounded-xl border border-line bg-surface p-3 transition-colors hover:border-primary-line hover:bg-primary-soft/50">
            <p className="truncate text-xs font-medium text-text-2">{label}</p>
            <p className="text-2xl font-bold text-primary tabular">{count(steps)}</p>
          </Link>
        ))}
      </CardBody>
    </Card>
  );
}

/** My calls and visits for today and the ones still open from before (late, in the bad tone with the word). */
async function FollowUpsToday() {
  const t = await api.get<Today>("/me/today").catch(() => null);
  if (!t) return null;
  return (
    <Card className="overflow-clip rounded-2xl">
      <CardHeader
        title={`Follow-ups today${t.total ? ` · ${t.total}` : ""}`}
        description={t.late ? <span className="font-medium text-bad">{t.late} late</span> : t.total ? "Your calls and visits" : undefined}
        actions={
          <Link href="/follow-ups" className="text-sm text-primary hover:underline">
            All follow-ups
          </Link>
        }
      />
      {t.rows.length ? (
        <ul aria-label="Follow-ups today" className="divide-y divide-line">
          {t.rows.slice(0, 8).map((f) => (
            <FollowUpRow key={f.id} f={f} showRecord today={t.today} />
          ))}
        </ul>
      ) : (
        <p className="px-4 py-3 text-sm text-muted">Nothing planned for today. Add a follow-up on an order, a customer or a factory and it shows here on its day.</p>
      )}
      {t.rows.length > 8 && (
        <p className="border-t border-line px-4 py-2 text-xs text-text-2">
          <Link href="/follow-ups?mine=true" className="font-medium text-primary hover:underline">
            {t.rows.length - 8} more
          </Link>
        </p>
      )}
    </Card>
  );
}

/** The next seven days from "Needs attention": what falls due when (deposits, quotation expiry, arrivals, SATs). */
async function ThisWeek({ today }: { today: string }) {
  const reminders = await getReminders().catch(() => null);
  if (!reminders) return null;
  const end = new Date(`${today}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 7);
  const last = end.toISOString().slice(0, 10);
  const week = reminders.items.filter((i) => i.due && i.due >= today && i.due <= last).sort((a, b) => a.due!.localeCompare(b.due!));
  if (!week.length) return null;
  const dayOf = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });
  return (
    <Card className="rounded-2xl">
      <CardHeader title="This week" description="What falls due in the next seven days" />
      <ul className="flex flex-col divide-y divide-line">
        {week.slice(0, 8).map((i) => (
          <li key={i.key}>
            <Link href={i.href} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 px-4 py-2.5 text-sm hover:bg-surface-2">
              <span className={i.due === today ? "font-semibold text-primary" : "text-muted"}>{i.due === today ? "Today" : dayOf(i.due!)}</span>
              <span className="min-w-0 truncate">{readableDates(i.title)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
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

async function Attention({ all }: { all: boolean }) {
  const reminders = await getReminders();
  return (
    <Card className="overflow-hidden rounded-2xl">
      <CardHeader
        title="Needs attention"
        description={all ? "Everyone's, the most urgent first" : "Yours, the most urgent first"}
        actions={reminders.counts.total ? <Badge tone={reminders.counts.bad ? "bad" : "info"}>{reminders.counts.total}</Badge> : undefined}
      />
      <ReminderList data={reminders} />
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


function AttentionSkeleton() {
  return (
    <div
      className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4"
      aria-busy="true"
      aria-label="Needs attention, loading"
    >
      {[0, 1, 2, 3, 4].map((k) => (
        <div key={k} className="h-12 animate-pulse rounded-lg bg-surface-2" />
      ))}
    </div>
  );
}
