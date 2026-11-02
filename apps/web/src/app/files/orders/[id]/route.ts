import { apiFetch } from "@/lib/api";
import { sameSite } from "@/lib/file-proxy";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF = /^(attachment|payment|factory_payment|expense):[0-9a-f-]{36}$/i;

/** Some files of an order (?files=attachment:<id>,…), or all of them, in one zip; the API checks who may see each. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });
  const files = (new URL(req.url).searchParams.get("files") ?? "").split(",").filter((f) => REF.test(f));
  const res = await apiFetch(`/orders/${id}/files/zip`, { query: files.length ? { files: files.join(",") } : undefined });
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
 * A file added on the order (multipart: file, step, kind, note, attachTo), sent
 * from the browser; server actions cap request bodies at 1 MB, so files come here.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return Response.json({ error: "Not found" }, { status: 404 });
  if (!sameSite(req)) return Response.json({ error: "Not allowed" }, { status: 403 });
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
  for (const k of ["step", "kind", "note", "attachTo"]) {
    const v = form.get(k);
    if (typeof v === "string" && v.trim()) body.set(k, v.trim());
  }
  const res = await apiFetch(`/orders/${id}/files`, { method: "POST", body });
  const json = await res.json().catch(() => ({ error: `Upload failed (${res.status})` }));
  return Response.json(json, { status: res.status });
}
