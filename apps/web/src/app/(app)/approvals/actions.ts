"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { attempt, type ActionState } from "@/lib/actions";
import { money } from "@/lib/format";

/** A submission as its answers describe it: a payment or a cost, how much, on what, from whom. */
type Submission = { kind?: string; amount?: string | null; currency?: string | null; order?: { refNo?: string } | null; submittedBy?: { name?: string } | null };
const what = (s: Submission | undefined) => (s?.kind === "expense" ? "Cost" : "Payment");
const howMuch = (s: Submission | undefined) => (s?.amount && s.currency ? money(s.amount, s.currency) : null);

/** Records it as the approver (the usual payment or expense), with its photo. */
export async function approveAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => api.post(`/submissions/${id}/approve`, {}), "Verified. It counts now.");
  if (!r.ok) return r;
  revalidatePath("/", "layout");
  const s = (r.data as { submission?: Submission } | undefined)?.submission;
  return {
    ...r,
    message: `${what(s)} verified`,
    detail: [howMuch(s) ? `${howMuch(s)} now counts` : "It counts now", s?.order?.refNo ? `on ${s.order.refNo}` : null].filter(Boolean).join(" "),
  };
}

/** Back to the person who added it, with the reason. */
export async function sendBackAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const reason = String(form.get("reason") ?? "");
  const r = await attempt(form, () => api.post(`/submissions/${id}/send-back`, { reason }), "Sent back.");
  if (!r.ok) return r;
  revalidatePath("/", "layout");
  const d = r.data as ({ submission?: Submission } & Submission) | undefined;
  const who = (d?.submission ?? d)?.submittedBy?.name;
  return { ...r, message: who ? `Sent back to ${who}` : "Sent back", detail: "With your reason; it does not count" };
}

/** The person who added it takes it back. */
export async function withdrawAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => api.post(`/submissions/${id}/withdraw`, {}), "Taken back: it will not be verified.");
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

/** Verify chosen (board VerificationQueue): approves every one ticked, one after the other; says how many went through. */
export async function approveManyAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ids = [...new Set(form.getAll("id").map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)))];
  if (!ids.length) return { ok: false, message: "Tick the ones to verify first." };
  let done = 0;
  const failed: string[] = [];
  for (const id of ids) {
    try {
      await api.post(`/submissions/${id}/approve`, {});
      done += 1;
    } catch (e) {
      failed.push(e instanceof Error ? e.message : "could not be verified");
    }
  }
  revalidatePath("/", "layout");
  if (!failed.length) return { ok: true, message: `Verified ${done}. ${done === 1 ? "It counts" : "They count"} now.` };
  return { ok: false, message: `Verified ${done} of ${ids.length}. ${failed.length} could not be: ${failed[0]}` };
}
