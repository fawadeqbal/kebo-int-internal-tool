"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { attempt, formValues, type ActionState } from "@/lib/actions";

/** Settings › Closed months: close through a month's end, or open months again with a reason. */
export async function closeBooksAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(form, () => api.put("/books/close", { month: v.month || null, reason: v.reason?.trim() || undefined }), v.month ? "Saved: the books are closed through that month." : "Every month is open again.");
  if (!r.ok) return r;
  revalidatePath("/settings/books");
  if (!v.month) return { ...r, detail: "Money in any month can be changed again, with a reason" };
  const month = new Date(`${v.month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  return { ...r, message: `${month} closed`, detail: "Money up to its end cannot change now" };
}
