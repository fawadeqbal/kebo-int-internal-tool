import { apiFetch } from "@/lib/api";

/** Types a browser can show safely in a tab (no SVG or HTML: they could run scripts). */
const VIEWABLE = new Set(["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"]);

/**
 * Downloads go through the web server (the API checks the person may see the
 * deal). ?view=1 opens a PDF or a photo in the browser instead of saving it.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await apiFetch(`/files/${id}`);
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
