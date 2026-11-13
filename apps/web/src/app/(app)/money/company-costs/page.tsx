import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { EXPENSE_CATEGORIES, type ExpenseCategory } from "@kebo/shared";
import { buildHref, buttonClass, Card, EmptyState, LinkTabs, PageHeader, Pagination, StatRow, StatTile, toPage } from "@kebo/ui";
import { addDays, todayIn } from "@kebo/utils";
import { api } from "@/lib/api";
import { money, TZ, whole } from "@/lib/format";
import { crumbsFor } from "@/lib/nav";
import { getPeople, getSettings } from "@/lib/loaders";
import { requirePermission } from "@/lib/session";
import type { ExpenseList, RepeatingCosts } from "@/lib/types-money";
import { PlanOff } from "@/components/common/plan-off";
import { ExportLink } from "@/components/sheets/export-link";
import { Section } from "@/components/order-sections/section";
import { ExpenseRecord } from "@/components/money/expense-record";
import type { ExpenseChoices } from "@/components/money/forms";
import { AddCompanyCost, RepeatingRow } from "@/components/money/company-costs";
import { companyKind } from "@/components/money/company-kinds";
import { moneyAccess } from "../../finance/sections";

export const metadata = { title: "Company costs" };

const HERE = "/money/company-costs";
const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
type Search = { p?: string; kind?: string; page?: string };

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
  const today = todayIn(TZ);
  const thisMonth = today.slice(0, 7);
  const month = /^\d{4}-\d{2}$/.test(sp.p ?? "") && sp.p! <= thisMonth ? sp.p! : thisMonth;
  const prev = addDays(`${month}-01`, -1).slice(0, 7);
  const next = addDays(`${month}-28`, 4).slice(0, 7);
  const category = (EXPENSE_CATEGORIES as readonly string[]).includes(sp.kind ?? "") ? (sp.kind as ExpenseCategory) : undefined;
  const q = { kind: "company" };
  const [list, before, year, repeating, people, choices, settings] = await Promise.all([
    api.get<ExpenseList>("/expenses", { ...q, ...span(month), category, page: String(toPage(sp.page)), pageSize: "50" }),
    api.get<ExpenseList>("/expenses", { ...q, ...span(prev), pageSize: "1" }),
    api.get<ExpenseList>("/expenses", { ...q, from: `${month.slice(0, 4)}-01-01`, to: `${month.slice(0, 4)}-12-31`, pageSize: "1" }),
    api.get<RepeatingCosts>("/expenses/repeating"),
    getPeople(),
    api.get<ExpenseChoices>("/expenses/targets"),
    getSettings(),
  ]);
  const c = list.currency;
  const fx = { main: settings.sales.currency, rates: settings.sales.exchangeRates };
  const keep = { p: month === thisMonth ? undefined : month, kind: category };
  const href = (change: Record<string, string | undefined>) => buildHref(HERE, keep, { page: undefined, ...change });
  const monthName = MONTH_YEAR.format(new Date(`${month}-01T00:00:00Z`));
  // The month's total over every kind (the list may be narrowed to one).
  const monthTotal = list.byCategory.reduce((t, k) => t + Number(k.total), 0);
  const monthCount = list.byCategory.reduce((t, k) => t + k.count, 0);
  const change = Number(before.total) > 0 ? Math.round(((monthTotal - Number(before.total)) / Number(before.total)) * 100) : null;
  const biggest = list.byCategory[0];

  return (
    <div>
      <PageHeader
        crumbs={crumbs}
        title="Company costs"
        summary="Rent, salaries and the office: what the company spends that is not for one order"
        actions={list.count > 0 ? <ExportLink what="expenses" query={{ ...span(month), category }} /> : undefined}
        primary={<AddCompanyCost mainCurrency={c} today={today} />}
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
                <RepeatingRow key={w.key} w={w} mainCurrency={c} today={today} />
              ))}
            </ul>
          </Section>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <LinkTabs
          label="Which kind"
          tabs={[
            { href: href({ kind: undefined }), label: "All", active: !category },
            ...list.byCategory.map((k) => ({ href: href({ kind: k.category }), label: companyKind(k.category), count: k.count, active: category === k.category })),
          ]}
        />
        <span className="flex items-center gap-1.5">
          <Link href={href({ p: prev })} aria-label="The month before" className={buttonClass("secondary", "sm", "px-2")}>
            <ChevronLeft aria-hidden />
          </Link>
          <span className="min-w-36 text-center text-sm font-semibold">{monthName}</span>
          {next <= thisMonth ? (
            <Link href={href({ p: next === thisMonth ? undefined : next })} aria-label="The month after" className={buttonClass("secondary", "sm", "px-2")}>
              <ChevronRight aria-hidden />
            </Link>
          ) : (
            <span className={buttonClass("secondary", "sm", "pointer-events-none px-2 opacity-40")} aria-hidden>
              <ChevronRight />
            </span>
          )}
        </span>
      </div>

      <Card className="overflow-hidden p-0">
        {list.rows.length === 0 ? (
          <EmptyState framed title={`No company costs in ${monthName}`} description="Add the rent, the salaries and the office's bills here. A cost of one order is added on that order." />
        ) : (
          <>
            <ul className="flex flex-col divide-y divide-line" aria-label="Company costs">
              {list.rows.map((e) => (
                <ExpenseRecord key={e.id} e={e} mainCurrency={c} people={people} fx={fx} today={today} choices={choices} />
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
        {list.listed > list.pageSize && <Pagination base={HERE} params={keep} page={list.page} pageSize={list.pageSize} total={list.listed} />}
      </Card>
    </div>
  );
}
