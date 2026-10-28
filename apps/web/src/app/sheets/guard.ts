import { apiFetch } from "@/lib/api";

/** Only this site's own pages, for someone signed in. Returns a response to send back when not. */
export async function sheetGuard(req: Request): Promise<Response | null> {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host) return Response.json({ error: "Not allowed" }, { status: 403 });
  const me = await apiFetch("/auth/me");
  if (!me.ok) return Response.json({ error: "Sign in again, then try once more." }, { status: 401 });
  return excelRefusal();
}

/** Excel is a plan feature: a response to send when the company's plan does not include it (or that cannot be told). */
export async function excelRefusal(): Promise<Response | null> {
  const res = await apiFetch("/company");
  if (!res.ok) return Response.json({ error: "Could not check your company's plan. Try again." }, { status: res.status === 401 ? 401 : 503 });
  const company = (await res.json().catch(() => null)) as { features?: string[] } | null;
  if (!Array.isArray(company?.features) || !company.features.includes("excel")) {
    return Response.json({ error: "Excel is not in your company's plan. Ask the platform admin to switch it on." }, { status: 403 });
  }
  return null;
}
