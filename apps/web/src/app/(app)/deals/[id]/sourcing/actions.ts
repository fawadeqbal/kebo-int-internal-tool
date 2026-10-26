"use server";

import { revalidatePath } from "next/cache";
import { factoryQuoteInput } from "@kebo/shared";
import { api } from "@/lib/api";
import { attempt, formBody, formValues, reasonOf, type ActionState } from "@/lib/actions";
import type { Paged } from "@/lib/types";
import type { FactoryOption } from "@/lib/types-deals";

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

/**
 * The API reports a problem inside a price line under one key ("lines"). Point
 * it at the exact line field ("lines.2.taxRate") so the form shows it next
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
export async function saveFactoryQuoteAction(
  dealId: string,
  quoteId: string | null,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const body = formBody(form);
  const r = locateLineErrors(
    body,
    await attempt(
      form,
      () => (quoteId ? api.put(`/factory-quotes/${quoteId}`, body) : api.post(`/inquiries/${dealId}/factory-quotes`, body)),
      quoteId ? "Factory prices saved." : "Factory prices added.",
    ),
  );
  if (r.ok) refresh(dealId);
  return r;
}

export async function removeFactoryQuoteAction(dealId: string, quoteId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const reason = reasonOf(form);
  const r = await attempt(
    form,
    () => api.delete(`/factory-quotes/${quoteId}${reason ? `?reason=${encodeURIComponent(reason)}` : ""}`),
    "Factory prices removed.",
  );
  if (r.ok) refresh(dealId);
  return r;
}

/** The factory quotes an item as separate parts: payload { parts: [{ description, model, quantity, unit }] }. */
export async function splitItemAction(dealId: string, itemId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(
    form,
    () => api.post(`/inquiries/${dealId}/items/${itemId}/parts`, formBody(form)),
    "Parts added. Price each part below.",
  );
  if (r.ok) refresh(dealId);
  return r;
}

/** Which factory price an item is quoted from (lineId empty = none). */
export async function choosePriceAction(dealId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(
    form,
    () => api.post(`/inquiries/${dealId}/preferred-prices`, { choices: { [v.itemId]: v.lineId || null }, reason: reasonOf(form) }),
    "The quotation will use this price.",
  );
  if (r.ok) refresh(dealId);
  return r;
}
