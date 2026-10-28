"use server";

import { originFromForm } from "@/lib/origin";
import { apiFetch } from "@/lib/api";
import { formValues, type ActionState } from "@/lib/actions";

/** Self sign-up: an email to confirm, then a trial company. The password is never sent back. */
export async function signUpAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const res = await apiFetch("/platform/public/sign-up", {
    method: "POST",
    auth: false,
    body: JSON.stringify({
      companyName: v.companyName,
      slug: v.slug,
      name: v.name,
      email: v.email,
      password: v.password,
      website: v.website,
      botToken: v["cf-turnstile-response"],
      origin: originFromForm(form),
    }),
  });
  const body = await res.json().catch(() => ({}));
  const { password: _p, ...kept } = v;
  if (!res.ok) return { ok: false, message: body.error ?? "Could not sign up. Please try again.", errors: body.fieldErrors, values: kept };
  return { ok: true, message: `Check your inbox (${v.email}): press the button in our email to start your trial.` };
}

/** A short name suggested from the company name, or whether one is free. */
export async function slugCheckAction(
  name: string,
  slug: string,
): Promise<{ suggestion?: string | null; free?: boolean; problem?: string | null }> {
  const q = new URLSearchParams(slug ? { slug } : { name });
  const res = await apiFetch(`/platform/public/slug?${q}`, { auth: false });
  return res.ok ? res.json() : {};
}
