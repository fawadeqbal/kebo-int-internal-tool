import { redirect } from "next/navigation";
import { EXPENSE_CATEGORIES, type ExpenseCategory } from "@kebo/shared";
import { buildHref, Card, EmptyState, LinkTabs, PAGE_SIZE, PageHeader, Pager, StatRow, StatTile, toPage } from "@kebo/ui";
import { addDays } from "@kebo/utils";
import { api } from "@/lib/api";
import { money, whole, companyToday, countOf } from "@/lib/format";
import { crumbsFor } from "@/lib/nav";
import { getPeople, getSettings } from "@/lib/loaders";
import { requirePermission } from "@/lib/session";
import type { ExpenseList, RepeatingCosts } from "@/lib/types-money";
import { PlanOff } from "@/components/common/plan-off";
import { ExportCsv } from "@/components/sheets/export-link";
import { Section } from "@/components/order-sections/section";
import { ExpenseRecord } from "@/components/money/expense-record";
import { RepeatingRow } from "@/components/money/company-costs";
import { AddCost, type CostSetup } from "@/components/money/cost-window";
import { COMPANY } from "@/components/money/cost-kinds";
import { companyKind } from "@/components/money/company-kinds";
import { moneyAccess } from "../../finance/sections";
import { FilterCard } from "@/components/common/filter-card";

export const metadata = { title: "Company costs" };

const HERE = "/money/company-costs";
const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
type Search = { p?: string; kind?: string; page?: string; q?: string };

/** The first and the last day of a month ("2026-11"). */
const span = (month: string) => ({ from: `${month}-01`, to: addDays(`${addDays(`${month}-28`, 4).slice(0, 7)}-01`, -1) });

/**
 * Money › Company costs (design "money, simple", board MCompany): what the company spends that is not a
 * cost of one order: rent, salaries, the office, and what is spent on customers and deals before there is
 * an order. A cost that comes every month is proposed here each month; one click confirms it. An order's
 * costs are on the order.
 */
