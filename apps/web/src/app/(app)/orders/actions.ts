"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { attempt, formValues, type ActionState } from "@/lib/actions";

/** Mark a checklist step done / skipped / undone. */
export async function stepAction(orderId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(form, () => api.post(`/orders/${orderId}/steps`, { action: v.action, key: v.key, on: v.on || null, note: v.note || null }), v.action === "undo" ? "Step reopened." : "Saved.");
  if (r.ok) revalidatePath(`/orders/${orderId}`);
  return r;
}

export async function datesAction(orderId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(form, () => api.patch(`/orders/${orderId}/dates`, { shipBy: v.shipBy || null, readyOn: v.readyOn || null }), "Dates saved. Due dates updated.");
  if (r.ok) revalidatePath(`/orders/${orderId}`);
  return r;
}

export async function stepDueAction(orderId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(form, () => api.patch(`/orders/${orderId}/steps/due`, { key: v.key, due: v.due || null }), "Due date saved.");
  if (r.ok) revalidatePath(`/orders/${orderId}`);
  return r;
}

export async function cancelOrderAction(orderId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(form, () => api.post(`/orders/${orderId}/cancel`, { reason: v.reason }), "Order cancelled.");
  if (r.ok) revalidatePath(`/orders/${orderId}`);
  return r;
}
