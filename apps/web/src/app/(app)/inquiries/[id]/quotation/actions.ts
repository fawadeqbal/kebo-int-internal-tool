"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { api, SESSION_COOKIE } from "@/lib/api";
import { withChromium } from "@/app/pdf/render";
import { attempt, formBody, formValues, reasonOf, type ActionState } from "@/lib/actions";
import type { DealDetail } from "@/lib/types";
import { LOST_REASON_LABEL, type LostReason } from "@kebo/shared";
import type { NewQuotationsResult, QuotationView, QuoteOffers, RevisionDraft } from "@/lib/types-deals";

const refresh = (id: string) => revalidatePath(`/inquiries/${id}`, "layout");

/** What a revision answer says about itself: "QUO-2026-0051 R1", and how many options it has. */
type RevisionAnswer = { number?: number; quotation?: { refNo?: string }; options?: unknown[] };
const revisionName = (d: RevisionAnswer | undefined) => (d?.number ? `${d.quotation?.refNo ? `${d.quotation.refNo} ` : ""}R${d.number}` : null);

/** Start the next revision as a draft (JSON in `payload`, from …/quotation/draft and the person's changes). */
export async function createRevisionAction(dealId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => api.post<{ number: number }>(`/inquiries/${dealId}/quotation/revisions`, formBody(form)));
  if (!r.ok) return r;
  refresh(dealId);
  const d = r.data as RevisionAnswer;
  const options = d.options?.length ?? 0;
  return {
    ...r,
    message: `Quotation ${revisionName(d) ?? `R${d.number}`} drafted`,
    detail: `${options > 1 ? `${options} options · ` : ""}Check it, then send it`,
  };
}

/**
 * New quotations: one draft for each offer ticked (or own prices), lettered A, B, C… The window sends the offers
 * (`offer` once per tick; "own" for own prices), the currency, valid until and the margin.
 */
export async function newQuotationsAction(dealId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const offers = form.getAll("offer").map((o) => (o === "own" ? null : String(o)));
  if (!offers.length) return { ok: false, message: "Tick at least one offer.", errors: { offer: ["Tick at least one offer"] }, values: v };
  const r = await attempt(form, () =>
    api.post<NewQuotationsResult>(`/inquiries/${dealId}/quotations`, { offers, currency: (v.currency ?? "").trim().toUpperCase(), validUntil: v.validUntil, margin: v.margin }),
  );
  if (!r.ok) return r;
  refresh(dealId);
  const made = (r.data as NewQuotationsResult).quotations;
  return {
    ...r,
    message: made.length === 1 ? `${made[0]!.refNo} drafted` : `${made.length} quotations drafted`,
    detail: made.length === 1 ? "Check it, then send it" : made.map((q) => q.letter).join(", "),
    data: { first: made[0]?.id ?? null },
  };
}

/** One quotation's next revision (after the customer has seen one, the API asks why). */
export async function reviseAction(dealId: string, quotationId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => api.post<{ number: number }>(`/quotations/${quotationId}/revisions`, formBody(form)));
  if (!r.ok) return r;
  refresh(dealId);
  return { ...r, message: `${revisionName(r.data as RevisionAnswer) ?? "The new revision"} drafted`, detail: "Change what is different, then send it" };
}

export async function updateRevisionAction(dealId: string, revisionId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => api.put(`/revisions/${revisionId}`, formBody(form)), "Draft saved.");
  if (r.ok) refresh(dealId);
  return r;
}

/**
 * "Delete draft" on a quotation's own page: the draft goes, then the page shows the quotation's revision before it,
 * or (when it was its only one) the inquiry's list of quotations.
 */
