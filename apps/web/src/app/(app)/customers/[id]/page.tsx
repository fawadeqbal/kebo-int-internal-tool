import { redirect } from "next/navigation";
import { can, PARTY_TYPE_LABEL, UNKNOWN_COUNTRY } from "@kebo/shared";
import { Banner } from "@kebo/ui";
import { requireUser } from "@/lib/session";
import { customerOf } from "@/lib/party-data";
import { countryName } from "@/lib/countries";
import { OpenPanelButton } from "@/components/common/panel";
import { DetailsCard } from "@/components/common/record";
import { RecordLanding } from "@/components/common/record-nav";
import { PerformanceCard } from "@/components/insights/performance";
import { getSettings } from "@/lib/loaders";
import { saveCustomerAction } from "../actions";
import { CustomerPanel } from "../customer-panel";
import { currenciesFrom } from "../currencies";

export const metadata = { title: "Customer" };

const waLink = (n: string) => `https://wa.me/${n.replace(/\D/g, "")}`;

/** Old ?tab= links and the history panel → the tab that has them now. */
const TAB_OF: Record<string, string> = {
  inquiries: "inquiries",
  deals: "inquiries",
  orders: "orders",
  money: "money",
  payments: "money",
  account: "money?view=profit",
  history: "notes",
  contacts: "contacts",
};

/**
 * The customer's Overview tab: Performance (from Insights) and Details with ✎ Edit (the side panel), the
 * primary contact among them. Contacts, orders, inquiries, money and notes each have their own tab.
 */
export default async function CustomerOverview({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const old = sp.tab ? TAB_OF[sp.tab] : sp.panel === "history" ? "notes" : undefined;
  if (old) redirect(`/customers/${id}/${old}`);
  const me = await requireUser();
  const canEdit = can(me, "customers.manage");
  const editing = canEdit && sp.panel === "edit-customer";
  const [c, settings] = await Promise.all([customerOf(id), editing ? getSettings() : null]);
  const primary = c.contacts.find((p) => p.isPrimary) ?? c.contacts[0] ?? null;
  const countryKnown = c.country !== UNKNOWN_COUNTRY;

  return (
    <div className="flex flex-col gap-5">
      <RecordLanding />
      <PerformanceCard kind="customer" id={c.id} me={me} balances={false} />
      <DetailsCard
        flash={sp.saved === c.id}
        edit={canEdit ? { panel: "edit-customer", id: c.id, label: `Edit ${c.name}` } : null}
        items={[
          { label: "Contact", value: primary && [primary.name, primary.position].filter(Boolean).join(" · ") },
          {
            label: "Email",
            value: primary?.email && (
              <a href={`mailto:${primary.email}`} className="break-all hover:text-primary hover:underline">
                {primary.email}
              </a>
            ),
          },
          {
            label: "Phone / WhatsApp",
            value: (primary?.phone || primary?.whatsapp) && (
              <>
                {primary.phone && (
                  <a href={`tel:${primary.phone}`} className="hover:text-primary hover:underline">
                    {primary.phone}
                  </a>
                )}
                {primary.whatsapp && primary.whatsapp !== primary.phone && (
                  <>
                    {primary.phone && " · "}
                    <a href={waLink(primary.whatsapp)} target="_blank" rel="noreferrer" className="hover:text-primary hover:underline">
                      WhatsApp {primary.whatsapp}
                    </a>
                  </>
                )}
              </>
            ),
          },
          { label: "Country", value: countryKnown ? countryName(c.country) : null },
          { label: "Address on papers", value: c.address && <span className="whitespace-pre-line">{c.address}</span> },
          { label: "Business license number", value: c.taxNo },
          { label: "Currency they pay in", value: c.defaultCurrency },
          { label: "Type", value: PARTY_TYPE_LABEL[c.type] },
          { label: "WeChat", value: primary?.wechat, optional: true },
          { label: "Reg. number", value: c.regNo, optional: true },
          { label: "Letters on documents", value: c.initials, optional: true },
          { label: "Notes", value: c.notes && <span className="whitespace-pre-line">{c.notes}</span>, wide: true, optional: true },
        ]}
        footer={
          !countryKnown && (
            <Banner meaning="warn" className="mx-4 mb-4">
              Their country is not set yet — it decides shipping.{" "}
              {canEdit ? (
                <OpenPanelButton panel="edit-customer" id={c.id} variant="link" size="sm" className="h-auto font-semibold">
                  Add it
                </OpenPanelButton>
              ) : (
                "Ask someone who manages customers to add it."
              )}
            </Banner>
          )
        }
      />
      {editing && settings && <CustomerPanel action={saveCustomerAction.bind(null, c.id)} customer={c} currencies={currenciesFrom(settings)} onRecord />}
    </div>
  );
}
