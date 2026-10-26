import { ApiError, apiUser, handle, json } from "@/lib/api/http";
import { getMailer, renderEmail } from "@/lib/email";
import { loadSettings, settingsSchema } from "@/modules/settings/service";

export const runtime = "nodejs";

/** { notifyEmails: string[] } → sends a test message (saved or not). */
export const POST = handle(async (request: Request) => {
  const actor = await apiUser("settings.manage");
  const body = (await request.json().catch(() => ({}))) as { notifyEmails?: unknown };
  const raw = Array.isArray(body.notifyEmails) ? body.notifyEmails.join(",") : String(body.notifyEmails ?? "");
  const parsed = settingsSchema.shape.notifyEmails.safeParse(raw);
  if (!parsed.success) throw new ApiError(422, "One of the emails is not valid.");
  if (parsed.data.length === 0) throw new ApiError(422, "Add at least one email first.");
  const mailer = getMailer();
  if (!mailer.enabled) throw new ApiError(400, "Email is not set up on the server (SMTP settings missing).");
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
  } catch (error) {
    throw new ApiError(502, `Could not send: ${(error as Error).message}`);
  }
  return json({ ok: true, message: `Sent to ${parsed.data.join(", ")}.` });
});
