import { Suspense } from "react";
import { Banknote, Factory, LayoutGrid, Target, TrendingUp, User, Users, type LucideIcon } from "lucide-react";
import { redirect } from "next/navigation";
import { can } from "@kebo/shared";
import { Alert, buildHref, buttonClass, Input, LinkTabs, PageHeader, Segmented, toPage } from "@kebo/ui";
import { todayIn } from "@kebo/utils";
import { hasFeature, requirePermission } from "@/lib/session";
import { crumbsFor, labelFor } from "@/lib/nav";
import { SECTION_PATH, viewPath } from "@/lib/old-addresses";
import { PlanOff } from "@/components/common/plan-off";
import { FileActions } from "@/components/common/file-actions";
import { PERIOD_KINDS, PERIOD_LABEL, periodOf, type Period, type Section } from "@/lib/insights-period";
import { CUSTOMER_CHIPS, loadCash, loadCustomers, loadFactories, loadFunnel, loadOverview, loadPeople, loadProfit, PROFIT_SORTS, type CustomerChip, type ProfitSort } from "@/lib/insights-data";
import { Overview } from "./overview";
import { ProfitSection } from "./profit-section";
import { CashSection } from "./cash-section";
import { CustomersSection, FactoriesSection, FunnelSection, PeopleSection } from "./parties-sections";
import { TargetsView } from "./targets-view";
import { TZ } from "@/lib/format";

export type ReportSearch = {
  period?: string;
  from?: string;
  to?: string;
  chip?: string;
  page?: string;
  month?: string;
  sort?: string;
  /** Targets: the year shown. */
  year?: string;
};

/** The tabs of Reports (each has its own address, so a link or a bookmark opens the tab it means). */
export type ReportKind = "overview" | "profit" | "customers" | "factories" | "cash" | "people" | "targets" | "funnel";

const SECTION_OF: Record<ReportKind, Section> = {
  overview: "overview",
  profit: "money",
  customers: "customers",
  factories: "factories",
  cash: "cash",
  people: "people",
  targets: "people",
  funnel: "funnel",
};
const PATH_OF: Record<ReportKind, string> = {
  overview: "/reports",
  profit: "/reports/profit",
  customers: "/reports/customers",
  factories: "/reports/factories",
  cash: "/reports/cash",
  people: "/reports/people",
  targets: "/reports/people/targets",
  funnel: "/reports/funnel",
};
/** One page, its reports as tabs under the title: the same period goes with you. Profit and Cash are for people who see money. */
const REPORT_TABS: { key: ReportKind; href: string; label: string; icon: LucideIcon; money?: boolean }[] = [
  { key: "overview", href: "/reports", label: "Overview", icon: LayoutGrid },
  { key: "profit", href: "/reports/profit", label: "Profit", icon: TrendingUp, money: true },
  { key: "customers", href: "/reports/customers", label: "Customers", icon: Users },
  { key: "factories", href: "/reports/factories", label: "Suppliers", icon: Factory },
  { key: "cash", href: "/reports/cash", label: "Cash", icon: Banknote, money: true },
  { key: "people", href: "/reports/people", label: "People", icon: User },
  { key: "funnel", href: "/reports/funnel", label: "Funnel", icon: Target },
];
/** Targets is a view of People (it opens from there), so People stays the tab. */
const TAB_OF = (kind: ReportKind): ReportKind => (kind === "targets" ? "people" : kind);

function ReportTabs({ current, keep, seeMoney }: { current: ReportKind; keep: Record<string, string | undefined>; seeMoney: boolean }) {
  return (
    <LinkTabs
      label="Reports"
      className="no-print mt-3"
      tabs={REPORT_TABS.filter((t) => seeMoney || !t.money).map((t) => ({
        href: buildHref(t.href, keep, {}),
        label: (
          <>
            <t.icon aria-hidden /> {t.label}
          </>
        ),
        active: t.key === current,
      }))}
    />
  );
}

