import { Coins, Eye, Factory, Package, Pencil, Search, StickyNote, Tag, Wallet } from "lucide-react";
import { can } from "@kebo/shared";
import { ButtonLink, PageHeader } from "@kebo/ui";
import { requirePermission, hasFeature } from "@/lib/session";
import { factoryOf, partyNotesOf } from "@/lib/party-data";
import { MoreMenu, type MenuEntry } from "@/components/common/more-menu";
import { RecordTabs } from "@/components/common/record-tabs";
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
  const [f, notes, managers] = await Promise.all([
    factoryOf(id),
    partyNotesOf("factories", id),
    can(me, "expenses.manage") ? hasFeature("expenses") : false,
  ]);
  const r = f.record;
  const base = `/factories/${f.id}`;

  const ledger = can(me, "ledger.view") ? `/finance/ledger/factories/${f.id}` : null;
  const more: MenuEntry[] = [
    { label: "Payments", href: `/payments?party=${f.id}` },
    ...(ledger ? [{ label: "Ledger and statement", href: ledger }] : []),
    { label: "Copy link", copy: base },
    ...(can(me, "inquiries.updateAny")
      ? [
          { separator: true as const },
          {
            label: "Remove…",
            danger: true as const,
            confirm: { title: `Remove ${f.name}?`, body: "It will no longer appear in lists and pickers. Its past prices stay on their inquiries.", confirmLabel: "Remove" },
            action: removeFactoryAction.bind(null, f.id),
          },
        ]
      : []),
  ];

  return (
    <div>
      <PageHeader
        crumbs={[{ label: "Partners & CRM" }, { label: "Suppliers", href: "/factories" }, { label: f.name }]}
        icon={Factory}
        phoneStack
        title={f.name}
        summary={[f.address?.split("\n")[0], f.owner ? `owner ${f.owner.name}` : "no owner yet"].filter(Boolean).join(" · ")}
        papers={
          <ButtonLink href={`${base}?panel=edit-factory&id=${f.id}`} variant="secondary" scroll={false}>
            <Pencil aria-hidden /> Edit
          </ButtonLink>
        }
        primary={
          can(me, "payments.record") || can(me, "expenses.manage") ? (
            <ButtonLink href={`/payments/new?kind=out&factory=${f.id}`} variant="primary">
              <Wallet aria-hidden /> Pay supplier
            </ButtonLink>
          ) : (
            <ButtonLink href="/inquiries?stage=sourcing" variant="primary">
              <Search aria-hidden /> Ask for prices
            </ButtonLink>
          )
        }
        more={<MoreMenu items={more} label={`More for ${f.name}`} />}
      />


      <RecordTabs
        className="mt-0"
        base={base}
        label="The supplier"
        tabs={[
          { path: "", label: "Overview", icon: <Eye aria-hidden /> },
          { path: "orders", label: "Orders", count: r.openOrders.length, alert: r.lateSteps > 0, icon: <Package aria-hidden /> },
          { path: "offers", label: "Price offers", count: f.quotes.length, icon: <Tag aria-hidden /> },
          ...(managers ? [{ path: "costs", label: "Costs", icon: <Coins aria-hidden /> }] : []),
          { path: "notes", label: "Notes", count: notes.length, icon: <StickyNote aria-hidden /> },
        ]}
      />
      <div className="mt-5">{children}</div>
    </div>
  );
}
