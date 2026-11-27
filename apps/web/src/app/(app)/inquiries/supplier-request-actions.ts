"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { attempt, formValues, type ActionState } from "@/lib/actions";

/** Asking suppliers for a price on an inquiry (see the API's /inquiries/:id/factory-requests). */

const refresh = (dealId: string) => revalidatePath(`/inquiries/${dealId}`, "layout");

/** status (declined | no_reply | sent) */
export async function supplierRequestStatusAction(dealId: string, requestId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => api.patch(`/factory-requests/${requestId}`, { status: formValues(form).status }), "Saved.");
  if (r.ok) refresh(dealId);
  return r;
}

export async function removeSupplierRequestAction(dealId: string, requestId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => api.delete(`/factory-requests/${requestId}`), "Removed.");
  if (r.ok) refresh(dealId);
  return r;
}
