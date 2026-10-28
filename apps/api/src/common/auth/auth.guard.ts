import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { can, isMobileApp, permissionsOfRole, planFeatureName, type Permission } from "@kebo/shared";
import { ForbiddenError } from "@kebo/utils";
import { PrismaService } from "../../database/prisma.service";
import { CompaniesService } from "../company/companies.service";
import { CompanyContext, type CompanyInfo } from "../company/company-context";
import { COMPANY_HEADER } from "../company/company-resolver";
import { FEATURE, IS_PUBLIC, PERMISSIONS, READ_ONLY_ALLOWED, SETUP_ALLOWED } from "./decorators";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_DAYS,
  SESSION_TTL_SECONDS,
  TokensService,
  sessionCookieOptions,
  tokenFrom,
} from "./tokens.service";
import type { SessionUser } from "./session-user";

const SLIDE_EVERY_MS = 60 * 60 * 1000;
const ACTIVE_EVERY_MS = 10 * 60 * 1000;

/** The company's status refuses this request: switched off, or read-only for a change. */
export function companyRefusal(company: CompanyInfo, method: string, readOnlyAllowed = false): HttpException | null {
  if (company.status === "off" || company.status === "deleted") {
    return new HttpException(
      { message: `${company.name} is switched off${company.statusReason ? ` (${company.statusReason.toLowerCase()})` : ""}. Contact the platform admin.`, code: "company_off" },
      HttpStatus.FORBIDDEN,
    );
  }
  if (company.status === "read_only" && !readOnlyAllowed && !["GET", "HEAD", "OPTIONS"].includes(method)) {
    return new HttpException(
      { message: `${company.name} is read-only${company.statusReason ? ` (${company.statusReason.toLowerCase()})` : ""}: you can look, but not change anything.`, code: "company_read_only" },
      HttpStatus.FORBIDDEN,
    );
  }
  return null;
}

/**
 * Runs before every route (registered globally): finds the session in the
 * request's company, checks it is live and its user active, slides the expiry
 * forward while in use, then checks the company (switched off, read-only, plan
 * features) and the route's permissions. Routes opt out with @Public().
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly activeSeen = new Map<string, number>();

  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
    private readonly prisma: PrismaService,
    private readonly companies: CompaniesService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const token = tokenFrom(req.headers);
    const claims = await this.tokens.verify(token);
    if (!claims) throw new UnauthorizedException("Please sign in.");
    const company = CompanyContext.current();
    // The company the token belongs to is gone; or the token is used at another company's address.
    if (!company || (claims.companyId && claims.companyId !== company.id)) throw new UnauthorizedException("Please sign in.");
    const named = req.headers[COMPANY_HEADER];
    if (typeof named === "string" && named.trim() && named.trim().toLowerCase() !== company.slug) throw new UnauthorizedException("Please sign in.");

    const session = await this.prisma.db.session.findUnique({
      where: { id: claims.sessionId },
      include: { user: { include: { access: true } } },
    });
    const now = Date.now();
    if (
      !session ||
      session.userId !== claims.userId ||
      session.revokedAt ||
      session.pendingTwoStep ||
      session.expiresAt.getTime() < now ||
      session.createdAt.getTime() < now - SESSION_MAX_AGE_DAYS * 86_400_000 ||
      !session.user.isActive ||
      session.user.isSystem
    ) {
      throw new UnauthorizedException("Your session has ended. Please sign in again.");
    }
    // A platform admin's visit: only while they are still an active platform admin.
    if (session.user.platformAdminId) {
      const admin = await this.prisma.platform.platformAdmin.findUnique({ where: { id: session.user.platformAdminId }, select: { isActive: true } });
      if (!admin?.isActive) throw new UnauthorizedException("Your session has ended. Please sign in again.");
    }
    this.markActive(company.id, now, !!session.user.platformAdminId);
    const u = session.user;
    const user: SessionUser = {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      roleName: u.access.name,
      permissions: permissionsOfRole(u.access),
      twoStepSetupRequired: u.access.requireTwoStep && !u.totpEnabledAt && !u.platformAdminId,
      sessionId: session.id,
      companyId: company.id,
      viaPlatform: !!u.platformAdminId,
    };
    req.user = user;

    // Switched off: nothing works. Read-only: looking works, changing does not (the platform admin may still change).
    const refusal = companyRefusal(company, req.method, user.viaPlatform || !!this.reflector.getAllAndOverride<boolean>(READ_ONLY_ALLOWED, targets));
    if (refusal) throw refusal;

    // The role needs two-step sign-in and they have not set it up: only the setup is open to them.
    if (user.twoStepSetupRequired && !this.reflector.getAllAndOverride<boolean>(SETUP_ALLOWED, targets)) {
      throw new ForbiddenError(`Your role (${u.access.name}) needs two-step sign-in. Set it up to carry on.`, "two_step_setup");
    }

    // Plan features: the route's own, and the phone app as a whole (a session the app signed in
    // with, or a request from it). Refused before the session's expiry moves on below.
    const feature = this.reflector.getAllAndOverride<string | undefined>(FEATURE, targets);
    const phone = !user.viaPlatform && (isMobileApp(req.headers["user-agent"]) || isMobileApp(session.userAgent));
    const needed = [feature, phone ? "mobile_app" : undefined].filter((f): f is string => !!f);
    if (needed.length) {
      const plan = await this.companies.plan(company);
      const off = plan ? needed.find((f) => !plan.features.includes(f)) : undefined;
      if (off) throw new ForbiddenError(`Your plan does not include ${planFeatureName(off).toLowerCase()}. Ask the platform admin to switch it on.`, "plan_feature");
    }

    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS, targets) ?? [];
    const missing = required.filter((p) => !can(user, p));
    if (missing.length) throw new ForbiddenError();

    // In use: the session's expiry moves on (not a platform admin's visit, and only for a request that was let through).
    if (!session.user.platformAdminId && now - session.lastSeenAt.getTime() > SLIDE_EVERY_MS) {
      await this.prisma.db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(now), expiresAt: new Date(now + SESSION_TTL_SECONDS * 1000) } });
      // Browsers: push the cookie's own expiry forward too.
      if (!String(req.headers.authorization ?? "").startsWith("Bearer ") && token) {
        ctx.switchToHttp().getResponse().cookie(SESSION_COOKIE, token, sessionCookieOptions());
      }
    }
    return true;
  }

  /** The company's "last active" (platform admin's list), at most every few minutes; the platform admin's own visits do not count. */
  private markActive(companyId: string, now: number, viaPlatform: boolean) {
    if (viaPlatform || now - (this.activeSeen.get(companyId) ?? 0) < ACTIVE_EVERY_MS) return;
    this.activeSeen.set(companyId, now);
    void this.prisma.platform.company.update({ where: { id: companyId }, data: { lastActiveAt: new Date(now) } }).catch(() => undefined);
  }
}
