"use server";

import { revalidatePath } from "next/cache";
import { supplierQuoteInput } from "@kebo/shared";
import { api, ApiError } from "@/lib/api";
import { attempt, formBody, reasonOf, type ActionState } from "@/lib/actions";
import type { Paged } from "@/lib/types";
import { requireUser } from "@/lib/session";
import type { SupplierOption, SupplierQuoteView } from "@/lib/types-deals";
import { isFailed, part, type Failed } from "@/lib/part";

const refresh = (id: string) => revalidatePath(`/inquiries/${id}`, "layout");

/** A new supplier typed in the offer window (as a new customer in the inquiry's): its name and how to reach them. */
export type QuickSupplier = {
  name: string;
  contactPerson: string;
  phone: string;
  wechat: string;
  email: string;
  address: string;
  bankDetails: string;
  notes: string;
};
export type QuickSupplierResult = { ok: true; factory: SupplierOption } | { ok: false; message: string; errors?: Record<string, string[] | undefined> };

/**
 * "New supplier" in the offer window: added to the supplier list now, looked after by whoever adds it (as on
 * Suppliers), and chosen for the offer. Same rules as the Suppliers page's own window (sourcing.manage).
 */
export async function quickSupplierAction(v: QuickSupplier): Promise<QuickSupplierResult> {
  const me = await requireUser();
  const blank = (x: string) => x.trim() || null;
  const r = await attempt(null, () =>
    api.post<{ id: string; name: string; contactPerson: string | null }>("/factories", {
      name: v.name.trim(),
      contactPerson: blank(v.contactPerson),
      phone: blank(v.phone),
      wechat: blank(v.wechat),
      email: blank(v.email),
      address: blank(v.address),
      bankDetails: blank(v.bankDetails),
      notes: blank(v.notes),
      ownerId: me.id,
    }),
  );
  if (!r.ok) return { ok: false, message: r.message ?? "Could not add the supplier.", errors: r.errors };
  const f = r.data as { id: string; name: string; contactPerson: string | null };
  revalidatePath("/suppliers");
  return { ok: true, factory: { id: f.id, name: f.name, contactPerson: f.contactPerson ?? (blank(v.contactPerson) as string | null) } };
}

/** Supplier picker: search the supplier list by name or contact person. */
export async function searchSuppliersAction(q: string): Promise<SupplierOption[] | Failed> {
  // Not read (logged): a Failed, and the picker says it could not search, never "none found".
  const res = await part("the suppliers", () => api.get<Paged<SupplierOption>>("/factories", { q: q.trim().slice(0, 100) || undefined, pageSize: 8 }));
  return isFailed(res) ? res : (res?.rows ?? []).map((f) => ({ id: f.id, name: f.name, contactPerson: f.contactPerson }));
}

/**
 * The API reports a problem inside a price line under one key ("lines"). Point
 * it at the exact line field ("lines.2.taxRate") so the form shows it next
 * to its box. The API has already decided; this only locates.
 */
function locateLineErrors(body: Record<string, unknown>, r: ActionState): ActionState {
  if (r.ok || !r.errors?.lines) return r;
  const parsed = supplierQuoteInput.safeParse(body);
  if (parsed.success) return r;
  const errors = { ...r.errors };
  for (const issue of parsed.error.issues) {
    if (issue.path[0] !== "lines" || issue.path.length < 3) continue;
    const key = issue.path.join(".");
    errors[key] = [...(errors[key] ?? []), issue.message];
  }
  return { ...r, errors };
}

/** Add (quoteId null) or edit one supplier's prices; JSON in `payload`. */
export async function saveSupplierQuoteAction(
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
      quoteId ? "Supplier prices saved." : "Supplier prices added.",
    ),
  );
  if (!r.ok) return r;
  refresh(dealId);
  // Named by the supplier, and what came with it.
  const supplier = String(form.get("supplierLabel") ?? "").trim();
  const lines = Array.isArray((body as { lines?: unknown[] }).lines) ? (body as { lines: unknown[] }).lines.length : 0;
  const currency = (body as { currency?: string }).currency;
  return {
    ...r,
    message: supplier ? `Offer from ${supplier} ${quoteId ? "saved" : "added"}` : r.message,
    detail: [lines ? `${lines} ${lines === 1 ? "item" : "items"}` : null, currency].filter(Boolean).join(" · ") || undefined,
  };
}

export async function removeSupplierQuoteAction(dealId: string, quoteId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const reason = reasonOf(form);
  const r = await attempt(
    form,
    () => api.delete(`/factory-quotes/${quoteId}${reason ? `?reason=${encodeURIComponent(reason)}` : ""}`),
    "Supplier prices removed.",
  );
  if (r.ok) refresh(dealId);
  return r;
}

/* ---------------------------------------------------------------- the offer's lines, one change at a time */

/** What a line change gives back to the line table: the offer numbered again, or why not. */
export type OfferLineResult = { ok: true; offer: SupplierQuoteView } | { ok: false; message: string; reasonChoices?: string[] };

async function lineCall(dealId: string, fn: () => Promise<SupplierQuoteView>): Promise<OfferLineResult> {
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
  return lineCall(dealId, () => api.post<SupplierQuoteView>(`/factory-quotes/${quoteId}/lines`, body));
}

export async function editOfferLineAction(dealId: string, lineId: string, body: object) {
  return lineCall(dealId, () => api.patch<SupplierQuoteView>(`/factory-lines/${lineId}`, body));
}

export async function moveOfferLineAction(dealId: string, lineId: string, body: object) {
  return lineCall(dealId, () => api.post<SupplierQuoteView>(`/factory-lines/${lineId}/move`, body));
}

export async function removeOfferLineAction(dealId: string, lineId: string, reason?: string) {
  return lineCall(dealId, () => api.delete<SupplierQuoteView>(`/factory-lines/${lineId}${reason ? `?reason=${encodeURIComponent(reason)}` : ""}`));
}

export async function copyOfferLinesAction(dealId: string, quoteId: string, fromQuoteId: string) {
  return lineCall(dealId, () => api.post<SupplierQuoteView>(`/factory-quotes/${quoteId}/copy-lines`, { fromQuoteId }));
}
