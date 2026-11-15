import { Global, Module } from "@nestjs/common";
import { SettingsService } from "./settings.service";
import { MailSettingsController, SettingsController } from "./settings.controller";
import { BooksController, BooksService } from "./books";

@Global()
@Module({ controllers: [SettingsController, MailSettingsController, BooksController], providers: [SettingsService, BooksService], exports: [SettingsService, BooksService] })
export class SettingsModule {}
