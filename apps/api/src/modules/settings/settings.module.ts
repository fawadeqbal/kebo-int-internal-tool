import { Global, Module } from "@nestjs/common";
import { SettingsService } from "./settings.service";
import { MailSettingsController, SettingsController } from "./settings.controller";

@Global()
@Module({ controllers: [SettingsController, MailSettingsController], providers: [SettingsService], exports: [SettingsService] })
export class SettingsModule {}
