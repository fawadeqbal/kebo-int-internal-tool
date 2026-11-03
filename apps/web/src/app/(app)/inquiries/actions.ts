"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { attempt, formBody, formValues, reasonOf, type ActionState } from "@/lib/actions";
import type { DealDetail, Paged } from "@/lib/types";
import type { ContactOption, CustomerOption } from "@/lib/types-deals";

const refresh = (id: string) => revalidatePath(`/inquiries/${id}`, "layout");

export async function moveStageAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(
    form,
    () => api.post(`/inquiries/${id}/stage`, { to: v.to, lostReason: v.lostReason || null, note: v.note || null, reason: reasonOf(form) }),
    "Stage updated.",
  );
  if (r.ok) refresh(id);
  return r;
}

export async function holdAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(
    form,
    () => api.post(`/inquiries/${id}/hold`, { onHold: v.onHold === "true", note: v.note || null, reason: reasonOf(form) }),
    v.onHold === "true" ? "On hold." : "Resumed.",
  );
  if (r.ok) refresh(id);
  return r;
}

export async function assignAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(
    form,
    () => api.post(`/inquiries/${id}/assign`, { assigneeId: v.assigneeId || null, reason: reasonOf(form) }),
    "Assignment saved.",
  );
  if (r.ok) refresh(id);
  return r;
}

export async function noteAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(form, () => api.post(`/inquiries/${id}/notes`, { body: v.body }));
  if (r.ok) refresh(id);
  return r;
}

export async function removeFileAction(dealId: string, fileId: string, _prev: ActionState, _form: FormData): Promise<ActionState> {
  const r = await attempt(null, () => api.delete(`/files/${fileId}`), "File removed.");
  if (r.ok) refresh(dealId);
  return r;
}

/** What a file is (URS, drawing…) and its note. */
export async function describeFileAction(dealId: string, fileId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(form, () => api.patch(`/files/${fileId}`, { kind: v.kind, note: v.note?.trim() || null }), "Saved.");
  if (r.ok) refresh(dealId);
  return r;
}

/** Customer picker on the inquiry form: search as you type (name, contact, email, phone). */
export async function searchCustomersAction(q: string): Promise<CustomerOption[]> {
  try {
    const res = await api.get<Paged<CustomerOption>>("/customers", { q: q.trim().slice(0, 100) || undefined, pageSize: 8 });
    return res.rows.map((c) => ({
      id: c.id,
      name: c.name,
      country: c.country,
      primaryContact: c.primaryContact && { id: c.primaryContact.id, name: c.primaryContact.name },
    }));
  } catch {
    return [];
  }
}

/** The contacts of the chosen customer. */
export async function customerContactsAction(customerId: string): Promise<ContactOption[]> {
  try {
    const c = await api.get<{ contacts: ContactOption[] }>(`/customers/${customerId}`);
    return c.contacts.map((x) => ({
      id: x.id,
      name: x.name,
      email: x.email,
      phone: x.phone,
      whatsapp: x.whatsapp,
      isPrimary: x.isPrimary,
    }));
  } catch {
    return [];
  }
}

/** A new inquiry, without leaving the page: the form then uploads the URS and documents and opens the deal. */
export async function createDealAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => api.post<{ id: string }>("/inquiries", formBody(form)));
  if (!r.ok) return r;
  const id = (r.data as { id: string }).id;
  refresh(id);
  return { ok: true, data: { id } };
}

export type QuickCustomer = { name: string; country: string; contact: string; email: string; phone: string; allowDuplicate?: boolean };
export type QuickCustomerResult =
  | { ok: true; customer: CustomerOption; contacts: ContactOption[] }
  | { ok: false; message: string; errors?: Record<string, string[] | undefined>; matches?: { id: string; label: string; detail?: string }[] };

