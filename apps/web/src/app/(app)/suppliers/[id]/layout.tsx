import { Banknote, Pencil, Search } from "lucide-react";
import { can, RECORD_KIND } from "@kebo/shared";
import { ButtonLink, RefCode } from "@kebo/ui";
import { requirePermission, hasFeature } from "@/lib/session";
import { factoryOf } from "@/lib/party-data";
import { RecordTabs } from "@/components/common/record-tabs";
import { RecordFrame } from "@/components/records/record-frame";
import { RecordTop } from "@/components/records/record-page";
import { MoreMenu } from "@/components/common/more-menu";
import { removeFactoryAction } from "../actions";

/**
 * Every page of a supplier shares one top (design: Record): ← Suppliers, the name with a status from what it
 * makes for us (Late · Making for us · No open order), one summary line, the one primary (Ask for prices) and
 * ⋯ (remove last, red); then four figures (Payable, making for us now, answers when asked, price offers) and
 * the tabs: Overview · Orders · Price offers · Costs (managers) · Notes.
 */
export default async function FactoryLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requirePermission("sourcing.manage");
  const [f, managers] = await Promise.all([factoryOf(id), can(me, "expenses.manage") ? hasFeature("expenses") : false]);
  const r = f.record;
  const base = `/suppliers/${f.id}`;

  return (
    <RecordFrame
      top={
        <RecordTop
          header={{
            crumbs: [{ label: "Purchasing" }, { label: "Suppliers", href: "/suppliers" }, { label: f.name }],
            title: f.name,
            record: { kind: RECORD_KIND.supplier, number: f.supplierCode },
            summary: (
              <>
                {f.supplierCode && (
                  // On a phone the number is in the top bar, under the name.
                  <span className="max-md:hidden">
                    <RefCode>{f.supplierCode}</RefCode>
                    {" · "}
                  </span>
                )}
                {[f.address?.split("\n")[0], f.owner ? `owner ${f.owner.name}` : "no owner yet"].filter(Boolean).join(" · ")}
              </>
            ),
            papers: (
              <ButtonLink href={`${base}?panel=edit-factory&id=${f.id}`} variant="secondary" scroll={false}>
                <Pencil aria-hidden /> Edit
              </ButtonLink>
            ),
            // Remove lives in ⋯, last and in red (PageHeader: delete last in ⋯), not under the Overview's boxes.
            more: can(me, "inquiries.updateAny") ? (
              <MoreMenu
                label={`More for ${f.name}`}
                items={[
                  {
                    label: "Remove this supplier",
                    danger: true,
                    confirm: { title: `Remove ${f.name}?`, body: "It will no longer appear in lists and pickers. Its past prices stay on their inquiries.", confirmLabel: "Remove" },
                    action: removeFactoryAction.bind(null, f.id),
                  },
                ]}
              />
            ) : undefined,
            primary: (
              can(me, "payments.record") || can(me, "expenses.manage") ? (
                <ButtonLink href={`/payments/new?kind=out&factory=${f.id}`} variant="primary">
                  <Banknote aria-hidden /> Pay supplier
                </ButtonLink>
              ) : (
                <ButtonLink href="/inquiries?stage=sourcing" variant="primary">
                  <Search aria-hidden /> Ask for prices
                </ButtonLink>
              )
            ),
          }}
          tabs={
            <RecordTabs
              base={base}
              label="The supplier"
              tabs={[
                { path: "", label: "Overview" },
                { path: "orders", label: "Orders", count: r.openOrders.length, alert: r.lateSteps > 0 },
                { path: "offers", label: "Offers", count: f.quotes.length },
                ...(managers ? [{ path: "costs", label: "Costs" }] : []),
                { path: "notes", label: "Notes" },
              ]}
            />
          }
        />
      }
    >
      {children}
    </RecordFrame>
  );
}
