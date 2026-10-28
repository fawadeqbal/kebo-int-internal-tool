"use server";

import { redirect } from "next/navigation";
import { apiFetch } from "@/lib/api";
import type { ActionState } from "@/lib/actions";

/** Sets the password from the emailed link, then off to sign in. The password is never sent back. */
export async function setPasswordAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const token = String(form.get("token") ?? "");
  const password = String(form.get("password") ?? "");
  if (password !== String(form.get("confirm") ?? ""))
    return { ok: false, message: "The two passwords are not the same.", errors: { confirm: ["Type the same password again"] } };
  const platform = form.get("platform") === "1";
  const res = await apiFetch(platform ? "/platform/auth/set-password" : "/platform/public/set-password", {
    method: "POST",
    body: JSON.stringify({ token, password }),
    auth: false,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, message: body.error ?? "Could not set the password.", errors: body.fieldErrors };
  redirect(
    platform ? "/platform/login?toast=Password+set.+Sign+in." : `/login?toast=${encodeURIComponent("Your password is set. Sign in.")}`,
  );
}
