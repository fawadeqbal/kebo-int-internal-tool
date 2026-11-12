"use server";

import { revalidatePath } from "next/cache";
import type { BankStepKind } from "@kebo/shared";
import { api } from "@/lib/api";
import { attempt, formBody, formValues, type ActionState } from "@/lib/actions";

/**
 * The order flow after acceptance (see the API's /orders/:id/flow). The API's
 * schemas take form strings (an empty field clears it), so most forms send
 * their fields as they are; lists (production, SAT) send a JSON `payload`.
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

export async function factoryOrderAction(orderId: string, _prev: ActionState, form: FormData) {
  const v = formValues(form);
  const body = {
    ...("factoryOrderedOn" in v ? { factoryOrderedOn: v.factoryOrderedOn || null } : {}),
    ...("factoryOrderNo" in v ? { factoryOrderNo: v.factoryOrderNo || null } : {}),
  };
  return run(orderId, form, () => api.patch(`/orders/${orderId}/factory-order`, body), "Saved.");
}

/* ---------------------------------------------------------------- shipping */

const SHIPMENT = ["mode", "status", "forwarder", "bookingNo", "blNo", "vessel", "portOfLoading", "portOfDischarge", "containerNo", "containerType", "sealNo", "loadedOn", "vgmKg", "etd", "eta", "departedOn", "arrivedOn", "note", "forwarderContact", "forwarderPhone", "customsBroker", "trackingNo", "freightAmount", "freightCurrency", "insurer", "insurancePolicyNo", "customsDeclarationNo", "clearedOn"];

export async function addShipmentAction(orderId: string, _prev: ActionState, form: FormData) {
  return run(orderId, form, () => api.post(`/orders/${orderId}/shipments`, pick(form, SHIPMENT)), "Shipment added.");
}

export async function updateShipmentAction(orderId: string, shipmentId: string, _prev: ActionState, form: FormData) {
  return run(orderId, form, () => api.patch(`/shipments/${shipmentId}`, pick(form, SHIPMENT)), "Shipment saved.");
}

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

export async function removeDocumentAction(orderId: string, docId: string, _prev: ActionState, form: FormData) {
  return run(orderId, form, () => api.delete(`/order-documents/${docId}`), "Document removed.");
}

export async function bankStepAction(orderId: string, step: BankStepKind, _prev: ActionState, form: FormData) {
  return run(orderId, form, () => api.put(`/orders/${orderId}/bank-steps/${step}`, pick(form, ["doneOn", "courier", "reference", "note"])), "Step recorded.");
}

export async function clearBankStepAction(orderId: string, step: BankStepKind, _prev: ActionState, form: FormData) {
  return run(orderId, form, () => api.delete(`/orders/${orderId}/bank-steps/${step}`), "Step undone.");
}

/* ---------------------------------------------------------------- delivery, SAT, claims */

const DELIVERY = ["deliveredOn", "deliveryNote", "deliveryReceivedBy", "satEngineerId", "satPlannedOn", "satDoneOn", "satSignedBy"];

/** The condition is the lines': "every line arrived good" marks them all (and dates the delivery), then the rest is saved. */
export async function deliveryAction(orderId: string, _prev: ActionState, form: FormData) {
  const body = pick(form, DELIVERY);
  return run(
    orderId,
    form,
    async () => {
      if (form.get("allLinesGood") === "on") await api.post(`/orders/${orderId}/delivery/all-good`, { deliveredOn: body.deliveredOn || null });
      return api.patch(`/orders/${orderId}/delivery`, body);
    },
    "Saved.",
  );
}

/** payload: { checks: [{ id?, item, result, note? }] } */
export async function satAction(orderId: string, _prev: ActionState, form: FormData) {
  return run(orderId, form, () => api.put(`/orders/${orderId}/sat`, formBody(form)), "SAT checklist saved.");
}

export async function addClaimAction(orderId: string, _prev: ActionState, form: FormData) {
  return run(orderId, form, () => api.post(`/orders/${orderId}/claims`, pick(form, ["title", "detail", "openedOn"])), "Claim opened.");
}

export async function updateClaimAction(orderId: string, claimId: string, _prev: ActionState, form: FormData) {
  return run(orderId, form, () => api.patch(`/claims/${claimId}`, pick(form, ["status", "resolution"])), "Claim saved.");
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

/** The production steps (board OrderProduction): payload { steps: [{ id?, title, factoryId?, plannedOn?, doneOn?, note? }] }. */
export async function productionStepsAction(orderId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => api.put(`/orders/${orderId}/production`, formBody(form)), "Production steps saved.");
  if (r.ok) revalidatePath(`/orders/${orderId}`, "layout");
  return r;
}
