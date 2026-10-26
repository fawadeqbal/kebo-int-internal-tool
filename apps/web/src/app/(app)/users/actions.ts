"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { attempt, formValues, type ActionState } from "@/lib/actions";

const refresh = (id?: string) => {
  revalidatePath("/users");
  if (id) revalidatePath(`/users/${id}`);
};

export async function createUserAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(form, () => api.post<{ id: string; name: string }>("/users", { name: v.name, email: v.email, role: v.role, password: v.password }));
  if (!r.ok) return r;
  refresh();
  redirect(`/users?toast=${encodeURIComponent(`${v.name.trim()} can now sign in.`)}`);
}

export async function updateUserAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(form, () => api.put(`/users/${id}`, { name: v.name, email: v.email, role: v.role }), "Saved. A new role takes effect at once (they sign in again).");
  if (r.ok) refresh(id);
  return r;
}

/** The button that ran these disappears once they succeed (it turns into the opposite one), so the answer comes as a toast. */
const done = (id: string, message: string): never => {
  refresh(id);
  redirect(`/users/${id}?toast=${encodeURIComponent(message)}`);
};

export async function setActiveAction(id: string, active: boolean, _prev: ActionState, _form: FormData): Promise<ActionState> {
  const r = await attempt(null, () => api.patch(`/users/${id}/active`, { active }));
  return r.ok ? done(id, active ? "Switched on. They can sign in again." : "Switched off and signed out everywhere.") : r;
}

export async function setPasswordAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(form, () => api.post(`/users/${id}/password`, { password: v.password }), "New password set. They are signed out everywhere; give them the password privately.");
  if (r.ok) refresh(id);
  return { ...r, values: undefined };
}

export async function resetTwoStepAction(id: string, _prev: ActionState, _form: FormData): Promise<ActionState> {
  const r = await attempt(null, () => api.post(`/users/${id}/two-step/reset`));
  return r.ok ? done(id, "Two-step sign-in is off for them. They can set it up again under My account.") : r;
}
