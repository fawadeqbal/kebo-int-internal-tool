"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { attempt, formValues, type ActionState } from "@/lib/actions";

const path = (code: string) => `/hs-codes/${encodeURIComponent(code)}`;

/** Add an HS code (code typed in the form) or change one (code given): its rebate % and description. */
export async function saveHsCodeAction(existing: string | null, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const code = (existing ?? v.code ?? "").replace(/\s+/g, "");
  if (!code) return { ok: false, message: "Enter the HS code, e.g. 8437.80", errors: { code: ["Enter the HS code, e.g. 8437.80"] }, values: v };
  const r = await attempt(form, () => api.put(path(code), { rebateRate: v.rebateRate, description: v.description?.trim() || null }), existing ? `HS ${code} saved.` : `HS ${code} added.`);
  if (r.ok) revalidatePath("/factories/rebates");
  return r;
}

export async function removeHsCodeAction(code: string, _prev: ActionState, _form: FormData): Promise<ActionState> {
  const r = await attempt(null, () => api.delete(path(code)), `HS ${code} removed.`);
  if (r.ok) revalidatePath("/factories/rebates");
  return r;
}
