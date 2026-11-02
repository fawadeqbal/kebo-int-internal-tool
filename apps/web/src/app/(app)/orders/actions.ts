"use server";

import { revalidatePath } from "next/cache";
import { api, ApiError } from "@/lib/api";
import { attempt, formBody, formValues, reasonOf, type ActionState } from "@/lib/actions";
import type { OrderLineView } from "@/lib/types-orders";

/** The other orders a transfer pays, sent as JSON (empty when missing or unreadable). */
const partsOf = (json: string | undefined): unknown[] => {
  if (!json) return [];
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

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

/** Everything ordered has come in (each goods line in full, dated today): payload { lines: [{ lineId, receivedQty }] }. */
export async function receiptAction(orderId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => api.put(`/orders/${orderId}/receipt`, formBody(form)), "All goods marked as received.");
  if (r.ok) refresh(orderId);
  return r;
}

/** The packing list: payload { containerNo, shippingMarks, lines: [{ lineId, packages, packageType, netWeightKg, grossWeightKg, cbm }] }. */
export async function packingAction(orderId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => api.put(`/orders/${orderId}/packing`, formBody(form)), "Packing list saved.");
  if (r.ok) refresh(orderId);
  return r;
}

/** The packing list's container and shipping marks (the order's details; nothing else changes). */
export async function packingMarksAction(orderId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(
    form,
    () => api.patch(`/orders/${orderId}/details`, { containerNo: v.containerNo?.trim() || null, shippingMarks: v.shippingMarks?.trim() || null }),
    "Saved.",
  );
  if (r.ok) refresh(orderId);
  return r;
}

/** What one line's change answered: the line, or why not. */
export type OrderLineResult = { ok: true; line: OrderLineView } | { ok: false; message: string };

/**
 * One line, changed in a step's line table: { set: "received" | "packing" |
 * "delivered", …the fields changed }. Answers in the line table's terms.
 */
export async function orderLineAction(orderId: string, lineId: string, body: Record<string, unknown>): Promise<OrderLineResult> {
  try {
    const r = await api.patch<{ line: OrderLineView }>(`/order-lines/${lineId}`, body);
    refresh(orderId);
    return { ok: true, line: r.line };
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 401) return { ok: false, message: "Your session ended. Please sign in again." };
      const field = Object.values(e.body.fieldErrors ?? {}).find((v) => v?.length)?.[0];
      return { ok: false, message: field ?? e.message };
    }
    console.error("[order lines]", e);
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}

/**
 * Money in from the customer (managers): what arrived (any currency, the rate),
 * this order's part, other orders it also pays, the rest as the customer's
 * credit; "Money reached us" ticks the bank step with it.
 */
export async function paymentAction(orderId: string, currency: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const parts = partsOf(v.parts);
  const received = v.receivedAmount ?? v.amount;
  const body = {
    kind: v.kind,
    // Money v2: `amount` is this order's part (blank: what it counts as, up to what is due).
    amount: v.receivedAmount !== undefined ? v.amount || null : v.amount,
    receivedAmount: received,
    receivedCurrency: v.receivedCurrency || currency,
    rate: v.receivedCurrency && v.receivedCurrency !== currency ? v.rate || null : null,
    paidByName: v.paidByName?.trim() || null,
    bankCharges: v.bankCharges || "0",
    currency,
    paidOn: v.paidOn,
    method: v.method,
    reference: v.reference?.trim() || null,
    note: v.note?.trim() || null,
    accountId: v.accountId || null,
    parts,
    ...(v.bankStep ? { bankStep: v.bankStep } : {}),
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
  const body = {
    reason: v.reason,
    ...(v.customerMoney ? { customerMoney: v.customerMoney } : {}),
    ...(v.factoryMoney ? { factoryMoney: v.factoryMoney } : {}),
    refundNow: v.refundNow === "true",
    refundAccountId: v.refundAccountId || null,
    refundOn: v.refundOn || null,
  };
  const r = await attempt(form, () => api.post(`/orders/${orderId}/cancel`, body), "Order cancelled.");
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
    revalidatePath(`/inquiries/${dealId}`);
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
    revalidatePath(`/inquiries/${dealId}`);
  }
  return r;
}

/** Pays (part of) the order from the customer's credit (managers). */
export async function useCreditAction(orderId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(form, () => api.post(`/orders/${orderId}/use-credit`, { amount: v.amount, on: v.on || null }), "Paid from the customer's credit.");
  if (r.ok) refresh(orderId);
  return r;
}

const refreshCustomer = (customerId: string) => {
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/orders", "layout");
  revalidatePath("/money");
};

/** One transfer over several of the customer's orders; the rest becomes their credit. */
export async function customerReceiptAction(customerId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const parts = partsOf(v.parts);
  const body = {
    receivedAmount: v.receivedAmount,
    receivedCurrency: v.receivedCurrency,
    currency: v.currency,
    rate: v.receivedCurrency !== v.currency ? v.rate || null : null,
    paidOn: v.paidOn,
    method: v.method,
    reference: v.reference?.trim() || null,
    paidByName: v.paidByName?.trim() || null,
    note: v.note?.trim() || null,
    accountId: v.accountId || null,
    parts,
  };
  const r = await attempt(form, () => api.post(`/customers/${customerId}/receipts`, body), "Payment recorded.");
  if (r.ok) refreshCustomer(customerId);
  return r;
}

/** Pays the customer's credit back (managers). */
export async function refundCreditAction(customerId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const body = { amount: v.amount, currency: v.currency, on: v.on, accountId: v.accountId || null, note: v.note?.trim() || null };
  const r = await attempt(form, () => api.post(`/customers/${customerId}/credit/refund`, body), "Refund recorded.");
  if (r.ok) refreshCustomer(customerId);
  return r;
}

/** A refund or a transfer recorded by mistake (managers). */
export async function voidCreditAction(customerId: string, kind: "credit" | "receipt", id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const path = kind === "credit" ? `/customer-credits/${id}/void` : `/customer-receipts/${id}/void`;
  const r = await attempt(form, () => api.post(path, { reason: v.reason }), "Removed.");
  if (r.ok) refreshCustomer(customerId);
  return r;
}
