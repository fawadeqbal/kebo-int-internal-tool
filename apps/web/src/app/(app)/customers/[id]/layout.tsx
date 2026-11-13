import { Eye, Pencil, MessageSquare, Package, Plus, Users, Wallet } from "lucide-react";
import { can, PARTY_TYPE_LABEL, UNKNOWN_COUNTRY } from "@kebo/shared";
import { ButtonLink, PageHeader, RefCode } from "@kebo/ui";
import { todayIn } from "@kebo/utils";
import { requireUser } from "@/lib/session";
import { customerOf, customerPaymentsOf } from "@/lib/party-data";
import { TZ } from "@/lib/format";
import { countryName } from "@/lib/countries";
import { RecordTabs } from "@/components/common/record-tabs";
import { late } from "./shared";

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
  const [c, pay] = await Promise.all([customerOf(id), customerPaymentsOf(id)]);
  const today = todayIn(TZ);
  const canAsk = can(me, "inquiries.create");
  const countryKnown = c.country !== UNKNOWN_COUNTRY;
  const base = `/customers/${c.id}`;

  const lateOrders = (pay?.orders ?? []).filter((o) => late(o, today)).length;

  return (
    <div>
      <PageHeader
        crumbs={[{ label: "Partners & CRM" }, { label: "Customers", href: "/customers" }, { label: c.name }]}
        phoneStack
        title={c.name}
        summary={
          <>
            {c.customerCode && (
              <>
                <RefCode>{c.customerCode}</RefCode>
                {" · "}
              </>
            )}
            {c.type === "individual" ? PARTY_TYPE_LABEL.individual : "Company"}
            {" · "}
            {countryKnown ? countryName(c.country) : <span className="text-warn">Country not set</span>}
            {c.defaultCurrency && ` · ${c.defaultCurrency}`}
            {` · since ${monthOf(c.createdAt)}`}
          </>
        }
        papers={
          can(me, "customers.manage") && (
            <ButtonLink href={`${base}?panel=edit-customer&id=${c.id}`} variant="secondary" scroll={false}>
              <Pencil aria-hidden /> Edit
            </ButtonLink>
          )
        }
        primary={
          canAsk && (
            <ButtonLink href={`/inquiries?panel=new-inquiry&for=${c.id}`} variant="primary">
              <Plus aria-hidden /> New inquiry
            </ButtonLink>
          )
        }
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
          { path: "notes", label: "Notes", icon: <Pencil aria-hidden /> },
        ]}
      />
      <div className="mt-5">{children}</div>
    </div>
  );
}
