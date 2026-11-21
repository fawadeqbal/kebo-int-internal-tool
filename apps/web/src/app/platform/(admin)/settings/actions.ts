"use server";

import { revalidatePath } from "next/cache";
import { platformApi } from "@/lib/api";
import { attempt, formValues, type ActionState } from "@/lib/actions";
import { mailBody } from "@/lib/mail-form";

const PAGE = "/platform/settings";

/** Platform settings › Emails: the platform's own sending email. A password or key left empty keeps the stored one. */
export async function savePlatformMailAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => platformApi.put("/mail", mailBody(form)), "Saved. Send a test email to check it.");
  // The password or key is never put back in the form.
  if (r.values) delete r.values.secret;
  if (r.ok) revalidatePath(PAGE);
  return r;
}

/** Back to the server's own email (.env). */
export async function removePlatformMailAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(
    form,
    () => platformApi.delete("/mail"),
    "Removed. The platform's email goes through the server's settings again.",
  );
  if (r.ok) revalidatePath(PAGE);
  return r;
}

/** One email, sent the way it is saved now. */
export async function testPlatformMailAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const to = formValues(form).to ?? "";
  const r = await attempt(form, () => platformApi.post<{ ok: true; via: string }>("/mail/test", { to }));
  if (r.ok) return { ...r, message: `Sent to ${to} through ${(r.data as { via: string }).via}. Check that inbox.` };
  return r;
}

/** Where the platform's emails go: the addresses typed (commas or lines); none, back to the default. */
export async function savePlatformInboxAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const emails = (formValues(form).emails ?? "")
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter(Boolean);
  const r = await attempt(
    form,
    () => platformApi.put("/mail/inbox", { emails }),
    emails.length ? "Saved." : "Saved: they go to the default again.",
  );
  if (r.ok) revalidatePath(PAGE);
  return r;
}
