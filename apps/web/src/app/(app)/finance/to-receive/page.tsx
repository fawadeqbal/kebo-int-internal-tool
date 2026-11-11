import { redirect } from "next/navigation";
import { can } from "@kebo/shared";
import { PageHeader } from "@kebo/ui";
import { AgeingStrip } from "@/components/ledger/ageing-strip";
import { crumbsFor, labelFor } from "@/lib/nav";
import { requirePermission } from "@/lib/session";
import { moneyAccess, ReceiveBody } from "../sections";

export const metadata = { title: "Receivables (AR)" };

/** Finance & general ledger › Receivables (AR): what customers still owe us, order by order, the most overdue first. */
export default async function ToReceivePage() {
  const me = await requirePermission("sourcing.manage");
  if (!(await moneyAccess(me)).recorders) redirect("/forbidden");
  return (
    <div>
      <PageHeader crumbs={crumbsFor("/finance/to-receive")} title={labelFor("/finance/to-receive")} description="What customers still owe us, order by order. Overdue first." />
      {can(me, "ledger.view") && <AgeingStrip side="receivable" />}
      <ReceiveBody />
    </div>
  );
}
