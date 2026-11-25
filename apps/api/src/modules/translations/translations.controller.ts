import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  translationFixInput,
  translationListQuery,
  translationLookupInput,
  type TranslationFixInput,
  type TranslationListQuery,
  type TranslationLookupInput,
} from "@kebo/shared";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser, SignedIn } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { TranslationsService } from "./translations.service";

/** The translator's memory (25 Nov 2026): the papers' Chinese, and the review of it (Settings › Chinese on papers). */
@ApiTags("translations")
@Controller("translations")
export class TranslationsController {
  constructor(private readonly translations: TranslationsService) {}

  /** { texts: string[] } → { found: { [text as kept]: 中文 }, waiting }: the rest are asked for (the worker translates them). */
  @SignedIn("anyone signed in to the company (a paper they may see)")
  @Post("lookup")
  @HttpCode(200)
  lookup(@Body(Validate(translationLookupInput)) body: TranslationLookupInput) {
    return this.translations.lookup(body.texts);
  }

  @SignedIn("checked inside: documents.manage")
  @Get("status")
  status(@CurrentUser() user: SessionUser) {
    return this.translations.status(user);
  }

  /** ?show=check|waiting|failed|all&q=&page= */
  @SignedIn("checked inside: documents.manage")
  @Get()
  list(@CurrentUser() user: SessionUser, @Query(Validate(translationListQuery)) q: TranslationListQuery) {
    return this.translations.list(user, q);
  }

  /** { zh }: a person's Chinese (it wins over the translator's). */
  @SignedIn("checked inside: documents.manage")
  @Patch(":id")
  fix(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(translationFixInput)) body: TranslationFixInput) {
    return this.translations.fix(user, id, body.zh);
  }

  @SignedIn("checked inside: documents.manage")
  @Post(":id/check")
  @HttpCode(200)
  check(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.translations.check(user, id);
  }

  @SignedIn("checked inside: documents.manage")
  @Post(":id/again")
  @HttpCode(200)
  again(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.translations.again(user, id);
  }
}
