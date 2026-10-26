"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { attempt, formBody, formValues, type ActionState } from "@/lib/actions";

const done = (orderId: string, r: ActionState) => {
  if (r.ok) revalidatePath(`/orders/${orderId}`, "layout");
  return r;
};

/** A new shipment (packing list) from the editor's JSON payload. */
export async function createShipmentAction(orderId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  return done(orderId, await attempt(form, () => api.post(`/orders/${orderId}/shipments`, formBody(form)), "Shipment planned."));
}

export async function updateShipmentAction(orderId: string, shipmentId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  return done(orderId, await attempt(form, () => api.put(`/shipments/${shipmentId}`, formBody(form)), "Shipment saved."));
}

/** Booked / Departed / Arrived. Departing the last goods ticks "Shipped" (inspection — and the balance, under before-shipment terms — first). */
export async function shipmentStatusAction(orderId: string, shipmentId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const words: Record<string, string> = { booked: "Marked as booked.", departed: "The goods have left.", arrived: "Marked as arrived." };
  return done(
    orderId,
    await attempt(
      form,
      () => api.post(`/shipments/${shipmentId}/status`, { to: v.to, on: v.on || null, note: v.note || null }),
      words[v.to],
    ),
  );
}

/** The original B/L handed to the customer (balance first). */
export async function documentsReleasedAction(
  orderId: string,
  shipmentId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const v = formValues(form);
  return done(
    orderId,
    await attempt(
      form,
      () => api.post(`/shipments/${shipmentId}/documents-released`, { on: v.on || null, note: v.note || null }),
      "Original documents released.",
    ),
  );
}
