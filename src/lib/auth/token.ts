import { jwtVerify, SignJWT } from "jose";

/**
 * Signed session cookie. It carries only the user id and the session id; the
 * session row in the database decides whether it is still valid (see
 * session.ts). Kept free of Node-only imports so the proxy can use it.
 */
export const SESSION_COOKIE = "qms_session";
/** Signed in for 30 days of not using the app; every visit pushes this forward. */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
/** How often the cookie is re-issued with a fresh 30 days while in use. */
export const SESSION_RENEW_AFTER_SECONDS = 60 * 60 * 24;

export interface SessionClaims {
  userId: string;
  sessionId: string;
  /** Seconds since epoch when this cookie was issued. */
  issuedAt: number;
}

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) throw new Error("AUTH_SECRET must be set and at least 32 characters long");
  return new TextEncoder().encode(value);
}

export async function signSessionToken(userId: string, sessionId: string): Promise<string> {
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secret());
}

export async function verifySessionToken(token: string | undefined): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (!payload.sub || typeof payload.sid !== "string") return null;
    return { userId: payload.sub, sessionId: payload.sid, issuedAt: payload.iat ?? 0 };
  } catch {
    return null;
  }
}

/** The same cookie attributes everywhere it is set or cleared (a mismatch can leave a stale cookie behind). */
export function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    maxAge,
  };
}