/** "New customer" on the inquiry form: just a name, country and one contact. The rest is filled in on the customer page later. */
export async function quickCustomerAction(v: QuickCustomer): Promise<QuickCustomerResult> {
  const r = await attempt(null, () =>
    api.post<{ id: string; name: string; country: string; contacts: (ContactOption & { isPrimary: boolean })[] }>("/customers", {
      name: v.name,
      country: v.country,
      contacts: [{ name: v.contact.trim() || v.name, email: v.email.trim() || null, phone: v.phone.trim() || null, whatsapp: v.phone.trim() || null, isPrimary: true }],
      allowDuplicate: !!v.allowDuplicate,
    }),
  );
  if (!r.ok) return { ok: false, message: r.message ?? "Could not add the customer.", errors: r.errors, matches: r.matches };
  const c = r.data as { id: string; name: string; country: string; contacts: ContactOption[] };
  const contacts = c.contacts.map((x) => ({ id: x.id, name: x.name, email: x.email, phone: x.phone, whatsapp: x.whatsapp, isPrimary: x.isPrimary }));
  const primary = contacts.find((x) => x.isPrimary) ?? contacts[0] ?? null;
  revalidatePath("/customers");
  return { ok: true, customer: { id: c.id, name: c.name, country: c.country, primaryContact: primary && { id: primary.id, name: primary.name } }, contacts };
}

/** Create or edit a deal (the form sends JSON in `payload`, with its line items). */
export async function saveDealAction(id: string | null, _prev: ActionState, form: FormData): Promise<ActionState> {
  const body = formBody(form);
  const r = await attempt(form, () =>
    id ? api.put<{ id: string }>(`/inquiries/${id}`, body) : api.post<{ id: string }>("/inquiries", body),
  );
  if (!r.ok) return r;
  const newId = id ?? (r.data as { id: string }).id;
  refresh(newId);
  redirect(`/inquiries/${newId}`);
}

/** The fields the inquiry's own cards change one at a time (Needs: "+ Add" in place, Edit, Edit lines). */
const DEAL_FIELDS = ["contactId", "channel", "category", "title", "requirements", "priority", "requiredBy"] as const;

/**
 * Save some of the inquiry's fields, or its items, without the whole form: the
 * inquiry as it is now (GET), with what was sent put in, saved with the same
 * PUT /inquiries/:id as the edit form. Items keep their ids, so factory prices
 * stay linked; a priced item asks why, as on the form. Items come as JSON in
 * `items` ({ id, key, parentKey, description, model, quantity, unit, targetPrice }).
 */
export async function dealFieldsAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(
    form,
    async () => {
      const d = await api.get<DealDetail>(`/inquiries/${id}`);
      const at = new Map(d.items.map((it, n) => [it.id, n]));
      let items: object[] = d.items.map((it) => ({
        id: it.id,
        partOf: it.parentId ? (at.get(it.parentId) ?? null) : null,
        description: it.description,
        model: it.model,
        quantity: it.quantity,
        unit: it.unit,
        targetPrice: it.targetPrice,
      }));
      if (v.items) {
        type Row = { id: string | null; key: string; parentKey: string | null; description: string; model: string; quantity: string; unit: string; targetPrice: string };
        const rows = JSON.parse(v.items) as Row[];
        const pos = new Map(rows.map((it, n) => [it.key, n]));
        items = rows.map((it) => ({
          id: it.id,
          partOf: it.parentKey ? (pos.get(it.parentKey) ?? null) : null,
          description: it.description,
          model: it.model.trim() || null,
          quantity: it.quantity.replace(/,/g, "").trim(),
          unit: it.unit.trim() || "pcs",
          targetPrice: it.targetPrice.replace(/,/g, "").trim() || null,
        }));
      }
      const now: Record<string, unknown> = {
        contactId: d.contactId,
        channel: d.channel,
        category: d.category,
        title: d.title || null,
        requirements: d.requirements,
        priority: d.priority,
        requiredBy: d.requiredBy,
      };
      for (const k of DEAL_FIELDS) if (k in v) now[k] = v[k]!.trim() === "" ? null : v[k];
      return api.put(`/inquiries/${id}`, { customerId: d.customer.id, ...now, items, reason: reasonOf(form) });
    },
    "Saved.",
  );
  if (r.ok) refresh(id);
  return r;
}
