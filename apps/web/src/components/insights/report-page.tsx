import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";
import { can } from "@kebo/shared";
import { Alert, buildHref, buttonClass, Card, CardHeader, Input, LinkTabs, PageHeader, Segmented } from "@kebo/ui";
import { todayIn } from "@kebo/utils";
import { api } from "@/lib/api";
import { hasFeature, requirePermission } from "@/lib/session";
import { crumbsFor, labelFor } from "@/lib/nav";
import { SECTION_PATH, viewPath } from "@/lib/old-addresses";
import { PlanOff } from "@/components/common/plan-off";
import { FileActions } from "@/components/common/file-actions";
import { PERIOD_KINDS, PERIOD_LABEL, periodOf, type Period, type Section } from "@/lib/insights-period";
import { CUSTOMER_CHIPS, loadCustomers, loadFactories, loadFunnel, loadMoney, loadOverview, loadPeople, type CustomerChip } from "@/lib/insights-data";
import type { LeaksReport } from "@/lib/types-money";
import type { AgeBucket } from "@/lib/types-facts";
import { Overview } from "./overview";
import { MoneySection } from "./money-section";
import { CustomersSection, FactoriesSection, FunnelSection, PeopleSection } from "./parties-sections";
import { TargetsView } from "./targets-view";
import { LEAK_VIEWS, LeaksBody, type LeakView } from "./leaks";
import { ProfitTable } from "./pnl";
import { TZ } from "@/lib/format";

export type ReportSearch = {
  period?: string;
  from?: string;
  to?: string;
  leak?: string;
  year?: string;
  pl?: string;
  chip?: string;
  page?: string;
  month?: string;
  age?: string;
  side?: string;
};

/** What each page is: Insights' sections (and the money ones' sub-views), each at its own address now. */
export type ReportKind = "overview" | "customers" | "factories" | "people" | "targets" | "funnel" | "profit" | "leaks";

const SECTION_OF: Record<ReportKind, Section> = {
  overview: "overview",
  customers: "customers",
  factories: "factories",
  people: "people",
  targets: "people",
  funnel: "funnel",
  profit: "money",
  leaks: "money",
};
const PATH_OF: Record<ReportKind, string> = {
  overview: "/reports",
  customers: "/reports/customers",
  factories: "/reports/factories",
  people: "/reports/people",
  targets: "/reports/people/targets",
  funnel: "/reports/funnel",
  profit: "/finance/profit",
  leaks: "/finance/leaks",
};
/** The sidebar item each page is under: the reports share Overview › Analytics & reports; the money ones have their own. */
const ITEM_OF: Record<ReportKind, string> = {
  overview: "/reports",
  customers: "/reports",
  factories: "/reports",
  people: "/reports",
  targets: "/reports",
  funnel: "/reports",
  profit: "/finance/profit",
  leaks: "/finance/leaks",
};
/** A report's own title (the overview and the money pages take their sidebar item's name). */
const REPORT_TITLE: Partial<Record<ReportKind, string>> = {
  customers: "Customers",
  factories: "Suppliers",
  people: "People & targets",
  targets: "Targets",
  funnel: "Sales funnel",
};
/** The reports as tabs under the title (they were sidebar items): the same period goes with you. */
const REPORT_TABS: { key: ReportKind | "print"; href: string; label: string }[] = [
  { key: "overview", href: "/reports", label: "Overview" },
  { key: "customers", href: "/reports/customers", label: "Customers" },
  { key: "factories", href: "/reports/factories", label: "Suppliers" },
  { key: "people", href: "/reports/people", label: "People & targets" },
  { key: "funnel", href: "/reports/funnel", label: "Sales funnel" },
  { key: "print", href: "/reports/print", label: "Printable reports" },
];
const REPORTS_CRUMBS = [...crumbsFor("/reports").slice(0, 1), { label: labelFor("/reports"), href: "/reports" }];

function ReportTabs({ current, keep }: { current: ReportKind | "print"; keep: Record<string, string | undefined> }) {
  const active = current === "targets" ? "people" : current;
  return (
    <LinkTabs
      label="Reports"
      className="no-print mt-3"
      tabs={REPORT_TABS.map((t) => ({ href: buildHref(t.href, keep, {}), label: t.label, active: t.key === active }))}
    />
  );
}
const DESCRIPTION: Record<ReportKind, string> = {
  overview: "How the business is doing · every figure is from the orders and money themselves",
  customers: "Who buys, how much, how well they pay",
  factories: "Who supplies on time and wins our orders",
  people: "Who sells, how fast, and against their targets",
  targets: "Monthly sales targets for the company and each person",
  funnel: "Where inquiries go, and why we lose them",
  profit: "Cash, what we're owed, what we owe, costs and profit, then the profit and loss month by month",
  leaks: "Where we lose money: deals, orders, customers and spending",
};

/**
 * One of the reports (Dashboard frame, without its section list: the sidebar has the pages now):
 * one period for every figure in the header with the period before to compare, tiles, one chart
 * per question, short lists. All figures come from the Insights tables (GET /insights/facts/*).
 * Overview › Analytics & reports (tabs: Overview, Customers, Suppliers, People & targets, Sales funnel, Printable reports);
 * Revenue & profitability › Profit & loss, Variance analysis.
 */
