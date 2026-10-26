import { z } from "zod";
import { ApiError, apiUser, handle, json } from "@/lib/api/http";
import { currentSessionId } from "@/lib/auth/session";
import { registerDevice, removeDevice } from "@/modules/notifications/push";

export const runtime = "nodejs";

const Body = z.object({ token: z.string().min(20).max(4096), platform: z.enum(["android", "ios"]).default("android") });

async function body(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(422, "A device token is required.");
  return parsed.data;
}

/** { token, platform } — this phone gets push notifications for the signed-in person. */
export const POST = handle(async (request: Request) => {
  const user = await apiUser();
  const { token, platform } = await body(request);
  await registerDevice(user.id, await currentSessionId(), token, platform);
  return json({ ok: true });
});

/** { token } — this phone stops getting push notifications. */
export const DELETE = handle(async (request: Request) => {
  const user = await apiUser();
  const { token } = await body(request);
  await removeDevice(token, user.id);
  return json({ ok: true });
});
