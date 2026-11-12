import { BookOpen, Eye, MessageSquare, Package, Plus, StickyNote, Users, Wallet } from "lucide-react";
import { can, PARTY_TYPE_LABEL, UNKNOWN_COUNTRY } from "@kebo/shared";
import { ButtonLink, PageHeader, StatusBadge } from "@kebo/ui";
import { todayIn } from "@kebo/utils";
import { requireUser } from "@/lib/session";
import { customerOf, customerPaymentsOf, partyNotesOf } from "@/lib/party-data";
import { TZ } from "@/lib/format";
import { countryName } from "@/lib/countries";
import { MoreMenu, type MenuEntry } from "@/components/common/more-menu";
import { RecordTabs } from "@/components/common/record-tabs";
import { removeCustomerAction } from "../actions";
import { customerStatus, late } from "./shared";

/** "Mar 2025" */
const monthOf = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: TZ });

/**
 * Every page of a customer shares one top (design: Record): ← Customers, the name with a status worked out
 * from their orders' payments, one summary line, the one primary (New inquiry) and ⋯ (remove last, red);
 * then four figures (Receivable, open orders, open inquiries, advance held) and the tabs: Overview · Orders ·
 * Inquiries · Money · Contacts · Notes. Each figure is told once, here; the tabs give the rows behind it.
 */
export default async function CustomerLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const [c, pay, notes] = await Promise.all([customerOf(id), customerPaymentsOf(id), partyNotesOf("customers", id)]);
  const today = todayIn(TZ);
  const status = customerStatus(pay, c, today);
  const canAsk = can(me, "inquiries.create");
  const countryKnown = c.country !== UNKNOWN_COUNTRY;
  const handledBy = c.inquiries.find((d) => d.assignee)?.assignee?.name;
  const base = `/customers/${c.id}`;

  const lateOrders = (pay?.orders ?? []).filter((o) => late(o, today)).length;

  const ledger = can(me, "ledger.view") ? `/finance/ledger/customers/${c.id}` : null;
  const more: MenuEntry[] = [
    ...(ledger ? [{ label: "Ledger and statement", href: ledger }] : []),
    { label: "Their inquiries", href: `/inquiries?customer=${c.id}&stage=all` },
    { label: "Copy link", copy: base },
    ...(can(me, "customers.delete")
      ? [
          { separator: true as const },
          {
            label: "Remove…",
            danger: true as const,
            confirm: {
              title: `Remove ${c.name}?`,
              body: "They stay on past inquiries and orders, but no longer appear in lists and pickers. Not possible while an order is open.",
              confirmLabel: "Remove",
            },
            action: removeCustomerAction.bind(null, c.id),
          },
        ]
      : []),
  ];

  return (
    <div>
      <PageHeader
        crumbs={[{ label: "Partners & CRM" }, { label: "Customers", href: "/customers" }, { label: c.name }]}
        phoneStack
        title={c.name}
        badge={<StatusBadge meaning={status.meaning}>{status.label}</StatusBadge>}
        summary={
          <>
            {c.type === "individual" ? PARTY_TYPE_LABEL.individual : "Company"}
            {" · "}
            {countryKnown ? countryName(c.country) : <span className="text-warn">Country not set</span>}
            {c.defaultCurrency && ` · ${c.defaultCurrency}`}
            {` · customer since ${monthOf(c.createdAt)}`}
            {handledBy && <span className="max-sm:hidden"> · handled by {handledBy}</span>}
          </>
        }
        papers={
          <>
            <ButtonLink href={`/payments?party=${c.id}`} variant="secondary">
              Payments
            </ButtonLink>
            {ledger && (
              <ButtonLink href={ledger} variant="secondary">
                <BookOpen aria-hidden /> Ledger
              </ButtonLink>
            )}
          </>
        }
        primary={
          canAsk && (
            <ButtonLink href={`/inquiries/new?customer=${c.id}`} variant="primary">
              <Plus aria-hidden /> New inquiry
            </ButtonLink>
          )
        }
        more={<MoreMenu items={more} label={`More for ${c.name}`} />}
      />


      <RecordTabs
        className="mt-0"
        base={base}
        label="The customer"
        tabs={[
          { path: "", label: "Overview", icon: <Eye aria-hidden /> },
          { path: "orders", label: "Orders", count: c.orders.length, alert: lateOrders > 0, icon: <Package aria-hidden /> },
          { path: "inquiries", label: "Inquiries", count: c.inquiries.length, icon: <MessageSquare aria-hidden /> },
          { path: "money", label: "Money", icon: <Wallet aria-hidden /> },
          { path: "contacts", label: "Contacts", count: c.contacts.length, icon: <Users aria-hidden /> },
          { path: "notes", label: "Notes", count: notes.length, icon: <StickyNote aria-hidden /> },
        ]}
      />
      <div className="mt-5">{children}</div>
    </div>
  );
}
