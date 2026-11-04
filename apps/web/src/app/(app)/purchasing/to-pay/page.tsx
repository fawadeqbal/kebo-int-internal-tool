import { can } from "@kebo/shared";
import { PageHeader } from "@kebo/ui";
import { AgeingStrip } from "@/components/ledger/ageing-strip";
import { crumbsFor } from "@/lib/nav";
import { requirePermission } from "@/lib/session";
import { OweBody } from "../../finance/sections";

export const metadata = { title: "To pay factories" };

/** Purchasing › To pay factories: what we still owe each factory for the goods on our orders. */
export default async function ToPayPage({ searchParams }: { searchParams: Promise<{ mine?: string }> }) {
  const me = await requirePermission("sourcing.manage");
  const { mine } = await searchParams;
  return (
    <div>
      <PageHeader crumbs={crumbsFor("/purchasing/to-pay")} title="To pay factories" description="What we still owe each factory, order by order, and what is next." />
      {can(me, "ledger.view") && mine !== "1" && <AgeingStrip side="payable" />}
      <OweBody mine={mine === "1"} />
    </div>
  );
}
