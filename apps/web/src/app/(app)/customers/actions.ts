"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { customerInput } from "@kebo/shared";
import { api, ApiError } from "@/lib/api";
import type { ImportResult, CustomerInput } from "@kebo/shared";
import type { CustomerDetail } from "@/lib/types-people";
import { attempt, formBody, type ActionState } from "@/lib/actions";

/**
 * The API reports problems inside a contact under one key ("contacts"). Point
 * them at the exact contact field ("contacts.1.email") so the form can show
 * each message next to its box. The API has already decided; this only locates.
 */
function locateContactErrors(body: Record<string, unknown>, r: ActionState): ActionState {
  if (r.ok || !r.errors?.contacts) return r;
  const parsed = customerInput.safeParse(body);
  if (parsed.success) return r;
  const errors = { ...r.errors };
  for (const issue of parsed.error.issues) {
    if (issue.path[0] !== "contacts" || issue.path.length < 3) continue;
    const key = issue.path.join(".");
    errors[key] = [...(errors[key] ?? []), issue.message];
  }
  return { ...r, errors };
}

/**
 * Create or edit a customer with its contacts (JSON in `payload`). "Save anyway" sends allowDuplicate.
 * From the side panel (`inPanel`) it answers with the customer's id and name and the list updates in
 * place; from the old edit page it goes to the customer.
 */
export async function saveCustomerAction(id: string | null, _prev: ActionState, form: FormData): Promise<ActionState> {
  const body = { ...formBody(form), allowDuplicate: form.get("allowDuplicate") === "true" };
  const r = locateContactErrors(
    body,
    await attempt(form, () => (id ? api.put<{ id: string }>(`/customers/${id}`, body) : api.post<{ id: string }>("/customers", body))),
  );
  if (!r.ok) return r;
  const savedId = id ?? (r.data as { id: string }).id;
  revalidatePath("/customers");
  revalidatePath(`/customers/${savedId}`, "layout");
  const name = (body as { name?: unknown }).name;
  if (form.get("inPanel") === "1")
    return { ok: true, data: { id: savedId, name: typeof name === "string" ? name.trim() : "", another: form.get("another") === "1" } };
  redirect(`/customers/${savedId}?toast=${encodeURIComponent(id ? "Customer saved." : "Customer added.")}`);
}

/** Undo of "Customer added": removes the customer just made (the toast's Undo). */
export async function undoNewCustomerAction(id: string): Promise<ActionState> {
  const r = await attempt(null, () => api.delete(`/customers/${id}`));
  if (r.ok) revalidatePath("/customers");
  return r;
}

export async function removeCustomerAction(id: string, _prev: ActionState, _form: FormData): Promise<ActionState> {
  const r = await attempt(null, () => api.delete(`/customers/${id}`));
  if (!r.ok) return r;
  revalidatePath("/customers");
  redirect(`/customers?toast=${encodeURIComponent("Customer removed.")}`);
}

/** A removed customer back in the lists (Archived chip). */
export async function restoreCustomerAction(id: string, _prev: ActionState, _form: FormData): Promise<ActionState> {
  const r = await attempt(null, () => api.post(`/customers/${id}/restore`, {}), "Customer restored.");
  if (r.ok) revalidatePath("/customers");
  return r;
}

/** New customers from an uploaded Excel file (checked on the page; the API checks again and leaves out any already there). */
export async function importCustomersAction(
  items: CustomerInput[],
  fileName: string,
): Promise<{ ok: true; result: ImportResult } | { ok: false; message: string }> {
  try {
    const result = await api.post<ImportResult>("/customers/import", { customers: items, fileName });
    revalidatePath("/customers");
    return { ok: true, result };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, message: e.status === 403 ? "You cannot add customers." : e.message };
    throw e;
  }
}

/** The customer as the API takes it back (PUT /customers/:id), with its contacts changed by `change`. */
async function putContacts(
  customerId: string,
  form: FormData | null,
  change: (contacts: CustomerDetail["contacts"]) => CustomerDetail["contacts"],
  done: string,
) {
  const c = await api.get<CustomerDetail>(`/customers/${customerId}`);
  const contacts = change(c.contacts);
  const body = {
    type: c.type,
    name: c.name,
    country: c.country,
    address: c.address,
    taxNo: c.taxNo,
    regNo: c.regNo,
    defaultCurrency: c.defaultCurrency,
    initials: c.initials,
    notes: c.notes,
    contacts: contacts.map(({ id, name, position, email, phone, whatsapp, wechat, isPrimary }) => ({
      id: id || undefined,
      name,
      position,
      email,
      phone,
      whatsapp,
      wechat,
      isPrimary,
    })),
    reason: form?.get("reason") ? String(form.get("reason")) : undefined,
    allowDuplicate: form?.get("allowDuplicate") === "true",
  };
  const r = await attempt(form, () => api.put(`/customers/${customerId}`, body), done);
  if (r.ok) revalidatePath(`/customers/${customerId}`, "layout");
  return r;
}

const text = (form: FormData, k: string) => {
  const v = String(form.get(k) ?? "").trim();
  return v || null;
};

/** A contact added (contactId null) or changed on the Contacts tab. "Primary contact" ticked makes it the one. */
export async function saveContactAction(
  customerId: string,
  contactId: string | null,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const fields = {
    name: String(form.get("name") ?? "").trim(),
    position: text(form, "position"),
    email: text(form, "email"),
    phone: text(form, "phone"),
    whatsapp: text(form, "whatsapp"),
    wechat: text(form, "wechat"),
  };
  const primary = form.get("isPrimary") === "on";
  const r = await putContacts(
    customerId,
    form,
    (list) => {
      const next = contactId
        ? list.map((x) => (x.id === contactId ? { ...x, ...fields } : x))
        : [...list, { id: "", ...fields, isPrimary: false }];
      const key = contactId ?? "";
      return primary ? next.map((x) => ({ ...x, isPrimary: x.id === key })) : next;
    },
    contactId ? "Contact saved." : "Contact added.",
  );
  // The API names a contact's fields "contacts.N.email"; the form's boxes are plain "email".
  if (!r.ok && r.errors) {
    const errors = { ...r.errors };
    for (const [k, v] of Object.entries(r.errors)) {
      const m = k.match(/^contacts\.\d+\.(\w+)$/);
      if (m) errors[m[1]!] = v;
    }
    if (errors.contacts && !errors.phone) errors.phone = errors.contacts;
    return { ...r, errors };
  }
  return r;
}

/** Make this contact the primary one (on the papers and in Overview). */
export async function makePrimaryContactAction(
  customerId: string,
  contactId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  return putContacts(customerId, form, (list) => list.map((x) => ({ ...x, isPrimary: x.id === contactId })), "Primary contact changed.");
}

/** Remove a contact (a customer keeps at least one). */
export async function removeContactAction(customerId: string, contactId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  return putContacts(customerId, form, (list) => list.filter((x) => x.id !== contactId), "Contact removed.");
}
