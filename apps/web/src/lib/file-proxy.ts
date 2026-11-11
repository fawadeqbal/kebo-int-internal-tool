import { apiFetch } from "@/lib/api";
import { UUID } from "@/lib/ids";

/**
 * Uploading the file kept with a record (an expense's receipt, a payment's
 * proof), passed through to the API, which checks who may change it. It takes
 * one `file` from this site's own pages (server actions cap bodies at 1 MB, so
 * files come here). Every stored file opens at /files/<id>.
 */
export function uploadRoute(apiPath: (id: string) => string, choose: string) {
  async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    if (!UUID.test(id)) return Response.json({ error: "Not found" }, { status: 404 });
    const origin = req.headers.get("origin");
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (!origin || !host || new URL(origin).host !== host) return Response.json({ error: "Not allowed" }, { status: 403 });
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return Response.json({ error: choose }, { status: 400 });
    }
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return Response.json({ error: choose }, { status: 400 });
    const body = new FormData();
    body.set("file", file, file.name);
    const res = await apiFetch(apiPath(id), { method: "POST", body });
    const json = await res.json().catch(() => ({ error: `Upload failed (${res.status})` }));
    return Response.json(json, { status: res.status });
  }

  return { POST };
}

/** Same site only: a form post from another site cannot add or change files. */
export function sameSite(req: Request) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  return !!origin && !!host && new URL(origin).host === host;
}