const DESCRIPTION: Record<ReportKind, string> = {
  overview: "How the business is doing",
  profit: "What was sold, what it cost, and what is left",
  customers: "Who buys, how much, how well they pay",
  factories: "Who supplies on time and wins our orders",
  cash: "What came in, what went out, and what each account holds",
  people: "Who sells, how fast, and against their targets",
  targets: "Monthly sales targets for the company and each person",
  funnel: "Where inquiries go, and why we lose them",
};

/**
 * Reports (design "money, simple", boards ROverview to RCash): one page in the menu, its reports as tabs,
 * one period for every figure with the period before to compare. Excel, View / Print and PDF are in the
 * header of every tab. Figures come from the Insights tables (GET /insights/facts/*) and, for cash, from
 * the cash book's own rows (GET /money/cash-report).
 */
export async function ReportPage({ kind, searchParams }: { kind: ReportKind; searchParams: Promise<ReportSearch> }) {
  const me = await requirePermission("reports.view");
  const crumbs = crumbsFor("/reports");
  const title = labelFor("/reports");
  if (!(await hasFeature("insights"))) return <PlanOff title={title} what="Insights (sales, profit and team reports)" crumbs={crumbs} />;
  const seeMoney = can(me, "expenses.manage");
  // Profit, cash and setting targets: for people who may see money.
  if ((kind === "profit" || kind === "cash" || kind === "targets") && !seeMoney) redirect(kind === "targets" ? "/reports/people" : "/forbidden");
  const sp = await searchParams;
  const section = SECTION_OF[kind];
  const path = PATH_OF[kind];
  const today = todayIn(TZ);
  const p = periodOf(sp, today);
  const keep = {
    period: p.kind === "quarter" ? undefined : p.kind,
    from: p.kind === "custom" ? p.from : undefined,
    to: p.kind === "custom" ? p.to : undefined,
  };
  /** A link to another figure: on this page, or (section / view) the page that has it, for the same period. */
  const href = (patch: Record<string, string | undefined>) => {
    const { section: s, view, ...rest } = patch;
    const to = (s ?? section) as Section;
    const sub = viewPath(to, view);
    const target = sub ?? (s ? SECTION_PATH[to] : path);
    const url = buildHref(target, keep, s || sub ? {} : rest);
    return view === "pnl" ? `${url}#pnl` : url;
  };
  // The printable report (unchanged), for the period up to today.
  const reportTo = p.to < today ? p.to : today;
  const excel = kind === "targets" ? undefined : buildHref("/sheets/export/insights", {}, { section, period: p.kind, from: p.from, to: p.to });

  const periodPicker = (
    <Segmented
      label="Period"
      className="bg-surface-2"
      options={PERIOD_KINDS.map((k) => ({
        href: buildHref(path, keep, {
          period: k === "quarter" ? undefined : k,
          from: k === "custom" ? p.from : undefined,
          to: k === "custom" ? p.to : undefined,
          sort: sp.sort,
        }),
        label: PERIOD_LABEL[k],
        active: p.kind === k,
      }))}
    />
  );
  // Targets are for a year (its own arrows), not a period.
  const periodic = kind !== "targets";

  return (
    <div>
      <PageHeader
        crumbs={crumbs}
        title={title}
        description={<span className="max-md:hidden">{DESCRIPTION[kind]}</span>}
        actions={
          periodic ? (
            <div className="no-print flex flex-wrap items-center gap-x-3 gap-y-2 max-md:hidden">
              {periodPicker}
              <span className="text-xs text-text-2">
                {p.label} · vs {p.vsLabel}
              </span>
              <FileActions
                excelHref={excel}
                viewHref={buildHref("/print/report", {}, { from: p.from, to: reportTo })}
                pdfHref={buildHref("/pdf/report/summary", {}, { from: p.from, to: reportTo })}
              />
            </div>
          ) : undefined
        }
      >
        <ReportTabs current={TAB_OF(kind)} keep={keep} seeMoney={seeMoney} />
      </PageHeader>
      {periodic && (
        <div className="mb-4 md:hidden">
          {periodPicker}
          <p className="mt-1.5 text-xs text-text-2">
            {p.label} · vs {p.vsLabel}
          </p>
        </div>
      )}
      {periodic && p.kind === "custom" && (
        <form action={path} className="no-print mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-line bg-surface px-4 py-3 shadow-card">
          <input type="hidden" name="period" value="custom" />
          <label className="text-xs text-text-2">
            From
            <Input name="from" type="date" defaultValue={p.from} className="mt-1 h-9 w-40" />
          </label>
          <label className="text-xs text-text-2">
            To
            <Input name="to" type="date" defaultValue={p.to} className="mt-1 h-9 w-40" />
          </label>
          <button className={buttonClass("secondary", "sm")}>Show</button>
          <span className="pb-1.5 text-xs text-muted">compared with the same number of days just before</span>
        </form>
      )}
      <Suspense key={`${kind}-${p.from}-${p.to}`} fallback={<SectionSkeleton />}>
        <Body kind={kind} p={p} sp={sp} today={today} seeMoney={seeMoney} href={href} keep={keep} path={path} />
      </Suspense>
    </div>
  );
}

