"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { handleForm, toActionError } from "@/lib/utils/action";
import type { ActionState } from "@/lib/utils/result";
import { customerSchema } from "./schema";
import { createCustomer, deleteCustomer, DuplicateCustomerError, updateCustomer } from "./service";

function duplicateState(error: unknown, formData: FormData): ActionState | null {
  if (!(error instanceof DuplicateCustomerError)) return null;
  return {
    ok: false,
    message: error.message,
    meta: { duplicates: error.matches },
    values: Object.fromEntries([...formData.entries()].filter(([, v]) => typeof v === "string")),
  };
}

export async function createCustomerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireUser();
  let id = "";
  let dup: ActionState | null = null;
  const result = await handleForm(formData, customerSchema, async (data) => {
    try {
      id = (await createCustomer(actor, data)).id;
    } catch (error) {
      dup = duplicateState(error, formData);
      if (!dup) throw error;
    }
  });
  if (dup) return dup;
  if (!result.ok) return result;
  revalidatePath("/customers");
  redirect(`/customers/${id}?toast=Buyer+added`);
}

export async function updateCustomerAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireUser();
  let dup: ActionState | null = null;
  const result = await handleForm(formData, customerSchema, async (data) => {
    try {
      await updateCustomer(actor, id, data);
    } catch (error) {
      dup = duplicateState(error, formData);
      if (!dup) throw error;
    }
  });
  if (dup) return dup;
  if (!result.ok) return result;
  revalidatePath(`/customers/${id}`);
  redirect(`/customers/${id}?toast=Buyer+updated`);
}

export async function deleteCustomerAction(id: string) {
  const actor = await requireUser();
  try {
    await deleteCustomer(actor, id);
  } catch (error) {
    redirect(`/customers/${id}?toast=${encodeURIComponent(toActionError(error).message ?? "Could not remove")}`);
  }
  revalidatePath("/customers");
  redirect("/customers?toast=Buyer+removed");
}
