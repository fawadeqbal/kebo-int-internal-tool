import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { twoStepRequired } from "@/lib/auth/permissions";
import { assertCan, revokeUserSessions, type SessionUser } from "@/lib/auth/session";
import { newRecoveryCodes, newTotpSecret, openSecret, sealSecret, consumeRecoveryCode, verifyTotp } from "@/lib/auth/totp";
import { DomainError, NotFoundError } from "@/lib/utils/result";
import { recordAudit } from "@/modules/audit/service";
import { LOCK_MINUTES, MAX_FAILED_LOGINS } from "./service";

async function loadTwoStep(userId: string) {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
      totpSecret: users.totpSecret,
      totpEnabledAt: users.totpEnabledAt,
      totpLastStep: users.totpLastStep,
      recoveryCodes: users.recoveryCodes,
      failedLogins: users.failedLogins,
      lockedUntil: users.lockedUntil,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) throw new NotFoundError("User");
  return row;
}

export async function twoStepStatus(userId: string) {
  const u = await loadTwoStep(userId);
  return { on: !!u.totpEnabledAt, since: u.totpEnabledAt, recoveryLeft: u.recoveryCodes?.length ?? 0, required: twoStepRequired(u.role) };
}

/** The secret to show while setting up (made on first visit, kept until confirmed or restarted). */
export async function pendingTwoStepSecret(userId: string, restart = false): Promise<string> {
  const u = await loadTwoStep(userId);
  if (u.totpEnabledAt) throw new DomainError("Two-step sign-in is already on.");
  if (u.totpSecret && !restart) return openSecret(u.totpSecret);
  const secret = newTotpSecret();
  await db.update(users).set({ totpSecret: sealSecret(secret), totpLastStep: null }).where(eq(users.id, userId));
  return secret;
}

/** Turn two-step sign-in on with a first code from the app. Returns the recovery codes (shown once). */
export async function confirmTwoStep(actor: SessionUser, code: string): Promise<string[]> {
  const u = await loadTwoStep(actor.id);
  if (u.totpEnabledAt) throw new DomainError("Two-step sign-in is already on.");
  if (!u.totpSecret) throw new DomainError("Start the setup again.");
  const step = verifyTotp(openSecret(u.totpSecret), code, null);
  if (step === null) throw new DomainError("That code is not right. Check the time on your phone is set automatically, and enter the newest code.");
  const { codes, hashes } = newRecoveryCodes();
  await db.transaction(async (tx) => {
    await tx.update(users).set({ totpEnabledAt: new Date(), totpLastStep: step, recoveryCodes: hashes }).where(eq(users.id, actor.id));
    await recordAudit(tx, { userId: actor.id, action: "two_step_on", entityType: "user", entityId: actor.id, summary: "Turned on two-step sign-in" });
  });
  return codes;
}

export type SecondStepResult = { ok: true; usedRecovery: boolean; recoveryLeft: number } | { ok: false; lockedMinutes?: number };

/**
 * The second step at sign-in: a code from the app, or one recovery code.
 * Wrong codes count towards the same lock as wrong passwords.
 */
