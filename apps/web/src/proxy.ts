import { NextResponse, type NextRequest } from "next/server";
import { addressOf, adminOrigin, marketingOrigin } from "@kebo/shared";

/**
 * Addresses per company (only when BASE_DOMAIN is set; otherwise everything is
 * at one address and this does nothing):
 *  - <short name>.<BASE_DOMAIN>: that company. Its short name goes to the API
 *    with every call (X-Company); a renamed company's old name redirects to the
 *    new one for a while; an unknown name shows "no company here".
 *  - admin.<BASE_DOMAIN>: the platform area (/platform).
 *  - <BASE_DOMAIN>: the marketing site (/ is app/site, /sign-in finds a
 *    company's address by email; request a demo, sign up). Any other page is
 *    sent on to ROOT_COMPANY's own address (same page), so links people kept
 *    from before the addresses still open; without ROOT_COMPANY, to the
 *    marketing page. Set-password links from older emails and the phone app's
 *    PDFs (Bearer, not a cookie) are served here. The API under /api is not a
 *    page and is never sent anywhere, so the phone app keeps working.
 *  - get.<BASE_DOMAIN>: the marketing site's old address; sends people on to
 *    the plain one (same page).
 */
const MARKETING_PATHS = ["/request-a-demo", "/sign-up"];
const isMarketingPath = (path: string) => MARKETING_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
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
  const marketing = marketingOrigin(base, "");
  const search = req.nextUrl.search;
  // The marketing site's pages have short paths (its files are under /site).
  const short = path === "/site" ? "/" : path.startsWith("/site/") ? path.slice(5) : path;
  // Its old address: on to the plain one, same page.
  if (a.kind === "marketing") return NextResponse.redirect(`${marketing}${short}${search}`);
  // The marketing site's pages live at the plain address only, at their short paths.
  if (short !== path) return NextResponse.redirect(`${marketing}${short}${search}`);
  if (a.kind === "company") {
    const slug = await companyAt(a.slug);
    if (!slug) return NextResponse.rewrite(new URL("/no-company", req.url));
    if (slug !== a.slug) return NextResponse.redirect(`https://${slug}.${base}${path}${req.nextUrl.search}`);
    headers.set("x-company", slug);
    return pass();
  }
  if (a.kind === "root") {
    // The marketing site: the page itself and "Sign in" (find your company), request a demo, sign up.
    if (path === "/") return NextResponse.rewrite(new URL(`/site${search}`, req.url), { request: { headers } });
    if (path === "/sign-in") return NextResponse.rewrite(new URL(`/site/sign-in${search}`, req.url), { request: { headers } });
    if (isMarketingPath(path)) return pass();
    // Links from emails sent before the addresses (the token says which company) and the phone app's PDFs.
    if (path === "/set-password" || (path.startsWith("/pdf/") && req.headers.has("authorization"))) return pass();
    // Any other page (a link kept from before the addresses): the same page at the first company's address.
    const root = process.env.ROOT_COMPANY;
    return NextResponse.redirect(root ? `https://${root}.${base}${path}${search}` : `${marketing}/`);
  }
  return pass();
}

export const config = {
  // Pages only: not Next's own files or the static ones.
  matcher: ["/((?!_next/|brand/|fonts/|favicon|icon|apple-icon|robots|sitemap).*)"],
};
