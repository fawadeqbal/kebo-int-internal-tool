"use server";

import { revalidatePath } from "next/cache";
import { api, ApiError } from "@/lib/api";
import type { ActionState } from "@/lib/actions";

/** A new key for the website form: the old one stops working at once. */
export async function newFormKeyAction(_prev: ActionState, _form: FormData): Promise<ActionState> {
  try {
    await api.post("/company/website-form/new-key", {});
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, message: e.message };
    throw e;
  }
  revalidatePath("/settings");
  return { ok: true, message: "A new key is made. Put the new snippet on your website: the old one no longer works." };
}
