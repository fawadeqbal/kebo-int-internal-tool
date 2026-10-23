"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { handleForm } from "@/lib/utils/action";
import type { ActionState } from "@/lib/utils/result";
import { getSettings } from "@/modules/settings/service";
import { cancelInvoiceSchema, invoiceSchema, paymentSchema } from "./schema";
import { cancelInvoice, createInvoice, recordPayment } from "./service";

export async function createInvoiceAction(quotationId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireUser();
  let id = "";
  const result = await handleForm(formData, invoiceSchema, async (data) => {
    id = (await createInvoice(actor, quotationId, data)).id;
  });
  if (!result.ok) return result;
  revalidatePath("/invoices");
  redirect(`/invoices/${id}?toast=Invoice+issued`);
}

export async function recordPaymentAction(invoiceId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireUser();
  const settings = await getSettings();
  const result = await handleForm(formData, paymentSchema, async (data) => {
    await recordPayment(actor, invoiceId, data, settings.currency);
  });
  if (!result.ok) return result;
  revalidatePath(`/invoices/${invoiceId}`);
  return { ok: true, message: "Payment recorded." };
}

export async function cancelInvoiceAction(invoiceId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireUser();
  const result = await handleForm(formData, cancelInvoiceSchema, async (data) => {
    await cancelInvoice(actor, invoiceId, data.reason);
  });
  if (!result.ok) return result;
  revalidatePath(`/invoices/${invoiceId}`);
  return { ok: true, message: "Invoice cancelled." };
}
