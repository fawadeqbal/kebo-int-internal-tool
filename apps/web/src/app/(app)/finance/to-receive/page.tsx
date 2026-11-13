import { redirect } from "next/navigation";
import { can } from "@kebo/shared";
import { ButtonLink, PageHeader, Segmented } from "@kebo/ui";
import { Banknote, FileText } from "lucide-react";
import { api } from "@/lib/api";
import type { Receivables } from "@/lib/types-insights";
import { PartyAgeing } from "@/components/money/party-ageing";
import { AgeingStrip } from "@/components/ledger/ageing-strip";
import { crumbsFor } from "@/lib/nav";
import { requirePermission } from "@/lib/session";
import { InvoicesBody, moneyAccess, ReceiveBody } from "../sections";

export const metadata = { title: "To receive" };

/**
 * Finance & general ledger › Receivables (AR): what customers still owe us, invoice by invoice (each instalment
 * with its payment request number), or order by order; the most overdue first.
 */
export default async function ToReceivePage({ searchParams }: { searchParams: Promise<{ view?: string; q?: string; cur?: string; age?: string }> }) {
  const sp = await searchParams;
  const byOrder = sp.view === "orders";
  const byInvoice = sp.view === "invoices";
  const me = await requirePermission("sourcing.manage");
  if (!(await moneyAccess(me)).recorders) redirect("/forbidden");
  return (
    <div>
      <PageHeader
        crumbs={crumbsFor("/finance/to-receive")}
        icon={FileText}
        title="Receivables"
        summary="What customers owe us, by age"
        primary={
          can(me, "payments.record") ? (
            <ButtonLink href="/payments/new?kind=in" variant="primary">
              <Banknote aria-hidden /> Record payment
            </ButtonLink>
          ) : undefined
        }
      />
      <Segmented
        label="Show"
        className="mb-4"
        options={[
          { href: "/finance/to-receive", label: "By customer", active: !byOrder && !byInvoice },
          { href: "/finance/to-receive?view=invoices", label: "By invoice", active: byInvoice },
          { href: "/finance/to-receive?view=orders", label: "By order", active: byOrder },
        ]}
      />
      {byOrder ? (
        <ReceiveBody />
      ) : byInvoice ? (
        <>
          {can(me, "ledger.view") && <AgeingStrip side="receivable" />}
          <InvoicesBody side="receivable" />
        </>
      ) : (
        <PartyAgeing side="receivable" base="/finance/to-receive" sp={sp} held={(await api.get<Receivables>("/money/receivables").catch(() => null))?.held} />
      )}
    </div>
  );
}
