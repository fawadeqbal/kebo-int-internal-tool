import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, SESSION_RENEW_AFTER_SECONDS, SESSION_TTL_SECONDS, sessionCookieOptions, signSessionToken, verifySessionToken } from "@/lib/auth/token";

/**
 * Optimistic route protection: send signed-out visitors to the login page, and
 * keep active people signed in by re-issuing their cookie once a day.
 * Real authorisation (live session + active user + role permissions) is
 * enforced again in every page, server action and API route.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isLogin = pathname === "/login" || pathname === "/login/verify";
  const claims = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);

  if (!claims && !isLogin) {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if (claims && isLogin) return NextResponse.redirect(new URL("/dashboard", request.url));

  const response = NextResponse.next();
  if (claims && Date.now() / 1000 - claims.issuedAt > SESSION_RENEW_AFTER_SECONDS) {
    response.cookies.set(SESSION_COOKIE, await signSessionToken(claims.userId, claims.sessionId), sessionCookieOptions(SESSION_TTL_SECONDS));
  }
  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|brand/|fonts/|healthz|inquiry-received).*)"],
};
