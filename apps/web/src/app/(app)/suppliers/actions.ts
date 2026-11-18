"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import type { ImportResult, FactoryInput } from "@kebo/shared";
import { attempt, formValues, type ActionState } from "@/lib/actions";

/** Create or edit a factory (in the side panel): answers with its id and name, and the page updates in place. */
/** `version`: the supplier's updatedAt when the form opened (a save over someone else's change is refused). */
export async function saveFactoryAction(id: string | null, version: string | null, _prev: ActionState, form: FormData): Promise<ActionState> {
  const body = formValues(form);
  const r = await attempt(form, () =>
    id ? api.put<{ id: string }>(`/factories/${id}`, body, { version }) : api.post<{ id: string }>("/factories", body),
  );
  if (!r.ok) return r;
  const savedId = id ?? (r.data as { id: string }).id;
  revalidatePath("/suppliers");
  revalidatePath(`/suppliers/${savedId}`, "layout");
  return { ok: true, data: { id: savedId, name: (body.name ?? "").trim() } };
}

export async function removeFactoryAction(id: string, _prev: ActionState, _form: FormData): Promise<ActionState> {
  const r = await attempt(null, () => api.delete(`/factories/${id}`));
  if (!r.ok) return r;
  revalidatePath("/suppliers");
  redirect(`/suppliers?toast=${encodeURIComponent("Supplier removed.")}`);
}

/** New factories from an uploaded Excel file (checked on the page; the API checks again and leaves out any already there). */
export async function importFactoriesAction(
  items: FactoryInput[],
  fileName: string,
): Promise<{ ok: true; result: ImportResult } | { ok: false; message: string }> {
  try {
    const result = await api.post<ImportResult>("/factories/import", { factories: items, fileName });
    revalidatePath("/suppliers");
    return { ok: true, result };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, message: e.status === 403 ? "You cannot add suppliers." : e.message };
    throw e;
  }
}
