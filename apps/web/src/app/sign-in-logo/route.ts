import { addressCompany, apiFetch } from "@/lib/api";
import { ignore } from "@/lib/quiet";

/**
 * The logo of the company at this address, for its sign-in page (white label): before anyone signs in, so it
 * comes from the public look (only while the company is on). The link carries a version (?v=), so browsers keep
 * it until the logo changes.
 */
export async function GET() {
  const slug = await addressCompany();
  if (!slug) return new Response(null, { status: 404 });
  const res = await apiFetch(`/platform/public/company-logo?slug=${encodeURIComponent(slug)}`, { auth: false }).catch(
    ignore("the company's logo for its sign-in page (sent as none)"),
  );
  const body = res?.ok ? ((await res.json()) as { logo: string | null }) : null;
  const m = body?.logo?.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
  if (!m) return new Response(null, { status: 404 });
  return new Response(Buffer.from(m[2]!, "base64"), {
    headers: { "content-type": m[1]!, "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" },
  });
}
