import { ATTACHMENT_KIND_LABEL, can } from "@kebo/shared";
import { counterKey } from "@kebo/utils";
import { api } from "@/lib/api";
import { getPeople, getSettings } from "@/lib/loaders";
import { requireUser } from "@/lib/session";
import { date, dateTime } from "@/lib/format";
import type { DealDetail } from "@/lib/types";
import type { ContactOption, CustomerOption } from "@/lib/types-deals";
import { editsOf } from "@/lib/edit-data";
import type { RequestStep } from "@/components/deals/deal-form";
import { InquiryPanel } from "./inquiry-panel";
import { createDealAction, customerContactsAction, quickCustomerAction, recentCustomersAction, removeRequestFileAction, saveRequestAction, searchCustomersAction } from "./actions";
import { dataOf, isFailed, part } from "@/lib/part";

/** The link that opens "New inquiry" over the Inquiries list (from anywhere), for a customer when one is given. */
export const newInquiryHref = (customerId?: string) => `/inquiries?panel=new-inquiry${customerId ? `&for=${customerId}` : ""}`;

/** "New inquiry": the window, drawn when the page's address asks for it (?panel=new-inquiry). `customerId` starts with that customer. */
export async function NewInquiryWindow({ customerId }: { customerId?: string }) {
  const me = await requireUser();
  if (!can(me, "inquiries.create")) return null;
  const [settings, people, presetPart] = await Promise.all([
    getSettings(),
    getPeople(),
    customerId && /^[0-9a-f-]{36}$/i.test(customerId)
      ? part("the customer it was opened for", () => api.get<{ id: string; name: string; country: string; contacts: ContactOption[] }>(`/customers/${customerId}`))
      : Promise.resolve(null),
  ]);
  // Not read: the window opens without them (the customer can be chosen in it) and says so.
  const preset = dataOf(presetPart);
  const primary = preset?.contacts.find((c) => c.isPrimary) ?? preset?.contacts[0] ?? null;
  const customer: CustomerOption | null = preset
    ? { id: preset.id, name: preset.name, country: preset.country, primaryContact: primary && { id: primary.id, name: primary.name, detail: primary.email ?? primary.whatsapp ?? primary.phone } }
    : null;
  return (
    <InquiryPanel
      mode="create"
      failed={isFailed(presetPart) ? presetPart.what : null}
      numberHint={counterKey("inquiry", new Date().getFullYear())}
      action={createDealAction}
      // The one making it is the responsible person until someone else is chosen (design rules 18 Nov: sensible defaults).
      initial={{ customer, contactId: primary?.id ?? "", channel: "email", category: "", title: "", requirements: "", priority: "normal", requiredBy: "", assigneeId: me.id }}
      initialContacts={preset?.contacts ?? []}
      categories={settings.sales.categories}
      people={people}
      meId={me.id}
      canAssignOthers={can(me, "inquiries.assign")}
      canAddCustomer={can(me, "customers.manage")}
      addCustomer={quickCustomerAction}
      searchCustomers={searchCustomersAction}
      recentCustomers={recentCustomersAction}
      loadContacts={customerContactsAction}
    />
  );
}

/**
 * "Edit the request": the same window, filled (?panel=edit-request on the inquiry's Overview); `step`
 * (?id=items, the Items card's Edit) opens only that part, with "All steps" to see the rest.
 */
export async function EditRequestWindow({ d, step }: { d: DealDetail; step?: string }) {
  if (!d.allowed.edit) return null;
  const [me, settings, people, edits] = await Promise.all([requireUser(), getSettings(), getPeople(), editsOf("inquiry", d.id)]);
  // (The steps are named here: a client file's values cannot be read on the server.)
  const startStep = (["customer", "items", "details", "files"] as RequestStep[]).find((x) => x === step);
  const primary = d.customer.contacts.find((c) => c.isPrimary) ?? d.customer.contacts[0] ?? null;
  const sent = d.quotations.some((q) => q.revisions.some((r) => r.status !== "draft"));
  return (
    <InquiryPanel
      mode="edit"
      refNo={d.refNo}
      customerName={d.customer.name}
      inquiryTitle={d.title}
      lastChanged={dateTime(d.updatedAt)}
      action={saveRequestAction.bind(null, d.id, d.updatedAt)}
      initial={{
        customer: { id: d.customer.id, name: d.customer.name, country: d.customer.country, primaryContact: primary && { id: primary.id, name: primary.name, detail: primary.email ?? primary.whatsapp ?? primary.phone } },
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
      recentCustomers={recentCustomersAction}
      loadContacts={customerContactsAction}
      startStep={startStep}
      only={!!startStep}
      items={d.items}
      itemsUpload={!sent}
      itemsEdit={{ edit: { type: "inquiry", id: d.id, card: "needs" }, card: edits.cards.needs }}
      files={d.attachments.map((f) => ({
        id: f.id,
        fileName: f.fileName,
        meta: `${ATTACHMENT_KIND_LABEL[f.kind]} · ${date(f.createdAt)}`,
        remove: f.uploadedById === me.id || d.canWork ? removeRequestFileAction.bind(null, d.id, f.id) : null,
      }))}
    />
  );
}
