import { redirect } from "next/navigation";
import { PageHeader } from "@kebo/ui";
import { todayIn } from "@kebo/utils";
import { PlanOff } from "@/components/common/plan-off";
import { crumbsFor } from "@/lib/nav";
import { requirePermission } from "@/lib/session";
import { CashBody, moneyAccess, TZ, type Search } from "../sections";

export const metadata = { title: "Cash book" };

/** Finance › Cash book: where our money is (each account), and every amount in and out in a month or a year. */
export default async function CashBookPage({ searchParams }: { searchParams: Promise<Search> }) {
  const me = await requirePermission("sourcing.manage");
  const a = await moneyAccess(me);
  if (!a.managers) redirect("/forbidden");
  const crumbs = crumbsFor("/finance/cash-book");
  if (!a.cashBook) return <PlanOff title="Cash book" what="The cash book" crumbs={crumbs} />;
  const sp = await searchParams;
  return (
    <div>
      <PageHeader crumbs={crumbs} title="Cash book" description="Every account, and every amount in and out: from customers, to factories, expenses and moves between our accounts." />
      <CashBody sp={sp} today={todayIn(TZ)} />
    </div>
  );
}
