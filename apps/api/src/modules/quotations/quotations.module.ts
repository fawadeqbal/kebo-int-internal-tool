import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { currency, revisionInput, revisionMoveInput, type RevisionInput } from "@kebo/shared";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser, RequirePermissions } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { InquiriesModule } from "../inquiries/inquiries.module";
import { OrdersModule } from "../orders/orders.module";
import { QuotationsService } from "./quotations.service";

@ApiTags("quotations")
@Controller()
class QuotationsController {
  constructor(private readonly quotations: QuotationsService) {}

  /** The deal's quotation with every revision (costs only for people who may see them). */
  @Get("inquiries/:id/quotation")
  get(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.quotations.get(user, id);
  }

  /** What a revision can offer: each factory offer (lines, costs in ?currency, which items it covers) and the customer's items. */
  @Get("inquiries/:id/quotation/offers")
  @RequirePermissions("quotations.manage")
  offers(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Query(Validate(z.object({ currency: currency.default("USD") }))) q: { currency: string },
  ) {
    return this.quotations.offers(user, id, q.currency);
  }

  /** Starting values for the next revision (copy of the latest, or the best factory offer at the default margin). */
  @Get("inquiries/:id/quotation/draft")
  @RequirePermissions("quotations.manage")
  draft(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.quotations.draft(user, id);
  }

  @Post("inquiries/:id/quotation/revisions")
  @RequirePermissions("quotations.manage")
  create(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(revisionInput)) body: RevisionInput) {
    return this.quotations.createRevision(user, id, body);
  }

  @Get("revisions/:id")
  revision(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.quotations.revision(user, id);
  }

  /** A saved draft as the editor sends it back. */
  @Get("revisions/:id/values")
  @RequirePermissions("quotations.manage")
  values(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.quotations.values(user, id);
  }

  @Put("revisions/:id")
  @RequirePermissions("quotations.manage")
  update(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(revisionInput)) body: RevisionInput) {
    return this.quotations.updateRevision(user, id, body);
  }

  @Delete("revisions/:id")
  @HttpCode(200)
  @RequirePermissions("quotations.manage")
  async remove(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.quotations.deleteDraft(user, id);
    return { ok: true };
  }

  /** { to: sent|accepted|rejected|expired, on?, optionId? } — accepted (one option) creates the order from it. */
  @Post("revisions/:id/status")
  @HttpCode(200)
  @RequirePermissions("quotations.manage")
  move(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(Validate(revisionMoveInput)) body: z.infer<typeof revisionMoveInput>,
  ) {
    return this.quotations.move(user, id, body.to, body.on, body.reason, body.optionId);
  }
}

@Module({
  imports: [InquiriesModule, OrdersModule],
  controllers: [QuotationsController],
  providers: [QuotationsService],
  exports: [QuotationsService],
})
export class QuotationsModule {}
