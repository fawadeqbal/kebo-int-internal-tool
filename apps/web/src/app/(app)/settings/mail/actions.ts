"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { attempt, formValues, type ActionState } from "@/lib/actions";

const PAGE = "/settings/mail";

/** The account as the form typed it. A password or key left empty keeps the stored one. */
function accountBody(form: FormData) {
  const v = formValues(form);
  return {
    provider: v.provider,
    fromName: v.fromName ?? "",
    fromEmail: v.fromEmail ?? "",
    ...(v.provider === "smtp" ? { host: v.host ?? "", port: v.port ?? "" } : {}),
    ...(v.provider !== "resend" && v.username?.trim() ? { username: v.username } : {}),
    ...(v.secret ? { secret: v.secret } : {}),
  };
}

/** Admin settings › Email accounts: connect one more address, or change one (`id`). */
export async function saveAccountAction(id: string | null, _prev: ActionState, form: FormData): Promise<ActionState> {
  const body = accountBody(form);
  const r = await attempt(
    form,
    () => (id ? api.put(`/mail-settings/accounts/${id}`, body) : api.post("/mail-settings/accounts", body)),
    id ? "Saved." : `${body.fromEmail} connected. Send a test email to check it.`,
  );
  // The password or key is never put back in the form.
  if (r.values) delete r.values.secret;
  if (r.ok) revalidatePath(PAGE);
  return r;
}

/** Disconnect one address: what it sent goes from the default. */
export async function disconnectAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => api.delete(`/mail-settings/accounts/${id}`), "Disconnected.");
  if (r.ok) revalidatePath(PAGE);
  return r;
}

/** Which address each kind of email goes from, the default, and whether people may choose when sending. */
export async function saveUsesAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const body = {
    defaultId: v.defaultId || null,
    uses: { customers: v.customers || null, staff: v.staff || null },
    choose: form.get("choose") === "on",
  };
  const r = await attempt(form, () => api.put("/mail-settings/uses", body), "Saved.");
  if (r.ok) revalidatePath(PAGE);
  return r;
}

/** One email, through the account chosen (else the default). */
export async function testMailAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const to = v.to ?? "";
  const r = await attempt(form, () => api.post<{ ok: true; via: string }>("/mail-settings/test", { to, accountId: v.accountId || null }));
  if (r.ok) return { ...r, message: `Sent to ${to} from ${(r.data as { via: string }).via}. Check that inbox.` };
  return r;
}
