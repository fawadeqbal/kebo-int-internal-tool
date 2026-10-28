import { Inject, Injectable } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { can, PERMISSION_GROUPS, permissionsInPlan, PRESET_ROLES } from "@kebo/shared";
import { ConflictError, DomainError, ForbiddenError, NotFoundError } from "@kebo/utils";
import { PrismaService, type Tx } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { ENV, type Env } from "../../config/env";
import { LimitsService } from "../../common/company/limits.service";
import { CompanyContext } from "../../common/company/company-context";
import { consumeRecoveryCode, newRecoveryCodes, newTotpSecret, openSecret, otpauthUrl, sealSecret, verifyTotp } from "../../common/auth/totp";
import type { SessionUser } from "../../common/auth/session-user";

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;

/** At least 10 characters with a letter and a digit (long passphrases welcome). */
export const passwordRule = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(200)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), "Use letters and at least one number");

export const userInput = z.object({
  name: z.string().trim().min(1, "Enter a name").max(120),
  email: z.email("Enter a valid email").trim().toLowerCase(),
  /** The role's key (Security → Roles). */
  role: z.string().trim().min(1, "Choose a role").max(40),
});
export const newUserInput = userInput.extend({ password: passwordRule });
export const passwordChangeInput = z.object({ current: z.string().min(1, "Enter your current password"), next: passwordRule });
export const codeInput = z.object({ code: z.string().trim().min(6, "Enter the code").max(20) });

const publicUser = {
  id: true,
  name: true,
  email: true,
  role: true,
  access: { select: { name: true, superAdmin: true, requireTwoStep: true } },
  isActive: true,
  lastLoginAt: true,
  totpEnabledAt: true,
  createdAt: true,
} as const;

const LABEL = new Map(PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => [i.permission, i.label] as const)));

