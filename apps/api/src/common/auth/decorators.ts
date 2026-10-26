import { createParamDecorator, ExecutionContext, SetMetadata } from "@nestjs/common";
import type { Permission } from "@kebo/shared";
import type { SessionUser } from "./session-user";

export const IS_PUBLIC = "auth:public";
export const PERMISSIONS = "auth:permissions";

/** No sign-in needed (health check, login, the website inquiry form). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** The signed-in user must have every listed permission. */
export const RequirePermissions = (...permissions: Permission[]) => SetMetadata(PERMISSIONS, permissions);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): SessionUser => ctx.switchToHttp().getRequest().user);
