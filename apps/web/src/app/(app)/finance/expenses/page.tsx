import { redirect } from "next/navigation";
import { PageHeader } from "@kebo/ui";
import { todayIn } from "@kebo/utils";
import { PlanOff } from "@/components/common/plan-off";
import { crumbsFor, labelFor } from "@/lib/nav";
import { requirePermission } from "@/lib/session";
import { ExpensesBody, moneyAccess, TZ, type Search } from "../sections";

export const metadata = { title: "Cost & expense allocation" };

/** Finance › Expenses: every cost in a month or a year, running the company and spent on customers. */
export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const me = await requirePermission("sourcing.manage");
  const a = await moneyAccess(me);
  if (!a.managers) redirect("/forbidden");
  const crumbs = crumbsFor("/finance/expenses");
  if (!a.expenses) return <PlanOff title={labelFor("/finance/expenses")} what="Expenses" crumbs={crumbs} />;
  const sp = await searchParams;
  return (
    <div>
      <PageHeader crumbs={crumbs} title={labelFor("/finance/expenses")} description="What the company spends to run, and what is spent on each customer and their orders." />
      <ExpensesBody sp={sp} today={todayIn(TZ)} />
    </div>
  );
}
