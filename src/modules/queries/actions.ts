"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { handleForm, toActionError } from "@/lib/utils/action";
import type { ActionState } from "@/lib/utils/result";
import { DuplicateCustomerError } from "@/modules/customers/service";
import { assignSchema, commentSchema, createQuerySchema, statusChangeSchema, updateQuerySchema } from "./schema";
import { addComment, assignQuery, changeStatus, createQuery, deleteQuery, removeAttachment, updateQuery } from "./service";

export async function createQueryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireUser();
  let id = "";
  let duplicate: ActionState | null = null;
  const result = await handleForm(formData, createQuerySchema, async (data) => {
    try {
      id = (await createQuery(actor, data)).id;
    } catch (error) {
      if (!(error instanceof DuplicateCustomerError)) throw error;
      duplicate = { ok: false, message: error.message, meta: { duplicates: error.matches } };
    }
  });
  if (duplicate) return { ...(duplicate as ActionState), values: result.values ?? Object.fromEntries(formData) as Record<string, unknown> };
  if (!result.ok) return result;
  revalidatePath("/queries");
  // The form uploads any selected files to the new query, then opens it.
  return { ok: true, meta: { id } };
}

export async function updateQueryAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireUser();
  const result = await handleForm(formData, updateQuerySchema, async (data) => {
    await updateQuery(actor, id, data);
  });
  if (!result.ok) return result;
  revalidatePath(`/queries/${id}`);
  redirect(`/queries/${id}?toast=Inquiry+updated`);
}

export async function changeStatusAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireUser();
  const result = await handleForm(formData, statusChangeSchema, async (data) => {
    await changeStatus(actor, id, data.status, data.reason);
  });
  if (!result.ok) return result;
  revalidatePath(`/queries/${id}`);
  return { ok: true, message: "Status updated." };
}

export async function assignQueryAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireUser();
  const result = await handleForm(formData, assignSchema, async (data) => {
    await assignQuery(actor, id, data.assignedTo ?? null);
  });
  if (!result.ok) return result;
  revalidatePath(`/queries/${id}`);
  return { ok: true, message: "Assignment saved." };
}

export async function addCommentAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireUser();
  const result = await handleForm(formData, commentSchema, async (data) => {
    await addComment(actor, id, data.body);
  });
  if (!result.ok) return result;
  revalidatePath(`/queries/${id}`);
  return { ok: true };
}

export async function removeAttachmentAction(attachmentId: string) {
  const actor = await requireUser();
  let queryId = "";
  try {
    queryId = await removeAttachment(actor, attachmentId);
  } catch (error) {
    return toActionError(error);
  }
  revalidatePath(`/queries/${queryId}`);
  return { ok: true };
}

export async function deleteQueryAction(id: string) {
  const actor = await requireUser();
  try {
    await deleteQuery(actor, id);
  } catch (error) {
    redirect(`/queries/${id}?toast=${encodeURIComponent(toActionError(error).message ?? "Could not remove")}`);
  }
  revalidatePath("/queries");
  redirect("/queries?toast=Inquiry+removed");
}
