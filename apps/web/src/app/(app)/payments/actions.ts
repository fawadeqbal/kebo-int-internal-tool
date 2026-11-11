"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { attempt, formValues, type ActionState } from "@/lib/actions";

/** The endpoints that remove a payment (each checks who may). The page passes the one the API named. */
const VOID_PATH = /^\/(payments|customer-receipts|customer-credits|factory-payments|expenses|money\/transfers)\/[0-9a-f-]{36}\/void$/i;

/** Remove a payment typed by mistake: it stays listed under Removed, crossed out. */
export async function voidPaymentAction(path: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  if (!VOID_PATH.test(path)) return { ok: false, message: "This cannot be removed here." };
  const r = await attempt(form, () => api.post(path, { reason: formValues(form).reason }), "Payment removed.");
  if (r.ok) revalidatePath("/", "layout");
  return r;
}
