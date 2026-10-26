import { apiFetch } from "@/lib/api";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** All of a deal's URS & documents in one zip (the API checks the person may see the deal). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });
  const res = await apiFetch(`/inquiries/${id}/files.zip`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    return new Response(body?.error ?? (res.status === 404 ? "Not found" : "Not allowed"), { status: res.status });
  }
  const headers = new Headers();
  for (const h of ["content-type", "content-length", "content-disposition", "cache-control"]) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(res.body, { status: 200, headers });
}

/**
 * One file for the deal (multipart: file, kind, note), sent from the browser
 * with upload progress. Server actions cap request bodies at 1 MB, so files
 * come through here. Only from this site's own pages.
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
    return Response.json({ error: "Choose a file to upload." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return Response.json({ error: "Choose a file to upload." }, { status: 400 });
  const body = new FormData();
  body.set("file", file, file.name);
  for (const k of ["kind", "note", "factoryQuoteId"]) {
    const v = form.get(k);
    if (typeof v === "string" && v.trim()) body.set(k, v.trim());
  }
  const res = await apiFetch(`/inquiries/${id}/files`, { method: "POST", body });
  const json = await res.json().catch(() => ({ error: `Upload failed (${res.status})` }));
  return Response.json(json, { status: res.status });
}
