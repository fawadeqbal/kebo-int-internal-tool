import { can } from "@kebo/shared";
import { PageHeader } from "@kebo/ui";
import { MessageSquare } from "lucide-react";
import { counterKey } from "@kebo/utils";
import { api } from "@/lib/api";
import { requirePermission } from "@/lib/session";
import type { ContactOption, CustomerOption, DealFormValues } from "@/lib/types-deals";
import { DealForm } from "@/components/deals/deal-form";
import { createDealAction, customerContactsAction, quickCustomerAction, searchCustomersAction } from "../actions";
import { getSettings, getPeople } from "@/lib/loaders";

export const metadata = { title: "New inquiry" };

/** A new RFQ typed in by staff (website RFQs arrive by themselves). ?customer=<id> starts with that customer. */
export default async function NewDealPage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const me = await requirePermission("inquiries.create");
  const sp = await searchParams;
  const [settings, people, preset] = await Promise.all([
    getSettings(),
    getPeople(),
    sp.customer && /^[0-9a-f-]{36}$/i.test(sp.customer)
      ? api.get<{ id: string; name: string; country: string; contacts: ContactOption[] }>(`/customers/${sp.customer}`).catch(() => null)
      : Promise.resolve(null),
  ]);
  const primary = preset?.contacts.find((c) => c.isPrimary) ?? preset?.contacts[0] ?? null;
  const customer: CustomerOption | null = preset
    ? { id: preset.id, name: preset.name, country: preset.country, primaryContact: primary && { id: primary.id, name: primary.name } }
    : null;
  const initial: DealFormValues = {
    customer,
    contactId: primary?.id ?? "",
    channel: "email",
    category: "",
    title: "",
    requirements: "",
    priority: "normal",
    requiredBy: "",
    assigneeId: "",
    items: [],
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        crumbs={[{ label: "Operations & trading" }, { label: "Inquiries", href: "/inquiries" }, { label: "New" }]}
        icon={MessageSquare}
        title="New inquiry"
        description={`Number is given on save · ${counterKey("inquiry", new Date().getFullYear())}-…`}
      />
      <DealForm
        mode="create"
        action={createDealAction}
        initial={initial}
        initialContacts={preset?.contacts ?? []}
        categories={settings.sales.categories}
        people={people}
        meId={me.id}
        canAssignOthers={can(me, "inquiries.assign")}
        canAddCustomer={can(me, "customers.manage")}
        addCustomer={quickCustomerAction}
        searchCustomers={searchCustomersAction}
        loadContacts={customerContactsAction}
        cancelHref="/inquiries"
        currency={settings.sales.currency}
      />
    </div>
  );
}
