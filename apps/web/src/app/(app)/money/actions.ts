"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { attempt, formBody, formValues, reasonOf, type ActionState } from "@/lib/actions";

/** Money changes show on the order and on the Money page. */
const refresh = (orderId?: string | null) => {
  if (orderId) revalidatePath(`/orders/${orderId}`);
  revalidatePath("/money");
};

/** The customer's instalments: payload { items: [{ id?, label, amount, dueOn }] }. */
export async function savePlanAction(orderId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => api.put(`/orders/${orderId}/payment-plan`, formBody(form)), "Payment plan saved.");
  if (r.ok) refresh(orderId);
  return r;
}

/** A customer payment typed wrong (always asks why). */
export async function editPaymentAction(
  orderId: string,
  paymentId: string,
  currency: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
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
    reason: reasonOf(form),
  };
  const r = await attempt(form, () => api.patch(`/payments/${paymentId}`, body), "Payment changed.");
  if (r.ok) refresh(orderId);
  return r;
}

const factoryBody = (form: FormData) => {
  const v = formValues(form);
  return {
    factoryId: v.factoryId,
    kind: v.kind,
    amount: v.amount,
    currency: v.currency,
    rate: v.rate?.trim() || null,
    paidOn: v.paidOn,
    method: v.method,
    paidById: v.paidById || null,
    reference: v.reference?.trim() || null,
    note: v.note?.trim() || null,
    reason: reasonOf(form),
  };
};

/** Money sent to a factory (paymentId null = new; a change always asks why). */
export async function factoryPaymentAction(
  orderId: string,
  paymentId: string | null,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const body = factoryBody(form);
  const r = await attempt(
    form,
    () => (paymentId ? api.patch(`/factory-payments/${paymentId}`, body) : api.post(`/orders/${orderId}/factory-payments`, body)),
    paymentId ? "Payment changed." : "Payment to the factory recorded.",
  );
  if (r.ok) refresh(orderId);
  return r;
}

export async function voidFactoryPaymentAction(
  orderId: string,
  paymentId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const r = await attempt(
    form,
    () => api.post(`/factory-payments/${paymentId}/void`, { reason: formValues(form).reason }),
    "Payment removed.",
  );
  if (r.ok) refresh(orderId);
  return r;
}

/** An expense for an order or the company (expenseId null = new; a change always asks why). */
export async function expenseAction(
  orderId: string | null,
  expenseId: string | null,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const v = formValues(form);
  const body = {
    orderId: orderId ?? (v.orderId || null),
    category: v.category,
    description: v.description?.trim() ?? "",
    amount: v.amount,
    currency: v.currency,
    rate: v.rate?.trim() || null,
    spentOn: v.spentOn,
    paidById: v.paidById || null,
    reference: v.reference?.trim() || null,
    note: v.note?.trim() || null,
    reason: reasonOf(form),
  };
  const r = await attempt(
    form,
    () => (expenseId ? api.patch(`/expenses/${expenseId}`, body) : api.post("/expenses", body)),
    expenseId ? "Expense changed." : "Expense added.",
  );
  if (r.ok) refresh(body.orderId);
  return r;
}

export async function voidExpenseAction(
  orderId: string | null,
  expenseId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const r = await attempt(form, () => api.post(`/expenses/${expenseId}/void`, { reason: formValues(form).reason }), "Expense removed.");
  if (r.ok) refresh(orderId);
  return r;
}
