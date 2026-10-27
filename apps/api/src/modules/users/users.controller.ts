import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { Validate } from "../../common/http/zod.pipe";
import { AllowDuringTwoStepSetup, CurrentUser, RequirePermissions } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { codeInput, newUserInput, passwordChangeInput, passwordRule, userInput, UsersService } from "./users.service";

@ApiTags("users")
@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** Active people for pickers (assign to…). */
  @Get("people")
  people() {
    return this.users.people();
  }

  @Get()
  @RequirePermissions("users.manage")
  list() {
    return this.users.list();
  }

  @Post()
  @RequirePermissions("users.manage")
  create(@CurrentUser() actor: SessionUser, @Body(Validate(newUserInput)) body: z.infer<typeof newUserInput>) {
    return this.users.create(actor, body);
  }

  @Put(":id")
  @RequirePermissions("users.manage")
  update(@CurrentUser() actor: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(userInput)) body: z.infer<typeof userInput>) {
    return this.users.update(actor, id, body);
  }

  @Patch(":id/active")
  @RequirePermissions("users.manage")
  async active(@CurrentUser() actor: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(z.object({ active: z.boolean() }))) body: { active: boolean }) {
    await this.users.setActive(actor, id, body.active);
    return { ok: true };
  }

  @Post(":id/password")
  @HttpCode(200)
  @RequirePermissions("users.manage")
  async password(@CurrentUser() actor: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(z.object({ password: passwordRule }))) body: { password: string }) {
    await this.users.resetPassword(actor, id, body.password);
    return { ok: true };
  }

  @Post(":id/two-step/reset")
  @HttpCode(200)
  @RequirePermissions("users.manage")
  async resetTwoStep(@CurrentUser() actor: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.users.resetTwoStep(actor, id);
    return { ok: true };
  }
}

@ApiTags("me")
@Controller("me")
export class AccountController {
  constructor(private readonly users: UsersService) {}

  @Post("password")
  @HttpCode(200)
  async password(@CurrentUser() actor: SessionUser, @Body(Validate(passwordChangeInput)) body: z.infer<typeof passwordChangeInput>) {
    await this.users.changeOwnPassword(actor, body);
    return { ok: true, message: "Password changed. Your other devices are signed out." };
  }

  @AllowDuringTwoStepSetup()
  @Get("two-step")
  twoStep(@CurrentUser() actor: SessionUser) {
    return this.users.twoStepStatus(actor);
  }

  /** Start setup: returns the secret and the otpauth:// link for the QR code. */
  @AllowDuringTwoStepSetup()
  @Post("two-step/setup")
  @HttpCode(200)
  setup(@CurrentUser() actor: SessionUser) {
    return this.users.startTwoStep(actor);
  }

  @AllowDuringTwoStepSetup()
  @Post("two-step/confirm")
  @HttpCode(200)
  confirm(@CurrentUser() actor: SessionUser, @Body(Validate(codeInput)) body: { code: string }) {
    return this.users.confirmTwoStep(actor, body.code);
  }

  @Post("two-step/recovery-codes")
  @HttpCode(200)
  codes(@CurrentUser() actor: SessionUser, @Body(Validate(codeInput)) body: { code: string }) {
    return this.users.newRecoveryCodes(actor, body.code);
  }

  @Post("two-step/off")
  @HttpCode(200)
  async off(@CurrentUser() actor: SessionUser, @Body(Validate(codeInput)) body: { code: string }) {
    await this.users.turnOffTwoStep(actor, body.code);
    return { ok: true };
  }
}
