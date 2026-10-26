import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { factoryQuoteInput, preferredLinesInput, type FactoryQuoteInput } from "@kebo/shared";
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
  async remove(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Query("reason") reason?: string) {
    await this.sourcing.remove(user, id, reason?.slice(0, 500));
    return { ok: true };
  }

  /** { choices: { [requestedItemId]: factoryQuoteLineId | null } } */
  @Post("inquiries/:id/preferred-prices")
  @HttpCode(200)
  @RequirePermissions("sourcing.manage")
  choose(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(preferredLinesInput)) body: z.infer<typeof preferredLinesInput>) {
    return this.sourcing.choose(user, id, body.choices, body.reason ?? undefined);
  }
}

@Module({ imports: [InquiriesModule], controllers: [SourcingController], providers: [SourcingService], exports: [SourcingService] })
export class SourcingModule {}
