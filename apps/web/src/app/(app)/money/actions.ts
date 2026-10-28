"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { attempt, formBody, formValues, reasonOf, type ActionState } from "@/lib/actions";

/** Money changes show on the order, the customer and the Money page. */
const refresh = (orderId?: string | null, customerId?: string | null) => {
  if (orderId) revalidatePath(`/orders/${orderId}`, "layout");
  if (customerId) revalidatePath(`/customers/${customerId}`);
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
    accountId: v.accountId || null,
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
    accountId: v.accountId || null,
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

/**
 * An expense for an order, a customer or the company (expenseId null = new; a
 * change always asks why). Returns the saved expense, so a receipt can follow.
 */
export async function expenseAction(
  orderId: string | null,
  expenseId: string | null,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const v = formValues(form);
  const body = {
    orderId: orderId ?? (v.orderId || null),
    inquiryId: orderId ? null : v.inquiryId || null,
    customerId: orderId ? null : v.customerId || null,
    factoryId: v.factoryId || null,
    category: v.category,
    description: v.description?.trim() ?? "",
    amount: v.amount,
    currency: v.currency,
    rate: v.rate?.trim() || null,
    spentOn: v.spentOn,
    paidById: v.paidById || null,
    reference: v.reference?.trim() || null,
    note: v.note?.trim() || null,
    accountId: v.accountId || null,
    reason: reasonOf(form),
  };
  const r = await attempt(
    form,
    () => (expenseId ? api.patch(`/expenses/${expenseId}`, body) : api.post("/expenses", body)),
    expenseId ? "Expense changed." : "Expense added.",
  );
  if (r.ok) {
    const saved = r.data as { customer?: { id: string } | null; deal?: { id: string } | null } | undefined;
    refresh(body.orderId, saved?.customer?.id ?? body.customerId);
    if (saved?.deal) revalidatePath(`/inquiries/${saved.deal.id}`, "layout");
  }
  return r;
}

/** Removes the proof kept with a payment: `in` from a customer, `out` to a factory. */
export async function removePaymentFileAction(side: "in" | "out", paymentId: string, orderId: string): Promise<ActionState> {
  const r = await attempt(null, () => api.delete(`/${side === "in" ? "payments" : "factory-payments"}/${paymentId}/file`), "File removed.");
  if (r.ok) refresh(orderId);
  return r;
}

/** Removes the receipt kept with an expense. */
export async function removeReceiptAction(expenseId: string, customerId: string | null, orderId: string | null): Promise<ActionState> {
  const r = await attempt(null, () => api.delete(`/expenses/${expenseId}/receipt`), "Receipt removed.");
  if (r.ok) refresh(orderId, customerId);
  return r;
}

export async function voidExpenseAction(
  orderId: string | null,
  expenseId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const r = await attempt(form, () => api.post(`/expenses/${expenseId}/void`, { reason: formValues(form).reason }), "Expense removed.");
  if (r.ok) {
    refresh(orderId);
    revalidatePath("/customers", "layout");
  }
  return r;
}

/* ---------------------------------------------------------------- cash book */

/** Add (id null) or change one of our accounts. */
export async function saveAccountAction(id: string | null, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const body = {
    name: v.name?.trim() ?? "",
    kind: v.kind,
    currency: v.currency,
    openingBalance: v.openingBalance || "0",
    openingOn: v.openingOn,
    note: v.note?.trim() || null,
    archived: v.archived === "on",
  };
  const r = await attempt(form, () => (id ? api.patch(`/money/accounts/${id}`, body) : api.post("/money/accounts", body)), id ? "Account saved." : "Account added.");
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

/** Money moved between two of our accounts. */
export async function transferAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const body = {
    fromAccountId: v.fromAccountId,
    toAccountId: v.toAccountId,
    amountOut: v.amountOut,
    amountIn: v.amountIn?.trim() || null,
    transferredOn: v.transferredOn,
    reference: v.reference?.trim() || null,
    note: v.note?.trim() || null,
  };
  const r = await attempt(form, () => api.post("/money/transfers", body), "Money moved.");
  if (r.ok) revalidatePath("/money");
  return r;
}

export async function voidTransferAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => api.post(`/money/transfers/${id}/void`, { reason: formValues(form).reason }), "Move removed.");
  if (r.ok) revalidatePath("/money");
  return r;
}

/** Put an amount recorded without an account on one. */
export async function setEntryAccountAction(kind: "in" | "factory" | "expense", id: string, accountId: string | null): Promise<ActionState> {
  const r = await attempt(null, () => api.put(`/money/entries/${kind}/${id}/account`, { accountId }), "Saved.");
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

/* ---------------------------------------------------------------- insights */

/** A month's sales target (empty or 0 removes it). */
export async function saveTargetAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const amount = v.amount?.replace(/[,\s]/g, "") ?? "";
  const r = await attempt(form, () => api.put(`/insights/targets/${v.month}`, { amount: amount ? Number(amount) : null }), amount && Number(amount) > 0 ? "Target saved." : "Target removed.");
  if (r.ok) {
    revalidatePath("/insights");
    revalidatePath("/dashboard");
  }
  return r;
}

/** Put a reminder off for some days, mark it done, or bring it back. */
export async function reminderAction(what: "snooze" | "done" | "restore", key: string, days?: number): Promise<ActionState> {
  const r = await attempt(null, () => api.post(`/reminders/${what}`, what === "snooze" ? { key, days } : { key }));
  if (r.ok) revalidatePath("/dashboard");
  return r;
}
