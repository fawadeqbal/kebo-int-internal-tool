"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { attempt, type ActionState } from "@/lib/actions";

/** Records it as the approver (the usual payment or expense), with its photo. */
export async function approveAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => api.post(`/submissions/${id}/approve`, {}), "Approved. It counts now.");
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

/** Back to the person who added it, with the reason. */
export async function sendBackAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const reason = String(form.get("reason") ?? "");
  const r = await attempt(form, () => api.post(`/submissions/${id}/send-back`, { reason }), "Sent back.");
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

/** The person who added it takes it back. */
export async function withdrawAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => api.post(`/submissions/${id}/withdraw`, {}), "Withdrawn.");
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
      failed.push(e instanceof Error ? e.message : "could not be approved");
    }
  }
  revalidatePath("/", "layout");
  if (!failed.length) return { ok: true, message: `Verified ${done}. ${done === 1 ? "It counts" : "They count"} now.` };
  return { ok: false, message: `Verified ${done} of ${ids.length}. ${failed.length} could not be: ${failed[0]}` };
}
