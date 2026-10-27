import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { can, permissionsOfRole, type Permission } from "@kebo/shared";
import { ForbiddenError } from "@kebo/utils";
import { PrismaService } from "../../database/prisma.service";
import { IS_PUBLIC, PERMISSIONS, SETUP_ALLOWED } from "./decorators";
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

/**
 * Runs before every route (registered globally): finds the session, checks it
 * is live and its user active, slides the expiry forward while in use, then
 * checks the route's permissions. Routes opt out with @Public().
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const token = tokenFrom(req.headers);
    const claims = await this.tokens.verify(token);
    if (!claims) throw new UnauthorizedException("Please sign in.");

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
    if (now - session.lastSeenAt.getTime() > SLIDE_EVERY_MS) {
      await this.prisma.db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(now), expiresAt: new Date(now + SESSION_TTL_SECONDS * 1000) } });
      // Browsers: push the cookie's own expiry forward too.
      if (!String(req.headers.authorization ?? "").startsWith("Bearer ") && token) {
        ctx.switchToHttp().getResponse().cookie(SESSION_COOKIE, token, sessionCookieOptions());
      }
    }
    const u = session.user;
    const user: SessionUser = {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      roleName: u.access.name,
      permissions: permissionsOfRole(u.access),
      twoStepSetupRequired: u.access.requireTwoStep && !u.totpEnabledAt,
      sessionId: session.id,
    };
    req.user = user;

    // The role needs two-step sign-in and they have not set it up: only the setup is open to them.
    if (user.twoStepSetupRequired && !this.reflector.getAllAndOverride<boolean>(SETUP_ALLOWED, targets)) {
      throw new ForbiddenError(`Your role (${u.access.name}) needs two-step sign-in. Set it up to carry on.`, "two_step_setup");
    }

    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS, targets) ?? [];
    const missing = required.filter((p) => !can(user, p));
    if (missing.length) throw new ForbiddenError();
    return true;
  }
}
