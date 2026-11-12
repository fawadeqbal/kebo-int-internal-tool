import { redirect } from "next/navigation";
import { PageHeader } from "@kebo/ui";
import { todayIn } from "@kebo/utils";
import { PlanOff } from "@/components/common/plan-off";
import { crumbsFor, labelFor } from "@/lib/nav";
import { requirePermission } from "@/lib/session";
import { CashBody, moneyAccess, TZ, VaultOverview, type Search } from "../sections";
import Link from "next/link";
import { Landmark } from "lucide-react";
import { api } from "@/lib/api";
import { MoveMoney, NewAccount, type AccountRow } from "@/components/money/cash-forms";

export const metadata = { title: "Multi-currency vault" };

/** Treasury & payments › Multi-currency vault (the cash book): where our money is (each account), and every amount in and out in a month or a year. */
export default async function CashBookPage({ searchParams }: { searchParams: Promise<Search> }) {
  const me = await requirePermission("sourcing.manage");
  const a = await moneyAccess(me);
  if (!a.managers) redirect("/forbidden");
  const crumbs = crumbsFor("/finance/cash-book");
  if (!a.cashBook) return <PlanOff title={labelFor("/finance/cash-book")} what="The cash book" crumbs={crumbs} />;
  const sp = await searchParams;
  const today = todayIn(TZ);
  // The overview first (board Vault); an account, a period, or "the whole cash book" opens the book itself.
  const book = !!(sp.acct || sp.p || sp.cur || (sp as { book?: string }).book);
  const accounts = await api.get<AccountRow[]>("/money/accounts");
  return (
    <div>
      <PageHeader
        crumbs={crumbs}
        icon={Landmark}
        title={labelFor("/finance/cash-book")}
        summary={book ? "Every amount in and out: from customers, to factories, expenses and moves between our accounts." : "Every account and what is in it"}
        actions={<MoveMoney accounts={accounts} today={today} />}
        primary={<NewAccount today={today} />}
      />
      {book ? (
        <>
          <Link href="/finance/cash-book" className="mb-3 inline-block text-sm font-medium text-primary hover:underline">
            ← All accounts
          </Link>
          <CashBody sp={sp} today={today} />
        </>
      ) : (
        <VaultOverview today={today} />
      )}
    </div>
  );
}
