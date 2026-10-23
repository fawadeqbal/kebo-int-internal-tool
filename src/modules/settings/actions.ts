"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { assertCan, requireUser } from "@/lib/auth/session";
import { handleForm } from "@/lib/utils/action";
import type { ActionState } from "@/lib/utils/result";
import { diff, recordAudit } from "@/modules/audit/service";
import { loadSettings, saveSettings, settingsSchema } from "./service";
import { getMailer, renderEmail } from "@/lib/email";

export async function saveSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireUser();
  const result = await handleForm(formData, settingsSchema, async (data) => {
    assertCan(actor, "settings.manage");
    await db.transaction(async (tx) => {
      const before = await loadSettings(tx);
      await saveSettings(tx, data);
      const changes = diff(before as unknown as Record<string, unknown>, data as unknown as Record<string, unknown>);
      if (changes.changed)
        await recordAudit(tx, { userId: actor.id, action: "update", entityType: "settings", summary: "Updated settings", ...changes });
    });
  });
  if (result.ok) {
    revalidatePath("/", "layout");
    return { ok: true, message: "Settings saved." };
  }
  return result;
}

/** Sends a test message to the admin emails typed in the form (saved or not). */
export async function sendTestEmailAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireUser();
  try {
    assertCan(actor, "settings.manage");
  } catch {
    return { ok: false, message: "Not allowed." };
  }
  const parsed = settingsSchema.shape.notifyEmails.safeParse(formData.get("notifyEmails") ?? "");
  if (!parsed.success) return { ok: false, message: "One of the emails is not valid." };
  if (parsed.data.length === 0) return { ok: false, message: "Add at least one email first." };
  const mailer = getMailer();
  if (!mailer.enabled) return { ok: false, message: "Email is not set up on the server (SMTP settings missing)." };
  const settings = await loadSettings();
  const mail = renderEmail({
    heading: "Test email",
    body: `Email notifications are working. Sent by ${actor.name}.`,
    link: `${(process.env.APP_URL ?? "").replace(/\/$/, "")}/dashboard`,
    linkLabel: "Open the system",
    footer: settings.companyName,
  });
  try {
    await mailer.send({ to: parsed.data, subject: "Test email from Kebo RFQ Desk", ...mail });
    return { ok: true, message: `Sent to ${parsed.data.join(", ")}.` };
  } catch (error) {
    console.error(error);
    return { ok: false, message: `Could not send: ${(error as Error).message}` };
  }
}
