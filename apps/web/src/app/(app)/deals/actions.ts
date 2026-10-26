"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { attempt, formBody, formValues, type ActionState } from "@/lib/actions";
import type { Paged } from "@/lib/types";
import type { ContactOption, CustomerOption } from "@/lib/types-deals";

const refresh = (id: string) => revalidatePath(`/deals/${id}`, "layout");

export async function moveStageAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(
    form,
    () => api.post(`/inquiries/${id}/stage`, { to: v.to, lostReason: v.lostReason || null, note: v.note || null }),
    "Stage updated.",
  );
  if (r.ok) refresh(id);
  return r;
}

export async function holdAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(
    form,
    () => api.post(`/inquiries/${id}/hold`, { onHold: v.onHold === "true", note: v.note || null }),
    v.onHold === "true" ? "On hold." : "Resumed.",
  );
  if (r.ok) refresh(id);
  return r;
}

export async function assignAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(form, () => api.post(`/inquiries/${id}/assign`, { assigneeId: v.assigneeId || null }), "Assignment saved.");
  if (r.ok) refresh(id);
  return r;
}

export async function noteAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(form, () => api.post(`/inquiries/${id}/notes`, { body: v.body }));
  if (r.ok) refresh(id);
  return r;
}

export async function uploadAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a file to upload." };
  const body = new FormData();
  body.set("file", file, file.name);
  const r = await attempt(null, () => api.upload(`/inquiries/${id}/files`, body), `Uploaded ${file.name}.`);
  if (r.ok) refresh(id);
  return r;
}

export async function removeFileAction(dealId: string, fileId: string, _prev: ActionState, _form: FormData): Promise<ActionState> {
  const r = await attempt(null, () => api.delete(`/files/${fileId}`), "File removed.");
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

/** Create or edit a deal (the form sends JSON in `payload`, with its line items). */
export async function saveDealAction(id: string | null, _prev: ActionState, form: FormData): Promise<ActionState> {
  const body = formBody(form);
  const r = await attempt(form, () =>
    id ? api.put<{ id: string }>(`/inquiries/${id}`, body) : api.post<{ id: string }>("/inquiries", body),
  );
  if (!r.ok) return r;
  const newId = id ?? (r.data as { id: string }).id;
  refresh(newId);
  redirect(`/deals/${newId}`);
}
