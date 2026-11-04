import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  followUpDoneInput,
  followUpEditInput,
  followUpInput,
  followUpListQuery,
  noteEditInput,
  recordNoteInput,
  type FollowUpDoneInput,
  type FollowUpEditInput,
  type FollowUpInput,
  type FollowUpListQuery,
  type NoteEditInput,
  type RecordNoteInput,
} from "@kebo/shared";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { NotificationsModule } from "../notifications/notifications.module";
import { NotesService } from "./notes.service";
import { FollowUpsService } from "./follow-ups.service";

/**
 * Notes and call logs on orders, customers and factories (inquiries: POST /inquiries/:id/notes as before,
 * and GET here). A note: { id, target: { type, id, label }, kind, body, at, contact: { id, name } | null,
 * author: { id, name }, createdAt, editedAt, can: { edit, delete } }.
 */
@ApiTags("notes")
@Controller()
class NotesController {
  constructor(private readonly notes: NotesService) {}

  /** The inquiry's notes as the other records' (the inquiry page also has them in GET /inquiries/:id). */
  @Get("inquiries/:id/notes")
  inquiry(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.notes.list(user, "inquiry", id);
  }

  @Get("orders/:id/notes")
  order(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.notes.list(user, "order", id);
  }

  /** { body (1–4000), kind?: note | call | visit | whatsapp | email, contactId?, at? (ISO date-time; default now) } — orders.update */
  @Post("orders/:id/notes")
  addToOrder(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(recordNoteInput)) body: RecordNoteInput) {
    return this.notes.add(user, "order", id, body);
  }

  @Get("customers/:id/notes")
  customer(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.notes.list(user, "customer", id);
  }

  /** As on orders — customers.manage */
  @Post("customers/:id/notes")
  addToCustomer(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(recordNoteInput)) body: RecordNoteInput) {
    return this.notes.add(user, "customer", id, body);
  }

  /** sourcing.manage (who sees factories) */
  @Get("factories/:id/notes")
  factory(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.notes.list(user, "factory", id);
  }

  /** As on orders, without contactId (factories have no contact list) — sourcing.manage */
  @Post("factories/:id/notes")
  addToFactory(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(recordNoteInput)) body: RecordNoteInput) {
    return this.notes.add(user, "factory", id, body);
  }

  /** { body?, kind?, contactId?, at? } — its author, within 24 hours of writing it (403 code "too_late" after). Any note, inquiry notes too. */
  @Patch("notes/:id")
  edit(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(noteEditInput)) body: NoteEditInput) {
    return this.notes.edit(user, id, body);
  }

  /** Its author, or a manager of that kind of record → { ok: true } */
  @Delete("notes/:id")
  @HttpCode(200)
  remove(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.notes.remove(user, id);
  }
}

/**
 * Follow-ups: planned calls, visits and meetings. A follow-up: { id, title, kind, dueOn, dueAt, place, note,
 * target: { type, id, label } | null, link, assignee: { id, name }, createdBy: { id, name }, createdAt,
 * updatedAt, done, doneAt, doneBy, doneNote, late, can: { edit, done, delete } }.
 */
@ApiTags("follow-ups")
@Controller()
class FollowUpsController {
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

@Module({
  imports: [NotificationsModule],
  controllers: [NotesController, FollowUpsController],
  providers: [NotesService, FollowUpsService],
  exports: [NotesService, FollowUpsService],
})
export class NotesModule {}
