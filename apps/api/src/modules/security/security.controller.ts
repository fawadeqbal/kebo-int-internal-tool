import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { bool, listQuery, roleInput, type RoleInput } from "@kebo/shared";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser, RequirePermissions } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { SecurityService } from "./security.service";

const signInQuery = listQuery.extend({ userId: z.uuid().optional(), failed: bool.optional() });
const keyParam = z.string().trim().min(1).max(40);

/** Roles: anyone who manages people sees them (to pick one); only Security changes them. */
@ApiTags("security")
@Controller("roles")
export class RolesController {
  constructor(private readonly security: SecurityService) {}

  @Get()
  list(@CurrentUser() actor: SessionUser) {
    return this.security.roles(actor);
  }

  @Get(":key")
  @RequirePermissions("security.manage")
  one(@CurrentUser() actor: SessionUser, @Param("key", Validate(keyParam)) key: string) {
    return this.security.role(actor, key);
  }

  @Post()
  @RequirePermissions("security.manage")
  create(@CurrentUser() actor: SessionUser, @Body(Validate(roleInput)) body: RoleInput) {
    return this.security.createRole(actor, body);
  }

  @Put(":key")
  @RequirePermissions("security.manage")
  update(@CurrentUser() actor: SessionUser, @Param("key", Validate(keyParam)) key: string, @Body(Validate(roleInput)) body: RoleInput) {
    return this.security.updateRole(actor, key, body);
  }

  @Delete(":key")
  @RequirePermissions("security.manage")
  async remove(@CurrentUser() actor: SessionUser, @Param("key", Validate(keyParam)) key: string) {
    await this.security.deleteRole(actor, key);
    return { ok: true };
  }
}

/** Everyone's signed-in devices and the sign-in history (Super Admin). */
@ApiTags("security")
@Controller("security")
@RequirePermissions("security.manage")
export class SecurityController {
  constructor(private readonly security: SecurityService) {}

  @Get("overview")
  overview() {
    return this.security.overview();
  }

  @Get("sessions")
  sessions(@CurrentUser() actor: SessionUser, @Query(Validate(z.object({ userId: z.uuid().optional() }))) q: { userId?: string }) {
    return this.security.sessions(actor, q.userId);
  }

  @Delete("sessions/:id")
  async end(@CurrentUser() actor: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.security.endSession(actor, id, false);
    return { ok: true };
  }

  /** Sign a person out on every device. */
  @Post("users/:id/sign-out")
  @HttpCode(200)
  endAll(@CurrentUser() actor: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.security.endAll(actor, id);
  }

  @Get("sign-ins")
  signIns(@Query(Validate(signInQuery)) q: z.infer<typeof signInQuery>) {
    return this.security.signIns(q);
  }
}

/** My account: my own signed-in devices and sign-ins. */
@ApiTags("me")
@Controller("me")
export class MySecurityController {
  constructor(private readonly security: SecurityService) {}

  @Get("sessions")
  sessions(@CurrentUser() actor: SessionUser) {
    return this.security.mySessions(actor);
  }

  @Delete("sessions/:id")
  async end(@CurrentUser() actor: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.security.endSession(actor, id, true);
    return { ok: true };
  }

  /** Sign out everywhere but here. */
  @Post("sessions/sign-out-others")
  @HttpCode(200)
  others(@CurrentUser() actor: SessionUser) {
    return this.security.endAll(actor, actor.id);
  }

  @Get("sign-ins")
  signIns(@CurrentUser() actor: SessionUser) {
    return this.security.mySignIns(actor);
  }
}
