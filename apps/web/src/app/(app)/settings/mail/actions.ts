"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { attempt, formValues, type ActionState } from "@/lib/actions";

const PAGE = "/settings/mail";

/** Admin settings › Email sending: save how the company's email goes out. A password or key left empty keeps the stored one. */
export async function saveMailAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const body = {
    provider: v.provider,
    fromName: v.fromName ?? "",
    fromEmail: v.fromEmail ?? "",
    ...(v.provider === "smtp" ? { host: v.host ?? "", port: v.port ?? "" } : {}),
    ...(v.provider !== "resend" && v.username?.trim() ? { username: v.username } : {}),
    ...(v.secret ? { secret: v.secret } : {}),
  };
  const r = await attempt(form, () => api.put("/mail-settings", body), "Saved. Send a test email to check it.");
  // The password or key is never put back in the form.
  if (r.values) delete r.values.secret;
  if (r.ok) revalidatePath(PAGE);
  return r;
}

/** Back to the server's own email. */
export async function removeMailAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => api.delete("/mail-settings"), "Removed. Email goes through the server's own again.");
  if (r.ok) revalidatePath(PAGE);
  return r;
}

/** One email, sent the way it is saved now. */
export async function testMailAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const to = formValues(form).to ?? "";
  const r = await attempt(form, () => api.post<{ ok: true; via: string }>("/mail-settings/test", { to }));
  if (r.ok) return { ...r, message: `Sent to ${to} through ${(r.data as { via: string }).via}. Check that inbox.` };
  return r;
}
