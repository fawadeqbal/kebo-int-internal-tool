"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { attempt, formValues, type ActionState } from "@/lib/actions";

/** Asking factories for a price on an inquiry (see the API's /inquiries/:id/factory-requests). */

const refresh = (dealId: string) => revalidatePath(`/inquiries/${dealId}`, "layout");

/** factoryId (several), channel, replyBy, note. */
export async function askFactoriesAction(dealId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const factoryIds = form.getAll("factoryId").filter((x): x is string => typeof x === "string");
  const r = await attempt(
    form,
    () => api.post(`/inquiries/${dealId}/factory-requests`, { factoryIds, channel: v.channel || null, sentOn: v.sentOn || null, replyBy: v.replyBy || null, note: v.note || null }),
    factoryIds.length === 1 ? "Marked as asked." : `${factoryIds.length} suppliers marked as asked.`,
  );
  if (!r.ok) return r;
  refresh(dealId);
  // Named: who was asked, and where their prices will be.
  const items = (r.data as { items?: { factory?: { id?: string; name?: string } }[] } | undefined)?.items ?? [];
  const names = items.filter((i) => i.factory?.id && factoryIds.includes(i.factory.id)).map((i) => i.factory!.name!);
  return {
    ...r,
    message: names.length === 1 ? `Asked ${names[0]} for a price` : `Asked ${factoryIds.length} suppliers for prices`,
    detail: names.length > 1 ? `${names.slice(0, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""} · their prices go on Supplier offers` : "Their price goes on Supplier offers",
  };
}

/** status (declined | no_reply | sent) */
export async function factoryRequestStatusAction(dealId: string, requestId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => api.patch(`/factory-requests/${requestId}`, { status: formValues(form).status }), "Saved.");
  if (r.ok) refresh(dealId);
  return r;
}

export async function removeFactoryRequestAction(dealId: string, requestId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => api.delete(`/factory-requests/${requestId}`), "Removed.");
  if (r.ok) refresh(dealId);
  return r;
}
