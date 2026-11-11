import { apiFetch } from "@/lib/api";
import { sameSite } from "@/lib/file-proxy";
import { UUID } from "@/lib/ids";

const SOURCES = new Set(["attachment", "payment", "factory_payment", "expense"]);

/** Replace with a newer one (multipart: file). The deal's files keep the old one as an earlier version. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; source: string; fileId: string }> }) {
  const { id, source, fileId } = await params;
  if (!UUID.test(id) || !UUID.test(fileId) || !SOURCES.has(source)) return Response.json({ error: "Not found" }, { status: 404 });
  if (!sameSite(req)) return Response.json({ error: "Not allowed" }, { status: 403 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Choose the newer file." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return Response.json({ error: "Choose the newer file." }, { status: 400 });
  const body = new FormData();
  body.set("file", file, file.name);
  const res = await apiFetch(`/orders/${id}/files/${source}/${fileId}/replace`, { method: "POST", body });
  const json = await res.json().catch(() => ({ error: `Upload failed (${res.status})` }));
  return Response.json(json, { status: res.status });
}
