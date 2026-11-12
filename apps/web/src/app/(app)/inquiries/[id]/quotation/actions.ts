"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { api, SESSION_COOKIE } from "@/lib/api";
import { withChromium } from "@/app/pdf/render";
import { attempt, formBody, formValues, reasonOf, type ActionState } from "@/lib/actions";
import type { DealDetail } from "@/lib/types";
import { LOST_REASON_LABEL, type LostReason } from "@kebo/shared";
import type { QuoteOffers, RevisionDraft } from "@/lib/types-deals";

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
    () => api.post(`/revisions/${revisionId}/status`, { to: v.to, on: v.on || null, reason: reasonOf(form), optionId: v.optionId || null, ...(v.to === "accepted" ? { customerRef: v.customerRef?.trim() || null, route: v.route || undefined } : {}) }),
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

/**
 * Lost: the sent revision recorded as rejected (with the reason) and the
 * inquiry marked lost — the same two calls as "Customer rejected" and "Mark
 * as lost" on their own.
 */
export async function lostAction(dealId: string, revisionId: string | null, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  if (!v.lostReason) return { ok: false, message: "Choose why it was lost.", errors: { lostReason: ["Choose why it was lost"] }, values: v };
  const why = `Lost: ${LOST_REASON_LABEL[v.lostReason as LostReason] ?? v.lostReason}${v.note?.trim() ? ` — ${v.note.trim()}` : ""}`;
  const r = await attempt(
    form,
    async () => {
      if (revisionId) await api.post(`/revisions/${revisionId}/status`, { to: "rejected", on: v.on || null, reason: why.slice(0, 500) });
      return api.post(`/inquiries/${dealId}/stage`, { to: "lost", lostReason: v.lostReason, note: v.note?.trim() || null, reason: why.slice(0, 500) });
    },
    "Marked as lost.",
  );
  if (r.ok) refresh(dealId);
  return r;
}

const TERM_FIELDS = ["validUntil", "incotermPlace", "paymentTerms", "deliveryTerms", "notes"] as const;

/** One of a draft's terms ("+ Add" on the terms card): the draft's values with it put in, saved with the same PUT as the editor. */
export async function revisionFieldsAction(dealId: string, revisionId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(
    form,
    async () => {
      const values = await api.get<RevisionDraft>(`/revisions/${revisionId}/values`);
      const body: Record<string, unknown> = { ...values };
      for (const k of TERM_FIELDS) if (k in v) body[k] = v[k]!.trim() === "" ? null : v[k]!.trim();
      return api.put(`/revisions/${revisionId}`, { ...body, reason: reasonOf(form) });
    },
    "Draft saved.",
  );
  if (r.ok) refresh(dealId);
  return r;
}

/** "Send email": the revision's PDF (its print page, as on Download PDF) goes with the message; a draft is then marked sent. */
export async function emailRevisionAction(dealId: string, revisionId: string, fileName: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const list = (s: string | undefined) => (s ?? "").split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
  const to = list(v.to);
  if (!to.length) return { ok: false, message: "Who is it to?", errors: { to: ["Write the customer's email"] }, values: v };
  let pdf: string | null = null;
  if (v.attach === "on") {
    const session = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!session) return { ok: false, message: "Your session ended. Please sign in again.", values: v };
    const made = await withChromium(session, (render) => render(`/print/revisions/${revisionId}`));
    if (made instanceof Response) return { ok: false, message: `The PDF could not be made: ${await made.text()}`, values: v };
    pdf = Buffer.from(made).toString("base64");
  }
  const r = await attempt(form, () =>
    api.post(`/revisions/${revisionId}/email`, { to, cc: list(v.cc), subject: v.subject ?? "", message: v.message ?? "", pdf, fileName }),
  );
  if (!r.ok) return r;
  refresh(dealId);
  return { ok: true, message: `Sent to ${to.join(", ")}.` };
}
