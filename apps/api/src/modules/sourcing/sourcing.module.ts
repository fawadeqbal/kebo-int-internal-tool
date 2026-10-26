import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { factoryQuoteInput, hsCodeInput, preferredLinesInput, type FactoryQuoteInput, type HsCodeInput } from "@kebo/shared";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser, RequirePermissions } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { InquiriesModule } from "../inquiries/inquiries.module";
import { SourcingService } from "./sourcing.service";

@ApiTags("sourcing")
@Controller()
class SourcingController {
  constructor(private readonly sourcing: SourcingService) {}

  /** All factory prices on a deal, costed in the selling currency, with options per item. */
  @Get("inquiries/:id/sourcing")
  @RequirePermissions("sourcing.manage")
  list(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.sourcing.forInquiry(user, id);
  }

  @Post("inquiries/:id/factory-quotes")
  @RequirePermissions("sourcing.manage")
  create(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(factoryQuoteInput)) body: FactoryQuoteInput) {
    return this.sourcing.create(user, id, body);
  }

  @Put("factory-quotes/:id")
  @RequirePermissions("sourcing.manage")
  update(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(factoryQuoteInput)) body: FactoryQuoteInput) {
    return this.sourcing.update(user, id, body);
  }

  @Delete("factory-quotes/:id")
  @HttpCode(200)
  @RequirePermissions("sourcing.manage")
  async remove(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.sourcing.remove(user, id);
    return { ok: true };
  }

  /** { choices: { [requestedItemId]: factoryQuoteLineId | null } } */
  @Post("inquiries/:id/preferred-prices")
  @HttpCode(200)
  @RequirePermissions("sourcing.manage")
  choose(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(preferredLinesInput)) body: z.infer<typeof preferredLinesInput>) {
    return this.sourcing.choose(user, id, body.choices);
  }

  /** Export rebate rates remembered per HS code. */
  @Get("hs-codes")
  @RequirePermissions("sourcing.manage")
  hsCodes(@CurrentUser() user: SessionUser, @Query("q") q?: string) {
    return this.sourcing.hsCodes(user, q);
  }

  /** One HS code's rebate; { code: null } the first time it is used. */
  @Get("hs-codes/:code")
  @RequirePermissions("sourcing.manage")
  async hsCode(@CurrentUser() user: SessionUser, @Param("code") code: string) {
    return (await this.sourcing.hsCode(user, code)) ?? { code: null };
  }

  @Put("hs-codes/:code")
  @RequirePermissions("sourcing.manage")
  saveHsCode(@CurrentUser() user: SessionUser, @Param("code") code: string, @Body(Validate(hsCodeInput)) body: HsCodeInput) {
    return this.sourcing.saveHsCode(user, code, body);
  }

  @Delete("hs-codes/:code")
  @HttpCode(200)
  @RequirePermissions("sourcing.manage")
  async removeHsCode(@CurrentUser() user: SessionUser, @Param("code") code: string) {
    await this.sourcing.removeHsCode(user, code);
    return { ok: true };
  }
}

@Module({ imports: [InquiriesModule], controllers: [SourcingController], providers: [SourcingService], exports: [SourcingService] })
export class SourcingModule {}
