import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  paperAgainInput,
  paperDraftInput,
  paperFixInput,
  paperKind,
  paperQueryInput,
  PAPER_OPTIONS,
  sendRequestInput,
  type PaperAgainInput,
  type PaperDraftInput,
  type PaperFixInput,
  type PaperKind,
  type PaperQueryInput,
  type SendRequestInput,
} from "@kebo/shared";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser, RequirePermissions } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { PapersService } from "./papers.service";

const uuid = new ParseUUIDPipe();
const kindParam = Validate(paperKind);
const finalInput = z.object({ options: z.object(Object.fromEntries(PAPER_OPTIONS.map((o) => [o, z.boolean().optional()]))).optional() });

/**
 * The papers the app makes from an order (see @kebo/shared workflows/papers).
 * Reading follows the order; making needs documents.manage (checked here and
 * in the service, with the bank papers' module and the purchase order's
 * factory prices).
 */
@ApiTags("order papers")
@Controller()
export class PapersController {
  constructor(private readonly papers: PapersService) {}

  /** Every paper of the order with where it stands (Ready, Draft, Can be made, Waiting for data, Uploaded, Missing, Kept elsewhere). */
  @Get("orders/:id/papers")
  list(@CurrentUser() user: SessionUser, @Param("id", uuid) id: string) {
    return this.papers.list(user, id);
  }

  /** ?ref= — the Make page: what the paper takes from the order (and what is missing), its options and versions. */
  @Get("orders/:id/papers/:kind/checks")
  checks(
    @CurrentUser() user: SessionUser,
    @Param("id", uuid) id: string,
    @Param("kind", kindParam) kind: PaperKind,
    @Query(Validate(paperQueryInput)) q: PaperQueryInput,
  ) {
    return this.papers.checks(user, id, kind, q.ref);
  }

  /** ?v=&opts=&ref= — the paper to print: a final version's snapshot, else made from the order now. */
  @Get("orders/:id/papers/:kind/doc")
  doc(
    @CurrentUser() user: SessionUser,
    @Param("id", uuid) id: string,
    @Param("kind", kindParam) kind: PaperKind,
    @Query(Validate(paperQueryInput)) q: PaperQueryInput,
  ) {
    return this.papers.doc(user, id, kind, q);
  }

  /** { ref, reason? } — send the payment request of a plan row: kept exactly as it prints now. Sent again: R2, with why. */
  @Post("orders/:id/requests/send")
  @HttpCode(200)
  sendRequest(@CurrentUser() user: SessionUser, @Param("id", uuid) id: string, @Body(Validate(sendRequestInput)) body: SendRequestInput) {
    return this.papers.sendRequest(user, id, body);
  }

  /** { options, ref? } — save as draft. */
  @Post("orders/:id/papers/:kind")
  @RequirePermissions("documents.manage")
  draft(
    @CurrentUser() user: SessionUser,
    @Param("id", uuid) id: string,
    @Param("kind", kindParam) kind: PaperKind,
    @Body(Validate(paperDraftInput)) body: PaperDraftInput,
  ) {
    return this.papers.draft(user, id, kind, body);
  }

  /** { ref? } — a new version of a final paper, as a draft. */
  @Post("orders/:id/papers/:kind/again")
  @RequirePermissions("documents.manage")
  again(
    @CurrentUser() user: SessionUser,
    @Param("id", uuid) id: string,
    @Param("kind", kindParam) kind: PaperKind,
    @Body(Validate(paperAgainInput)) body: PaperAgainInput,
  ) {
    return this.papers.again(user, id, kind, body.ref);
  }

  /** { field, value, lineId? } (?ref=) — missing data typed on the Make page, saved where it belongs. */
  @Post("orders/:id/papers/:kind/fix")
  @HttpCode(200)
  fix(
    @CurrentUser() user: SessionUser,
    @Param("id", uuid) id: string,
    @Param("kind", kindParam) kind: PaperKind,
    @Body(Validate(paperFixInput)) body: PaperFixInput,
    @Query(Validate(paperQueryInput)) q: PaperQueryInput,
  ) {
    return this.papers.fix(user, id, kind, body, q.ref);
  }

  /** { options? } — make the draft final: snapshot, number locked, the paper set and the checklist ticked. */
  @Post("papers/:id/final")
  @HttpCode(200)
  @RequirePermissions("documents.manage")
  final(@CurrentUser() user: SessionUser, @Param("id", uuid) id: string, @Body(Validate(finalInput)) body: z.infer<typeof finalInput>) {
    return this.papers.final(user, id, body);
  }

  /** A draft version, deleted (Delete the draft). A final version cannot be deleted. */
  @Delete("papers/:id")
  @HttpCode(200)
  @RequirePermissions("documents.manage")
  removeDraft(@CurrentUser() user: SessionUser, @Param("id", uuid) id: string) {
    return this.papers.removeDraft(user, id);
  }
}
