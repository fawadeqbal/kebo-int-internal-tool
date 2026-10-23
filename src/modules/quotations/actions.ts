"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { handleForm, toActionError } from "@/lib/utils/action";
import type { ActionState } from "@/lib/utils/result";
import { quotationSchema, quotationStatusSchema } from "./schema";
import { changeQuotationStatus, createQuotation, deleteDraftQuotation, reviseQuotation, updateQuotation } from "./service";

export async function createQuotationAction(queryId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireUser();
  let id = "";
  const result = await handleForm(formData, quotationSchema, async (data) => {
    id = (await createQuotation(actor, queryId, data)).id;
  });
  if (!result.ok) return result;
  revalidatePath(`/queries/${queryId}`);
  redirect(`/quotations/${id}?toast=Quotation+saved+as+draft`);
}

export async function updateQuotationAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireUser();
  const result = await handleForm(formData, quotationSchema, async (data) => {
    await updateQuotation(actor, id, data);
  });
  if (!result.ok) return result;
  revalidatePath(`/quotations/${id}`);
  redirect(`/quotations/${id}?toast=Quotation+updated`);
}

export async function quotationStatusAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireUser();
  const result = await handleForm(formData, quotationStatusSchema, async (data) => {
    await changeQuotationStatus(actor, id, data.status, data.submittedAt);
  });
  if (!result.ok) return result;
  revalidatePath(`/quotations/${id}`);
  return { ok: true, message: "Quotation status updated." };
}

export async function reviseQuotationAction(id: string) {
  const actor = await requireUser();
  let newId = "";
  try {
    newId = (await reviseQuotation(actor, id)).id;
  } catch (error) {
    redirect(`/quotations/${id}?toast=${encodeURIComponent(toActionError(error).message ?? "Could not create version")}`);
  }
  redirect(`/quotations/${newId}/edit?toast=New+version+created+—+adjust+and+save`);
}

export async function deleteQuotationAction(id: string) {
  const actor = await requireUser();
  let queryId = "";
  try {
    queryId = await deleteDraftQuotation(actor, id);
  } catch (error) {
    redirect(`/quotations/${id}?toast=${encodeURIComponent(toActionError(error).message ?? "Could not delete")}`);
  }
  redirect(`/queries/${queryId}?toast=Draft+quotation+deleted`);
}
