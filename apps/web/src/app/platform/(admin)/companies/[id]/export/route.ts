import { apiFetch } from "@/lib/api";

/** The company's export (a zip from the API), passed straight through to the platform admin's browser. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await apiFetch(`/platform/companies/${id}/export`, { platform: true });
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return new Response(body?.error ?? "Could not export.", {
      status: res.status || 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return new Response(res.body, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": res.headers.get("content-disposition") ?? `attachment; filename="export.zip"`,
      "cache-control": "private, no-store",
    },
  });
}