export async function deleteDraftAction(dealId: string, quotationId: string, revisionId: string, _prev: ActionState, _form: FormData): Promise<ActionState> {
  const r = await attempt(null, () => api.delete(`/revisions/${revisionId}`), "Draft deleted.");
  if (!r.ok) return r;
  refresh(dealId);
  const left = await api.get<QuotationView>(`/inquiries/${dealId}/quotation`).catch(() => null);
  redirect(left?.quotations.some((q) => q.id === quotationId) ? `/inquiries/${dealId}/quotations/${quotationId}` : `/inquiries/${dealId}/quotation`);
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

/**
 * The quotations a send window includes (design "one way, any number"): this one and the deal's other drafts
 * ticked under Include, in the window's order.
 */
function included(form: FormData, revisionId: string) {
  const ids = [...new Set(form.getAll("include").map(String).filter(Boolean))];
  return ids.includes(revisionId) ? ids : [revisionId, ...ids];
}

const list = (s: string | undefined) => (s ?? "").split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);

/** Sent, or the customer's answer (accepted creates the order). With other drafts included, all are marked sent. */
export async function moveRevisionAction(dealId: string, revisionId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  if (v.to === "sent" && included(form, revisionId).length > 1) return markManySent(dealId, included(form, revisionId), form);
  const r = await attempt(
    form,
    () => api.post(`/revisions/${revisionId}/status`, { to: v.to, on: v.on || null, reason: reasonOf(form), optionId: v.optionId || null, ...(v.to === "sent" && v.via ? { via: v.via } : {}), ...(v.to === "accepted" ? { customerRef: v.customerRef?.trim() || null, route: v.route || undefined } : {}) }),
    DONE[v.to] ?? "Saved.",
  );
  // Accepting is one step: when the order cannot be made, nothing at all was changed. Say so.
  if (!r.ok && v.to === "accepted" && !r.code && !r.errors && /went wrong/i.test(r.message ?? ""))
    return { ...r, message: "The order could not be made, so nothing was changed: the quotation is still waiting for the answer. Try again; if it happens again, tell whoever looks after the system." };
  if (!r.ok) return r;
  refresh(dealId);
  const name = revisionName(r.data as RevisionAnswer);
  if (v.to === "accepted") {
    const deal = await api.get<DealDetail>(`/inquiries/${dealId}`).catch(() => null);
    const order = deal?.orders.find((o) => o.status !== "cancelled");
    if (order) {
      revalidatePath(`/orders/${order.id}`, "layout");
      return {
        ...r,
        message: `Sales order ${order.refNo} made${name ? ` from ${name}` : ""}`,
        detail: "The customer accepted: the order starts with its payment",
        next: [{ label: "Open the order", href: `/orders/${order.id}` }],
        data: { orderId: order.id, orderRefNo: order.refNo },
      };
    }
  }
  if (!name) return r;
  const said: Record<string, ActionState> = {
    sent: { message: `${name} marked as sent`, detail: "The inquiry is now Quoted" },
    rejected: { message: `${name}: the customer said no` },
    expired: { message: `${name} marked expired` },
  };
  return { ...r, ...(said[v.to ?? ""] ?? {}) };
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
  if (!r.ok) return r;
  refresh(dealId);
  const n = (r.data as { refNo?: string } | undefined)?.refNo;
  return { ...r, message: n ? `${n} marked lost` : "Marked lost", detail: why };
}

/**
 * The customer said no to one quotation: it is recorded as rejected (with why). With `close` ticked the
 * inquiry is closed as lost too (as Lost… does); unticked, its other quotations stay open.
 */
export async function saidNoAction(dealId: string, revisionId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  if (v.close === "on") return lostAction(dealId, revisionId, _prev, form);
  const why = v.note?.trim() || (v.lostReason ? LOST_REASON_LABEL[v.lostReason as LostReason] : "");
  if (!why) return { ok: false, message: "Say why they said no.", errors: { note: ["Say why"] }, values: v };
  const r = await attempt(form, () => api.post(`/revisions/${revisionId}/status`, { to: "rejected", on: v.on || null, reason: why.slice(0, 500) }), "Recorded: the customer said no.");
  if (!r.ok) return r;
  refresh(dealId);
  const name = revisionName(r.data as RevisionAnswer);
  return { ...r, message: name ? `${name}: the customer said no` : "Recorded: the customer said no", detail: why };
}

