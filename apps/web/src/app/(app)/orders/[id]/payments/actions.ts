"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { attempt, formValues, type ActionState } from "@/lib/actions";

const body = (v: Record<string, string>) => ({
  kind: v.kind,
  amount: v.amount,
  bankCharges: v.bankCharges || "0",
  currency: v.currency,
  paidOn: v.paidOn,
  method: v.method,
  reference: v.reference || null,
  factoryOrderId: v.factoryOrderId || null,
  note: v.note || null,
});

/** Money in from the customer; ticks "Deposit received" / "Balance received" when covered. */
export async function paymentInAction(orderId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(form, () => api.post(`/orders/${orderId}/payments/in`, body(v)), "Payment recorded.");
  if (r.ok) revalidatePath(`/orders/${orderId}`, "layout");
  return r;
}

/** Money out to a factory against one of its factory orders. A gate (customer's deposit first) refuses it unless a manager writes why. */
export async function paymentOutAction(orderId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(form, () => api.post(`/orders/${orderId}/payments/out`, body(v)), "Payment to the factory recorded.");
  if (r.ok) revalidatePath(`/orders/${orderId}`, "layout");
  return r;
}

export async function voidPaymentAction(orderId: string, paymentId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(form, () => api.post(`/payments/${paymentId}/void`, { reason: v.reason }), "Payment voided.");
  if (r.ok) revalidatePath(`/orders/${orderId}`, "layout");
  return r;
}
