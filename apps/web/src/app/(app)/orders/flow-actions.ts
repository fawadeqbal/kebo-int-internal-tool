"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { attempt, formBody, formValues, type ActionState } from "@/lib/actions";

/**
 * The order flow after acceptance (see the API's /orders/:id/flow). The API's
 * schemas take form strings (an empty field clears it), so most forms send
 * their fields as they are; lists (the SAT points) send a JSON `payload`.
 */

const refresh = (orderId: string) => {
  revalidatePath(`/orders/${orderId}`, "layout");
  revalidatePath("/orders");
};

const run = async (orderId: string, form: FormData | null, call: () => Promise<unknown>, done: string): Promise<ActionState> => {
  const r = await attempt(form, call, done);
  if (r.ok) refresh(orderId);
  return r;
};

/** Only the named fields: a form may carry buttons and helpers the API does not know. */
const pick = (form: FormData, keys: string[]) => {
  const v = formValues(form);
  return Object.fromEntries(keys.filter((k) => k in v).map((k) => [k, v[k]]));
};

/* ---------------------------------------------------------------- payment route, bank contract, factory order */

export async function routeAction(orderId: string, _prev: ActionState, form: FormData) {
  const v = formValues(form);
  const body = {
    route: v.route || null,
    ...(v.balanceWhen ? { balanceWhen: v.balanceWhen } : {}),
    ...(v.lcTerms ? { lcTerms: v.lcTerms } : {}),
    ...(v.lcDays ? { lcDays: v.lcDays } : {}),
  };
  return run(orderId, form, () => api.patch(`/orders/${orderId}/route`, body), "Payment route saved. The plan follows it.");
}

const CONTRACT = ["number", "status", "customerBank", "ourBank", "amount", "currency", "openedOn", "latestShipOn", "expiresOn", "note"];
export async function bankContractAction(orderId: string, _prev: ActionState, form: FormData) {
  return run(orderId, form, () => api.put(`/orders/${orderId}/bank-contract`, pick(form, CONTRACT)), "Saved.");
}

/* ---------------------------------------------------------------- shipping */

export async function removeShipmentAction(orderId: string, shipmentId: string, _prev: ActionState, form: FormData) {
  return run(orderId, form, () => api.delete(`/shipments/${shipmentId}`), "Shipment removed.");
}

/* ---------------------------------------------------------------- documents and the bank chain */

const DOCUMENT = ["title", "number", "issuedOn", "status", "shipmentId", "attachmentId", "note", "keptWhere"];

export async function addDocumentAction(orderId: string, _prev: ActionState, form: FormData) {
  return run(orderId, form, () => api.post(`/orders/${orderId}/document-set`, pick(form, ["kind", ...DOCUMENT])), "Document recorded.");
}

export async function updateDocumentAction(orderId: string, docId: string, _prev: ActionState, form: FormData) {
  return run(orderId, form, () => api.patch(`/order-documents/${docId}`, pick(form, DOCUMENT)), "Document saved.");
}

/* ---------------------------------------------------------------- delivery, SAT, claims */

/** payload: { checks: [{ id?, item, result, note? }] } */
export async function satAction(orderId: string, _prev: ActionState, form: FormData) {
  return run(orderId, form, () => api.put(`/orders/${orderId}/sat`, formBody(form)), "SAT points saved.");
}

export async function addClaimAction(orderId: string, _prev: ActionState, form: FormData) {
  return run(orderId, form, () => api.post(`/orders/${orderId}/claims`, pick(form, ["title", "detail", "openedOn", "amount", "bearer"])), "Claim opened.");
}

export async function updateClaimAction(orderId: string, claimId: string, _prev: ActionState, form: FormData) {
  return run(orderId, form, () => api.patch(`/claims/${claimId}`, pick(form, ["status", "resolution", "amount", "bearer"])), "Claim saved.");
}

/** Send one purchase order to its supplier (before the deposit is verified: with the reason). */
export async function sendPurchaseOrderAction(orderId: string, poId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(
    form,
    () => api.post(`/orders/${orderId}/purchase-orders/${poId}/send`, { sentOn: v.sentOn, supplierRef: v.supplierRef?.trim() || null, how: v.how || null, reason: v.reason?.trim() || null }),
    "Purchase order sent.",
  );
  if (r.ok) revalidatePath(`/orders/${orderId}`, "layout");
  return r;
}

