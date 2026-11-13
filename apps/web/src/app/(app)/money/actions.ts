"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { todayIn } from "@kebo/utils";
import { attempt, formBody, formValues, reasonOf, type ActionState } from "@/lib/actions";
import { TZ } from "@/lib/format";

/** Money changes show on the order, the customer and the Money page. */
const refresh = (orderId?: string | null, customerId?: string | null) => {
  if (orderId) revalidatePath(`/orders/${orderId}`, "layout");
  if (customerId) revalidatePath(`/customers/${customerId}`, "layout");
  revalidatePath("/finance", "layout");
  revalidatePath("/purchasing", "layout");
  revalidatePath("/payments", "layout");
  revalidatePath("/money", "layout");
};

/** The customer's instalments: payload { items: [{ id?, label, amount, dueOn }] }. */
export async function savePlanAction(orderId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => api.put(`/orders/${orderId}/payment-plan`, formBody(form)), "Payment plan saved.");
  if (r.ok) refresh(orderId);
  return r;
}

/**
 * Send the payment request of a plan row (`ref`): kept exactly as it prints now, and the row shows Sent.
 * Sent again, the API asks why (the form shows "Why?" and sends again with the reason): R2, the first stays.
 */
export async function sendRequestAction(orderId: string, ref: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => api.post(`/orders/${orderId}/requests/send`, { ref, reason: reasonOf(form) }));
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
    amount: v.amount ?? v.receivedAmount,
    receivedAmount: v.receivedAmount ?? v.amount,
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
    // A form may name it after its kind when "What" is left empty.
    description: v.description?.trim() || v.descriptionDefault?.trim() || "",
    amount: v.amount,
    currency: v.currency,
    rate: v.rate?.trim() || null,
    spentOn: v.spentOn,
    paidById: v.paidById || null,
    reference: v.reference?.trim() || null,
    note: v.note?.trim() || null,
    accountId: v.accountId || null,
    // The order's expense form says the step, who bears it and whether it was someone's own money; other forms leave them as they are.
    ...(form.has("step") ? { step: v.step || null } : {}),
    ...(form.has("borneBy") ? { borneBy: v.borneBy } : {}),
    ...(form.has("ownMoney") ? { ownMoney: v.ownMoney === "on" || v.ownMoney === "true" } : {}),
    // The order's cost form also says whether it is a bill to pay later, and who it is owed to.
    ...(form.has("payLater") ? { payLater: v.payLater === "on" || v.payLater === "true" } : {}),
    ...(form.has("payee") ? { payee: v.payee?.trim() || null } : {}),
    // A company cost says whether it comes every month; confirming a proposed month names its chain.
    ...(form.has("repeats") ? { repeats: v.repeats === "on" || v.repeats === "true" } : {}),
    ...(form.has("repeatKey") ? { repeatKey: v.repeatKey || null } : {}),
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

/** A cost that comes every month: skip this month's, or stop it from repeating. */
export async function repeatingAction(key: string, what: "skip" | "stop"): Promise<ActionState> {
  const r = await attempt(null, () => api.post(`/expenses/repeating/${key}`, { what }));
  if (r.ok) refresh();
  return r;
}

/** Pays back what someone paid from their own money: each of `expenseIds`, on one day, from one account. */
export async function repayAction(orderId: string | null, expenseIds: string[], _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const body = { repaidOn: v.repaidOn, accountId: v.accountId || null };
  let r: ActionState = { ok: true };
  for (const id of expenseIds) {
    r = await attempt(form, () => api.post(`/expenses/${id}/repay`, body), expenseIds.length > 1 ? `${expenseIds.length} expenses repaid.` : "Repaid.");
    if (!r.ok) break;
  }
  refresh(orderId);
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

/**
 * A cost added by someone who does not record costs themselves (Staff): it waits for a manager to verify,
 * and counts only then. On an order, or the company's own; from their own money, or from one of our accounts.
 */
export async function submitCostAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const own = v.ownMoney === "on";
  const orderId = v.orderId || null;
  const body = {
    orderId,
    category: v.category,
    description: v.description?.trim() ?? "",
    amount: v.amount,
    currency: v.currency,
    spentOn: v.spentOn,
    ownMoney: own,
    paidById: own ? v.paidById || null : null,
    accountId: own ? null : v.accountId || null,
  };
  const r = await attempt(form, () => api.post("/submissions", { kind: "expense", orderId, body }), "Sent to a manager to verify.");
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

/**
 * An account added from inside a money window (name and kind; it starts empty, today): the window chooses it
 * at once, so the answer carries its id. Its opening balance and note are changed on Cash & bank.
 */
export async function quickAccountAction(name: string, kind: string, currency: string): Promise<{ ok: boolean; message?: string; id?: string }> {
  const body = { name: name.trim(), kind, currency, openingBalance: "0", openingOn: todayIn(TZ), note: null };
  const r = await attempt(null, () => api.post<{ id: string }>("/money/accounts", body), "Account added.");
  if (r.ok) revalidatePath("/", "layout");
  return { ok: !!r.ok, message: r.ok ? r.message : (r.errors?.name?.[0] ?? r.message), id: (r.data as { id?: string } | undefined)?.id };
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
  if (r.ok) revalidatePath("/finance", "layout");
  return r;
}

export async function voidTransferAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => api.post(`/money/transfers/${id}/void`, { reason: formValues(form).reason }), "Move removed.");
  if (r.ok) revalidatePath("/finance", "layout");
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
    revalidatePath("/reports", "layout");
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

/**
 * A month's row of targets: the company's and each person's (fields `company`
 * and `p:<userId>`). Only the fields that changed are sent; empty removes one.
 */
export async function saveTargetRowAction(month: string, before: Record<string, string>, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const clean = (x: string | undefined) => (x ?? "").replace(/[,\s]/g, "");
  const changed = Object.keys(v).filter((k) => (k === "company" || k.startsWith("p:")) && clean(v[k]) !== clean(before[k]));
  const r = await attempt(
    form,
    async () => {
      for (const k of changed) {
        const amount = clean(v[k]);
        const body = { amount: amount ? Number(amount) : null };
        if (k === "company") await api.put(`/insights/targets/${month}`, body);
        else await api.put(`/insights/targets/${month}/people/${k.slice(2)}`, body);
      }
    },
    changed.length ? "Targets saved." : "Nothing changed.",
  );
  if (r.ok) {
    revalidatePath("/reports", "layout");
    revalidatePath("/dashboard");
  }
  return r;
}

/** The factory's payment plan on an order (people who see factory money): its parts as JSON `payload`. */
export async function factoryPlanAction(orderId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => api.put(`/orders/${orderId}/factory-plan`, formBody(form)), "Plan saved.");
  if (r.ok) refresh(orderId);
  return r;
}
