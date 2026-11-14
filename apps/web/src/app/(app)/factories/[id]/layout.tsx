import { Banknote, Eye, Factory, Package, Pencil, Search, Tag } from "lucide-react";
import { can } from "@kebo/shared";
import { ButtonLink, PageHeader, RefCode } from "@kebo/ui";
import { requirePermission, hasFeature } from "@/lib/session";
import { factoryOf } from "@/lib/party-data";
import { RecordTabs } from "@/components/common/record-tabs";

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
  const base = `/factories/${f.id}`;

  return (
    <div>
      <PageHeader
        crumbs={[{ label: "Suppliers", href: "/factories" }, { label: f.name }]}
        icon={Factory}
        phoneStack
        title={f.name}
        summary={
          <>
            {f.supplierCode && (
              <>
                <RefCode>{f.supplierCode}</RefCode>
                {" · "}
              </>
            )}
            {[f.address?.split("\n")[0], f.owner ? `owner ${f.owner.name}` : "no owner yet"].filter(Boolean).join(" · ")}
          </>
        }
        papers={
          <ButtonLink href={`${base}?panel=edit-factory&id=${f.id}`} variant="secondary" scroll={false}>
            <Pencil aria-hidden /> Edit
          </ButtonLink>
        }
        primary={
          can(me, "payments.record") || can(me, "expenses.manage") ? (
            <ButtonLink href={`/payments/new?kind=out&factory=${f.id}`} variant="primary">
              <Banknote aria-hidden /> Pay supplier
            </ButtonLink>
          ) : (
            <ButtonLink href="/inquiries?stage=sourcing" variant="primary">
              <Search aria-hidden /> Ask for prices
            </ButtonLink>
          )
        }
      />

      <RecordTabs
        className="mt-0"
        base={base}
        label="The supplier"
        tabs={[
          { path: "", label: "Overview", icon: <Eye aria-hidden /> },
          { path: "orders", label: "Orders", count: r.openOrders.length, alert: r.lateSteps > 0, icon: <Package aria-hidden /> },
          { path: "offers", label: "Offers", count: f.quotes.length, icon: <Tag aria-hidden /> },
          ...(managers ? [{ path: "costs", label: "Costs", icon: <Banknote aria-hidden /> }] : []),
          { path: "notes", label: "Notes", icon: <Pencil aria-hidden /> },
        ]}
      />
      <div className="mt-5">{children}</div>
    </div>
  );
}
