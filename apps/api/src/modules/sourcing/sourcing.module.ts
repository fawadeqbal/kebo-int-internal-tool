import { Body, Controller, Delete, Get, HttpCode, Module, Param, Patch, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  copyLinesInput,
  factoryLinePatch,
  factoryLinesInput,
  factoryQuoteInput,
  lineMoveInput,
  type CopyLinesInput,
  type FactoryLinePatch,
  type FactoryLinesInput,
  type FactoryQuoteInput,
  type LineMoveInput,
} from "@kebo/shared";
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
  create(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(Validate(factoryQuoteInput)) body: FactoryQuoteInput,
  ) {
    return this.sourcing.create(user, id, body);
  }

  @Put("factory-quotes/:id")
  @RequirePermissions("sourcing.manage")
  update(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(Validate(factoryQuoteInput)) body: FactoryQuoteInput,
  ) {
    return this.sourcing.update(user, id, body);
  }

  @Get("factory-quotes/:id")
  @RequirePermissions("sourcing.manage")
  one(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.sourcing.quote(user, id);
  }

  /* One change at a time from the line table; each answers with the whole offer. */

  @Post("factory-quotes/:id/lines")
  @RequirePermissions("sourcing.manage")
  addLines(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(factoryLinesInput)) body: FactoryLinesInput) {
    return this.sourcing.addLines(user, id, body);
  }

  @Post("factory-quotes/:id/copy-lines")
  @RequirePermissions("sourcing.manage")
  copyLines(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(copyLinesInput)) body: CopyLinesInput) {
    return this.sourcing.copyLines(user, id, body);
  }

  @Patch("factory-lines/:id")
  @RequirePermissions("sourcing.manage")
  editLine(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(factoryLinePatch)) body: FactoryLinePatch) {
    return this.sourcing.editLine(user, id, body);
  }

  @Post("factory-lines/:id/move")
  @RequirePermissions("sourcing.manage")
  moveLine(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(lineMoveInput)) body: LineMoveInput) {
    return this.sourcing.moveLine(user, id, body);
  }

  @Delete("factory-lines/:id")
  @HttpCode(200)
  @RequirePermissions("sourcing.manage")
  removeLine(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Query("reason") reason?: string) {
    return this.sourcing.removeLine(user, id, reason?.slice(0, 500));
  }

  @Delete("factory-quotes/:id")
  @HttpCode(200)
  @RequirePermissions("sourcing.manage")
  async remove(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Query("reason") reason?: string) {
    await this.sourcing.remove(user, id, reason?.slice(0, 500));
    return { ok: true };
  }
}

@Module({ imports: [InquiriesModule], controllers: [SourcingController], providers: [SourcingService], exports: [SourcingService] })
export class SourcingModule {}
