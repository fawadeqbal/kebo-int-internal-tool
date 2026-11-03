"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { attempt, formBody, type ActionState } from "@/lib/actions";

/** Settings › Papers we use (PUT /settings/papers): payload { off: the papers switched off }. */
export async function savePapersAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => api.put("/settings/papers", formBody(form)), "Saved. The Papers lists and the checklists follow it.");
  if (r.ok) revalidatePath("/", "layout");
  return { ...r, data: undefined };
}
