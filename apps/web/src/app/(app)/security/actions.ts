"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { attempt, formValues, type ActionState } from "@/lib/actions";

/** Checkboxes send one `permissions` value each (formValues would keep only the last). */
const roleBody = (form: FormData) => {
  const v = formValues(form);
  return { name: v.name, description: v.description, requireTwoStep: v.requireTwoStep === "on", permissions: form.getAll("permissions").map(String) };
};

export async function createRoleAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => api.post<{ key: string }>("/roles", roleBody(form)));
  if (!r.ok) return r;
  revalidatePath("/security");
  redirect(`/security/roles/${(r.data as { key: string }).key}?toast=${encodeURIComponent("Role made. Give it to people under Users.")}`);
}

export async function updateRoleAction(key: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => api.put(`/roles/${key}`, roleBody(form)), "Saved. People in this role have the new rights from their next click.");
  if (r.ok) {
    revalidatePath("/security", "layout");
    revalidatePath("/users");
  }
  return r;
}

export async function deleteRoleAction(key: string, _prev: ActionState, _form: FormData): Promise<ActionState> {
  const r = await attempt(null, () => api.delete(`/roles/${key}`));
  if (!r.ok) return r;
  revalidatePath("/security");
  redirect(`/security?toast=${encodeURIComponent("Role removed.")}`);
}

export async function endSessionAction(id: string, _prev: ActionState, _form: FormData): Promise<ActionState> {
  const r = await attempt(null, () => api.delete(`/security/sessions/${id}`), "Signed out.");
  if (r.ok) revalidatePath("/security", "layout");
  return r;
}

export async function signOutEverywhereAction(userId: string, _prev: ActionState, _form: FormData): Promise<ActionState> {
  const r = await attempt(null, () => api.post<{ ended: number }>(`/security/users/${userId}/sign-out`));
  if (!r.ok) return r;
  revalidatePath("/security", "layout");
  revalidatePath(`/users/${userId}`);
  const n = (r.data as { ended: number }).ended;
  return { ok: true, message: n ? `Signed out of ${n} device${n === 1 ? "" : "s"}.` : "They were not signed in anywhere." };
}