/**
 * People and their sign-in: admin management, own password, and two-step
 * sign-in with an authenticator app (secret encrypted at rest, one-time
 * recovery codes stored only as hashes, codes never accepted twice).
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
    private readonly limits: LimitsService,
  ) {}

  /* ---------------------------------------------------------------- shared with sign-in */

  /** One atomic statement: parallel failures all count, and a failure never lifts a lock. */
  async registerFailure(userId: string) {
    // The lock's end is worked out here and sent like any date the app writes: the database's now()
    // would be read back shifted by its TimeZone (the Prisma adapter reads timestamps in it), which
    // made a 15-minute lock last hours on a server set to Asia/Shanghai.
    const until = new Date(Date.now() + LOCK_MINUTES * 60_000);
    await this.prisma.db.$executeRaw`
      update users set
        failed_logins = case when failed_logins + 1 >= ${MAX_FAILED_LOGINS} then 0 else failed_logins + 1 end,
        locked_until = case when failed_logins + 1 >= ${MAX_FAILED_LOGINS} then ${until} else locked_until end
      where id = ${userId}::uuid`;
  }

  async revokeSessions(tx: Tx, userId: string, exceptSessionId?: string) {
    await tx.session.updateMany({ where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) }, data: { revokedAt: new Date() } });
  }

  /* ---------------------------------------------------------------- admin */

  list() {
    return this.prisma.db.user.findMany({ where: { isSystem: false, platformAdminId: null }, select: publicUser, orderBy: [{ isActive: "desc" }, { name: "asc" }] });
  }

  /** Active people, for "assign to" pickers (anyone signed in may see names). */
  people() {
    return this.prisma.db.user.findMany({ where: { isSystem: false, platformAdminId: null, isActive: true }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } });
  }

  /**
   * A role the person may hand out, take away, or whose people they may manage:
   * it allows nothing their own role does not (so People cannot be used to get
   * round Security). Only a Super Admin gives the Super Admin role or manages a Super Admin.
   */
  private async within(actor: SessionUser, key: string, doing: (roleName: string) => string) {
    const [role, mine] = await Promise.all([
      this.prisma.db.role.findFirst({ where: { key } }),
      this.prisma.db.role.findFirst({ where: { key: actor.role } }),
    ]);
    if (!role) throw new DomainError("That role no longer exists. Reload and choose another.");
    if (mine?.superAdmin) return role;
    if (role.superAdmin) throw new ForbiddenError(`Only a Super Admin can ${doing(role.name)}.`);
    // Counting only what the company's plan includes: nobody has the rest.
    const more = permissionsInPlan(role, await this.limits.features()).filter((p) => !actor.permissions.includes(p));
    if (more.length)
      throw new ForbiddenError(
        `You cannot ${doing(role.name)}: that role allows more than yours (${more.map((p) => LABEL.get(p) ?? p).join(", ")}).`,
      );
    return role;
  }

  private async checkAssignable(actor: SessionUser, key: string) {
    // Roles of the company's own making are a plan feature: without it only the ready-made ones can be given.
    if (!Object.hasOwn(PRESET_ROLES, key)) await this.limits.require("custom_roles");
    return this.within(actor, key, (name) => `give the ${name} role`);
  }

  /** At least one active Super Admin stays. */
  private async keepASuperAdmin(userId: string) {
    const others = await this.prisma.db.user.count({
      where: { access: { superAdmin: true }, isActive: true, isSystem: false, platformAdminId: null, id: { not: userId } },
    });
    if (others === 0) throw new DomainError("Keep at least one active Super Admin.");
  }

  async create(actor: SessionUser, input: z.infer<typeof newUserInput>) {
    if (await this.prisma.db.user.findFirst({ where: { email: input.email } })) throw new ConflictError("Someone already uses this email.");
    const role = await this.checkAssignable(actor, input.role);
    await this.limits.checkPeople(1);
    return this.prisma.tx(async (tx) => {
      const user = await tx.user.create({
        data: { name: input.name, email: input.email, role: input.role, passwordHash: await bcrypt.hash(input.password, 12) },
        select: publicUser,
      });
      await this.audit.record(tx, {
        userId: actor.id,
        action: "create",
        entityType: "user",
        entityId: user.id,
        summary: `Added ${role.name} ${input.email}`,
      });
      return user;
    });
  }

  /** Someone the actor may manage: not a system account, and in a role within the actor's own. */
  private async managed(actor: SessionUser, id: string) {
    const user = await this.prisma.db.user.findFirst({ where: { id, isSystem: false, platformAdminId: null } });
    if (!user) throw new NotFoundError("User");
    if (user.id !== actor.id) await this.within(actor, user.role, (name) => `change the account of someone with the ${name} role`);
    return user;
  }

  async update(actor: SessionUser, id: string, input: z.infer<typeof userInput>) {
    const user = await this.managed(actor, id);
    if (actor.id === id && input.role !== user.role) throw new DomainError("You cannot change your own role.");
    if (input.role !== user.role) {
      const next = await this.checkAssignable(actor, input.role);
      const was = await this.prisma.db.role.findFirstOrThrow({ where: { key: user.role } });
      if (was.superAdmin && !next.superAdmin && user.isActive) await this.keepASuperAdmin(id);
    }
    const clash = await this.prisma.db.user.findFirst({ where: { email: input.email, id: { not: id } } });
    if (clash) throw new ConflictError("Someone already uses this email.");
    return this.prisma.tx(async (tx) => {
      const updated = await tx.user.update({ where: { id }, data: input, select: publicUser });
      // A role change takes effect at once: sessions carry no role, but end them so screens reload with the new rights.
      if (input.role !== user.role) await this.revokeSessions(tx, id);
      await this.audit.record(tx, {
        userId: actor.id,
        action: "update",
        entityType: "user",
        entityId: id,
        summary: `Edited ${user.email}`,
        oldValues: { name: user.name, email: user.email, role: user.role },
        newValues: input,
      });
      return updated;
    });
  }

  async setActive(actor: SessionUser, id: string, active: boolean) {
    if (actor.id === id) throw new DomainError("You cannot switch off your own account.");
    const user = await this.managed(actor, id);
    if (!active && (await this.prisma.db.role.findFirst({ where: { key: user.role } }))?.superAdmin) await this.keepASuperAdmin(id);
    if (active && !user.isActive) await this.limits.checkPeople(1);
    await this.prisma.tx(async (tx) => {
      await tx.user.update({ where: { id }, data: { isActive: active } });
      if (!active) await this.revokeSessions(tx, id);
      await this.audit.record(tx, { userId: actor.id, action: active ? "activate" : "deactivate", entityType: "user", entityId: id, summary: `${active ? "Switched on" : "Switched off"} ${user.email}` });
    });
  }

  async resetPassword(actor: SessionUser, id: string, password: string) {
    const user = await this.managed(actor, id);
    await this.prisma.tx(async (tx) => {
      await tx.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(password, 12), failedLogins: 0, lockedUntil: null } });
      await this.revokeSessions(tx, id);
      await this.audit.record(tx, { userId: actor.id, action: "password_reset", entityType: "user", entityId: id, summary: `Set a new password for ${user.email} (signed out everywhere)` });
    });
  }

  /** When someone lost their phone and recovery codes. Signs them out everywhere. */
  async resetTwoStep(actor: SessionUser, id: string) {
    if (!can(actor, "users.manage")) throw new ForbiddenError();
    if (actor.id === id) throw new DomainError("Use My account to change your own two-step sign-in.");
    const user = await this.managed(actor, id);
    await this.prisma.tx(async (tx) => {
      await tx.user.update({ where: { id }, data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: [] } });
      await this.revokeSessions(tx, id);
      await this.audit.record(tx, { userId: actor.id, action: "two_step_reset", entityType: "user", entityId: id, summary: `Reset two-step sign-in for ${user.email}` });
    });
  }

  /* ---------------------------------------------------------------- my account */

  async changeOwnPassword(actor: SessionUser, input: z.infer<typeof passwordChangeInput>) {
    const user = await this.prisma.db.user.findUniqueOrThrow({ where: { id: actor.id } });
    if (!(await bcrypt.compare(input.current, user.passwordHash))) throw new DomainError("Your current password is not right.");
    await this.prisma.tx(async (tx) => {
      await tx.user.update({ where: { id: actor.id }, data: { passwordHash: await bcrypt.hash(input.next, 12) } });
      // Every other device signs in again; this one stays signed in.
      await this.revokeSessions(tx, actor.id, actor.sessionId);
      await this.audit.record(tx, { userId: actor.id, action: "password_change", entityType: "user", entityId: actor.id, summary: "Changed own password" });
    });
  }

  async twoStepStatus(actor: SessionUser) {
    const u = await this.prisma.db.user.findUniqueOrThrow({ where: { id: actor.id }, include: { access: true } });
    return {
      on: !!u.totpEnabledAt,
      since: u.totpEnabledAt,
      recoveryCodesLeft: u.recoveryCodes.length,
      /** Their role needs it: it cannot be turned off. */
      required: u.access.requireTwoStep,
      roleName: u.access.name,
    };
  }

  /** Start (or restart) setup: a new secret, shown as a QR link until confirmed. */
  async startTwoStep(actor: SessionUser) {
    const u = await this.prisma.db.user.findUniqueOrThrow({ where: { id: actor.id } });
    if (u.totpEnabledAt) throw new DomainError("Two-step sign-in is already on.");
    const secret = newTotpSecret();
    await this.prisma.db.user.update({ where: { id: actor.id }, data: { totpSecret: sealSecret(secret, this.env.AUTH_SECRET), totpLastStep: null } });
    return { secret, otpauthUrl: otpauthUrl(`RFQ Desk (${CompanyContext.require().name})`, u.email, secret) };
  }

  /** The first code from the app turns it on; returns the recovery codes (shown once). */
  async confirmTwoStep(actor: SessionUser, code: string) {
    const u = await this.prisma.db.user.findUniqueOrThrow({ where: { id: actor.id } });
    if (u.totpEnabledAt) throw new DomainError("Two-step sign-in is already on.");
    if (!u.totpSecret) throw new DomainError("Start the setup again.");
    const step = verifyTotp(openSecret(u.totpSecret, this.env.AUTH_SECRET), code, null);
    if (step === null) throw new DomainError("That code is not right. Check your phone's time is set automatically and enter the newest code.");
    const { codes, hashes } = newRecoveryCodes();
    await this.prisma.tx(async (tx) => {
      await tx.user.update({ where: { id: actor.id }, data: { totpEnabledAt: new Date(), totpLastStep: step, recoveryCodes: hashes } });
      await this.audit.record(tx, { userId: actor.id, action: "two_step_on", entityType: "user", entityId: actor.id, summary: "Turned on two-step sign-in" });
    });
    return { recoveryCodes: codes };
  }

  /** Check the person's current code before changing their two-step settings. */
  private async checkOwnCode(userId: string, code: string) {
    const u = await this.prisma.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (!u.totpEnabledAt || !u.totpSecret) throw new DomainError("Two-step sign-in is not on.");
    const step = verifyTotp(openSecret(u.totpSecret, this.env.AUTH_SECRET), code, u.totpLastStep);
    if (step === null) throw new DomainError("That code is not right. Enter the newest code from your app.");
    await this.prisma.db.user.update({ where: { id: userId }, data: { totpLastStep: step } });
  }

  async newRecoveryCodes(actor: SessionUser, code: string) {
    await this.checkOwnCode(actor.id, code);
    const { codes, hashes } = newRecoveryCodes();
    await this.prisma.tx(async (tx) => {
      await tx.user.update({ where: { id: actor.id }, data: { recoveryCodes: hashes } });
      await this.audit.record(tx, { userId: actor.id, action: "two_step_codes", entityType: "user", entityId: actor.id, summary: "Made new recovery codes" });
    });
    return { recoveryCodes: codes };
  }

  async turnOffTwoStep(actor: SessionUser, code: string) {
    const role = await this.prisma.db.role.findFirstOrThrow({ where: { key: actor.role } });
    if (role.requireTwoStep) throw new DomainError(`Your role (${role.name}) needs two-step sign-in, so it stays on.`);
    await this.checkOwnCode(actor.id, code);
    await this.prisma.tx(async (tx) => {
      await tx.user.update({ where: { id: actor.id }, data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: [] } });
      await this.audit.record(tx, { userId: actor.id, action: "two_step_off", entityType: "user", entityId: actor.id, summary: "Turned off two-step sign-in" });
    });
  }

  /**
   * The second step at sign-in: an app code or one recovery code. Wrong codes
   * count towards the same lock as wrong passwords.
   */
  async verifySecondStep(userId: string, code: string): Promise<{ ok: true; usedRecovery: boolean; recoveryLeft: number } | { ok: false; locked: boolean }> {
    const u = await this.prisma.db.user.findUnique({ where: { id: userId } });
    if (!u || !u.isActive || !u.totpEnabledAt || !u.totpSecret) return { ok: false, locked: false };
    if (u.lockedUntil && u.lockedUntil > new Date()) return { ok: false, locked: true };
    const step = verifyTotp(openSecret(u.totpSecret, this.env.AUTH_SECRET), code, u.totpLastStep);
    if (step !== null) {
      // Conditional update: the same code cannot be used by two requests at once.
      const won = await this.prisma.db.user.updateMany({
        where: { id: userId, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
        data: { totpLastStep: step, failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
      });
      if (won.count === 1) return { ok: true, usedRecovery: false, recoveryLeft: u.recoveryCodes.length };
    }
    const left = consumeRecoveryCode(u.recoveryCodes, code);
    if (left) {
      const won = await this.prisma.db.user.updateMany({
        where: { id: userId, recoveryCodes: { equals: u.recoveryCodes } },
        data: { recoveryCodes: left, failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
      });
      if (won.count === 1) return { ok: true, usedRecovery: true, recoveryLeft: left.length };
    }
    await this.registerFailure(userId);
    return { ok: false, locked: false };
  }
}
