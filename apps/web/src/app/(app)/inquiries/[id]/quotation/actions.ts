"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { attempt, formBody, formValues, reasonOf, type ActionState } from "@/lib/actions";
import type { DealDetail } from "@/lib/types";
import type { QuoteOffers } from "@/lib/types-deals";

const refresh = (id: string) => revalidatePath(`/inquiries/${id}`, "layout");

/** Start the next revision as a draft (JSON in `payload`, from …/quotation/draft and the person's changes). */
export async function createRevisionAction(dealId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => api.post<{ number: number }>(`/inquiries/${dealId}/quotation/revisions`, formBody(form)));
  if (r.ok) {
    refresh(dealId);
    r.message = `R${(r.data as { number: number }).number} saved as a draft. Check it, then mark it as sent.`;
  }
  return r;
}

export async function updateRevisionAction(dealId: string, revisionId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => api.put(`/revisions/${revisionId}`, formBody(form)), "Draft saved.");
  if (r.ok) refresh(dealId);
  return r;
}

export async function deleteRevisionAction(dealId: string, revisionId: string, _prev: ActionState, _form: FormData): Promise<ActionState> {
  const r = await attempt(null, () => api.delete(`/revisions/${revisionId}`), "Draft deleted.");
  if (r.ok) refresh(dealId);
  return r;
}

const DONE: Record<string, string> = {
  sent: "Marked as sent. The inquiry is now Quoted.",
  accepted: "Accepted. The order was created.",
  rejected: "Recorded: the customer rejected it.",
  expired: "Marked expired.",
};

/** Sent, or the customer's answer (accepted creates the order). */
export async function moveRevisionAction(dealId: string, revisionId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(
    form,
    () => api.post(`/revisions/${revisionId}/status`, { to: v.to, on: v.on || null, reason: reasonOf(form), optionId: v.optionId || null }),
    DONE[v.to] ?? "Saved.",
  );
  if (!r.ok) return r;
  refresh(dealId);
  if (v.to === "accepted") {
    const deal = await api.get<DealDetail>(`/inquiries/${dealId}`).catch(() => null);
    const order = deal?.orders.find((o) => o.status !== "cancelled");
    if (order) {
      revalidatePath(`/orders/${order.id}`, "layout");
      return { ...r, message: `Accepted. Order ${order.refNo} was created.`, data: { orderId: order.id, orderRefNo: order.refNo } };
    }
  }
  return r;
}

/** The offers with costs in another currency (the editor asks when the quotation currency changes). */
export async function offersAction(dealId: string, currency: string): Promise<QuoteOffers | null> {
  try {
    return await api.get<QuoteOffers>(`/inquiries/${dealId}/quotation/offers`, { currency: currency.trim().toUpperCase().slice(0, 3) });
  } catch {
    return null;
  }
}
