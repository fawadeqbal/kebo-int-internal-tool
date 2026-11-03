"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { attempt, type ActionState } from "@/lib/actions";

export async function markAllReadAction(_prev: ActionState, _form: FormData): Promise<ActionState> {
  const r = await attempt(null, () => api.post("/notifications/read", { ids: "all" }), "All caught up.");
  if (r.ok) revalidatePath("/", "layout");
  return r;
}
