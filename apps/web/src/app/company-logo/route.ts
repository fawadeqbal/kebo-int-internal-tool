import { apiFetch } from "@/lib/api";

/**
 * The signed-in company's logo (Settings → Company) as an image, for the app's
 * header. The link carries a version (?v=), so browsers keep it until it changes.
 */
export async function GET() {
  const res = await apiFetch("/company/brand").catch(() => null);
  const brand = res?.ok ? ((await res.json()) as { logo: string | null }) : null;
  const m = brand?.logo?.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
  if (!m) return new Response(null, { status: 404 });
  return new Response(Buffer.from(m[2]!, "base64"), {
    headers: { "content-type": m[1]!, "cache-control": "private, max-age=31536000, immutable" },
  });
}
