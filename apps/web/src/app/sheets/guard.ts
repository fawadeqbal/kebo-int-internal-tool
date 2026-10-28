import { apiFetch } from "@/lib/api";

/** Only this site's own pages, for someone signed in. Returns a response to send back when not. */
export async function sheetGuard(req: Request): Promise<Response | null> {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host) return Response.json({ error: "Not allowed" }, { status: 403 });
  const me = await apiFetch("/auth/me");
  if (!me.ok) return Response.json({ error: "Sign in again, then try once more." }, { status: 401 });
  return null;
}
