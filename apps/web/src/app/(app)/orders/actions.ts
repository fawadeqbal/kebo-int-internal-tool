"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { attempt, formBody, formValues, reasonOf, type ActionState } from "@/lib/actions";

const refresh = (orderId: string) => {
  revalidatePath(`/orders/${orderId}`, "layout");
  revalidatePath("/orders");
};

/**
 * One stage forward or back. When something looks off the API answers
 * code "confirm" with the warnings; the form shows them and sends again with
 * confirm=true (and an optional note) when the person goes ahead anyway.
 */
export async function moveStageAction(orderId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const body = {
    to: v.to,
    confirm: v.confirm === "true",
    note: v.note?.trim() || null,
    readyOn: v.readyOn || null,
    shippedOn: v.shippedOn || null,
    blNo: v.blNo?.trim() || null,
    reason: reasonOf(form),
  };
  const r = await attempt(form, () => api.post(`/orders/${orderId}/stage`, body), "Order moved.");
  if (r.ok) refresh(orderId);
  return r;
}

/** Ship-by, ready, shipped dates and the B/L number. */
export async function detailsAction(orderId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(
    form,
    () =>
      api.patch(`/orders/${orderId}/details`, {
        shipBy: v.shipBy || null,
        readyOn: v.readyOn || null,
        shippedOn: v.shippedOn || null,
        blNo: v.blNo?.trim() || null,
        documentTitle: v.documentTitle?.trim() || null,
        portOfDischarge: v.portOfDischarge?.trim() || null,
        reason: reasonOf(form),
      }),
    "Details saved.",
  );
  if (r.ok) refresh(orderId);
  return r;
}

/** How many of each goods line came in from the factory so far: payload { on, lines: [{ lineId, receivedQty }] }. */
export async function receiptAction(orderId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const body = formBody(form);
  const all = formValues(form).all === "true";
  const r = await attempt(
    form,
    () => api.put(`/orders/${orderId}/receipt`, body),
    all ? "All goods marked as received." : "Saved what came in.",
  );
  if (r.ok) refresh(orderId);
  return r;
}

/** The packing list: payload { containerNo, shippingMarks, lines: [{ lineId, packages, packageType, netWeightKg, grossWeightKg, cbm }] }. */
export async function packingAction(orderId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => api.put(`/orders/${orderId}/packing`, formBody(form)), "Packing list saved.");
  if (r.ok) refresh(orderId);
  return r;
}

/** Money in from the customer (managers), always in the order's currency. */
export async function paymentAction(orderId: string, currency: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const body = {
    kind: v.kind,
    amount: v.amount,
    bankCharges: v.bankCharges || "0",
    currency,
    paidOn: v.paidOn,
    method: v.method,
    reference: v.reference?.trim() || null,
    note: v.note?.trim() || null,
  };
  const r = await attempt(form, () => api.post(`/orders/${orderId}/payments`, body), "Payment recorded.");
  if (r.ok) refresh(orderId);
  return r;
}

/** A payment recorded by mistake (managers): it stays listed, crossed out. */
export async function voidPaymentAction(orderId: string, paymentId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(form, () => api.post(`/payments/${paymentId}/void`, { reason: v.reason }), "Payment removed.");
  if (r.ok) refresh(orderId);
  return r;
}

export async function cancelOrderAction(orderId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(form, () => api.post(`/orders/${orderId}/cancel`, { reason: v.reason }), "Order cancelled.");
  if (r.ok) refresh(orderId);
  return r;
}

/** Gives the proforma its number (KEB260916TN07), dated today. */
export async function issueProformaAction(orderId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => api.post<{ proforma: { number: string } }>(`/orders/${orderId}/proforma`), undefined);
  if (r.ok) {
    refresh(orderId);
    return { ...r, message: `Proforma issued as ${(r.data as { proforma: { number: string } }).proforma.number}.` };
  }
  return r;
}

/** Notes and files live on the deal; the order page shows them and adds to them. */
export async function orderNoteAction(orderId: string, dealId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(form, () => api.post(`/inquiries/${dealId}/notes`, { body: v.body }));
  if (r.ok) {
    revalidatePath(`/orders/${orderId}`, "layout");
    revalidatePath(`/deals/${dealId}`);
  }
  return r;
}

export async function orderRemoveFileAction(
  orderId: string,
  dealId: string,
  fileId: string,
  _prev: ActionState,
  _form: FormData,
): Promise<ActionState> {
  const r = await attempt(null, () => api.delete(`/files/${fileId}`), "File removed.");
  if (r.ok) {
    revalidatePath(`/orders/${orderId}`, "layout");
    revalidatePath(`/deals/${dealId}`);
  }
  return r;
}
