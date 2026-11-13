import { can } from "@kebo/shared";
import { ButtonLink, PageHeader, Segmented } from "@kebo/ui";
import { Banknote, FileText } from "lucide-react";
import { PartyAgeing } from "@/components/money/party-ageing";
import { AgeingStrip } from "@/components/ledger/ageing-strip";
import { crumbsFor } from "@/lib/nav";
import { requirePermission } from "@/lib/session";
import { InvoicesBody, OweBody } from "../../finance/sections";

export const metadata = { title: "To pay" };

/**
 * Finance & general ledger › Payables (AP): what we still owe the suppliers for the goods on our orders, invoice
 * by invoice (with their own number once they send one) or factory by factory.
 */
export default async function ToPayPage({ searchParams }: { searchParams: Promise<{ mine?: string; view?: string; q?: string; cur?: string; age?: string }> }) {
  const me = await requirePermission("sourcing.manage");
  const sp = await searchParams;
  const { mine, view } = sp;
  const byFactory = view === "factories";
  const byInvoice = view === "invoices" || mine === "1";
  return (
    <div>
      <PageHeader
        crumbs={crumbsFor("/purchasing/to-pay")}
        icon={FileText}
        title="Payables"
        summary="What we owe suppliers, by age"
        primary={
          can(me, "payments.record") ? (
            <ButtonLink href="/payments/new?kind=out" variant="primary">
              <Banknote aria-hidden /> Pay supplier
            </ButtonLink>
          ) : undefined
        }
      />
      {!byFactory && !byInvoice ? (
        <>
          <Segmented label="Show" className="mb-4" options={showOptions("suppliers", false)} />
          <PartyAgeing side="payable" base="/purchasing/to-pay" sp={sp} />
        </>
      ) : byFactory ? (
        <>
          <Segmented label="Show" className="mb-4" options={showOptions("factories", mine === "1")} />
          <OweBody mine={mine === "1"} />
        </>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-3">
            <Segmented label="Show" options={showOptions("invoices", mine === "1")} />
            <Segmented
              label="Which suppliers"
              options={[
                { href: "/purchasing/to-pay?view=invoices", label: "All suppliers", active: mine !== "1" },
                { href: "/purchasing/to-pay?mine=1", label: "My suppliers", active: mine === "1" },
              ]}
            />
          </div>
          {can(me, "ledger.view") && mine !== "1" && <AgeingStrip side="payable" />}
          <InvoicesBody side="payable" mine={mine === "1"} />
        </>
      )}
    </div>
  );
}

const showOptions = (at: "suppliers" | "invoices" | "factories", mine: boolean) => [
  { href: "/purchasing/to-pay", label: "By supplier", active: at === "suppliers" },
  { href: mine ? "/purchasing/to-pay?view=invoices&mine=1" : "/purchasing/to-pay?view=invoices", label: "By invoice", active: at === "invoices" },
  { href: mine ? "/purchasing/to-pay?view=factories&mine=1" : "/purchasing/to-pay?view=factories", label: "By factory", active: at === "factories" },
];
