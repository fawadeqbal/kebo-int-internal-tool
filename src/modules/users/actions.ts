"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { handleForm, toActionError } from "@/lib/utils/action";
import type { ActionState } from "@/lib/utils/result";
import { changeOwnPasswordSchema, createUserSchema, resetPasswordSchema, updateUserSchema } from "./schema";
import { changeOwnPassword, createUser, resetPassword, setUserActive, updateUser } from "./service";

export async function createUserAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireUser();
  const result = await handleForm(formData, createUserSchema, async (data) => {
    await createUser(actor, data);
  });
  if (!result.ok) return result;
  revalidatePath("/users");
  redirect("/users?toast=User+created");
}

export async function updateUserAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireUser();
  const result = await handleForm(formData, updateUserSchema, async (data) => {
    await updateUser(actor, id, data);
  });
  if (!result.ok) return result;
  revalidatePath("/users");
  redirect("/users?toast=User+updated");
}

export async function resetPasswordAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireUser();
  const result = await handleForm(formData, resetPasswordSchema, async (data) => {
    await resetPassword(actor, id, data.password);
  });
  return result.ok ? { ok: true, message: "Password updated. Share it with the user securely." } : result;
}

export async function toggleUserActiveAction(id: string, isActive: boolean) {
  const actor = await requireUser();
  try {
    await setUserActive(actor, id, isActive);
  } catch (error) {
    const err = toActionError(error);
    redirect(`/users/${id}?toast=${encodeURIComponent(err.message ?? "Could not update user")}`);
  }
  revalidatePath("/users");
  redirect(`/users/${id}?toast=${isActive ? "User+activated" : "User+deactivated"}`);
}

export async function changeOwnPasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireUser();
  const result = await handleForm(formData, changeOwnPasswordSchema, async (data) => {
    await changeOwnPassword(actor, data.currentPassword, data.password);
  });
  return result.ok ? { ok: true, message: "Your password has been changed." } : { ...result, values: {} };
}
