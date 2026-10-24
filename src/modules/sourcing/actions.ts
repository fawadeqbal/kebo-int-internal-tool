"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { handleForm, toActionError } from "@/lib/utils/action";
import type { ActionState } from "@/lib/utils/result";
import { choicesSchema, offerSchema, supplierSchema } from "./schema";
import { chooseOffers, createOffer, createSupplier, deleteOffer, deleteSupplier, updateOffer, updateSupplier } from "./service";

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

export async function createOfferAction(queryId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireUser();
  const result = await handleForm(formData, offerSchema, async (data) => {
    await createOffer(actor, queryId, data);
  });
  if (!result.ok) return result;
  revalidatePath(`/queries/${queryId}`);
  redirect(`/queries/${queryId}/sourcing?toast=Factory+offer+saved`);
}

export async function updateOfferAction(offerId: string, queryId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireUser();
  const result = await handleForm(formData, offerSchema, async (data) => {
    await updateOffer(actor, offerId, data);
  });
  if (!result.ok) return result;
  revalidatePath(`/queries/${queryId}`);
  redirect(`/queries/${queryId}/sourcing?toast=Factory+offer+saved`);
}

export async function deleteOfferAction(offerId: string, queryId: string) {
  const actor = await requireUser();
  try {
    await deleteOffer(actor, offerId);
  } catch (error) {
    redirect(`/queries/${queryId}/sourcing?toast=${encodeURIComponent(toActionError(error).message ?? "Could not remove")}`);
  }
  revalidatePath(`/queries/${queryId}`);
  redirect(`/queries/${queryId}/sourcing?toast=Factory+offer+removed`);
}

export async function chooseOffersAction(queryId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireUser();
  const result = await handleForm(formData, choicesSchema, async (data) => {
    await chooseOffers(actor, queryId, data.choices);
  });
  if (!result.ok) return result;
  revalidatePath(`/queries/${queryId}`);
  revalidatePath(`/queries/${queryId}/sourcing`);
  return { ok: true, message: "Saved. New quotations are priced from these offers." };
}
