import { redirect } from "next/navigation";
import { PageHeader, linkClass, cn } from "@kebo/ui";
import { PlanOff } from "@/components/common/plan-off";
import { crumbsFor, labelFor } from "@/lib/nav";
import { requirePermission } from "@/lib/session";
import { CashBody, moneyAccess, VaultOverview, type Search } from "../sections";
import { companyToday } from "@/lib/format";
import Link from "next/link";

import { api } from "@/lib/api";
import { MoveMoney, NewAccount, type AccountRow } from "@/components/money/cash-forms";

export const metadata = { title: "Cash & bank" };

/** Treasury & payments › Multi-currency vault (the cash book): where our money is (each account), and every amount in and out in a month or a year. */
export default async function CashBookPage({ searchParams }: { searchParams: Promise<Search> }) {
  const me = await requirePermission("sourcing.manage");
  const a = await moneyAccess(me);
  if (!a.managers) redirect("/forbidden");
  const crumbs = crumbsFor("/finance/cash-book");
  if (!a.cashBook) return <PlanOff title={labelFor("/finance/cash-book")} what="The cash book" crumbs={crumbs} />;
  const sp = await searchParams;
  const today = companyToday();
  // The overview first (board Vault); an account, a period, or "the whole cash book" opens the book itself.
  const book = !!(sp.acct || sp.p || sp.cur || (sp as { book?: string }).book);
  const accounts = await api.get<AccountRow[]>("/money/accounts");
  return (
    <div>
      <PageHeader
        kind="list"
        crumbs={crumbs}
        title={labelFor("/finance/cash-book")}
        actions={<MoveMoney accounts={accounts} today={today} />}
        primary={<NewAccount today={today} />}
      />
      {book ? (
        <>
          <Link href="/finance/cash-book" className={cn(linkClass, "mb-3 inline-block text-sm")}>
            ← All bank accounts
          </Link>
          <CashBody sp={sp} today={today} />
        </>
      ) : (
        <VaultOverview today={today} />
      )}
    </div>
  );
}
