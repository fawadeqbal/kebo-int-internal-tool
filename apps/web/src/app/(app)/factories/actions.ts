"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { factoryInput, type ImportResult, type FactoryInput } from "@kebo/shared";
import { attempt, formBody, type ActionState } from "@/lib/actions";

/** Point the API's "contacts" errors at the exact contact field ("contacts.1.email"), as for customers. */
function locateContactErrors(body: Record<string, unknown>, r: ActionState): ActionState {
  if (r.ok || !r.errors?.contacts) return r;
  const parsed = factoryInput.safeParse(body);
  if (parsed.success) return r;
  const errors = { ...r.errors };
  for (const issue of parsed.error.issues) {
    if (issue.path[0] !== "contacts" || issue.path.length < 3) continue;
    const key = issue.path.join(".");
    errors[key] = [...(errors[key] ?? []), issue.message];
  }
  return { ...r, errors };
}

/** Create or edit a factory (in the side panel): answers with its id and name, and the page updates in place. */
export async function saveFactoryAction(id: string | null, _prev: ActionState, form: FormData): Promise<ActionState> {
  const body = formBody(form);
  const r = locateContactErrors(body, await attempt(form, () => (id ? api.put<{ id: string }>(`/factories/${id}`, body) : api.post<{ id: string }>("/factories", body))));
  if (!r.ok) return r;
  const savedId = id ?? (r.data as { id: string }).id;
  revalidatePath("/factories");
  revalidatePath(`/factories/${savedId}`);
  return { ok: true, data: { id: savedId, name: typeof body.name === "string" ? body.name.trim() : "" } };
}

export async function removeFactoryAction(id: string, _prev: ActionState, _form: FormData): Promise<ActionState> {
  const r = await attempt(null, () => api.delete(`/factories/${id}`));
  if (!r.ok) return r;
  revalidatePath("/factories");
  redirect(`/factories?toast=${encodeURIComponent("Factory removed.")}`);
}

/** New factories from an uploaded Excel file (checked on the page; the API checks again and leaves out any already there). */
export async function importFactoriesAction(items: FactoryInput[], fileName: string): Promise<{ ok: true; result: ImportResult } | { ok: false; message: string }> {
  try {
    const result = await api.post<ImportResult>("/factories/import", { factories: items, fileName });
    revalidatePath("/factories");
    return { ok: true, result };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, message: e.status === 403 ? "You cannot add factories." : e.message };
    throw e;
  }
}
