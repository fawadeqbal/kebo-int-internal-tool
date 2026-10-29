import { Body, Controller, Get, Global, Module, Param, ParseEnumPipe, Put } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { SETTINGS, type SettingsKey } from "@kebo/shared";
import { CurrentUser, RequirePermissions } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
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

@Global()
@Module({ controllers: [SettingsController], providers: [SettingsService], exports: [SettingsService] })
export class SettingsModule {}
