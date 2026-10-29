import { cache, Suspense } from "react";
import Link from "next/link";
import { Banknote, Coins, TrendingUp, Users } from "lucide-react";
import { can, type InquiryStage, type Priority } from "@kebo/shared";
import { Alert, Badge, Card, CardBody, CardHeader, PageHeader, PriorityBadge, StageBadge } from "@kebo/ui";
import { api } from "@/lib/api";
import { requireUser, hasFeature } from "@/lib/session";
import { date, money } from "@/lib/format";
import type { Person } from "@/lib/types";
import type { Insights, Reminders } from "@/lib/types-insights";
import { Headline, KpiCard, TargetRing } from "@/components/insights/kpi";
import { RevenueChart } from "@/components/insights/charts";
import { TargetEditor } from "@/components/insights/targets";
import { ReminderList } from "@/components/insights/reminder-list";

export const metadata = { title: "Home" };

const TZ = process.env.APP_TIME_ZONE ?? process.env.NEXT_PUBLIC_APP_TIME_ZONE ?? "Asia/Shanghai";

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
      <PageHeader
        title={`${hello}, ${me.name.split(" ")[0]}`}
        description={
          <>
            {dayName}
            <Suspense>
              <HowMany />
            </Suspense>
          </>
        }
      />

      {insights && (
        <Suspense fallback={<MonthSkeleton />}>
          <MonthStrip />
        </Suspense>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <Suspense fallback={<AttentionSkeleton />}>
          <Attention all={can(me, "inquiries.viewAll")} />
        </Suspense>

        <div className="flex flex-col gap-5">
          {insights && (
            <Suspense fallback={<div className="h-[300px] animate-pulse rounded-2xl bg-surface-2" aria-hidden />}>
              <SalesChart />
            </Suspense>
          )}
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
                <Link key={label} href={href} className="rounded-xl border border-line p-3 transition-colors hover:border-line-strong">
                  <p className="text-xs text-muted">{label}</p>
                  <p className="text-2xl font-semibold tabular">{value}</p>
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
const getInsights = cache(() => api.get<Insights>("/insights").catch(() => null));
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

async function MonthStrip() {
  const i = await getInsights();
  if (!i) return null;
  return (
    <>
      {i.missingRates.length > 0 && (
        <Alert tone="warning" className="mb-4">
          There is no exchange rate for {i.missingRates.join(", ")} in Settings, so amounts in{" "}
          {i.missingRates.length === 1 ? "it are" : "them are"} left out of these figures.
        </Alert>
      )}
      <section aria-label="This month" className="mb-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard
            label="Sales this month"
            icon={<TrendingUp className="size-3.5" />}
            value={<Headline amount={i.kpis.revenue.value ?? 0} currency={i.currency} />}
            kpi={i.kpis.revenue}
            note={`${i.kpis.orders.value} order${i.kpis.orders.value === 1 ? "" : "s"}`}
            href="/insights"
          />
          {i.kpis.netProfit ? (
            <KpiCard
              label="Profit after expenses"
              icon={<Coins className="size-3.5" />}
              value={<Headline amount={i.kpis.netProfit.value ?? 0} currency={i.currency} />}
              kpi={i.kpis.netProfit}
              tone={Number(i.kpis.netProfit.value) < 0 ? "bad" : undefined}
              note={
                Number(i.kpis.uncostedRevenue.value) > 0 ? `${money(i.kpis.uncostedRevenue.value ?? 0, i.currency)} not costed` : undefined
              }
              href="/insights?tab=profit"
            />
          ) : (
            <KpiCard
              label="Gross profit"
              icon={<Coins className="size-3.5" />}
              value={<Headline amount={i.kpis.grossProfit.value ?? 0} currency={i.currency} />}
              kpi={i.kpis.grossProfit}
              note={
                Number(i.kpis.uncostedRevenue.value) > 0 ? `${money(i.kpis.uncostedRevenue.value ?? 0, i.currency)} not costed` : undefined
              }
              href="/insights?tab=profit"
            />
          )}
          <KpiCard
            label="Customers owe us"
            icon={<Users className="size-3.5" />}
            value={<Headline amount={i.now.toReceive} currency={i.currency} />}
            note={
              Number(i.now.overdue) > 0 ? (
                <span className="font-medium text-bad">{money(i.now.overdue, i.currency)} overdue</span>
              ) : (
                "Nothing overdue"
              )
            }
            tone={Number(i.now.overdue) > 0 ? "warn" : undefined}
            href="/money?tab=receive"
          />
          {i.now.cashInHand !== null ? (
            <KpiCard
              label="In our accounts"
              icon={<Banknote className="size-3.5" />}
              value={<Headline amount={i.now.cashInHand} currency={i.currency} />}
              note="Cash, banks and wallets"
              href="/money?tab=cash"
            />
          ) : (
            <KpiCard
              label="Win rate"
              icon={<Banknote className="size-3.5" />}
              value={i.kpis.winRate.value === null ? "—" : `${i.kpis.winRate.value}%`}
              kpi={i.kpis.winRate}
              points
              href="/insights?tab=sales"
            />
          )}
        </div>
        <Card className="rounded-2xl">
          <CardHeader
            title="This month's target"
            actions={i.target.canSet ? <TargetEditor month={i.target.month} current={i.target.amount} currency={i.currency} /> : undefined}
          />
          <CardBody>
            {i.target.amount && i.target.percent !== null ? (
              <TargetRing percent={i.target.percent} reached={i.target.reached} amount={i.target.amount} currency={i.currency} size={112} />
            ) : (
              <p className="text-sm text-muted">No target yet. Set one to see at a glance how the month is going.</p>
            )}
          </CardBody>
        </Card>
      </section>
    </>
  );
}

async function SalesChart() {
  const i = await getInsights();
  if (!i) return null;
  return (
    <Card className="rounded-2xl">
      <CardHeader
        title="Sales, last 6 months"
        actions={
          <Link href="/insights" className="text-sm text-primary hover:underline">
            Open Insights
          </Link>
        }
      />
      <CardBody>
        <RevenueChart data={i.series.slice(-6)} currency={i.currency} showNet={false} height={220} />
      </CardBody>
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
