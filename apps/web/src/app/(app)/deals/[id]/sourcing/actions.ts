"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { attempt, formBody, formValues, type ActionState } from "@/lib/actions";
import type { Paged } from "@/lib/types";
import type { FactoryOption } from "@/lib/types-deals";

const refresh = (id: string) => revalidatePath(`/deals/${id}`, "layout");

/** Factory picker: search the factory list by name or contact person. */
export async function searchFactoriesAction(q: string): Promise<FactoryOption[]> {
  try {
    const res = await api.get<Paged<FactoryOption>>("/factories", { q: q.trim().slice(0, 100) || undefined, pageSize: 8 });
    return res.rows.map((f) => ({ id: f.id, name: f.name, contactPerson: f.contactPerson, defaultVatRate: String(f.defaultVatRate), pricesIncludeVat: f.pricesIncludeVat }));
  } catch {
    return [];
  }
}

/** Add (quoteId null) or edit one factory's prices; JSON in `payload`. */
export async function saveFactoryQuoteAction(dealId: string, quoteId: string | null, _prev: ActionState, form: FormData): Promise<ActionState> {
  const body = formBody(form);
  const r = await attempt(form, () => (quoteId ? api.put(`/factory-quotes/${quoteId}`, body) : api.post(`/inquiries/${dealId}/factory-quotes`, body)), quoteId ? "Factory prices saved." : "Factory prices added.");
  if (r.ok) refresh(dealId);
  return r;
}

export async function removeFactoryQuoteAction(dealId: string, quoteId: string, _prev: ActionState, _form: FormData): Promise<ActionState> {
  const r = await attempt(null, () => api.delete(`/factory-quotes/${quoteId}`), "Factory prices removed.");
  if (r.ok) refresh(dealId);
  return r;
}

/** Which factory price an item is quoted from (lineId empty = none). */
export async function choosePriceAction(dealId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(form, () => api.post(`/inquiries/${dealId}/preferred-prices`, { choices: { [v.itemId]: v.lineId || null } }), "The quotation will use this price.");
  if (r.ok) refresh(dealId);
  return r;
}
