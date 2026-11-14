import { Body, Controller, Delete, Get, HttpCode, Param, ParseEnumPipe, Post, Put } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { mailSettingsInput, mailTestInput, SETTINGS, type MailSettingsInput, type MailTestInput, type SettingsKey } from "@kebo/shared";
import { CurrentUser, RequirePermissions } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { Validate } from "../../common/http/zod.pipe";
import { CompanyMail } from "../../common/notify/company-mail";
import { SettingsService } from "./settings.service";

const KEYS = Object.fromEntries(Object.keys(SETTINGS).map((k) => [k, k])) as Record<SettingsKey, SettingsKey>;

@ApiTags("settings")
@Controller("settings")
class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  all() {
    return this.settings.get();
  }

  /** Whether the main currency can still change (not once money is recorded against it). */
  @Get("main-currency")
  mainCurrency() {
    return this.settings.mainCurrencyLock();
  }

  @Put(":key")
  @RequirePermissions("settings.manage")
  update(@CurrentUser() user: SessionUser, @Param("key", new ParseEnumPipe(KEYS)) key: SettingsKey, @Body() body: unknown) {
    return this.settings.update(user, key, body);
  }
}

/**
 * Admin settings › Email sending: how the company's own email goes out (Gmail, an SMTP server or Resend).
 * Admins only; the password or key is taken in and never given back.
 */
@ApiTags("settings")
@Controller("mail-settings")
class MailSettingsController {
  constructor(private readonly mail: CompanyMail) {}

  @Get()
  @RequirePermissions("security.manage")
  view(@CurrentUser() user: SessionUser) {
    return this.mail.view(user);
  }

  @Put()
  @RequirePermissions("security.manage")
  save(@CurrentUser() user: SessionUser, @Body(Validate(mailSettingsInput)) body: MailSettingsInput) {
    return this.mail.save(user, body);
  }

  /** Back to the server's own email. */
  @Delete()
  @HttpCode(200)
  @RequirePermissions("security.manage")
  remove(@CurrentUser() user: SessionUser) {
    return this.mail.remove(user);
  }

  /** { to }: one email, sent the way it is set now. */
  @Post("test")
  @HttpCode(200)
  @RequirePermissions("security.manage")
  test(@CurrentUser() user: SessionUser, @Body(Validate(mailTestInput)) body: MailTestInput) {
    return this.mail.test(user, body.to);
  }
}

export { MailSettingsController, SettingsController };
