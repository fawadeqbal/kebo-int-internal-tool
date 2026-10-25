"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { handleForm, toActionError } from "@/lib/utils/action";
import type { ActionState } from "@/lib/utils/result";
import { itemPriceSchema, supplierSchema } from "./schema";
import { clearItemFactoryPrice, createSupplier, deleteSupplier, setItemFactoryPrice, updateSupplier } from "./service";

export async function createSupplierAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireUser();
  let id = "";
  const result = await handleForm(formData, supplierSchema, async (data) => {
    id = (await createSupplier(actor, data)).id;
  });
  if (!result.ok) return result;
  revalidatePath("/factories");
  redirect(`/factories/${id}?toast=Factory+added`);
}

export async function updateSupplierAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireUser();
  const result = await handleForm(formData, supplierSchema, async (data) => {
    await updateSupplier(actor, id, data);
  });
  if (!result.ok) return result;
  revalidatePath(`/factories/${id}`);
  return { ok: true, message: "Factory saved." };
}

export async function deleteSupplierAction(id: string) {
  const actor = await requireUser();
  try {
    await deleteSupplier(actor, id);
  } catch (error) {
    redirect(`/factories/${id}?toast=${encodeURIComponent(toActionError(error).message ?? "Could not remove")}`);
  }
  revalidatePath("/factories");
  redirect("/factories?toast=Factory+removed");
}

export async function setItemPriceAction(queryId: string, itemId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireUser();
  const result = await handleForm(formData, itemPriceSchema, async (data) => {
    await setItemFactoryPrice(actor, queryId, itemId, data);
  });
  if (!result.ok) return result;
  revalidatePath(`/queries/${queryId}`);
  return { ok: true, message: "Factory price saved." };
}

export async function clearItemPriceAction(queryId: string, itemId: string): Promise<ActionState> {
  const actor = await requireUser();
  try {
    await clearItemFactoryPrice(actor, queryId, itemId);
  } catch (error) {
    return toActionError(error);
  }
  revalidatePath(`/queries/${queryId}`);
  return { ok: true, message: "Factory price removed." };
}

