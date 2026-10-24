import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt, isNull, lt, ne, or } from "drizzle-orm";
import { db, type DbOrTx } from "@/lib/db";
import { sessions, users, type Role } from "@/lib/db/schema";
import { can, type Permission } from "./permissions";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, sessionCookieOptions, signSessionToken, verifySessionToken } from "./token";
import { ForbiddenError } from "@/lib/utils/result";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

const SLIDE_EVERY_MS = 60 * 60 * 1000; // move the expiry forward at most once an hour
const expiry = () => new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
/** However active a device is, it has to sign in again after this long. */
export const SESSION_MAX_AGE_DAYS = 90;
const maxAgeCutoff = () => new Date(Date.now() - SESSION_MAX_AGE_DAYS * 86400_000);

/** Start a session for this browser after a successful sign-in. */
export async function createSession(userId: string) {
  const userAgent = (await headers()).get("user-agent")?.slice(0, 300) ?? null;
  const [row] = await db.insert(sessions).values({ userId, expiresAt: expiry(), userAgent }).returning({ id: sessions.id });
  // Tidy up this person's finished sessions (signed out, expired or too old).
  await db
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), or(lt(sessions.expiresAt, new Date()), lt(sessions.createdAt, maxAgeCutoff()), lt(sessions.revokedAt, new Date(Date.now() - 7 * 86400_000)))));
  const store = await cookies();
  store.set(SESSION_COOKIE, await signSessionToken(userId, row.id), sessionCookieOptions(SESSION_TTL_SECONDS));
}

/** Sign out this browser: the session ends on the server and the cookie is removed. */
export async function destroySession() {
  const store = await cookies();
  const claims = await verifySessionToken(store.get(SESSION_COOKIE)?.value);
  if (claims) await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, claims.sessionId));
  store.set(SESSION_COOKIE, "", sessionCookieOptions(0));
}

/** End every session of a user (deactivated, or password reset by an admin), optionally keeping one. */
export async function revokeUserSessions(userId: string, exceptSessionId?: string, tx: DbOrTx = db) {
  await tx
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), exceptSessionId ? ne(sessions.id, exceptSessionId) : undefined));
}

/** The id of the current browser's session (to keep it when changing your own password). */
export async function currentSessionId(): Promise<string | null> {
  const claims = await verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  return claims?.sessionId ?? null;
}

/**
 * The signed-in user, re-checked against the database on every request:
 * the session must exist, not be signed out or expired, and the user must be active.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  const claims = await verifySessionToken(store.get(SESSION_COOKIE)?.value);
  if (!claims) return null;
  const [row] = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role, lastSeenAt: sessions.lastSeenAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.id, claims.sessionId),
        eq(sessions.userId, claims.userId),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
        gt(sessions.createdAt, maxAgeCutoff()),
        eq(users.isActive, true),
      ),
    )
    .limit(1);
  if (!row) return null;
  if (Date.now() - row.lastSeenAt.getTime() > SLIDE_EVERY_MS) {
    await db.update(sessions).set({ lastSeenAt: new Date(), expiresAt: expiry() }).where(eq(sessions.id, claims.sessionId));
  }
  return { id: row.id, name: row.name, email: row.email, role: row.role };
});

/**
 * For pages: send signed-out people to the login page. When a cookie is still
 * there but its session has ended (signed out elsewhere, password reset,
 * deactivated), it is cleared first, so the login page doesn't bounce back.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (user) return user;
  const hasCookie = !!(await cookies()).get(SESSION_COOKIE)?.value;
  redirect(hasCookie ? "/api/auth/signed-out" : "/login");
}

/** For pages: show the "not allowed" page when the role lacks a permission. */
export async function requirePagePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user.role, permission)) redirect("/forbidden");
  return user;
}

/** For actions and services: throw when the role lacks a permission. */
export function assertCan(user: SessionUser, permission: Permission) {
  if (!can(user.role, permission)) throw new ForbiddenError();
}
