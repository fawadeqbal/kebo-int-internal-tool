"use server";

import { revalidatePath } from "next/cache";
import { LOST_REASON_LABEL, requestedItemInput } from "@kebo/shared";
import { api } from "@/lib/api";
import { attempt, formBody, formValues, reasonOf, type ActionState } from "@/lib/actions";
import type { DealDetail, Paged } from "@/lib/types";
import type { ContactOption, CustomerOption } from "@/lib/types-deals";

const refresh = (id: string) => revalidatePath(`/inquiries/${id}`, "layout");

/**
 * The API names a wrong item only as "items": point it at the item and its field ("items.1.quantity"), so the
 * window's Items step says which one. The API has already decided; this only locates.
 */
function locateItemErrors(items: unknown, r: ActionState): ActionState {
  if (r.ok || !r.errors?.items || !Array.isArray(items)) return r;
  const errors = { ...r.errors };
  items.forEach((it, n) => {
    const parsed = requestedItemInput.safeParse(it);
    if (parsed.success) return;
    for (const issue of parsed.error.issues) {
      const key = ["items", n, ...issue.path].join(".");
      errors[key] = [...(errors[key] ?? []), issue.message];
    }
  });
  return { ...r, errors };
}

/** The inquiry's number from what the API answers (its detail), to name it in the note. */
const numberOf = (r: ActionState) => (r.data as { refNo?: string } | undefined)?.refNo;
/** "RFQ-2026-0583 marked lost", "Lost: price too high". */
const STAGE_SAID: Record<string, string> = { lost: "marked lost", won: "marked won", sourcing: "is being worked on", new: "is open again", quoted: "moved to Quoted" };

export async function moveStageAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(
    form,
    () => api.post(`/inquiries/${id}/stage`, { to: v.to, lostReason: v.lostReason || null, note: v.note || null, reason: reasonOf(form) }),
    "Stage updated.",
  );
  if (!r.ok) return r;
  refresh(id);
  const n = numberOf(r);
  const lost = v.to === "lost" && v.lostReason ? LOST_REASON_LABEL[v.lostReason as keyof typeof LOST_REASON_LABEL] : undefined;
  return {
    ...r,
    message: n ? `${n} ${STAGE_SAID[v.to ?? ""] ?? `moved to ${v.to}`}` : r.message,
    detail: lost ? `Why: ${lost}` : undefined,
    // Marked lost by mistake: Undo, for a little while (the API allows whoever did it, just now).
    undo: v.to === "lost" ? { type: "inquiry-lost", id } : undefined,
  };
}

export async function holdAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(
    form,
    () => api.post(`/inquiries/${id}/hold`, { onHold: v.onHold === "true", note: v.note || null, reason: reasonOf(form) }),
    v.onHold === "true" ? "On hold." : "Resumed.",
  );
  if (!r.ok) return r;
  refresh(id);
  const n = numberOf(r);
  return n ? { ...r, message: v.onHold === "true" ? `${n} put on hold` : `${n} taken off hold`, detail: v.onHold === "true" ? "Reminders are paused until it is taken off hold" : undefined } : r;
}

export async function assignAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(
    form,
    () => api.post(`/inquiries/${id}/assign`, { assigneeId: v.assigneeId || null, reason: reasonOf(form) }),
    "Assignment saved.",
  );
  if (!r.ok) return r;
  refresh(id);
  const d = r.data as { refNo?: string; assignee?: { name?: string } | null } | undefined;
  return d?.refNo ? { ...r, message: d.assignee?.name ? `${d.assignee.name} handles ${d.refNo}` : `Nobody handles ${d.refNo} now` } : r;
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
/** "Remove" on a file in the Edit the request window (called directly: that window is one form already). */
export async function removeRequestFileAction(dealId: string, fileId: string): Promise<ActionState> {
  return removeFileAction(dealId, fileId, {}, new FormData());
}

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
  const body = formBody(form);
  const r = locateItemErrors(body.items, await attempt(form, () => api.post<{ id: string; refNo: string }>("/inquiries", body)));
  if (!r.ok) return r;
  const { id, refNo } = r.data as { id: string; refNo: string };
  refresh(id);
  return { ok: true, data: { id, refNo } };
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

/**
 * "Edit the request": the request's own values (customer, contact, how it came, category, title, what they
 * need, priority, needed by), its items when they changed (one save, so a refused one saves nothing) and who
 * handles it.
 * Answers { id, refNo } so the window can send its new files, as a new inquiry does.
 */
/** `version`: the inquiry's updatedAt when the window opened (a save over someone else's change is refused). */
export async function saveRequestAction(id: string, version: string | null, _prev: ActionState, form: FormData): Promise<ActionState> {
  const { assigneeId, reason, items: given, ...fields } = formBody(form) as { assigneeId?: string | null; reason?: string; items?: unknown[] } & Record<string, unknown>;
  const r = await attempt(
    form,
    async () => {
      const d = await api.get<DealDetail>(`/inquiries/${id}`);
      const at = new Map(d.items.map((it, n) => [it.id, n]));
      // The items as the window sent them when they changed (Items step), else as they are.
      const items = Array.isArray(given) ? given : d.items.map((it) => ({
        id: it.id,
        partOf: it.parentId ? (at.get(it.parentId) ?? null) : null,
        description: it.description,
        model: it.model,
        quantity: it.quantity,
        unit: it.unit,
        targetPrice: it.targetPrice,
      }));
      await api.put(`/inquiries/${id}`, { ...fields, items, reason }, { version });
      if ((assigneeId ?? null) !== (d.assignee?.id ?? null)) await api.post(`/inquiries/${id}/assign`, { assigneeId: assigneeId ?? null, reason });
      return { id, refNo: d.refNo };
    },
    "Saved.",
  );
  if (r.ok) refresh(id);
  return locateItemErrors(given, r);
}

