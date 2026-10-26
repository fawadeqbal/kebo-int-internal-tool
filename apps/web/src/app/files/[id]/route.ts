import { apiFetch } from "@/lib/api";

/** Downloads go through the web server (the API checks the person may see the deal). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await apiFetch(`/files/${id}`);
  if (!res.ok) return new Response(res.status === 404 ? "Not found" : "Not allowed", { status: res.status });
  const headers = new Headers();
  for (const h of ["content-type", "content-length", "content-disposition", "x-content-type-options", "cache-control"]) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(res.body, { status: 200, headers });
}
