import { Module } from "@nestjs/common";
import { TranslationsController } from "./translations.controller";
import { TranslationsService } from "./translations.service";
import { Translator } from "./translator";

/** The worker's part (translating what waits) without the HTTP routes. */
/** (Settings come from the global SettingsModule.) */
@Module({ providers: [TranslationsService, Translator], exports: [TranslationsService, Translator] })
export class TranslationsCoreModule {}

@Module({ imports: [TranslationsCoreModule], controllers: [TranslationsController] })
export class TranslationsModule {}
