import { createParamDecorator, ExecutionContext, SetMetadata } from "@nestjs/common";
import type { Permission } from "@kebo/shared";
import type { SessionUser } from "./session-user";

export const IS_PUBLIC = "auth:public";
export const PERMISSIONS = "auth:permissions";
export const SETUP_ALLOWED = "auth:two-step-setup";

/** No sign-in needed (health check, login, the website inquiry form). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Usable by someone whose role needs two-step sign-in before they have set it
 * up (who they are, setting it up, signing out); every other route is closed to them.
 */
export const AllowDuringTwoStepSetup = () => SetMetadata(SETUP_ALLOWED, true);

/** The signed-in user must have every listed permission. */
export const RequirePermissions = (...permissions: Permission[]) => SetMetadata(PERMISSIONS, permissions);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): SessionUser => ctx.switchToHttp().getRequest().user);

export const READ_ONLY_ALLOWED = "company:read-only-allowed";
export const FEATURE = "company:feature";

/** Still works while the company is read-only (signing out, two-step setup, marking notifications read…). */
export const AllowWhenReadOnly = () => SetMetadata(READ_ONLY_ALLOWED, true);

/** Only for companies whose plan includes this feature (@kebo/shared PLAN_FEATURES). */
export const RequireFeature = (feature: string) => SetMetadata(FEATURE, feature);
