import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { can } from "@kebo/shared";
import { Alert, buildHref, buttonClass, Input, PageHeader, SectionNav, Segmented } from "@kebo/ui";
import { todayIn } from "@kebo/utils";
import { api } from "@/lib/api";
import { hasFeature, requirePermission } from "@/lib/session";
import { PlanOff } from "@/components/common/plan-off";
import { PERIOD_KINDS, PERIOD_LABEL, periodOf, SECTION_LABEL, SECTIONS, sectionOfTab, type Period, type Section } from "@/lib/insights-period";
import { CUSTOMER_CHIPS, loadCustomers, loadFactories, loadFunnel, loadMoney, loadOverview, loadPeople, type CustomerChip } from "@/lib/insights-data";
import type { LeaksReport } from "@/lib/types-money";
import type { AgeBucket } from "@/lib/types-facts";
import { SectionList } from "@/components/insights/frame";
import { Overview } from "@/components/insights/overview";
import { MoneySection } from "@/components/insights/money-section";
import { CustomersSection, FactoriesSection, FunnelSection, PeopleSection } from "@/components/insights/parties-sections";
import { TargetsView } from "@/components/insights/targets-view";
import { LEAK_VIEWS, LeaksBody, type LeakView } from "@/components/insights/leaks";
import { ProfitTable } from "@/components/insights/pnl";

export const metadata = { title: "Insights" };

const TZ = process.env.APP_TIME_ZONE ?? process.env.NEXT_PUBLIC_APP_TIME_ZONE ?? "Asia/Shanghai";

type Search = {
  section?: string;
  period?: string;
  from?: string;
  to?: string;
  view?: string;
  leak?: string;
  year?: string;
  pl?: string;
  chip?: string;
  page?: string;
  month?: string;
  age?: string;
  side?: string;
  /** Old links. */
  tab?: string;
  sub?: string;
};

const TITLE: Record<Section, string> = {
  overview: "Insights",
  money: "Money",
  customers: "Customers",
  factories: "Factories",
  people: "People",
  funnel: "Funnel",
};
const DESCRIPTION: Record<Section, string> = {
  overview: "How the business is doing · every figure is from the orders and money themselves",
  money: "Cash, what we're owed, what we owe, costs and profit · for people who may see money",
  customers: "Who buys, how much, how well they pay",
  factories: "Who supplies on time and wins our orders",
  people: "Who sells, how fast, and against their targets",
  funnel: "Where inquiries go, and why we lose them",
};

/**
 * Insights (Dashboard frame): the sections on the left, one period for every figure in the header with the
 * period before to compare, tiles, one chart per question, short lists. All figures come from the Insights
 * tables (GET /insights/facts/*).
 */
