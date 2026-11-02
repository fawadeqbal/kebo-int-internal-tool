"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { attempt, formBody, type ActionState } from "@/lib/actions";

/** The company's whole order checklist at once (PUT /settings/checklist): payload { items, hidden }. */
export async function saveChecklistAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => api.put("/settings/checklist", formBody(form)), "Saved. New orders start with this list.");
  if (r.ok) revalidatePath("/settings");
  return { ...r, data: undefined };
}
