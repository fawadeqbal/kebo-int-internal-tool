import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  noteEditInput,
  recordNoteInput,
  type NoteEditInput,
  type RecordNoteInput,
} from "@kebo/shared";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { NotesService } from "./notes.service";

/**
 * Notes and call logs on orders, customers and factories (inquiries: POST /inquiries/:id/notes as before,
 * and GET here). A note: { id, target: { type, id, label }, kind, body, at, contact: { id, name } | null,
 * author: { id, name }, createdAt, editedAt, can: { edit, delete } }.
 */
@ApiTags("notes")
@Controller()
export class NotesController {
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
