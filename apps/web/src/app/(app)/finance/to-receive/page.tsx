import { redirect } from "next/navigation";
import { can } from "@kebo/shared";
import { PageHeader, Segmented } from "@kebo/ui";
import { AgeingStrip } from "@/components/ledger/ageing-strip";
import { crumbsFor, labelFor } from "@/lib/nav";
import { requirePermission } from "@/lib/session";
import { InvoicesBody, moneyAccess, ReceiveBody } from "../sections";

export const metadata = { title: "Receivables (AR)" };

/**
 * Finance & general ledger › Receivables (AR): what customers still owe us, invoice by invoice (each instalment
 * with its payment request number), or order by order; the most overdue first.
 */
export default async function ToReceivePage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const byOrder = (await searchParams).view === "orders";
  const me = await requirePermission("sourcing.manage");
  if (!(await moneyAccess(me)).recorders) redirect("/forbidden");
  return (
    <div>
      <PageHeader crumbs={crumbsFor("/finance/to-receive")} title={labelFor("/finance/to-receive")} description="What customers still owe us. Overdue first." />
      {can(me, "ledger.view") && <AgeingStrip side="receivable" />}
      <Segmented
        label="Show"
        className="mb-4"
        options={[
          { href: "/finance/to-receive", label: "By invoice", active: !byOrder },
          { href: "/finance/to-receive?view=orders", label: "By order", active: byOrder },
        ]}
      />
      {byOrder ? <ReceiveBody /> : <InvoicesBody side="receivable" />}
    </div>
  );
}
