import { NextResponse, type NextRequest } from "next/server";
import { addressOf, adminOrigin } from "@kebo/shared";

/**
 * Addresses per company (only when BASE_DOMAIN is set; otherwise everything is
 * at one address and this does nothing):
 *  - <short name>.<BASE_DOMAIN>: that company. Its short name goes to the API
 *    with every call (X-Company); a renamed company's old name redirects to the
 *    new one for a while; an unknown name shows "no company here".
 *  - admin.<BASE_DOMAIN>: the platform area (/platform).
 *  - <BASE_DOMAIN>: ROOT_COMPANY's pages when set (the first company keeps its
 *    old address), else sign-in by email and the public pages.
 */
const known = new Map<string, { at: number; slug: string | null }>();

async function companyAt(slug: string): Promise<string | null> {
  const hit = known.get(slug);
  if (hit && Date.now() - hit.at < 60_000) return hit.slug;
  const base = (process.env.API_URL ?? "http://localhost:4000/api").replace(/\/$/, "");
  let found: string | null;
  try {
    const res = await fetch(`${base}/platform/public/company?slug=${encodeURIComponent(slug)}`, { cache: "no-store" });
    found = res.ok ? ((await res.json()) as { slug: string }).slug : null;
  } catch {
    // The API is down: let the page say so.
    return slug;
  }
  if (known.size > 5_000) known.clear();
  known.set(slug, { at: Date.now(), slug: found });
  return found;
}

export async function proxy(req: NextRequest) {
  const base = process.env.BASE_DOMAIN;
  if (!base) return NextResponse.next();
  const headers = new Headers(req.headers);
  // Only this decides the company: never what the browser sent.
  headers.delete("x-company");
  const path = req.nextUrl.pathname;
  const a = addressOf(req.headers.get("x-forwarded-host") ?? req.headers.get("host"), base);
  const admin = adminOrigin(base, "");
  const pass = () => NextResponse.next({ request: { headers } });

  if (a.kind === "admin") {
    if (path === "/" || !path.startsWith("/platform")) return NextResponse.redirect(`${admin}/platform`);
    return pass();
  }
  if (path.startsWith("/platform")) return NextResponse.redirect(`${admin}${path}${req.nextUrl.search}`);
  if (a.kind === "company") {
    const slug = await companyAt(a.slug);
    if (!slug) return NextResponse.rewrite(new URL("/no-company", req.url));
    if (slug !== a.slug) return NextResponse.redirect(`https://${slug}.${base}${path}${req.nextUrl.search}`);
    headers.set("x-company", slug);
    return pass();
  }
  if (a.kind === "root" && process.env.ROOT_COMPANY) headers.set("x-company", process.env.ROOT_COMPANY);
  return pass();
}

export const config = {
  // Pages only: not Next's own files or the static ones.
  matcher: ["/((?!_next/|brand/|fonts/|favicon|icon|apple-icon|robots|sitemap).*)"],
};
