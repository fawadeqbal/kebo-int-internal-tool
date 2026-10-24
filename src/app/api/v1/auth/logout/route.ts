import { destroySession } from "@/lib/auth/session";
import { handle, json } from "@/lib/api/http";

export const runtime = "nodejs";

/** Ends this app session on the server (the token stops working everywhere at once). */
export const POST = handle(async () => {
  await destroySession();
  return json({ ok: true });
});
