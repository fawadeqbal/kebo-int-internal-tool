import { db } from "@/lib/db";
import { ApiError, apiUser, handle, json, parse } from "@/lib/api/http";
import { diff, recordAudit } from "@/modules/audit/service";
import { loadSettings, saveSettings, settingsSchema } from "@/modules/settings/service";

export const runtime = "nodejs";

export const GET = handle(async () => {
  await apiUser("settings.manage");
  return json({ settings: await loadSettings() });
});

/** The settings object; missing fields keep their saved values (categories and notifyEmails as arrays, the notify* switches as booleans). */
export const PUT = handle(async (request: Request) => {
  const actor = await apiUser("settings.manage");
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") throw new ApiError(400, "Send a JSON object.");
  // Fields the app does not send (e.g. an older app without exchange rates) keep their saved value.
  const current = await loadSettings();
  const merged: Record<string, unknown> = { ...current, ...body };
  const asForm = {
    ...merged,
    categories: Array.isArray(merged.categories) ? merged.categories.join("\n") : merged.categories,
    notifyEmails: Array.isArray(merged.notifyEmails) ? merged.notifyEmails.join(",") : merged.notifyEmails,
  };
  const data = parse(settingsSchema, asForm);
  await db.transaction(async (tx) => {
    const before = await loadSettings(tx);
    await saveSettings(tx, data);
    const changes = diff(before as unknown as Record<string, unknown>, data as unknown as Record<string, unknown>);
    if (changes.changed) await recordAudit(tx, { userId: actor.id, action: "update", entityType: "settings", summary: "Updated settings", ...changes });
  });
  return json({ ok: true, settings: data, message: "Settings saved." });
});
