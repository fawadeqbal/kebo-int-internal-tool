"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { attempt, formBody, formValues, type ActionState } from "@/lib/actions";

const done = (orderId: string, r: ActionState) => {
  if (r.ok) revalidatePath(`/orders/${orderId}`, "layout");
  return r;
};

/** A new factory order (draft) from the editor's JSON payload. */
export async function createFactoryOrderAction(orderId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  return done(
    orderId,
    await attempt(
      form,
      () => api.post(`/orders/${orderId}/factory-orders`, formBody(form)),
      "Factory order saved as a draft. Send it when the factory has it.",
    ),
  );
}

export async function updateFactoryOrderAction(orderId: string, foId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  return done(orderId, await attempt(form, () => api.put(`/factory-orders/${foId}`, formBody(form)), "Factory order saved."));
}

/** Sent to the factory: ticks "Factory order placed". */
export async function sendFactoryOrderAction(orderId: string, foId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  return done(
    orderId,
    await attempt(form, () => api.post(`/factory-orders/${foId}/send`, { on: v.on || null }), "Marked as sent to the factory."),
  );
}

/** The factory confirmed, with its ready date. */
export async function confirmFactoryOrderAction(orderId: string, foId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  return done(
    orderId,
    await attempt(
      form,
      () => api.post(`/factory-orders/${foId}/confirm`, { readyOn: v.readyOn, on: v.on || null }),
      "Factory confirmation recorded.",
    ),
  );
}

/** The factory's VAT invoice (fapiao) arrived. */
export async function vatInvoiceAction(orderId: string, foId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  return done(
    orderId,
    await attempt(form, () => api.post(`/factory-orders/${foId}/vat-invoice`, { number: v.number, on: v.on }), "VAT invoice recorded."),
  );
}

export async function cancelFactoryOrderAction(orderId: string, foId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  return done(
    orderId,
    await attempt(form, () => api.post(`/factory-orders/${foId}/cancel`, { reason: v.reason }), "Factory order cancelled."),
  );
}