export default async function CompanyCostsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const me = await requirePermission("sourcing.manage");
  const a = await moneyAccess(me);
  if (!a.managers) redirect("/forbidden");
  const crumbs = crumbsFor(HERE);
  if (!a.expenses) return <PlanOff title="Company costs" what="Company costs" crumbs={crumbs} />;
  const sp = await searchParams;
  const today = companyToday();
  const thisMonth = today.slice(0, 7);
  const month = /^\d{4}-\d{2}$/.test(sp.p ?? "") && sp.p! <= thisMonth ? sp.p! : thisMonth;
  const prev = addDays(`${month}-01`, -1).slice(0, 7);
  const category = (EXPENSE_CATEGORIES as readonly string[]).includes(sp.kind ?? "") ? (sp.kind as ExpenseCategory) : undefined;
  const q = { kind: "company" };
  const text = sp.q?.trim() || undefined;
  const [list, unsearched, before, year, repeating, people, settings] = await Promise.all([
    api.get<ExpenseList>("/expenses", { ...q, ...span(month), category, q: text, page: String(toPage(sp.page)), pageSize: String(PAGE_SIZE) }),
    // The figures over the list are the month's, whatever is searched.
    text ? api.get<ExpenseList>("/expenses", { ...q, ...span(month), pageSize: "1" }) : null,
    api.get<ExpenseList>("/expenses", { ...q, ...span(prev), pageSize: "1" }),
    api.get<ExpenseList>("/expenses", { ...q, from: `${month.slice(0, 4)}-01-01`, to: `${month.slice(0, 4)}-12-31`, pageSize: "1" }),
    api.get<RepeatingCosts>("/expenses/repeating"),
    getPeople(),
    getSettings(),
  ]);
  const c = list.currency;
  const fx = { main: settings.sales.currency, rates: settings.sales.exchangeRates };
  const setup: CostSetup = { mainCurrency: fx.main, fx, today, people, for: COMPANY };
  const keep = { p: month === thisMonth ? undefined : month, kind: category, q: sp.q };
  const href = (change: Record<string, string | undefined>) => buildHref(HERE, keep, { page: undefined, ...change });
  const monthName = MONTH_YEAR.format(new Date(`${month}-01T00:00:00Z`));
  // The month's total over every kind (the list may be narrowed to one, or searched).
  const month0 = unsearched ?? list;
  const monthTotal = month0.byCategory.reduce((t, k) => t + Number(k.total), 0);
  const monthCount = month0.byCategory.reduce((t, k) => t + k.count, 0);
  // The kinds' tabs count what the search finds, so each number is what its tab lists.
  const foundCount = list.byCategory.reduce((t, k) => t + k.count, 0);
  const change = Number(before.total) > 0 ? Math.round(((monthTotal - Number(before.total)) / Number(before.total)) * 100) : null;
  const biggest = month0.byCategory[0];

  return (
    <div>
      <PageHeader
        crumbs={crumbs}
        title="Company costs"
        summary="Rent, salaries and the office: what the company spends that is not for one order"
        actions={list.count > 0 ? <ExportCsv what="expenses" query={{ ...span(month), category, q: text }} /> : undefined}
        primary={<AddCost setup={setup} label="Add company cost" icon={null} />}
      />
      <StatRow className="mb-4">
        <StatTile label={month === thisMonth ? "This month" : monthName} value={whole(monthTotal, c)} sub={`${monthCount} cost${monthCount === 1 ? "" : "s"}`} />
        <StatTile label={month === thisMonth ? "Last month" : "The month before"} value={whole(before.total, c)} sub={change === null ? "—" : `${change > 0 ? "+" : ""}${change}% since`} />
        <StatTile label={`In ${month.slice(0, 4)}`} value={whole(year.total, c)} sub={`${year.count} cost${year.count === 1 ? "" : "s"}`} />
        <StatTile label="Biggest kind" value={biggest ? companyKind(biggest.category) : "—"} sub={biggest && monthTotal > 0 ? `${whole(biggest.total, c)} · ${Math.round((Number(biggest.total) / monthTotal) * 100)}%` : "nothing yet"} />
      </StatRow>

      {month === thisMonth && repeating.waiting.length > 0 && (
        <div className="mb-4">
          <Section title="To confirm this month" state={`${repeating.waiting.length} waiting`} tone="warn">
            <ul className="flex flex-col divide-y divide-line border-t border-line">
              {repeating.waiting.map((w) => (
                <RepeatingRow key={w.key} w={w} setup={setup} />
              ))}
            </ul>
          </Section>
        </div>
      )}

      <div className="mb-4">
        <LinkTabs
          label="Which kind"
          tabs={[
            { href: href({ kind: undefined }), label: "All", count: foundCount, active: !category },
            ...list.byCategory.map((k) => ({ href: href({ kind: k.category }), label: companyKind(k.category), count: k.count, active: category === k.category })),
          ]}
        />
      </div>

      <FilterCard
        search="Search what it was for, a note or who was paid…"
        value={sp.q}
        keep={{ kind: category }}
        month={{
          name: "p",
          current: month,
          base: thisMonth,
          thisMonth,
          label: monthName,
          // This month and the eleven before it.
          options: Array.from({ length: 12 }, (_, i) => addDays(`${thisMonth}-15`, -30 * i).slice(0, 7))
            .filter((m, i, all) => all.indexOf(m) === i)
            .map((m) => ({ value: m, label: MONTH_YEAR.format(new Date(`${m}-01T00:00:00Z`)) })),
        }}
        count={countOf(list.count, "cost")}
      />

      <Card className="overflow-hidden p-0">
        {list.rows.length === 0 ? (
          text ? (
            <EmptyState framed title="No cost matches" description={`Nothing in ${monthName} matches “${text}”. Try other words, or clear the search.`} />
          ) : (
            <EmptyState framed title={`No company costs in ${monthName}`} description="Add the rent, the salaries and the office's bills here. A cost of one order is added on that order." />
          )
        ) : (
          <>
            <ul className="flex flex-col divide-y divide-line" aria-label="Company costs">
              {list.rows.map((e) => (
                <ExpenseRecord key={e.id} e={e} mainCurrency={c} people={people} fx={fx} today={today} />
              ))}
            </ul>
            <p className="flex items-baseline justify-between gap-3 border-t-2 border-line-strong px-4 py-3 text-sm font-bold">
              <span>
                Total{category ? ` · ${companyKind(category)}` : ""} · {monthName}
              </span>
              <span className="tabular">{money(list.total, c)}</span>
            </p>
          </>
        )}
      </Card>
      <Pager base={HERE} params={keep} page={list.page} pageSize={list.pageSize} total={list.listed} bare />
    </div>
  );
}
