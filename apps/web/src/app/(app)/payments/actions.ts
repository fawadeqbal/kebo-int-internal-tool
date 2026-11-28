"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { attempt, formValues, type ActionState } from "@/lib/actions";
import { isVoidPath } from "@/lib/void-path";


/** Remove a payment typed by mistake: it stays listed under Removed, crossed out. */
export async function voidPaymentAction(path: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  if (!isVoidPath(path)) return { ok: false, message: "This cannot be removed here." };
  const r = await attempt(form, () => api.post(path, { reason: formValues(form).reason }), path.startsWith("/expenses/") ? "Cost removed." : path.startsWith("/money/transfers/") ? "Move removed." : "Payment removed.");
  if (!r.ok) return r;
  revalidatePath("/", "layout");
  return { ...r, detail: "It stays under Removed, with your reason" };
}

/** Where each kind keeps its file: the endpoint that removes it (customer: the payment on the order; supplier; expense). */
const FILE_PATH: Record<"customer" | "supplier" | "expense", (id: string) => string> = {
  customer: (id) => `/payments/${id}/file`,
  supplier: (id) => `/supplier-payments/${id}/file`,
  expense: (id) => `/expenses/${id}/receipt`,
};

/** Removes the file kept with a payment (bank slip, receipt photo), whatever kind of payment it is. */
export async function removeRecordFileAction(kind: "customer" | "supplier" | "expense", id: string): Promise<ActionState> {
  const r = await attempt(null, () => api.delete(FILE_PATH[kind](id)), "File removed.");
  if (r.ok) revalidatePath("/", "layout");
  return r;
}
