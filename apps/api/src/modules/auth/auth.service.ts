import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { permissionsOf } from "@kebo/shared";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { SESSION_MAX_AGE_DAYS, SESSION_TTL_SECONDS, TokensService } from "../../common/auth/tokens.service";
import type { SessionUser } from "../../common/auth/session-user";
import { UsersService } from "../users/users.service";

const IP_LIMIT = 20;
const IP_WINDOW_MS = 15 * 60 * 1000;

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

  private limitIp(ip: string) {
    const now = Date.now();
    if (this.attempts.size > 20_000) this.attempts.clear();
    const entry = this.attempts.get(ip);
    if (!entry || entry.resetAt < now) {
      this.attempts.set(ip, { count: 1, resetAt: now + IP_WINDOW_MS });
      return;
    }
    entry.count += 1;
    if (entry.count > IP_LIMIT) {
      throw new HttpException({ message: `Too many sign-in attempts. Try again in ${Math.ceil((entry.resetAt - now) / 60000)} minutes.` }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  async login(email: string, password: string, meta: { ip: string; userAgent?: string }) {
    this.limitIp(meta.ip);
    const user = await this.prisma.db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH).catch(() => false);
    const wrong = new HttpException({ message: "Wrong email or password." }, HttpStatus.UNAUTHORIZED);
    if (!user || user.isSystem) throw wrong;
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new HttpException({ message: "Too many wrong passwords. This account is locked for a few minutes." }, HttpStatus.TOO_MANY_REQUESTS);
    }
    if (!ok) {
      await this.users.registerFailure(user.id);
      throw wrong;
    }
    if (!user.isActive) throw new HttpException({ message: "This account is switched off. Ask an admin." }, HttpStatus.FORBIDDEN);

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
        data: { userId: user.id, expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000), userAgent: meta.userAgent?.slice(0, 300), pendingTwoStep: twoStep },
      });
      await this.audit.record(tx, { userId: user.id, action: "login", entityType: "user", entityId: user.id, summary: `Signed in from ${meta.ip}` });
      return s;
    });
    const token = await this.tokens.sign(user.id, session.id);
    return {
      token,
      expiresInSeconds: SESSION_TTL_SECONDS,
      /** The authenticator code is still needed (POST /auth/two-step). */
      twoStepRequired: twoStep,
      user: twoStep ? null : this.profile({ id: user.id, name: user.name, email: user.email, role: user.role, sessionId: session.id }),
    };
  }

  /**
   * The second sign-in step: the session made by the password is only usable
   * once a correct authenticator (or recovery) code is given.
   */
  async completeTwoStep(token: string | undefined, code: string, ip: string) {
    this.limitIp(ip);
    const claims = await this.tokens.verify(token);
    const session = claims && (await this.prisma.db.session.findUnique({ where: { id: claims.sessionId }, include: { user: true } }));
    if (!session || !session.pendingTwoStep || session.revokedAt || session.expiresAt < new Date() || session.userId !== claims.userId) {
      throw new HttpException({ message: "Sign in with your password again." }, HttpStatus.UNAUTHORIZED);
    }
    const result = await this.users.verifySecondStep(session.userId, code);
    if (!result.ok) {
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
    const u = session.user;
    return {
      user: this.profile({ id: u.id, name: u.name, email: u.email, role: u.role, sessionId: session.id }),
      recoveryCodesLeft: result.recoveryLeft,
      usedRecoveryCode: result.usedRecovery,
    };
  }

  async logout(user: SessionUser) {
    await this.prisma.db.session.update({ where: { id: user.sessionId }, data: { revokedAt: new Date() } });
  }

  profile(user: SessionUser) {
    return { id: user.id, name: user.name, email: user.email, role: user.role, permissions: permissionsOf(user.role) };
  }
}
