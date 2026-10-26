"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { attempt, formValues, type ActionState } from "@/lib/actions";

/** Create or edit a factory. */
export async function saveFactoryAction(id: string | null, _prev: ActionState, form: FormData): Promise<ActionState> {
  const body = formValues(form);
  const r = await attempt(form, () => (id ? api.put<{ id: string }>(`/factories/${id}`, body) : api.post<{ id: string }>("/factories", body)));
  if (!r.ok) return r;
  const savedId = id ?? (r.data as { id: string }).id;
  revalidatePath("/factories");
  revalidatePath(`/factories/${savedId}`);
  redirect(`/factories/${savedId}?toast=${encodeURIComponent(id ? "Factory saved." : "Factory added.")}`);
}

export async function removeFactoryAction(id: string, _prev: ActionState, _form: FormData): Promise<ActionState> {
  const r = await attempt(null, () => api.delete(`/factories/${id}`));
  if (!r.ok) return r;
  revalidatePath("/factories");
  redirect(`/factories?toast=${encodeURIComponent("Factory removed.")}`);
}
