import { cache, Suspense, type ReactNode } from "react";
import Link from "next/link";
import { can, ORDER_WORD_TONE, type InquiryStage, type Priority } from "@kebo/shared";
import { ButtonLink, Card, CardBody, CardHeader, cn, RefCode, StatusBadge, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { todayIn } from "@kebo/utils";
import { ArrowRight, Plus } from "lucide-react";
import type { OrderRow } from "@/lib/types-orders";
import type { Paged, Person } from "@/lib/types";
import { api } from "@/lib/api";
import { requireUser, hasFeature } from "@/lib/session";
import { money, TZ } from "@/lib/format";
import type { HomeFigures, Receivables, Reminders } from "@/lib/types-insights";
import { CustomersOwe, InquiriesNow, MonthFigures, NeedsYou, NextWeeks, OrdersNow, SoldByMonth, StandsOut, ThinProfit } from "@/components/home/board";

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
  const today = todayIn(TZ);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: TZ }).format(new Date()));
  const hello = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const day = new Date(`${today}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div className="flex flex-col gap-4">
      {/* Who, when, how much waits; the three things people start from here. */}
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-[22px] leading-7 font-bold text-text">
            {hello}, {me.name.split(" ")[0]}
          </h1>
          <p className="mt-0.5 text-sm text-text-2">
            {day}
            <Suspense>
              <HowMany />
            </Suspense>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can(me, "payments.record") && (
            <ButtonLink href="/payments/new" variant="secondary">
              Record payment
            </ButtonLink>
          )}
          {can(me, "expenses.manage") && (
            <ButtonLink href="/payments/new?kind=expense" variant="secondary">
              Add a cost
            </ButtonLink>
          )}
          {can(me, "inquiries.create") && (
            <ButtonLink href="/inquiries?panel=new-inquiry" variant="primary">
              <Plus aria-hidden /> New inquiry
            </ButtonLink>
          )}
        </div>
      </header>

      {insights ? <Board /> : <Simple />}
    </div>
  );
}

const block = (h: string) => <div className={cn("animate-pulse rounded-2xl bg-surface-2", h)} aria-hidden />;

// One request each per page view, however many cards use them.
const getFigures = cache(() => api.get<HomeFigures>("/insights/home").catch(() => null));
const getReminders = cache(() => api.get<Reminders>("/reminders").catch(() => null));
const getOwed = cache(() => api.get<Receivables>("/money/receivables").catch(() => null));

/** " · 7 things need you today" after the date, once the list is in. */
async function HowMany() {
  const r = await getReminders();
  const n = r?.counts.total ?? 0;
  if (n === 0) return <> · nothing needs you right now</>;
  return (
    <>
      {" · "}
      <strong className="font-semibold text-warn">
        {n} thing{n === 1 ? "" : "s"} need{n === 1 ? "s" : ""} you today
      </strong>
    </>
  );
}

/**
 * Home for people who see the reports (design "money, simple", board Home): the month in four figures, what
 * needs them, what stands out, the cash of the next four weeks, and where orders, money and inquiries stand.
 * Each part streams in as it is ready.
 */
function Board() {
  return (
    <>
      <Suspense fallback={block("h-[92px]")}>
        <Figures />
      </Suspense>
      <div className="grid items-start gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Suspense fallback={block("h-[340px]")}>
          <Needs />
        </Suspense>
        <Suspense fallback={block("h-[340px]")}>
          <With figures={(h) => <StandsOut h={h} />} />
        </Suspense>
      </div>
      <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
        <Suspense fallback={block("h-[260px]")}>
          <With figures={(h) => <NextWeeks h={h} />} />
        </Suspense>
        <Suspense fallback={block("h-[260px]")}>
          <With figures={(h) => <SoldByMonth h={h} />} />
        </Suspense>
        <Suspense fallback={block("h-[260px]")}>
          <With figures={(h) => <OrdersNow h={h} />} />
        </Suspense>
        <Suspense fallback={block("h-[260px]")}>
          <Owed />
        </Suspense>
        <Suspense fallback={block("h-[260px]")}>
          <With figures={(h) => <ThinProfit h={h} />} />
        </Suspense>
        <Suspense fallback={block("h-[260px]")}>
          <With figures={(h) => <InquiriesNow h={h} />} />
        </Suspense>
      </div>
    </>
  );
}

async function Figures() {
  const h = await getFigures();
  return h ? <MonthFigures h={h} /> : null;
}
/** A card made from the figures, once they are in (nothing when they could not be read). */
async function With({ figures }: { figures: (h: HomeFigures) => ReactNode }) {
  const h = await getFigures();
  return h ? figures(h) : null;
}
async function Needs() {
  const r = await getReminders();
  return r ? <NeedsYou r={r} /> : null;
}
async function Owed() {
  const r = await getOwed();
  return r ? <CustomersOwe r={r} /> : null;
}

/** Home for people who do not see the reports: what needs them, the inquiries and orders they work on, who owes. */
async function Simple() {
  const d = await api.get<Dashboard>("/dashboard");
  return (
    <>
      <div className="grid items-start gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Suspense fallback={block("h-[340px]")}>
          <Needs />
        </Suspense>
        <div className="flex flex-col gap-4">
          <Pipeline counts={d.counts} />
          <Suspense fallback={block("h-[260px]")}>
            <Owed />
          </Suspense>
        </div>
      </div>
      <Suspense fallback={block("h-[260px]")}>
        <RecentOrders />
      </Suspense>
    </>
  );
}

/** Open inquiries by stage, a bar each. */
function Pipeline({ counts }: { counts: Dashboard["counts"] }) {
  const rows: { label: string; n: number; href: string }[] = [
    { label: "New", n: counts.new, href: "/inquiries?stage=new" },
    { label: "Waiting for prices", n: counts.sourcing, href: "/inquiries?stage=sourcing" },
    { label: "Quoted", n: counts.quoted, href: "/inquiries?stage=quoted" },
  ];
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <Card>
      <CardHeader
        title="Inquiries now"
        actions={
          <Link href="/inquiries/board" className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary hover:underline">
            <ArrowRight className="size-4" aria-hidden /> Board
          </Link>
        }
      />
      <CardBody>
        <ul className="flex flex-col gap-3">
          {rows.map((r) => (
            <li key={r.label}>
              <Link href={r.href} className="flex flex-col gap-1.5 rounded-lg hover:text-primary">
                <span className="flex justify-between gap-3 text-[13px]">
                  <span>
                    {r.label} <span className="text-muted">· {r.n}</span>
                  </span>
                </span>
                <span className="h-2 rounded bg-surface-3">
                  <span className="block h-2 rounded bg-chart-1" style={{ width: `${(r.n / max) * 100}%` }} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

/** The latest open sales orders (the board's "Recent sales orders"): what each is worth, what is still due, where it is. */
async function RecentOrders() {
  const data = await api.get<Paged<OrderRow>>("/orders/page", { status: "open", page: 1 }).catch(() => null);
  if (!data || !data.rows.length) return null;
  const rows = data.rows.slice(0, 5);
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Recent sales orders"
        actions={
          <ButtonLink href="/orders" variant="secondary" size="sm">
            <ArrowRight aria-hidden /> View all
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
              <Td className="max-w-56 truncate">{o.customer.name}</Td>
              <Td className="text-right whitespace-nowrap tabular">{money(o.total, o.currency)}</Td>
              <Td className="text-right whitespace-nowrap tabular">{Number(o.due) > 0.005 ? money(o.due, o.currency) : "—"}</Td>
              <Td>
                <StatusBadge meaning={ORDER_WORD_TONE[o.word]}>{o.word}</StatusBadge>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}


