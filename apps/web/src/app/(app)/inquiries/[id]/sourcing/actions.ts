"use server";

import { revalidatePath } from "next/cache";
import { factoryQuoteInput } from "@kebo/shared";
import { api, ApiError } from "@/lib/api";
import { attempt, formBody, formValues, reasonOf, type ActionState } from "@/lib/actions";
import type { Paged } from "@/lib/types";
import type { FactoryOption, FactoryQuoteView } from "@/lib/types-deals";

const refresh = (id: string) => revalidatePath(`/inquiries/${id}`, "layout");

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

/* ---------------------------------------------------------------- the offer's lines, one change at a time */

/** What a line change gives back to the line table: the offer numbered again, or why not. */
export type OfferLineResult = { ok: true; offer: FactoryQuoteView } | { ok: false; message: string; reasonChoices?: string[] };

async function lineCall(dealId: string, fn: () => Promise<FactoryQuoteView>): Promise<OfferLineResult> {
  try {
    const offer = await fn();
    refresh(dealId);
    return { ok: true, offer };
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 401) return { ok: false, message: "Your session ended. Please sign in again." };
      const field = Object.values(e.body.fieldErrors ?? {}).find((v) => v?.length)?.[0];
      return { ok: false, message: field ?? e.message, reasonChoices: e.code === "reason_needed" ? (e.body.choices ?? []) : undefined };
    }
    console.error("[offer lines]", e);
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}

export async function addOfferLinesAction(dealId: string, quoteId: string, body: object) {
  return lineCall(dealId, () => api.post<FactoryQuoteView>(`/factory-quotes/${quoteId}/lines`, body));
}

export async function editOfferLineAction(dealId: string, lineId: string, body: object) {
  return lineCall(dealId, () => api.patch<FactoryQuoteView>(`/factory-lines/${lineId}`, body));
}

export async function moveOfferLineAction(dealId: string, lineId: string, body: object) {
  return lineCall(dealId, () => api.post<FactoryQuoteView>(`/factory-lines/${lineId}/move`, body));
}

export async function removeOfferLineAction(dealId: string, lineId: string, reason?: string) {
  return lineCall(dealId, () => api.delete<FactoryQuoteView>(`/factory-lines/${lineId}${reason ? `?reason=${encodeURIComponent(reason)}` : ""}`));
}

export async function copyOfferLinesAction(dealId: string, quoteId: string, fromQuoteId: string) {
  return lineCall(dealId, () => api.post<FactoryQuoteView>(`/factory-quotes/${quoteId}/copy-lines`, { fromQuoteId }));
}

const OFFER_FIELDS = ["reference", "validUntil", "basis", "basisPlace", "leadTime", "moq", "paymentTerms", "advancePercent", "notes"] as const;

/**
 * One or a few of an offer's details ("+ Add" in place on its card): the offer
 * as it is now, with what was sent put in, saved with the same PUT as the
 * offer's form (its lines are left as they are).
 */
export async function offerFieldsAction(dealId: string, quoteId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(
    form,
    async () => {
      const q = await api.get<FactoryQuoteView>(`/factory-quotes/${quoteId}`);
      const body: Record<string, unknown> = {
        factoryId: q.factory.id,
        reference: q.reference,
        receivedOn: q.receivedOn,
        validUntil: q.validUntil,
        currency: q.currency,
        basis: q.basis,
        basisPlace: q.basisPlace,
        leadTime: q.leadTime,
        moq: q.moq,
        paymentTerms: q.paymentTerms,
        advancePercent: q.advancePercent,
        notes: q.notes,
      };
      for (const k of OFFER_FIELDS) if (k in v) body[k] = v[k]!.trim() === "" ? null : v[k]!.trim();
      return api.put(`/factory-quotes/${quoteId}`, { ...body, reason: reasonOf(form) });
    },
    "Saved.",
  );
  if (r.ok) refresh(dealId);
  return r;
}
