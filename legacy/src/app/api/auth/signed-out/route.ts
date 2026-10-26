import { NextResponse } from "next/server";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/token";

/** A session that ended elsewhere: clear the stale cookie, then show the login page. */
export function GET(request: Request) {
  const response = NextResponse.redirect(new URL("/login?ended=1", request.url), 303);
  response.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(0));
  return response;
}