export async function ReportPage({ kind, searchParams }: { kind: ReportKind; searchParams: Promise<ReportSearch> }) {
  const me = await requirePermission("reports.view");
  const item = ITEM_OF[kind];
  const tabbed = item === "/reports";
  const crumbs = tabbed && kind !== "overview" ? REPORTS_CRUMBS : crumbsFor(item);
  const title = REPORT_TITLE[kind] ?? labelFor(item);
  if (!(await hasFeature("insights"))) return <PlanOff title={title} what="Insights (sales, profit and team reports)" crumbs={crumbs} />;
  const seeMoney = can(me, "expenses.manage");
  // Money (profit, leaks) and setting targets: for people who may see money, as on Insights.
  if ((kind === "profit" || kind === "leaks" || kind === "targets") && !seeMoney) redirect(kind === "targets" ? "/reports/people" : "/forbidden");
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
  const excel = kind === "targets" || kind === "leaks" ? undefined : buildHref("/sheets/export/insights", {}, { section, period: p.kind, from: p.from, to: p.to });

  const periodPicker = (
    <Segmented
      label="Period"
      className="bg-surface-2"
      options={PERIOD_KINDS.map((k) => ({
        href: buildHref(path, keep, {
          period: k === "quarter" ? undefined : k,
          from: k === "custom" ? p.from : undefined,
          to: k === "custom" ? p.to : undefined,
          year: sp.year,
          pl: sp.pl,
          leak: sp.leak,
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
        {tabbed && <ReportTabs current={kind} keep={keep} />}
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
      const age =
        sp.age && sp.side && ["notDue", "d30", "d60", "over60"].includes(sp.age) && ["receivable", "payable"].includes(sp.side)
          ? { side: sp.side as "receivable" | "payable", bucket: sp.age as AgeBucket | "over60" }
          : undefined;
      const d = await loadMoney(p, age);
      return (
        <div className="flex flex-col gap-6">
          <div>
            <Missing rates={d.missingRates} />
            <MoneySection d={d} p={p} href={href} />
          </div>
          <section id="pnl" aria-labelledby="pnl-title" className="flex scroll-mt-20 flex-col gap-4">
            <h2 id="pnl-title" className="text-base font-semibold">
              Profit and loss, month by month
            </h2>
            <ProfitTable year={sp.year} cash={sp.pl === "cash"} href={(change) => `${buildHref(path, { ...keep, year: sp.year, pl: sp.pl }, change)}#pnl`} />
          </section>
        </div>
      );
    }
    case "leaks": {
      const r = await api.get<LeaksReport>("/reports/leaks", { from: p.from, to: p.to < today ? p.to : today });
      const view: LeakView = (LEAK_VIEWS as readonly string[]).includes(sp.leak ?? "") ? (sp.leak as LeakView) : "attention";
      return <LeaksBody r={r} view={view} href={(v) => buildHref(path, keep, { leak: v })} />;
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

/** Overview › Analytics & reports › Printable reports: the sales report as a paper (view, print, PDF) and each report's tables as Excel, for a period. */
export async function PrintableReports({ searchParams }: { searchParams: Promise<ReportSearch & { staff?: string }> }) {
  await requirePermission("reports.view");
  const crumbs = REPORTS_CRUMBS;
  if (!(await hasFeature("insights"))) return <PlanOff title="Printable reports" what="Insights (sales, profit and team reports)" crumbs={crumbs} />;
  const sp = await searchParams;
  const today = todayIn(TZ);
  const p = periodOf(sp, today);
  const path = "/reports/print";
  const reportTo = p.to < today ? p.to : today;
  const q = { from: p.from, to: reportTo, staff: sp.staff };
  const sheets: { section: Section; title: string; what: string }[] = [
    { section: "overview", title: "Overview", what: "The overview's tiles and tables" },
    { section: "customers", title: "Customers", what: "Every customer's sales, profit and payments" },
    { section: "factories", title: "Factories", what: "Every factory's orders and how they delivered" },
    { section: "people", title: "People", what: "Each person's inquiries, quotes, wins and sales" },
    { section: "funnel", title: "Sales funnel", what: "Inquiries by stage, channel and lost reason" },
  ];
  return (
    <div>
      <PageHeader crumbs={crumbs} title="Printable reports" description="The sales report as a paper to print or send, and each report's tables as Excel, for the period you choose.">
        <ReportTabs current="print" keep={{ period: p.kind === "quarter" ? undefined : p.kind, from: p.kind === "custom" ? p.from : undefined, to: p.kind === "custom" ? p.to : undefined }} />
      </PageHeader>
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Segmented
          label="Period"
          className="bg-surface-2"
          options={PERIOD_KINDS.map((k) => ({
            href: buildHref(path, {}, { period: k === "quarter" ? undefined : k, from: k === "custom" ? p.from : undefined, to: k === "custom" ? p.to : undefined }),
            label: PERIOD_LABEL[k],
            active: p.kind === k,
          }))}
        />
        <span className="text-xs text-text-2">{p.label}</span>
      </div>
      {p.kind === "custom" && (
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
        </form>
      )}
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader
            title="Sales report"
            description={`${p.label}: inquiries, quotations, wins and losses, sales, profit and each person, on the company's paper.`}
            actions={<FileActions viewHref={buildHref("/print/report", {}, q)} pdfHref={buildHref("/pdf/report/summary", {}, q)} of="sales report" />}
          />
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title="Tables in Excel" description={`${p.label} · one file per report, a sheet per table`} />
          <ul className="flex flex-col divide-y divide-line">
            {sheets.map((s) => (
              <Row key={s.section} title={s.title} what={s.what}>
                <FileActions excelHref={buildHref("/sheets/export/insights", {}, { section: s.section, period: p.kind, from: p.from, to: p.to })} of={`${s.title.toLowerCase()} report`} />
              </Row>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function Row({ title, what, children }: { title: string; what: string; children: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
      <span className="min-w-0">
        <span className="font-medium">{title}</span>
        <span className="block text-xs text-muted">{what}</span>
      </span>
      {children}
    </li>
  );
}
