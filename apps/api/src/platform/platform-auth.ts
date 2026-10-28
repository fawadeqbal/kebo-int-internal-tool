import {
  applyDecorators,
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { DomainError, ForbiddenError } from "@kebo/utils";
import { ENV, type Env } from "../config/env";
import { PrismaService } from "../database/prisma.service";
import { Public } from "../common/auth/decorators";
import { TokensService } from "../common/auth/tokens.service";
import { consumeRecoveryCode, newRecoveryCodes, newTotpSecret, openSecret, otpauthUrl, sealSecret, verifyTotp } from "../common/auth/totp";

export const PLATFORM_COOKIE = "kebo_platform";
const SESSION_DAYS = 14;
const LOCK_MINUTES = 15;
const MAX_FAILED = 8;
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password-placeholder", 12);

export interface PlatformAdminUser {
  id: string;
  name: string;
  email: string;
  sessionId: string;
  twoStepOn: boolean;
}

/** The platform token: from "Authorization: Bearer …" (the web app sends it) or the platform cookie. */
function platformToken(headers: Record<string, string | string[] | undefined>): string | undefined {
  const auth = headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) return auth.slice(7).trim() || undefined;
  const cookie = typeof headers.cookie === "string" ? headers.cookie : "";
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === PLATFORM_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

/**
 * Platform admins sign in on their own (not into any company), with a password
 * and an authenticator code. Two-step sign-in is required: until it is set up,
 * only setting it up works.
 */
@Injectable()
export class PlatformAuthService {
  private readonly attempts = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private limitIp(ip: string) {
    const now = Date.now();
    if (this.attempts.size > 10_000) this.attempts.clear();
    const e = this.attempts.get(ip);
    if (!e || e.resetAt < now) return void this.attempts.set(ip, { count: 1, resetAt: now + 15 * 60_000 });
    if (++e.count > 15) throw new HttpException({ message: "Too many sign-in attempts. Try again in a few minutes." }, HttpStatus.TOO_MANY_REQUESTS);
  }

  async login(email: string, password: string, meta: { ip: string; userAgent?: string }) {
    this.limitIp(meta.ip);
    const db = this.prisma.platform;
    const admin = await db.platformAdmin.findUnique({ where: { email: email.trim().toLowerCase() } });
    const ok = await bcrypt.compare(password, admin?.passwordHash ?? DUMMY_HASH).catch(() => false);
    const wrong = new HttpException({ message: "Wrong email or password." }, HttpStatus.UNAUTHORIZED);
    if (!admin || !admin.isActive) throw wrong;
    if (admin.lockedUntil && admin.lockedUntil > new Date()) throw new HttpException({ message: "Too many wrong attempts. Locked for a few minutes." }, HttpStatus.TOO_MANY_REQUESTS);
    if (!ok) {
      await this.failure(admin.id, admin.failedLogins);
      throw wrong;
    }
    const twoStep = !!admin.totpEnabledAt;
    const session = await db.platformSession.create({
      data: {
        adminId: admin.id,
        expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000),
        pendingTwoStep: twoStep,
        ip: meta.ip.slice(0, 64),
        userAgent: meta.userAgent?.slice(0, 300),
      },
    });
    await db.platformAdmin.update({ where: { id: admin.id }, data: { failedLogins: 0, lockedUntil: null, ...(twoStep ? {} : { lastLoginAt: new Date() }) } });
    if (!twoStep) await this.log(admin, "sign_in", `Signed in from ${meta.ip} (two-step sign-in still to set up)`);
    const token = await this.tokens.signPurpose("platform_session", { aid: admin.id, sid: session.id }, `${SESSION_DAYS}d`);
    return { token, expiresInSeconds: SESSION_DAYS * 86_400, twoStepRequired: twoStep, twoStepSetupRequired: !twoStep };
  }

  private async failure(id: string, failed: number) {
    const lock = failed + 1 >= MAX_FAILED;
    await this.prisma.platform.platformAdmin.update({
      where: { id },
      data: { failedLogins: lock ? 0 : failed + 1, ...(lock ? { lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) } : {}) },
    });
  }

  async completeTwoStep(token: string | undefined, code: string, ip: string) {
    this.limitIp(ip);
    const claims = await this.tokens.verifyPurpose("platform_session", token);
    const db = this.prisma.platform;
    const session = claims && (await db.platformSession.findUnique({ where: { id: String(claims.sid) }, include: { admin: true } }));
    if (!session || !session.pendingTwoStep || session.revokedAt || session.expiresAt < new Date() || session.adminId !== claims.aid) {
      throw new HttpException({ message: "Sign in with your password again." }, HttpStatus.UNAUTHORIZED);
    }
    const a = session.admin;
    if (a.lockedUntil && a.lockedUntil > new Date()) throw new HttpException({ message: "Too many wrong attempts. Locked for a few minutes." }, HttpStatus.TOO_MANY_REQUESTS);
    const step = a.totpSecret ? verifyTotp(openSecret(a.totpSecret, this.env.AUTH_SECRET), code, a.totpLastStep) : null;
    let detail = "with a two-step code";
    if (step !== null) {
      const won = await db.platformAdmin.updateMany({ where: { id: a.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] }, data: { totpLastStep: step } });
      if (won.count !== 1) throw new HttpException({ message: "That code was just used. Wait for the next one." }, HttpStatus.UNAUTHORIZED);
    } else {
      const left = consumeRecoveryCode(a.recoveryCodes, code);
      if (!left) {
        await this.failure(a.id, a.failedLogins);
        throw new HttpException({ message: "That code is not right. Enter the newest code from your app." }, HttpStatus.UNAUTHORIZED);
      }
      await db.platformAdmin.update({ where: { id: a.id }, data: { recoveryCodes: left } });
      detail = `with a recovery code, ${left.length} left`;
    }
    await db.platformSession.update({ where: { id: session.id }, data: { pendingTwoStep: false } });
    await db.platformAdmin.update({ where: { id: a.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
    await this.log(a, "sign_in", `Signed in from ${ip} ${detail}`);
    return { ok: true };
  }

  /** Who is calling (the guard): a live session of an active admin. */
  async authenticate(token: string | undefined): Promise<PlatformAdminUser | null> {
    const claims = await this.tokens.verifyPurpose("platform_session", token);
    if (!claims) return null;
    const session = await this.prisma.platform.platformSession.findUnique({ where: { id: String(claims.sid) }, include: { admin: true } });
    if (!session || session.adminId !== claims.aid || session.revokedAt || session.pendingTwoStep || session.expiresAt < new Date() || !session.admin.isActive) return null;
    if (Date.now() - session.lastSeenAt.getTime() > 3_600_000) {
      await this.prisma.platform.platformSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
    }
    return { id: session.admin.id, name: session.admin.name, email: session.admin.email, sessionId: session.id, twoStepOn: !!session.admin.totpEnabledAt };
  }

  async logout(admin: PlatformAdminUser) {
    await this.prisma.platform.platformSession.update({ where: { id: admin.sessionId }, data: { revokedAt: new Date() } });
  }

  async startTwoStep(admin: PlatformAdminUser) {
    if (admin.twoStepOn) throw new DomainError("Two-step sign-in is already on.");
    const secret = newTotpSecret();
    await this.prisma.platform.platformAdmin.update({ where: { id: admin.id }, data: { totpSecret: sealSecret(secret, this.env.AUTH_SECRET), totpLastStep: null } });
    return { secret, otpauthUrl: otpauthUrl("RFQ Desk platform", admin.email, secret) };
  }

  async confirmTwoStep(admin: PlatformAdminUser, code: string) {
    const a = await this.prisma.platform.platformAdmin.findUniqueOrThrow({ where: { id: admin.id } });
    if (a.totpEnabledAt) throw new DomainError("Two-step sign-in is already on.");
    if (!a.totpSecret) throw new DomainError("Start the setup again.");
    const step = verifyTotp(openSecret(a.totpSecret, this.env.AUTH_SECRET), code, null);
    if (step === null) throw new DomainError("That code is not right. Check your phone's time is set automatically and enter the newest code.");
    const { codes, hashes } = newRecoveryCodes();
    await this.prisma.platform.platformAdmin.update({ where: { id: a.id }, data: { totpEnabledAt: new Date(), totpLastStep: step, recoveryCodes: hashes, lastLoginAt: new Date() } });
    await this.log(a, "two_step_on", "Turned on two-step sign-in");
    return { recoveryCodes: codes };
  }

  async changePassword(admin: PlatformAdminUser, current: string, next: string) {
    const a = await this.prisma.platform.platformAdmin.findUniqueOrThrow({ where: { id: admin.id } });
    if (!(await bcrypt.compare(current, a.passwordHash))) throw new DomainError("Your current password is not right.");
    await this.prisma.platform.platformAdmin.update({ where: { id: a.id }, data: { passwordHash: await bcrypt.hash(next, 12) } });
    await this.prisma.platform.platformSession.updateMany({ where: { adminId: a.id, id: { not: admin.sessionId }, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.log(a, "password_change", "Changed own password (signed out elsewhere)");
  }

  /** A link to set the password (new platform admins; made by the command line tool). */
  async passwordLink(adminId: string) {
    const a = await this.prisma.platform.platformAdmin.findUniqueOrThrow({ where: { id: adminId } });
    const token = await this.tokens.signPurpose("platform_password", { aid: a.id, pw: fingerprint(a.passwordHash) }, "2d");
    return `${this.env.APP_URL.replace(/\/$/, "")}/platform/set-password?token=${encodeURIComponent(token)}`;
  }

  async setPassword(token: string, password: string) {
    const claims = await this.tokens.verifyPurpose("platform_password", token);
    const a = claims && (await this.prisma.platform.platformAdmin.findUnique({ where: { id: String(claims.aid) } }));
    if (!a || claims.pw !== fingerprint(a.passwordHash)) throw new DomainError("This link has expired or was already used. Ask for a new one.");
    await this.prisma.platform.platformAdmin.update({ where: { id: a.id }, data: { passwordHash: await bcrypt.hash(password, 12), failedLogins: 0, lockedUntil: null } });
    await this.prisma.platform.platformSession.updateMany({ where: { adminId: a.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.log(a, "password_set", "Set a password with a link");
    return { email: a.email };
  }

  private log(a: { id: string; name: string }, action: string, summary: string) {
    return this.prisma.platform.platformLog.create({ data: { adminId: a.id, adminName: a.name, action, summary } });
  }
}

/** Changes whenever the password does: a set-password link works once. */
export const fingerprint = (hash: string) => createHash("sha256").update(hash).digest("hex").slice(0, 16);

/** Platform routes: a signed-in platform admin with two-step sign-in on (setup routes allow it off). */
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(private readonly auth: PlatformAuthService) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const admin = await this.auth.authenticate(platformToken(req.headers));
    if (!admin) throw new UnauthorizedException("Please sign in.");
    const setup = Reflect.getMetadata("platform:setup", ctx.getHandler()) === true;
    if (!admin.twoStepOn && !setup) throw new ForbiddenError("Set up two-step sign-in to carry on.", "two_step_setup");
    req.platformAdmin = admin;
    return true;
  }
}

/** A platform route (not tied to a company, no company session needed). */
export const PlatformRoute = () => applyDecorators(Public(), UseGuards(PlatformGuard));
/** Open before two-step sign-in is set up. */
export const PlatformSetupAllowed = () => (target: object, key: string | symbol, descriptor: PropertyDescriptor) => {
  Reflect.defineMetadata("platform:setup", true, descriptor.value);
  return descriptor;
};
export const CurrentAdmin = createParamDecorator((_: unknown, ctx: ExecutionContext): PlatformAdminUser => ctx.switchToHttp().getRequest().platformAdmin);
export { platformToken };
