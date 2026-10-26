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

  sign(userId: string, sessionId: string): Promise<string> {
    return new SignJWT({ sid: sessionId })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
      .sign(this.key);
  }

  async verify(token: string | undefined): Promise<{ userId: string; sessionId: string } | null> {
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ["HS256"] });
      return payload.sub && typeof payload.sid === "string" ? { userId: payload.sub, sessionId: payload.sid } : null;
    } catch {
      return null;
    }
  }
}

/** The token from "Authorization: Bearer …" (mobile, server-to-server) or the session cookie (browser). */
export function tokenFrom(headers: Record<string, string | string[] | undefined>): string | undefined {
  const auth = headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) return auth.slice(7).trim() || undefined;
  const cookie = typeof headers.cookie === "string" ? headers.cookie : "";
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}
