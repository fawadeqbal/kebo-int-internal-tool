"use server";

import { revalidatePath } from "next/cache";
import { factoryQuoteInput } from "@kebo/shared";
import { api } from "@/lib/api";
import { attempt, formBody, formValues, type ActionState } from "@/lib/actions";
import type { Paged } from "@/lib/types";
import type { FactoryOption, HsCodeLookup } from "@/lib/types-deals";

const refresh = (id: string) => revalidatePath(`/deals/${id}`, "layout");

/** Factory picker: search the factory list by name or contact person. */
export async function searchFactoriesAction(q: string): Promise<FactoryOption[]> {
  try {
    const res = await api.get<Paged<FactoryOption>>("/factories", { q: q.trim().slice(0, 100) || undefined, pageSize: 8 });
    return res.rows.map((f) => ({ id: f.id, name: f.name, contactPerson: f.contactPerson }));
  } catch {
    return [];
  }
}

/** The export rebate remembered for an HS code: null the first time it is used, undefined when it cannot be checked. */
export async function lookupHsCodeAction(code: string): Promise<{ rebateRate: number; description: string | null } | null | undefined> {
  const clean = code.replace(/\s+/g, "");
  if (!/^[0-9.]{2,20}$/.test(clean)) return undefined;
  try {
    const r = await api.get<HsCodeLookup>(`/hs-codes/${encodeURIComponent(clean)}`);
    return r.code === null ? null : { rebateRate: r.rebateRate, description: r.description };
  } catch {
    return undefined;
  }
}

/**
 * The API reports a problem inside a price line under one key ("lines"). Point
 * it at the exact line field ("lines.2.rebateRate") so the form shows it next
 * to its box. The API has already decided; this only locates.
 */
function locateLineErrors(body: Record<string, unknown>, r: ActionState): ActionState {
  if (r.ok || !r.errors?.lines) return r;
  const parsed = factoryQuoteInput.safeParse(body);
  if (parsed.success) return r;
  const errors = { ...r.errors };
  for (const issue of parsed.error.issues) {
    if (issue.path[0] !== "lines" || issue.path.length < 3) continue;
    const key = issue.path.join(".");
    errors[key] = [...(errors[key] ?? []), issue.message];
  }
  return { ...r, errors };
}

/** Add (quoteId null) or edit one factory's prices; JSON in `payload`. */
export async function saveFactoryQuoteAction(dealId: string, quoteId: string | null, _prev: ActionState, form: FormData): Promise<ActionState> {
  const body = formBody(form);
  const r = locateLineErrors(body, await attempt(form, () => (quoteId ? api.put(`/factory-quotes/${quoteId}`, body) : api.post(`/inquiries/${dealId}/factory-quotes`, body)), quoteId ? "Factory prices saved." : "Factory prices added."));
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
