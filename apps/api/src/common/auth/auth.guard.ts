import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { can, type Permission } from "@kebo/shared";
import { ForbiddenError } from "@kebo/utils";
import { PrismaService } from "../../database/prisma.service";
import { IS_PUBLIC, PERMISSIONS } from "./decorators";
import { SESSION_TTL_SECONDS, TokensService, tokenFrom } from "./tokens.service";
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
    const claims = await this.tokens.verify(tokenFrom(req.headers));
    if (!claims) throw new UnauthorizedException("Please sign in.");

    const session = await this.prisma.db.session.findUnique({ where: { id: claims.sessionId }, include: { user: true } });
    const now = Date.now();
    if (
      !session ||
      session.userId !== claims.userId ||
      session.revokedAt ||
      session.pendingTwoStep ||
      session.expiresAt.getTime() < now ||
      !session.user.isActive ||
      session.user.isSystem
    ) {
      throw new UnauthorizedException("Your session has ended. Please sign in again.");
    }
    if (now - session.lastSeenAt.getTime() > SLIDE_EVERY_MS) {
      await this.prisma.db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(now), expiresAt: new Date(now + SESSION_TTL_SECONDS * 1000) } });
    }
    const user: SessionUser = { id: session.user.id, name: session.user.name, email: session.user.email, role: session.user.role, sessionId: session.id };
    req.user = user;

    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS, targets) ?? [];
    const missing = required.filter((p) => !can(user.role, p));
    if (missing.length) throw new ForbiddenError();
    return true;
  }
}
