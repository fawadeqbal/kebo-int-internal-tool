import { Inject, Injectable } from "@nestjs/common";
import { jwtVerify, SignJWT } from "jose";
import { ENV, type Env } from "../../config/env";

export const SESSION_COOKIE = "kebo_session";
/** Signed in for 30 days of not using the app; use pushes it forward. */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
/** However active, a device signs in again after this long. */
export const SESSION_MAX_AGE_DAYS = 90;

/** The token only names the session; the sessions table decides whether it is still valid. */
@Injectable()
export class TokensService {
  private readonly key: Uint8Array;

  constructor(@Inject(ENV) env: Env) {
    if (env.NODE_ENV === "production" && /replace-with|change-me|example/i.test(env.AUTH_SECRET)) {
      throw new Error("AUTH_SECRET is still the example value; generate one with: openssl rand -base64 48");
    }
    this.key = new TextEncoder().encode(env.AUTH_SECRET);
  }

  /** A session token: who, which session, and which company it belongs to. */
  sign(userId: string, sessionId: string, companyId: string): Promise<string> {
    return new SignJWT({ sid: sessionId, cid: companyId })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(userId)
      .setIssuedAt()
      // The token lives as long as the longest possible session; the sessions row
      // slides the 30-day idle expiry and enforces the 90-day cap on every request.
      .setExpirationTime(`${SESSION_MAX_AGE_DAYS}d`)
      .sign(this.key);
  }

  /**
   * companyId is null on tokens made before companies existed: those belong to the
   * first company (the default one).
   */
  async verify(token: string | undefined): Promise<{ userId: string; sessionId: string; companyId: string | null } | null> {
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ["HS256"] });
      if (!payload.sub || typeof payload.sid !== "string" || payload.typ) return null;
      return { userId: payload.sub, sessionId: payload.sid, companyId: typeof payload.cid === "string" ? payload.cid : null };
    } catch {
      return null;
    }
  }

  /**
   * A short-lived signed token for one purpose (a set-password link, a platform
   * admin opening a company, the platform session): never accepted as a sign-in token.
   */
  signPurpose(typ: string, claims: Record<string, string>, expires: string): Promise<string> {
    return new SignJWT({ ...claims, typ }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(expires).sign(this.key);
  }

  async verifyPurpose(typ: string, token: string | undefined): Promise<Record<string, unknown> | null> {
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ["HS256"] });
      return payload.typ === typ ? (payload as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
}

/** The same cookie attributes wherever it is set or refreshed. */
export const sessionCookieOptions = () => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.COOKIE_SECURE === "true",
  path: "/",
  maxAge: SESSION_TTL_SECONDS * 1000,
});

/** The token from "Authorization: Bearer …" (mobile, server-to-server) or the session cookie (browser). */
export function tokenFrom(headers: Record<string, string | string[] | undefined>): string | undefined {
  const auth = headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) return auth.slice(7).trim() || undefined;
  const cookie = typeof headers.cookie === "string" ? headers.cookie : "";
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return undefined; // a mangled cookie is simply "not signed in"
      }
    }
  }
  return undefined;
}
