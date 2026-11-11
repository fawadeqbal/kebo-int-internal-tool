import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  followUpDoneInput,
  followUpEditInput,
  followUpInput,
  followUpListQuery,
  type FollowUpDoneInput,
  type FollowUpEditInput,
  type FollowUpInput,
  type FollowUpListQuery,
} from "@kebo/shared";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { FollowUpsService } from "./follow-ups.service";
/**
 * Follow-ups: planned calls, visits and meetings. A follow-up: { id, title, kind, dueOn, dueAt, place, note,
 * target: { type, id, label } | null, link, assignee: { id, name }, createdBy: { id, name }, createdAt,
 * updatedAt, done, doneAt, doneBy, doneNote, late, can: { edit, done, delete } }.
 */
@ApiTags("follow-ups")
@Controller()
export class FollowUpsController {
  constructor(private readonly followUps: FollowUpsService) {}

  /** ?mine=true&on=&from=&to=&open=true|false&inquiryId|orderId|customerId|factoryId&page&pageSize → { rows, total, page, pageSize, counts: { open, done, late }, canViewAll } */
  @Get("follow-ups")
  list(@CurrentUser() user: SessionUser, @Query(Validate(followUpListQuery)) q: FollowUpListQuery) {
    return this.followUps.list(user, q);
  }

  /** { title, kind?, dueOn, dueAt?, place?, note?, inquiryId | orderId | customerId | factoryId (at most one), assigneeId? (default me) } */
  @Post("follow-ups")
  create(@CurrentUser() user: SessionUser, @Body(Validate(followUpInput)) body: FollowUpInput) {
    return this.followUps.create(user, body);
  }

  @Get("follow-ups/:id")
  get(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.followUps.get(user, id);
  }

  /** The fields that change (as POST); any of the four record ids sent sets the record (all null: none). */
  @Patch("follow-ups/:id")
  edit(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(followUpEditInput)) body: FollowUpEditInput) {
    return this.followUps.edit(user, id, body);
  }

  /** { note? } — done (again: no change). */
  @Post("follow-ups/:id/done")
  @HttpCode(200)
  done(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(followUpDoneInput)) body: FollowUpDoneInput) {
    return this.followUps.done(user, id, body.note);
  }

  @Post("follow-ups/:id/reopen")
  @HttpCode(200)
  reopen(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.followUps.reopen(user, id);
  }

  /** The person it is for, who made it, or a manager → { ok: true } */
  @Delete("follow-ups/:id")
  @HttpCode(200)
  remove(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.followUps.remove(user, id);
  }

  /** My open follow-ups due today or earlier, by when they are due → { today, now, total, late, rows } */
  @Get("me/today")
  today(@CurrentUser() user: SessionUser) {
    return this.followUps.today(user);
  }
}
