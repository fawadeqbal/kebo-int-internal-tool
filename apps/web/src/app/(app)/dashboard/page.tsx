import { cache, Suspense } from "react";
import Link from "next/link";
import { can, ORDER_STAGE_LABEL, ORDER_STAGE_TONE, type FlowStep, type InquiryStage, type Priority } from "@kebo/shared";
import { Alert, Badge, ButtonLink, Card, CardBody, CardHeader, Meter, PriorityBadge, StageBadge, StatTile, StatusBadge, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { ArrowRight, FileText, PieChart, Plus, ReceiptText, TrendingUp, Wallet } from "lucide-react";
import type { OrderRow } from "@/lib/types-orders";
import type { Paged } from "@/lib/types";
import { api } from "@/lib/api";
import { requireUser, hasFeature } from "@/lib/session";
import { date, money, TZ, plural } from "@/lib/format";
import type { Person } from "@/lib/types";
import type { Reminders } from "@/lib/types-insights";
import { loadHome } from "@/lib/insights-data";
import { amountCell, bigMoney, change, monthYearOf, percent } from "@/lib/insights-period";
import { TargetRing } from "@/components/insights/kpi";
import { TargetEditor } from "@/components/insights/targets";
import { Delta, Tiles } from "@/components/insights/frame";
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
  // Only the deal counts are waited for; the month's figures and "Needs attention" stream in as they come.
  const d = await api.get<Dashboard>("/dashboard");
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: TZ }).format(new Date()));
  const hello = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const dayName = new Date(`${d.today}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });

  return (
    <div>
      {/* The welcome card (Kebo ERP look): who, what day, how much needs them, and the day's main actions. */}
      <header className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-primary-line bg-primary-soft px-5 py-5 sm:px-6">
        <div className="min-w-0">
          <p className="text-xs font-bold tracking-[0.08em] text-primary uppercase">{hello}</p>
          <h1 className="mt-1 text-2xl leading-8 font-bold tracking-tight text-text sm:text-[28px] sm:leading-9">Welcome back, {me.name.split(" ")[0]}</h1>
          <p className="mt-1 text-sm text-text-2">
            {dayName}
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
        </div>
      </header>

      {insights && (
        <Suspense fallback={<MonthSkeleton />}>
          <MonthStrip today={d.today} />
        </Suspense>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <div className="flex flex-col gap-5">
          <Suspense fallback={<AttentionSkeleton />}>
            <Attention all={can(me, "inquiries.viewAll")} />
          </Suspense>
          <Suspense>
            <RecentOrders />
          </Suspense>
        </div>

        <div className="flex flex-col gap-5">
          <Suspense fallback={<div className="h-[140px] animate-pulse rounded-2xl bg-surface-2" aria-hidden />}>
            <FollowUpsToday />
          </Suspense>
          {insights && (
            <Suspense fallback={<div className="h-[300px] animate-pulse rounded-2xl bg-surface-2" aria-hidden />}>
              <SalesChart today={d.today} />
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
          <Card className="rounded-2xl">
            <CardHeader title="Inquiries now" description="Open inquiries by stage" />
            <CardBody className="grid grid-cols-3 gap-2">
              {(
                [
                  [
                    "New",
                    d.counts.new,
                    "/inquiries?stage=new",
                    d.counts.unassigned ? `${d.counts.unassigned} not assigned` : "Not started",
                  ],
                  ["Sourcing", d.counts.sourcing, "/inquiries?stage=sourcing", "Getting prices"],
                  ["Quoted", d.counts.quoted, "/inquiries?stage=quoted", "Waiting for answers"],
                ] as const
              ).map(([label, value, href, hint]) => (
                <Link key={label} href={href} className="rounded-xl border border-line bg-surface p-3 transition-colors hover:border-primary-line hover:bg-primary-soft/50">
                  <p className="text-xs font-medium text-text-2">{label}</p>
                  <p className="text-2xl font-bold text-primary tabular">{value}</p>
                  <p className="truncate text-xs text-muted">{hint}</p>
                </Link>
              ))}
            </CardBody>
          </Card>
          <Card className="rounded-2xl">
            <CardHeader title="My open inquiries" description="Earliest needed-by first" />
            <CardBody>
              <DealList rows={d.myDeals} empty="No open inquiries assigned to you." />
            </CardBody>
          </Card>
          {d.workload && (
            <Card className="rounded-2xl">
              <CardHeader title="Team" description="Open inquiries and orders per person" />
              <CardBody>
                <ul className="flex flex-col gap-2">
                  {d.workload.map((p) => (
                    <li key={p.id}>
                      <Link
                        href={`/inquiries?assignee=${p.id}`}
                        className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm hover:border-line-strong"
                      >
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

/** " · 3 things need you, 1 urgent" after the date, once the list is in. */
async function HowMany() {
  const r = await getReminders();
  const n = r.counts.total;
  if (n === 0) return <> · nothing needs you right now</>;
  return (
    <>
      {" "}
      · {n} thing{n === 1 ? "" : "s"} need{n === 1 ? "s" : ""} you
      {r.counts.bad > 0 && <span className="font-medium text-bad">, {r.counts.bad} urgent</span>}
    </>
  );
}

/**
 * This month, as Insights › Overview shows it for "Month" (the same tiles, labels and endpoints): Sales,
 * Gross profit, To receive with what is overdue, Open quotes; and the month's target.
 */
async function MonthStrip({ today }: { today: string }) {
  const h = await getHome(today);
  if (!h) return null;
  const c = h.currency;
  const vs = h.p.vsLabel;
  const overdue = h.now.overdue;
  const owed = Number(h.receivable.total);
  return (
    <>
      {h.missingRates.length > 0 && (
        <Alert tone="warning" className="mb-4">
          There is no exchange rate for {h.missingRates.join(", ")} in Settings, so amounts in {h.missingRates.length === 1 ? "it are" : "them are"} left
          out of these figures.
        </Alert>
      )}
      <section aria-label="This month" className="mb-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Tiles>
          <StatTile
            label="Sales"
            icon={TrendingUp}
            iconColor={1}
            value={bigMoney(h.sales.now, c)}
            delta={<Delta value={change(h.sales.now, h.sales.before)} vs={vs} />}
            sub={`this month · ${plural(h.sales.orders, "order")}`}
            href="/reports?period=month"
          />
          <StatTile
            label="Gross profit"
            icon={PieChart}
            iconColor={3}
            value={bigMoney(h.profit.now, c)}
            delta={<Delta value={change(h.profit.now, h.profit.before)} vs={vs} />}
            sub={`margin ${percent(h.profit.margin)}${h.profit.marginBefore !== null ? ` · was ${percent(h.profit.marginBefore)}` : ""}`}
            href="/reports?period=month"
          />
          <StatTile
            label="Receivable"
            icon={FileText}
            iconColor={2}
            tone={Number(overdue.amount) > 0 ? "bad" : undefined}
            value={bigMoney(owed, c)}
            meter={owed > 0 ? { percent: (Number(overdue.amount) / owed) * 100, label: `${bigMoney(Number(overdue.amount), c)} of it overdue` } : undefined}
            sub={
              Number(overdue.amount) > 0 ? (
                <span className="font-medium text-bad">
                  {bigMoney(Number(overdue.amount), c)} overdue · {plural(overdue.customers, "customer")}
                </span>
              ) : (
                "nothing overdue"
              )
            }
            href="/finance/to-receive"
          />
          <StatTile
            label="Open quotes"
            icon={ReceiptText}
            iconColor={4}
            value={bigMoney(Number(h.now.openQuotes.value), c)}
            sub={`${plural(h.now.openQuotes.count, "quote")}${h.now.openQuotes.likely ? ` · likely ${bigMoney(Number(h.now.openQuotes.likely), c)}` : ""}`}
            href="/inquiries?stage=quoted"
          />
        </Tiles>
        <Card className="rounded-2xl">
          <CardHeader
            title="This month's target"
            actions={h.target.canSet ? <TargetEditor month={h.target.month} current={h.target.amount} currency={c} /> : undefined}
          />
          <CardBody>
            {h.target.amount && h.target.percent !== null ? (
              <TargetRing percent={h.target.percent} reached={h.target.reached} amount={h.target.amount} currency={c} size={112} />
            ) : (
              <p className="text-sm text-muted">No target yet. Set one to see at a glance how the month is going.</p>
            )}
          </CardBody>
        </Card>
      </section>
    </>
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
                <Link href={`/orders/${o.id}`} className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-text-2 hover:text-primary">
                  {o.refNo}
                </Link>
              </Td>
              <Td className="max-w-56 truncate font-semibold">{o.customer.name}</Td>
              <Td className="text-right tabular">{money(o.total, o.currency)}</Td>
              <Td className="text-right tabular">{Number(o.due) > 0.005 ? money(o.due, o.currency) : "—"}</Td>
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

function MonthSkeleton() {
  return (
    <div className="mb-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]" aria-hidden>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((k) => (
          <div key={k} className="h-[118px] animate-pulse rounded-2xl bg-surface-2" />
        ))}
      </div>
      <div className="h-[118px] animate-pulse rounded-2xl bg-surface-2" />
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
