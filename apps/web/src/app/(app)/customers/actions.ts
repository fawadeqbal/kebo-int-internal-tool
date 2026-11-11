"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { customerInput } from "@kebo/shared";
import { api, ApiError } from "@/lib/api";
import type { ImportResult, CustomerInput } from "@kebo/shared";
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
  const r = locateContactErrors(body, await attempt(form, () => (id ? api.put<{ id: string }>(`/customers/${id}`, body) : api.post<{ id: string }>("/customers", body))));
  if (!r.ok) return r;
  const savedId = id ?? (r.data as { id: string }).id;
  revalidatePath("/customers");
  revalidatePath(`/customers/${savedId}`, "layout");
  const name = (body as { name?: unknown }).name;
  if (form.get("inPanel") === "1") return { ok: true, data: { id: savedId, name: typeof name === "string" ? name.trim() : "" } };
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

/** New customers from an uploaded Excel file (checked on the page; the API checks again and leaves out any already there). */
export async function importCustomersAction(items: CustomerInput[], fileName: string): Promise<{ ok: true; result: ImportResult } | { ok: false; message: string }> {
  try {
    const result = await api.post<ImportResult>("/customers/import", { customers: items, fileName });
    revalidatePath("/customers");
    return { ok: true, result };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, message: e.status === 403 ? "You cannot add customers." : e.message };
    throw e;
  }
}
