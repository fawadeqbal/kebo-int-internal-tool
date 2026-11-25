"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { attempt, formValues, type ActionState } from "@/lib/actions";

/** Settings › Chinese on papers: a person's Chinese for a text, the translator's marked right, or asked again. */
export async function translationAction(id: string, op: "fix" | "check" | "again", _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(
    form,
    () =>
      op === "fix"
        ? api.patch(`/translations/${encodeURIComponent(id)}`, { zh: v.zh ?? "" })
        : api.post(`/translations/${encodeURIComponent(id)}/${op}`, {}),
    op === "fix" ? "Saved: papers print this Chinese now" : op === "check" ? "Marked right" : "Asked again: the translator writes it in a minute",
  );
  if (r.ok) revalidatePath("/settings/translations");
  return r;
}
