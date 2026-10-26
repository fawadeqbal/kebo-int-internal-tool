import { destroySession } from "@/lib/auth/session";
import { handle, json } from "@/lib/api/http";
import { removeDevice } from "@/modules/notifications/push";

export const runtime = "nodejs";

/**
 * Ends this app session on the server (the token stops working everywhere at once).
 * { deviceToken? } — also stops push notifications to this phone.
 */
export const POST = handle(async (request: Request) => {
  const body = (await request.json().catch(() => ({}))) as { deviceToken?: unknown };
  if (typeof body.deviceToken === "string" && body.deviceToken.length >= 20) await removeDevice(body.deviceToken);
  await destroySession();
  return json({ ok: true });
});
