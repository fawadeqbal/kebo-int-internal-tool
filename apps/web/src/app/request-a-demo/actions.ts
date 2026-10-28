"use server";

import { apiFetch } from "@/lib/api";
import { formValues, type ActionState } from "@/lib/actions";

/** The public "Request a demo" form: becomes a lead for the platform admin. */
export async function requestDemoAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const res = await apiFetch("/platform/public/demo-request", {
    method: "POST",
    auth: false,
    body: JSON.stringify({
      companyName: v.companyName,
      name: v.name,
      email: v.email,
      phone: v.phone,
      country: v.country,
      teamSize: v.teamSize || null,
      message: v.message,
      website: v.website,
      botToken: v["cf-turnstile-response"],
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, message: body.error ?? "Could not send. Please try again.", errors: body.fieldErrors, values: v };
  return { ok: true, message: "Thank you. We will contact you within one working day to set up your demo." };
}
