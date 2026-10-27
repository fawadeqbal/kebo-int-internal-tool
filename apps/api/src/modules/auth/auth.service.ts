import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { permissionsOfRole, type SignInResult } from "@kebo/shared";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { SESSION_MAX_AGE_DAYS, SESSION_TTL_SECONDS, TokensService } from "../../common/auth/tokens.service";
import type { SessionUser } from "../../common/auth/session-user";
import { UsersService } from "../users/users.service";

const IP_LIMIT = 20;
const IP_WINDOW_MS = 15 * 60 * 1000;
/** Sign-in history is kept for a year. */
const HISTORY_DAYS = 365;

/** A real hash checked when the email is unknown, so response time does not reveal which emails exist. */
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password-placeholder", 12);

@Injectable()
export class AuthService {
  /** Per-IP attempts (one API instance; the per-account lock lives in the database). */
  private readonly attempts = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly audit: AuditService,
    private readonly users: UsersService,
  ) {}

  private async limitIp(ip: string, attempt: { email: string; userId?: string | null; userAgent?: string }) {
    const now = Date.now();
    if (this.attempts.size > 20_000) this.attempts.clear();
    const entry = this.attempts.get(ip);
    if (!entry || entry.resetAt < now) {
      this.attempts.set(ip, { count: 1, resetAt: now + IP_WINDOW_MS });
      return;
    }
    entry.count += 1;
    if (entry.count > IP_LIMIT) {
      // Kept once per window, so a flood does not fill the history.
      if (entry.count === IP_LIMIT + 1) await this.record({ ...attempt, ip, result: "too_many" });
      throw new HttpException(
        { message: `Too many sign-in attempts. Try again in ${Math.ceil((entry.resetAt - now) / 60000)} minutes.` },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** One line of the sign-in history. Never stops a sign-in. */
  private async record(a: {
    email: string;
    userId?: string | null;
    ip: string;
    userAgent?: string;
    result: SignInResult;
    detail?: string;
  }) {
    await this.prisma.db.signIn
      .create({
        data: {
          userId: a.userId ?? null,
          email: a.email.trim().toLowerCase().slice(0, 254),
          result: a.result,
          detail: a.detail?.slice(0, 120) ?? null,
          ip: a.ip.slice(0, 64),
          userAgent: a.userAgent?.slice(0, 300) ?? null,
        },
      })
      .catch(() => undefined);
  }

  async login(email: string, password: string, meta: { ip: string; userAgent?: string }) {
    await this.limitIp(meta.ip, { email, userAgent: meta.userAgent });
    const user = await this.prisma.db.user.findUnique({ where: { email: email.trim().toLowerCase() }, include: { access: true } });
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH).catch(() => false);
    const wrong = new HttpException({ message: "Wrong email or password." }, HttpStatus.UNAUTHORIZED);
    const attempt = { email, userId: user && !user.isSystem ? user.id : null, ip: meta.ip, userAgent: meta.userAgent };
    if (!user || user.isSystem) {
      await this.record({ ...attempt, result: "unknown_email" });
      throw wrong;
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.record({ ...attempt, result: "locked" });
      throw new HttpException(
        { message: "Too many wrong passwords. This account is locked for a few minutes." },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (!ok) {
      await this.users.registerFailure(user.id);
      await this.record({ ...attempt, result: "wrong_password" });
      throw wrong;
    }
    if (!user.isActive) {
      await this.record({ ...attempt, result: "switched_off" });
      throw new HttpException({ message: "This account is switched off. Ask an admin." }, HttpStatus.FORBIDDEN);
    }

    const twoStep = !!user.totpEnabledAt;
    const session = await this.prisma.tx(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, ...(twoStep ? {} : { lastLoginAt: new Date() }) } });
      // Tidy this person's finished sessions.
      await tx.session.deleteMany({
        where: {
          userId: user.id,
          OR: [{ expiresAt: { lt: new Date() } }, { createdAt: { lt: new Date(Date.now() - SESSION_MAX_AGE_DAYS * 86_400_000) } }, { revokedAt: { not: null } }],
        },
      });
      const s = await tx.session.create({
        data: {
          userId: user.id,
          expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
          userAgent: meta.userAgent?.slice(0, 300),
          ip: meta.ip.slice(0, 64),
          pendingTwoStep: twoStep,
        },
      });
      await this.audit.record(tx, { userId: user.id, action: "login", entityType: "user", entityId: user.id, summary: `Signed in from ${meta.ip}` });
      return s;
    });
    const setup = user.access.requireTwoStep && !twoStep;
    await this.record({
      ...attempt,
      result: twoStep ? "code_needed" : "signed_in",
      detail: setup ? "(asked to set up two-step sign-in)" : undefined,
    });
    await this.prisma.db.signIn.deleteMany({ where: { at: { lt: new Date(Date.now() - HISTORY_DAYS * 86_400_000) } } });
    const token = await this.tokens.sign(user.id, session.id);
    return {
      token,
      expiresInSeconds: SESSION_TTL_SECONDS,
      /** The authenticator code is still needed (POST /auth/two-step). */
      twoStepRequired: twoStep,
      /** Signed in, but their role needs two-step sign-in: set it up before anything else. */
      twoStepSetupRequired: setup,
      user: twoStep ? null : this.profileOf(user, session.id),
    };
  }

  /**
   * The second sign-in step: the session made by the password is only usable
   * once a correct authenticator (or recovery) code is given.
   */
  async completeTwoStep(token: string | undefined, code: string, meta: { ip: string; userAgent?: string }) {
    const claims = await this.tokens.verify(token);
    const session =
      claims &&
      (await this.prisma.db.session.findUnique({ where: { id: claims.sessionId }, include: { user: { include: { access: true } } } }));
    await this.limitIp(meta.ip, { email: session?.user.email ?? "", userId: session?.userId, userAgent: meta.userAgent });
    if (!session || !session.pendingTwoStep || session.revokedAt || session.expiresAt < new Date() || session.userId !== claims.userId) {
      throw new HttpException({ message: "Sign in with your password again." }, HttpStatus.UNAUTHORIZED);
    }
    const attempt = { email: session.user.email, userId: session.userId, ip: meta.ip, userAgent: meta.userAgent };
    const result = await this.users.verifySecondStep(session.userId, code);
    if (!result.ok) {
      await this.record({ ...attempt, result: result.locked ? "locked" : "wrong_code" });
      throw new HttpException(
        { message: result.locked ? "Too many wrong codes. This account is locked for a few minutes." : "That code is not right. Enter the newest code from your app." },
        result.locked ? HttpStatus.TOO_MANY_REQUESTS : HttpStatus.UNAUTHORIZED,
      );
    }
    await this.prisma.tx(async (tx) => {
      await tx.session.update({ where: { id: session.id }, data: { pendingTwoStep: false } });
      await this.audit.record(tx, {
        userId: session.userId,
        action: "login",
        entityType: "user",
        entityId: session.userId,
        summary: result.usedRecovery ? `Signed in with a recovery code, ${result.recoveryLeft} left` : "Signed in with a two-step code",
      });
    });
    await this.record({
      ...attempt,
      result: "signed_in",
      detail: result.usedRecovery ? `with a recovery code, ${result.recoveryLeft} left` : "with a two-step code",
    });
    return {
      user: this.profileOf(session.user, session.id),
      recoveryCodesLeft: result.recoveryLeft,
      usedRecoveryCode: result.usedRecovery,
    };
  }

  async logout(user: SessionUser) {
    await this.prisma.db.session.update({ where: { id: user.sessionId }, data: { revokedAt: new Date() } });
  }

  /** What the apps know about the signed-in person: who, their role and what they may do. */
  profile(user: SessionUser) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      roleName: user.roleName,
      permissions: user.permissions,
      twoStepSetupRequired: user.twoStepSetupRequired,
    };
  }

  private profileOf(
    u: {
      id: string;
      name: string;
      email: string;
      role: string;
      totpEnabledAt: Date | null;
      access: { name: string; superAdmin: boolean; permissions: string[]; requireTwoStep: boolean };
    },
    sessionId: string,
  ) {
    return this.profile({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      roleName: u.access.name,
      permissions: permissionsOfRole(u.access),
      twoStepSetupRequired: u.access.requireTwoStep && !u.totpEnabledAt,
      sessionId,
    });
  }
}
