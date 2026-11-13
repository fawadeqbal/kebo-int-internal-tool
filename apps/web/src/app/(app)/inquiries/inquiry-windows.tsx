import { ATTACHMENT_KIND_LABEL, can } from "@kebo/shared";
import { counterKey } from "@kebo/utils";
import { api } from "@/lib/api";
import { getPeople, getSettings } from "@/lib/loaders";
import { requireUser } from "@/lib/session";
import { date } from "@/lib/format";
import type { DealDetail } from "@/lib/types";
import type { ContactOption, CustomerOption } from "@/lib/types-deals";
import { InquiryPanel } from "./inquiry-panel";
import { createDealAction, customerContactsAction, quickCustomerAction, removeRequestFileAction, saveRequestAction, searchCustomersAction } from "./actions";

/** The link that opens "New inquiry" over the Inquiries list (from anywhere), for a customer when one is given. */
export const newInquiryHref = (customerId?: string) => `/inquiries?panel=new-inquiry${customerId ? `&for=${customerId}` : ""}`;

/** "New inquiry": the window, drawn when the page's address asks for it (?panel=new-inquiry). `customerId` starts with that customer. */
export async function NewInquiryWindow({ customerId }: { customerId?: string }) {
  const me = await requireUser();
  if (!can(me, "inquiries.create")) return null;
  const [settings, people, preset] = await Promise.all([
    getSettings(),
    getPeople(),
    customerId && /^[0-9a-f-]{36}$/i.test(customerId)
      ? api.get<{ id: string; name: string; country: string; contacts: ContactOption[] }>(`/customers/${customerId}`).catch(() => null)
      : Promise.resolve(null),
  ]);
  const primary = preset?.contacts.find((c) => c.isPrimary) ?? preset?.contacts[0] ?? null;
  const customer: CustomerOption | null = preset ? { id: preset.id, name: preset.name, country: preset.country, primaryContact: primary && { id: primary.id, name: primary.name } } : null;
  return (
    <InquiryPanel
      mode="create"
      numberHint={counterKey("inquiry", new Date().getFullYear())}
      action={createDealAction}
      initial={{ customer, contactId: primary?.id ?? "", channel: "email", category: "", title: "", requirements: "", priority: "normal", requiredBy: "", assigneeId: "" }}
      initialContacts={preset?.contacts ?? []}
      categories={settings.sales.categories}
      people={people}
      meId={me.id}
      canAssignOthers={can(me, "inquiries.assign")}
      canAddCustomer={can(me, "customers.manage")}
      addCustomer={quickCustomerAction}
      searchCustomers={searchCustomersAction}
      loadContacts={customerContactsAction}
    />
  );
}

/** "Edit the request": the same window, filled (?panel=edit-request on the inquiry's Overview). */
export async function EditRequestWindow({ d }: { d: DealDetail }) {
  if (!d.allowed.edit) return null;
  const [me, settings, people] = await Promise.all([requireUser(), getSettings(), getPeople()]);
  const primary = d.customer.contacts.find((c) => c.isPrimary) ?? d.customer.contacts[0] ?? null;
  const sent = d.quotation?.revisions.some((r) => r.status !== "draft");
  return (
    <InquiryPanel
      mode="edit"
      refNo={d.refNo}
      customerName={d.customer.name}
      action={saveRequestAction.bind(null, d.id)}
      initial={{
        customer: { id: d.customer.id, name: d.customer.name, country: d.customer.country, primaryContact: primary && { id: primary.id, name: primary.name } },
        contactId: d.contactId ?? "",
        channel: d.channel,
        category: d.category,
        title: d.title,
        requirements: d.requirements ?? "",
        priority: d.priority,
        requiredBy: d.requiredBy ?? "",
        assigneeId: d.assignee?.id ?? "",
      }}
      initialContacts={d.customer.contacts}
      categories={settings.sales.categories}
      people={people}
      meId={me.id}
      canAssignOthers={can(me, "inquiries.assign")}
      customerLocked={sent ? "Already quoted: the customer cannot change" : undefined}
      searchCustomers={searchCustomersAction}
      loadContacts={customerContactsAction}
      hasItems={d.items.length > 0}
      files={d.attachments.map((f) => ({
        id: f.id,
        fileName: f.fileName,
        meta: `${ATTACHMENT_KIND_LABEL[f.kind]} · ${date(f.createdAt)}`,
        remove: f.uploadedById === me.id || d.canWork ? removeRequestFileAction.bind(null, d.id, f.id) : null,
      }))}
    />
  );
}
