import { z } from "zod";
import { apiUser, handle, json } from "@/lib/api/http";
import { markRead } from "@/modules/notifications/repository";

export const runtime = "nodejs";

/** { ids?: string[] } — the given ones, or all unread when no ids. */
export const POST = handle(async (request: Request) => {
  const user = await apiUser();
  const body = await request.json().catch(() => ({}));
  const ids = z.array(z.uuid()).max(200).optional().catch(undefined).parse((body as { ids?: unknown }).ids);
  await markRead(user.id, ids);
  return json({ ok: true });
});