async function Body({
  kind,
  p,
  sp,
  today,
  seeMoney,
  href,
  keep,
  path,
}: {
  kind: ReportKind;
  p: Period;
  sp: ReportSearch;
  today: string;
  seeMoney: boolean;
  href: (patch: Record<string, string | undefined>) => string;
  keep: Record<string, string | undefined>;
  path: string;
}) {
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  switch (kind) {
    case "overview": {
      const d = await loadOverview(p, seeMoney, sp.month);
      return (
        <>
          <Missing rates={d.missingRates} />
          <Overview d={d} p={p} href={href} />
        </>
      );
    }
    case "profit": {
      const sort: ProfitSort = (PROFIT_SORTS as readonly string[]).includes(sp.sort ?? "") ? (sp.sort as ProfitSort) : "low";
      const d = await loadProfit(p, sort);
      const params = { ...keep, sort: sort === "low" ? undefined : sort };
      return (
        <>
          <Missing rates={d.missingRates} />
          <ProfitSection d={d} p={p} sort={sort} page={toPage(sp.page)} base={path} params={params} href={(patch) => buildHref(path, params, patch)} />
        </>
      );
    }
    case "cash": {
      const { report } = await loadCash(p);
      if (!report) return <Alert tone="info">Cash &amp; bank is not switched on for the company, so there are no accounts to report on.</Alert>;
      return (
        <>
          <Missing rates={report.missingRates} />
          <CashSection r={report} p={p} />
        </>
      );
    }
    case "customers": {
      const chip: CustomerChip = (CUSTOMER_CHIPS as readonly string[]).includes(sp.chip ?? "") ? (sp.chip as CustomerChip) : "all";
      const d = await loadCustomers(p, today);
      return <CustomersSection d={d} p={p} href={href} chip={chip} page={page} base={path} params={{ ...keep, chip: chip === "all" ? undefined : chip }} />;
    }
    case "factories":
      return <FactoriesSection d={await loadFactories(p)} p={p} page={page} base={path} params={keep} />;
    case "people":
      return <PeopleSection d={await loadPeople(p, today)} p={p} canSet={seeMoney} href={href} />;
    case "targets": {
      const year = /^\d{4}$/.test(sp.year ?? "") ? Number(sp.year) : Number(today.slice(0, 4));
      return <TargetsView year={year} today={today} back="/reports/people" />;
    }
    case "funnel":
      return <FunnelSection d={await loadFunnel(p)} p={p} />;
  }
}

function Missing({ rates }: { rates: string[] }) {
  if (!rates.length) return null;
  return (
    <Alert tone="warning" className="mb-4">
      There is no exchange rate for {rates.join(", ")} in Settings, so amounts in {rates.length === 1 ? "it are" : "them are"} left out.
    </Alert>
  );
}

/** While a page's figures are on their way. */
function SectionSkeleton() {
  return (
    <div className="flex flex-col gap-3" role="status" aria-busy="true" aria-label="Loading">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-surface-2" />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-xl bg-surface-2" />
    </div>
  );
}
