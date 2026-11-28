import { Body, Controller, Delete, Get, HttpCode, Param, Patch, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  copyLinesInput,
  supplierLinePatch,
  supplierLinesInput,
  supplierQuoteInput,
  lineMoveInput,
  type CopyLinesInput,
  type SupplierLinePatch,
  type SupplierLinesInput,
  type SupplierQuoteInput,
  type LineMoveInput,
} from "@kebo/shared";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser, RequirePermissions } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { SourcingService } from "./sourcing.service";

@ApiTags("sourcing")
@Controller()
export class SourcingController {
  constructor(private readonly sourcing: SourcingService) {}

  /** All supplier prices on a deal, costed in the selling currency, with options per item. */
  @Get("inquiries/:id/sourcing")
  @RequirePermissions("sourcing.manage")
  list(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.sourcing.forInquiry(user, id);
  }

  @Post("inquiries/:id/supplier-quotes")
  @RequirePermissions("sourcing.manage")
  create(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(Validate(supplierQuoteInput)) body: SupplierQuoteInput,
  ) {
    return this.sourcing.create(user, id, body);
  }

  @Put("supplier-quotes/:id")
  @RequirePermissions("sourcing.manage")
  update(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(Validate(supplierQuoteInput)) body: SupplierQuoteInput,
  ) {
    return this.sourcing.update(user, id, body);
  }

  @Get("supplier-quotes/:id")
  @RequirePermissions("sourcing.manage")
  one(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.sourcing.quote(user, id);
  }

  /* One change at a time from the line table; each answers with the whole offer. */

  @Post("supplier-quotes/:id/lines")
  @RequirePermissions("sourcing.manage")
  addLines(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(supplierLinesInput)) body: SupplierLinesInput) {
    return this.sourcing.addLines(user, id, body);
  }

  @Post("supplier-quotes/:id/copy-lines")
  @RequirePermissions("sourcing.manage")
  copyLines(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(copyLinesInput)) body: CopyLinesInput) {
    return this.sourcing.copyLines(user, id, body);
  }

  @Patch("supplier-lines/:id")
  @RequirePermissions("sourcing.manage")
  editLine(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(supplierLinePatch)) body: SupplierLinePatch) {
    return this.sourcing.editLine(user, id, body);
  }

  @Post("supplier-lines/:id/move")
  @RequirePermissions("sourcing.manage")
  moveLine(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(lineMoveInput)) body: LineMoveInput) {
    return this.sourcing.moveLine(user, id, body);
  }

  @Delete("supplier-lines/:id")
  @HttpCode(200)
  @RequirePermissions("sourcing.manage")
  removeLine(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Query("reason") reason?: string) {
    return this.sourcing.removeLine(user, id, reason?.slice(0, 500));
  }

  @Delete("supplier-quotes/:id")
  @HttpCode(200)
  @RequirePermissions("sourcing.manage")
  async remove(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Query("reason") reason?: string) {
    await this.sourcing.remove(user, id, reason?.slice(0, 500));
    return { ok: true };
  }
}
