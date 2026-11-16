import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { currency, newQuotationsInput, revisionEmailInput, revisionInput, revisionMoveInput, type NewQuotationsInput, type RevisionInput } from "@kebo/shared";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser, RequirePermissions, SignedIn } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { QuotationsService } from "./quotations.service";

@ApiTags("quotations")
@Controller()
export class QuotationsController {
  constructor(private readonly quotations: QuotationsService) {}

  /** The deal's quotations, A, B, C…, each with every revision (costs only for people who may see them). */
  @SignedIn("checked inside: sourcing.manage")
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

  /** New quotations: one draft for each factory offer ticked (or own prices), lettered A, B, C… */
  @Post("inquiries/:id/quotations")
  @RequirePermissions("quotations.manage")
  createMany(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(newQuotationsInput)) body: NewQuotationsInput) {
    return this.quotations.createQuotations(user, id, body);
  }

  /** Starting values for one quotation's next revision (a copy of its latest). */
  @Get("quotations/:id/draft")
  @RequirePermissions("quotations.manage")
  draftOf(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.quotations.draftFor(user, id);
  }

  /** One quotation's next revision (after the customer has seen one: with the reason it changes). */
  @Post("quotations/:id/revisions")
  @RequirePermissions("quotations.manage")
  revise(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(revisionInput)) body: RevisionInput) {
    return this.quotations.createRevisionOn(user, id, body);
  }

  @SignedIn("checked inside: sourcing.manage")
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
    return this.quotations.move(user, id, body.to, body.on, body.reason, body.optionId, { customerRef: body.customerRef, route: body.route, via: body.via });
  }

  /** Email the revision to the customer (with its PDF, made by the web app) and mark it sent. */
  @Post("revisions/:id/email")
  @HttpCode(200)
  @RequirePermissions("quotations.manage")
  email(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(revisionEmailInput)) body: z.infer<typeof revisionEmailInput>) {
    return this.quotations.email(user, id, body);
  }
}
