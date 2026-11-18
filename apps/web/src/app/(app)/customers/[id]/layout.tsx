import { Pencil, Plus } from "lucide-react";
import { can, PARTY_TYPE_LABEL, RECORD_KIND, UNKNOWN_COUNTRY } from "@kebo/shared";
import { ButtonLink, PageHeader, RefCode } from "@kebo/ui";
import { requireUser } from "@/lib/session";
import { customerOf, customerPaymentsOf } from "@/lib/party-data";
import { companyToday, currentZone } from "@/lib/format";
import { countryName } from "@/lib/countries";
import { RecordTabs } from "@/components/common/record-tabs";
import { late } from "./shared";

/** "Mar 2025" */
const monthOf = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: currentZone() }); // "since Nov 2026", company time

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
  const today = companyToday();
  const canAsk = can(me, "inquiries.create");
  const countryKnown = c.country !== UNKNOWN_COUNTRY;
  const base = `/customers/${c.id}`;

  const lateOrders = (pay?.orders ?? []).filter((o) => late(o, today)).length;

  return (
    <div>
      <PageHeader
        crumbs={[{ label: "Sales" }, { label: "Customers", href: "/customers" }, { label: c.name }]}
        phoneStack
        title={c.name}
        record={{ kind: RECORD_KIND.customer, number: c.customerCode }}
        summary={
          <>
            {c.customerCode && (
              // On a phone the number is in the top bar, under the name.
              <span className="max-md:hidden">
                <RefCode>{c.customerCode}</RefCode>
                {" · "}
              </span>
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
              <Plus aria-hidden /> Add inquiry
            </ButtonLink>
          )
        }
      />

      <RecordTabs
        base={base}
        label="The customer"
        tabs={[
          { path: "", label: "Overview" },
          { path: "orders", label: "Orders", count: c.orders.length, alert: lateOrders > 0 },
          { path: "inquiries", label: "Inquiries", count: c.inquiries.length },
          { path: "money", label: "Money" },
          { path: "contacts", label: "Contacts", count: c.contacts.length },
          { path: "notes", label: "Notes" },
        ]}
      />
      <div className="mt-5">{children}</div>
    </div>
  );
}
