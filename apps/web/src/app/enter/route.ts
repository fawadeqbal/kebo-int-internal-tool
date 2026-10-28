import { cookies } from "next/headers";
import { apiFetch, SESSION_COOKIE } from "@/lib/api";

/** A platform admin's one-time link into a company at its own address: becomes a session here. */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const res = await apiFetch("/auth/enter", { method: "POST", auth: false, body: JSON.stringify({ token }) });
  const body = (await res.json().catch(() => ({}))) as { token?: string; expiresInSeconds?: number; error?: string };
  if (!res.ok || !body.token)
    return new Response(body.error ?? "This link has expired. Open the company again from the platform.", {
      status: 401,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  (await cookies()).set(SESSION_COOKIE, body.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    maxAge: body.expiresInSeconds ?? 3600,
  });
  return new Response(null, { status: 303, headers: { location: "/dashboard" } });
}
