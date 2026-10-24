"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { handleForm, toActionError } from "@/lib/utils/action";
import type { ActionState } from "@/lib/utils/result";
import { packingListSchema } from "./schema";
import { createPackingList, deletePackingList, updatePackingList } from "./service";

export async function createPackingListAction(invoiceId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireUser();
  let id = "";
  const result = await handleForm(formData, packingListSchema, async (data) => {
    id = (await createPackingList(actor, invoiceId, data)).id;
  });
  if (!result.ok) return result;
  redirect(`/packing-lists/${id}?toast=Packing+list+created`);
}

export async function updatePackingListAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireUser();
  const result = await handleForm(formData, packingListSchema, async (data) => {
    await updatePackingList(actor, id, data);
  });
  if (!result.ok) return result;
  revalidatePath(`/packing-lists/${id}`);
  redirect(`/packing-lists/${id}?toast=Packing+list+saved`);
}

export async function deletePackingListAction(id: string) {
  const actor = await requireUser();
  let queryId = "";
  try {
    queryId = (await deletePackingList(actor, id)).queryId;
  } catch (error) {
    redirect(`/packing-lists/${id}?toast=${encodeURIComponent(toActionError(error).message ?? "Could not remove")}`);
  }
  redirect(`/queries/${queryId}?toast=Packing+list+removed`);
}
