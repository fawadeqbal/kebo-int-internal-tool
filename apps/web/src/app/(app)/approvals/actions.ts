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
