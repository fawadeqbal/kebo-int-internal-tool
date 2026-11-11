import { can } from "@kebo/shared";
import { PageHeader, Segmented } from "@kebo/ui";
import { AgeingStrip } from "@/components/ledger/ageing-strip";
import { crumbsFor, labelFor } from "@/lib/nav";
import { requirePermission } from "@/lib/session";
import { InvoicesBody, OweBody } from "../../finance/sections";

export const metadata = { title: "Payables (AP)" };

/**
 * Finance & general ledger › Payables (AP): what we still owe the suppliers for the goods on our orders, invoice
 * by invoice (with their own number once they send one) or factory by factory.
 */
export default async function ToPayPage({ searchParams }: { searchParams: Promise<{ mine?: string; view?: string }> }) {
  const me = await requirePermission("sourcing.manage");
  const { mine, view } = await searchParams;
  const byFactory = view === "factories";
  return (
    <div>
      <PageHeader crumbs={crumbsFor("/purchasing/to-pay")} title={labelFor("/purchasing/to-pay")} description="What we still owe the suppliers, and what is next." />
      {can(me, "ledger.view") && mine !== "1" && <AgeingStrip side="payable" />}
      {byFactory ? (
        <>
          <Segmented label="Show" className="mb-4" options={showOptions(true, mine === "1")} />
          <OweBody mine={mine === "1"} />
        </>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-3">
            <Segmented label="Show" options={showOptions(false, mine === "1")} />
            <Segmented
              label="Which suppliers"
              options={[
                { href: "/purchasing/to-pay", label: "All suppliers", active: mine !== "1" },
                { href: "/purchasing/to-pay?mine=1", label: "My suppliers", active: mine === "1" },
              ]}
            />
          </div>
          <InvoicesBody side="payable" mine={mine === "1"} />
        </>
      )}
    </div>
  );
}

const showOptions = (byFactory: boolean, mine: boolean) => [
  { href: mine ? "/purchasing/to-pay?mine=1" : "/purchasing/to-pay", label: "By invoice", active: !byFactory },
  { href: mine ? "/purchasing/to-pay?view=factories&mine=1" : "/purchasing/to-pay?view=factories", label: "By factory", active: byFactory },
];
