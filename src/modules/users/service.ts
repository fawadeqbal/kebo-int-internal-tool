import { and, count, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { dummyHash, hashPassword, verifyPassword } from "@/lib/auth/password";
import { assertCan, currentSessionId, revokeUserSessions, type SessionUser } from "@/lib/auth/session";
import { DomainError, NotFoundError } from "@/lib/utils/result";
import { diff, recordAudit } from "@/modules/audit/service";
import { findUserByEmailWithHash, findUserById } from "./repository";
import type { z } from "zod";
import type { createUserSchema, updateUserSchema } from "./schema";

export async function authenticate(email: string, password: string) {
  const user = await findUserByEmailWithHash(email);
  // Always run a hash comparison so response time does not reveal whether the email exists.
  const ok = await verifyPassword(password, user?.passwordHash ?? dummyHash());
  if (!user || !ok || !user.isActive) return null;
  await db.transaction(async (tx) => {
    await tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    await recordAudit(tx, { userId: user.id, action: "login", entityType: "user", entityId: user.id, summary: "Signed in" });
  });
  return user;
}

async function emailTaken(email: string, exceptId?: string) {
  const [row] = await db
    .select({ n: count() })
    .from(users)
    .where(exceptId ? and(eq(users.email, email), ne(users.id, exceptId)) : eq(users.email, email));
  return (row?.n ?? 0) > 0;
}

export async function createUser(actor: SessionUser, input: z.infer<typeof createUserSchema>) {
  assertCan(actor, "users.manage");
  if (await emailTaken(input.email)) throw new DomainError("A user with this email already exists.");
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(users)
      .values({ name: input.name, email: input.email, role: input.role, passwordHash })
      .returning({ id: users.id });
    await recordAudit(tx, {
      userId: actor.id,
      action: "create",
      entityType: "user",
      entityId: created.id,
      summary: `Created user ${input.email} (${input.role})`,
      newValues: { name: input.name, email: input.email, role: input.role },
    });
    return created;
  });
}

async function countActiveAdmins(exceptId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.isActive, true), ne(users.id, exceptId)));
  return row?.n ?? 0;
}

export async function updateUser(actor: SessionUser, id: string, input: z.infer<typeof updateUserSchema>) {
  assertCan(actor, "users.manage");
  const existing = await findUserById(id);
  if (!existing) throw new NotFoundError("User");
  if (await emailTaken(input.email, id)) throw new DomainError("Another user already uses this email.");
  if (existing.role === "admin" && input.role !== "admin" && (await countActiveAdmins(id)) === 0)
    throw new DomainError("At least one active Super Admin is required.");
  const changes = diff(existing, input);
  await db.transaction(async (tx) => {
    await tx.update(users).set(input).where(eq(users.id, id));
    if (changes.changed)
      await recordAudit(tx, { userId: actor.id, action: "update", entityType: "user", entityId: id, summary: `Updated user ${input.email}`, ...changes });
  });
}

export async function setUserActive(actor: SessionUser, id: string, isActive: boolean) {
  assertCan(actor, "users.manage");
  if (actor.id === id && !isActive) throw new DomainError("You cannot deactivate your own account.");
  const existing = await findUserById(id);
  if (!existing) throw new NotFoundError("User");
  if (!isActive && existing.role === "admin" && (await countActiveAdmins(id)) === 0)
    throw new DomainError("At least one active Super Admin is required.");
  await db.transaction(async (tx) => {
    await tx.update(users).set({ isActive }).where(eq(users.id, id));
    if (!isActive) await revokeUserSessions(id, undefined, tx); // signed out everywhere at once
    await recordAudit(tx, {
      userId: actor.id,
      action: isActive ? "activate" : "deactivate",
      entityType: "user",
      entityId: id,
      summary: `${isActive ? "Activated" : "Deactivated"} ${existing.email}`,
    });
  });
}

export async function resetPassword(actor: SessionUser, id: string, password: string) {
  assertCan(actor, "users.manage");
  const existing = await findUserById(id);
  if (!existing) throw new NotFoundError("User");
  const passwordHash = await hashPassword(password);
  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash }).where(eq(users.id, id));
    // The old password may be known to someone else: end that user's sessions (unless it is the admin's own).
    await revokeUserSessions(id, actor.id === id ? ((await currentSessionId()) ?? undefined) : undefined, tx);
    await recordAudit(tx, { userId: actor.id, action: "reset_password", entityType: "user", entityId: id, summary: `Reset password for ${existing.email}` });
  });
}

export async function changeOwnPassword(actor: SessionUser, currentPassword: string, password: string) {
  const user = await findUserByEmailWithHash(actor.email);
  if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) throw new DomainError("Your current password is not correct.");
  const passwordHash = await hashPassword(password);
  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash }).where(eq(users.id, actor.id));
    // Sign out other browsers and devices; this one stays signed in.
    await revokeUserSessions(actor.id, (await currentSessionId()) ?? undefined, tx);
    await recordAudit(tx, { userId: actor.id, action: "change_password", entityType: "user", entityId: actor.id, summary: "Changed own password" });
  });
}
