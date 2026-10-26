"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { attempt, formValues, type ActionState } from "@/lib/actions";

const done = (orderId: string, r: ActionState) => {
  if (r.ok) revalidatePath(`/orders/${orderId}`, "layout");
  return r;
};

/** A draft proforma (whole order) or commercial invoice (one shipment). */
export async function createInvoiceAction(orderId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const body = {
    type: v.type,
    shipmentId: v.shipmentId || null,
    issueDate: v.issueDate || null,
    dueDate: v.dueDate || null,
    notes: v.notes || null,
  };
  return done(
    orderId,
    await attempt(form, () => api.post(`/orders/${orderId}/invoices`, body), "Draft invoice made. Check it, then issue it."),
  );
}

export async function updateInvoiceAction(orderId: string, invoiceId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  return done(
    orderId,
    await attempt(
      form,
      () => api.put(`/invoices/${invoiceId}`, { issueDate: v.issueDate || null, dueDate: v.dueDate || null, notes: v.notes || null }),
      "Invoice saved.",
    ),
  );
}

/** Numbered, dated and locked. A proforma ticks "Proforma invoice sent". */
export async function issueInvoiceAction(orderId: string, invoiceId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  return done(orderId, await attempt(form, () => api.post(`/invoices/${invoiceId}/issue`, { on: v.on || null }), "Invoice issued."));
}

/** Drafts are deleted; issued invoices are voided (the number is never reused). */
export async function voidInvoiceAction(orderId: string, invoiceId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  return done(orderId, await attempt(form, () => api.post(`/invoices/${invoiceId}/void`, { reason: v.reason }), "Invoice voided."));
}
