"use server";

import { apiFetch } from "@/lib/api";
import { formValues, type ActionState } from "@/lib/actions";
import { originFromForm } from "@/lib/origin";

/** "Ask a question" on the marketing page: a lead for the platform admin. */
export async function contactAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const res = await apiFetch("/platform/public/contact", {
    method: "POST",
    auth: false,
    body: JSON.stringify({
      name: v.name,
      email: v.email,
      companyName: v.companyName,
      phone: v.phone,
      message: v.message,
      website: v.website,
      botToken: v["cf-turnstile-response"],
      origin: originFromForm(form),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, message: body.error ?? "Could not send. Please try again.", errors: body.fieldErrors, values: v };
  return { ok: true, message: "Thank you. We have your question and will answer by email within one working day." };
}

/** "Sign in": the addresses of the person's companies, sent to their email. */
export async function findCompanyAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const res = await apiFetch("/platform/public/find-company", { method: "POST", auth: false, body: JSON.stringify({ email: v.email }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, message: body.error ?? "Could not send. Please try again.", errors: body.fieldErrors, values: v };
  return {
    ok: true,
    message: `If ${v.email} has an account, we have sent it a link to the right sign-in page. Check your inbox (and spam) in a minute.`,
  };
}