export async function verifySecondStep(userId: string, code: string, ip: string): Promise<SecondStepResult> {
  const u = await loadTwoStep(userId);
  const now = new Date();
  if (!u.isActive || !u.totpEnabledAt || !u.totpSecret) return { ok: false };
  if (u.lockedUntil && u.lockedUntil > now) return { ok: false, lockedMinutes: Math.ceil((u.lockedUntil.getTime() - now.getTime()) / 60000) };

  const step = verifyTotp(openSecret(u.totpSecret), code, u.totpLastStep);
  if (step !== null) {
    await db.transaction(async (tx) => {
      await tx.update(users).set({ totpLastStep: step, failedLogins: 0, lockedUntil: null, lastLoginAt: now }).where(eq(users.id, userId));
      await recordAudit(tx, { userId, action: "login", entityType: "user", entityId: userId, summary: `Signed in with two-step code (from ${ip})` });
    });
    return { ok: true, usedRecovery: false, recoveryLeft: u.recoveryCodes?.length ?? 0 };
  }
  const left = consumeRecoveryCode(u.recoveryCodes ?? [], code);
  if (left) {
    await db.transaction(async (tx) => {
      await tx.update(users).set({ recoveryCodes: left, failedLogins: 0, lockedUntil: null, lastLoginAt: now }).where(eq(users.id, userId));
      await recordAudit(tx, { userId, action: "login", entityType: "user", entityId: userId, summary: `Signed in with a recovery code, ${left.length} left (from ${ip})` });
    });
    return { ok: true, usedRecovery: true, recoveryLeft: left.length };
  }

  const fails = u.failedLogins + 1;
  const lock = fails >= MAX_FAILED_LOGINS;
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set(lock ? { failedLogins: 0, lockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60000) } : { failedLogins: fails })
      .where(eq(users.id, userId));
    await recordAudit(tx, {
      userId,
      action: lock ? "locked" : "login_failed",
      entityType: "user",
      entityId: userId,
      summary: lock ? `Sign-in locked for ${LOCK_MINUTES} minutes after wrong two-step codes (from ${ip})` : `Wrong two-step code (from ${ip})`,
    });
  });
  return lock ? { ok: false, lockedMinutes: LOCK_MINUTES } : { ok: false };
}

/** Check the person's own current code before changing their two-step settings. */
async function checkOwnCode(userId: string, code: string) {
  const u = await loadTwoStep(userId);
  if (!u.totpEnabledAt || !u.totpSecret) throw new DomainError("Two-step sign-in is not on.");
  const step = verifyTotp(openSecret(u.totpSecret), code, u.totpLastStep);
  if (step === null) throw new DomainError("That code is not right. Enter the newest code from your app.");
  await db.update(users).set({ totpLastStep: step }).where(eq(users.id, userId));
  return u;
}

export async function regenerateRecoveryCodes(actor: SessionUser, code: string): Promise<string[]> {
  await checkOwnCode(actor.id, code);
  const { codes, hashes } = newRecoveryCodes();
  await db.transaction(async (tx) => {
    await tx.update(users).set({ recoveryCodes: hashes }).where(eq(users.id, actor.id));
    await recordAudit(tx, { userId: actor.id, action: "two_step_codes", entityType: "user", entityId: actor.id, summary: "Made new recovery codes (old ones no longer work)" });
  });
  return codes;
}

/** Turn it off (only where the role does not require it), or start again on a new phone. */
export async function turnOffTwoStep(actor: SessionUser, code: string, mode: "off" | "new_phone") {
  const u = await checkOwnCode(actor.id, code);
  if (mode === "off" && twoStepRequired(u.role)) throw new DomainError("Two-step sign-in is required for your role. Use “Move to a new phone” instead.");
  await db.transaction(async (tx) => {
    await tx.update(users).set({ totpSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: null }).where(eq(users.id, actor.id));
    await recordAudit(tx, {
      userId: actor.id,
      action: "two_step_off",
      entityType: "user",
      entityId: actor.id,
      summary: mode === "off" ? "Turned off two-step sign-in" : "Started two-step sign-in again on a new phone",
    });
  });
}

/** For an administrator when someone lost their phone and recovery codes. Signs them out everywhere. */
export async function adminResetTwoStep(actor: SessionUser, userId: string) {
  assertCan(actor, "users.manage");
  if (actor.id === userId) throw new DomainError("Use My account to change your own two-step sign-in.");
  const u = await loadTwoStep(userId);
  await db.transaction(async (tx) => {
    await tx.update(users).set({ totpSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: null }).where(eq(users.id, userId));
    await revokeUserSessions(userId, undefined, tx);
    await recordAudit(tx, { userId: actor.id, action: "two_step_reset", entityType: "user", entityId: userId, summary: `Reset two-step sign-in for ${u.email}; they set it up again at next sign-in` });
  });
}
