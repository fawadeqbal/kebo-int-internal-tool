import { apiFetch } from "@/lib/api";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Types a browser can show safely in a tab (no SVG or HTML: they could run scripts). */
const VIEWABLE = new Set(["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"]);

/** An expense's receipt (managers only; the API checks). ?view=1 opens a PDF or a photo in the browser. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });
  const res = await apiFetch(`/expenses/${id}/receipt`);
  if (!res.ok) return new Response(res.status === 404 ? "Not found" : "Not allowed", { status: res.status });
  const headers = new Headers();
  for (const h of ["content-type", "content-length", "content-disposition", "x-content-type-options", "cache-control"]) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (new URL(req.url).searchParams.get("view") === "1" && VIEWABLE.has(type)) {
    headers.set("content-disposition", (headers.get("content-disposition") ?? "").replace(/^attachment/, "inline") || "inline");
    headers.set("content-security-policy", "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; object-src 'self'");
  }
  return new Response(res.body, { status: 200, headers });
}

/**
 * A photo or PDF of the receipt, sent from the browser (server actions cap
 * bodies at 1 MB, so files come through here). Only from this site's own pages.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host) return Response.json({ error: "Not allowed" }, { status: 403 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Choose a photo or PDF of the receipt." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return Response.json({ error: "Choose a photo or PDF of the receipt." }, { status: 400 });
  const body = new FormData();
  body.set("file", file, file.name);
  const res = await apiFetch(`/expenses/${id}/receipt`, { method: "POST", body });
  const json = await res.json().catch(() => ({ error: `Upload failed (${res.status})` }));
  return Response.json(json, { status: res.status });
}