export default async function InsightsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const me = await requirePermission("reports.view");
  if (!(await hasFeature("insights"))) return <PlanOff title="Insights" what="Insights (sales, profit and team reports)" />;
  const sp = await searchParams;

  // Old links (?tab=sales, ?tab=profit&sub=pnl, ?tab=targets…) land on the section that has it now.
  const old = sectionOfTab(sp.tab);
  if (old) {
    const custom = sp.from && sp.to;
    const view = old.view ?? (sp.tab === "profit" && sp.sub ? (sp.sub === "pnl" ? "pnl" : "leaks") : undefined);
    redirect(
      buildHref("/insights", {}, {
        section: old.section === "overview" ? undefined : old.section,
        view,
        leak: view === "leaks" ? sp.sub : undefined,
        year: sp.year,
        pl: sp.pl,
        period: custom ? "custom" : undefined,
        from: custom ? sp.from : undefined,
        to: custom ? sp.to : undefined,
      }),
    );
  }

  const seeMoney = can(me, "expenses.manage");
  const sections = SECTIONS.filter((s) => s !== "money" || seeMoney);
  const section: Section = (sections as readonly string[]).includes(sp.section ?? "") ? (sp.section as Section) : "overview";
  const today = todayIn(TZ);
  const p = periodOf(sp, today);
  const keep = {
    section: section === "overview" ? undefined : section,
    period: p.kind === "quarter" ? undefined : p.kind,
    from: p.kind === "custom" ? p.from : undefined,
    to: p.kind === "custom" ? p.to : undefined,
  };
  const href = (patch: Record<string, string | undefined>) => buildHref("/insights", keep, patch);
  const sectionHref = (s: Section) => buildHref("/insights", { ...keep, section: s === "overview" ? undefined : s }, {});

  const [customers, factories, people] = await Promise.all([
    api.get<{ total: number }>("/customers", { pageSize: 1 }).catch(() => null),
    api.get<{ total: number }>("/factories", { pageSize: 1 }).catch(() => null),
    api.get<{ people: unknown[] }>("/insights/targets/people", { year: today.slice(0, 4) }).catch(() => null),
  ]);
  const count: Partial<Record<Section, number | undefined>> = { customers: customers?.total, factories: factories?.total, people: people?.people.length };
  const navItems = sections.map((s) => ({ href: sectionHref(s), label: SECTION_LABEL[s], active: s === section, count: count[s] }));
  const excel = buildHref("/sheets/export/insights", {}, { section, period: p.kind, from: p.from, to: p.to });
  const subView = (section === "money" && (sp.view === "pnl" || sp.view === "leaks")) || (section === "people" && sp.view === "targets" && seeMoney);

  const periodPicker = (
    <Segmented
      label="Period"
      className="bg-surface-2"
      options={PERIOD_KINDS.map((k) => ({
        href: buildHref("/insights", keep, {
          period: k === "quarter" ? undefined : k,
          from: k === "custom" ? p.from : undefined,
          to: k === "custom" ? p.to : undefined,
          page: undefined,
          month: undefined,
        }),
        label: PERIOD_LABEL[k],
        active: p.kind === k,
      }))}
    />
  );

  return (
    <div>
      <PageHeader
        title={TITLE[section]}
        description={<span className="max-md:hidden">{DESCRIPTION[section]}</span>}
        actions={
          <div className="no-print flex flex-wrap items-center gap-x-3 gap-y-2 max-md:hidden">
            {periodPicker}
            <span className="text-xs text-text-2">
              {p.label} · vs {p.vsLabel}
            </span>
            {!subView && (
              <a href={excel} className={buttonClass("ghost", "sm")} download>
                Excel
              </a>
            )}
          </div>
        }
      />
      <div className="mb-4 flex flex-col gap-3 lg:hidden">
        <SectionNav label="Insights sections" items={navItems.map((i) => ({ href: i.href, label: i.label, active: i.active, count: i.count ?? undefined }))} />
        <div className="md:hidden">
          {periodPicker}
          <p className="mt-1.5 text-xs text-text-2">
            {p.label} · vs {p.vsLabel}
          </p>
        </div>
      </div>
      {p.kind === "custom" && (
        <form action="/insights" className="no-print mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-line bg-surface px-4 py-3 shadow-card">
          {keep.section && <input type="hidden" name="section" value={keep.section} />}
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

      <div className="lg:grid lg:grid-cols-[180px_minmax(0,1fr)] lg:items-start lg:gap-5">
        <SectionList label="Insights sections" items={navItems} />
        <div className="min-w-0">
          <Suspense key={`${section}-${p.from}-${p.to}-${sp.view ?? ""}`} fallback={<SectionSkeleton />}>
            <SectionBody section={section} p={p} sp={sp} today={today} seeMoney={seeMoney} href={href} keep={keep} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

async function SectionBody({
  section,
  p,
  sp,
  today,
  seeMoney,
  href,
  keep,
}: {
  section: Section;
  p: Period;
  sp: Search;
  today: string;
  seeMoney: boolean;
  href: (patch: Record<string, string | undefined>) => string;
  keep: Record<string, string | undefined>;
}) {
  switch (section) {
    case "overview": {
      const d = await loadOverview(p, seeMoney, sp.month);
      return (
        <>
          <Missing rates={d.missingRates} />
          <Overview d={d} p={p} href={href} />
        </>
      );
    }
    case "money": {
      if (sp.view === "pnl")
        return (
          <SubView title="Profit and loss, month by month" back={href({})}>
            <ProfitTable year={sp.year} cash={sp.pl === "cash"} href={(change) => buildHref("/insights", { ...keep, view: "pnl", year: sp.year, pl: sp.pl }, change)} />
          </SubView>
        );
      if (sp.view === "leaks") {
        const r = await api.get<LeaksReport>("/reports/leaks", { from: p.from, to: p.to < today ? p.to : today });
        const view: LeakView = (LEAK_VIEWS as readonly string[]).includes(sp.leak ?? "") ? (sp.leak as LeakView) : "attention";
        return (
          <SubView title="Where we lose money" back={href({})}>
            <LeaksBody r={r} view={view} href={(v) => buildHref("/insights", { ...keep, view: "leaks" }, { leak: v })} />
          </SubView>
        );
      }
      const age = sp.age && sp.side && ["notDue", "d30", "d60", "over60"].includes(sp.age) && ["receivable", "payable"].includes(sp.side) ? { side: sp.side as "receivable" | "payable", bucket: sp.age as AgeBucket | "over60" } : undefined;
      const d = await loadMoney(p, age);
      return (
        <>
          <Missing rates={d.missingRates} />
          <MoneySection d={d} p={p} href={href} />
        </>
      );
    }
    case "customers": {
      const chip: CustomerChip = (CUSTOMER_CHIPS as readonly string[]).includes(sp.chip ?? "") ? (sp.chip as CustomerChip) : "all";
      const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
      const d = await loadCustomers(p, today);
      return <CustomersSection d={d} p={p} href={href} chip={chip} page={page} params={{ ...keep, chip: chip === "all" ? undefined : chip }} />;
    }
    case "factories":
      return <FactoriesSection d={await loadFactories(p)} p={p} page={Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1)} params={keep} />;
    case "people": {
      if (sp.view === "targets" && seeMoney) {
        const year = /^\d{4}$/.test(sp.year ?? "") ? Number(sp.year) : Number(today.slice(0, 4));
        return <TargetsView year={year} today={today} back={href({})} />;
      }
      return <PeopleSection d={await loadPeople(p, today)} p={p} canSet={seeMoney} href={href} />;
    }
    case "funnel":
      return <FunnelSection d={await loadFunnel(p)} p={p} />;
  }
}

function SubView({ title, back, children }: { title: string; back: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{title}</h2>
        <Link href={back} className={buttonClass("ghost", "sm")}>
          ← Back
        </Link>
      </div>
      {children}
    </div>
  );
}

function Missing({ rates }: { rates: string[] }) {
  if (!rates.length) return null;
  return (
    <Alert tone="warning" className="mb-4">
      There is no exchange rate for {rates.join(", ")} in Settings, so amounts in {rates.length === 1 ? "it are" : "them are"} left out.
    </Alert>
  );
}

/** While a section's figures are on their way. */
function SectionSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-surface-2" />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-xl bg-surface-2" />
    </div>
  );
}
