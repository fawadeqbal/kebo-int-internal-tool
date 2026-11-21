import { Body, Controller, Delete, Get, HttpCode, Param, ParseEnumPipe, Post, Put, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { MAIL_USES, mailAccountInput, mailTestInput, mailUsesInput, SETTINGS, type MailAccountInput, type MailTestInput, type MailUse, type MailUsesInput, type SettingsKey } from "@kebo/shared";
import { CurrentUser, RequirePermissions, SignedIn } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { Validate } from "../../common/http/zod.pipe";
import { CompanyMail } from "../../common/notify/company-mail";
import { SettingsService } from "./settings.service";

const KEYS = Object.fromEntries(Object.keys(SETTINGS).map((k) => [k, k])) as Record<SettingsKey, SettingsKey>;

@ApiTags("settings")
@Controller("settings")
class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @SignedIn("anyone signed in to the company")
  @Get()
  all() {
    return this.settings.get();
  }

  /** Whether the main currency can still change (not once money is recorded against it). */
  @SignedIn("anyone signed in to the company")
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

const USES = Object.fromEntries(MAIL_USES.map((u) => [u, u])) as Record<MailUse, MailUse>;

/**
 * Admin settings › Email accounts: the addresses the company sends from (Gmail, an SMTP server or Resend),
 * which one each kind of email goes from, and whether people may choose when sending. Admins only; a password
 * or key is taken in and never given back.
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

  /** For a send window: the addresses an email may go from (names only), and the one it starts on. */
  @SignedIn("anyone who sends from a window")
  @Get("senders")
  senders(@Query("use", new ParseEnumPipe(USES)) use: MailUse) {
    return this.mail.senders(use);
  }

  @Post("accounts")
  @HttpCode(200)
  @RequirePermissions("security.manage")
  add(@CurrentUser() user: SessionUser, @Body(Validate(mailAccountInput)) body: MailAccountInput) {
    return this.mail.add(user, body);
  }

  @Put("accounts/:id")
  @RequirePermissions("security.manage")
  update(@CurrentUser() user: SessionUser, @Param("id") id: string, @Body(Validate(mailAccountInput)) body: MailAccountInput) {
    return this.mail.update(user, id, body);
  }

  @Delete("accounts/:id")
  @HttpCode(200)
  @RequirePermissions("security.manage")
  disconnect(@CurrentUser() user: SessionUser, @Param("id") id: string) {
    return this.mail.disconnect(user, id);
  }

  @Put("uses")
  @RequirePermissions("security.manage")
  uses(@CurrentUser() user: SessionUser, @Body(Validate(mailUsesInput)) body: MailUsesInput) {
    return this.mail.setUses(user, body);
  }

  /** Back to the server's own email: every account disconnected. */
  @Delete()
  @HttpCode(200)
  @RequirePermissions("security.manage")
  remove(@CurrentUser() user: SessionUser) {
    return this.mail.remove(user);
  }

  /** { to, accountId? }: one email, through that account (else the default). */
  @Post("test")
  @HttpCode(200)
  @RequirePermissions("security.manage")
  test(@CurrentUser() user: SessionUser, @Body(Validate(mailTestInput)) body: MailTestInput) {
    return this.mail.test(user, body.to, body.accountId);
  }
}

export { MailSettingsController, SettingsController };