const TERM_FIELDS = ["validUntil", "incotermPlace", "paymentTerms", "deliveryTerms", "warranty", "notes"] as const;

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

/**
 * "Send email": the revision's PDF (its print page, as on Download PDF) goes with the message; a draft is then
 * marked sent. With other drafts included, they go in the same email, each with its PDF.
 */
export async function emailRevisionAction(dealId: string, revisionId: string, fileName: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const to = list(v.to);
  if (!to.length) return { ok: false, message: "Who is it to?", errors: { to: ["Write the customer's email"] }, values: v };
  const ids = included(form, revisionId);
  if (ids.length > 1) return emailMany(dealId, ids, to, form);
  let pdf: string | null = null;
  if (v.attach === "on") {
    const session = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!session) return { ok: false, message: "Your session ended. Please sign in again.", values: v };
    // Sending it is what makes a draft the sent quotation: the copy that goes out is printed as sent, without the DRAFT mark.
    const made = await withChromium(session, (render) => render(`/print/revisions/${revisionId}?sending=1`));
    if (made instanceof Response) return { ok: false, message: `The PDF could not be made: ${await made.text()}`, values: v };
    pdf = Buffer.from(made).toString("base64");
  }
  const r = await attempt(form, () =>
    api.post(`/revisions/${revisionId}/email`, { to, cc: list(v.cc), subject: v.subject ?? "", message: v.message ?? "", pdf, fileName }),
  );
  if (!r.ok) return r;
  refresh(dealId);
  return { ok: true, message: `${fileName.replace(/\.pdf$/i, "") || "The quotation"} sent to ${to.join(", ")}`, detail: pdf ? "By email, with the PDF" : "By email" };
}

/** Several drafts in one email: each one's PDF printed as sent, attached in the same order; each is then sent. */
async function emailMany(dealId: string, ids: string[], to: string[], form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const body = new FormData();
  body.set("revisionIds", ids.join(","));
  body.set("to", to.join(", "));
  body.set("cc", list(v.cc).join(", "));
  body.set("subject", v.subject ?? "");
  body.set("message", v.message ?? "");
  const attach = v.attach === "on";
  if (attach) {
    const session = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!session) return { ok: false, message: "Your session ended. Please sign in again.", values: v };
    const made = await withChromium(session, async (render) => {
      const out: Uint8Array[] = [];
      for (const id of ids) out.push(await render(`/print/revisions/${id}?sending=1`));
      return out;
    });
    if (made instanceof Response) return { ok: false, message: `The PDFs could not be made: ${await made.text()}`, values: v };
    made.forEach((pdf, i) => body.append("pdfs", new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), `${i + 1}.pdf`));
  }
  const r = await attempt(form, () => api.upload<{ sent: string[] }>(`/inquiries/${dealId}/quotations/email`, body));
  if (!r.ok) return r;
  refresh(dealId);
  const sent = (r.data as { sent: string[] }).sent;
  return { ok: true, message: `${sent.length} quotations sent to ${to.join(", ")}`, detail: `${sent.join(", ")} · by email${attach ? ", each with its PDF" : ""}` };
}

/** Several drafts marked sent at once (sent another way: how, and the day). */
async function markManySent(dealId: string, ids: string[], form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(form, () => api.post<{ sent: string[] }>(`/inquiries/${dealId}/quotations/sent`, { revisionIds: ids, on: v.on || null, via: v.via || undefined }));
  if (!r.ok) return r;
  refresh(dealId);
  const sent = (r.data as { sent: string[] }).sent;
  return { ok: true, message: `${sent.length} quotations marked as sent`, detail: `${sent.join(", ")} · the inquiry is now Quoted` };
}
