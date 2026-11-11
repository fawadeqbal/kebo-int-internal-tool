import { Injectable } from "@nestjs/common";
import type { NoteEditInput, NoteKind, NoteInput } from "@kebo/shared";
import { ForbiddenError, NotFoundError } from "@kebo/utils";
import { z } from "zod";
import { PrismaService, type Tx } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { Clock } from "../../common/time/clock.service";
import type { SessionUser } from "../../common/auth/session-user";
import { canAddTo, managesNotesOf, seeRecord, type RecordRef, type RecordType } from "./records";

/** A note's author may change it for this long after writing it. */
export const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;
/** "When it happened" may be a little ahead of the server's clock (a phone's clock), not more. */
const AHEAD_MS = 5 * 60 * 1000;

const people = { select: { id: true, name: true } } as const;
const include = { author: people, contact: people } as const;

/** A note with its author and contact. */
interface NoteRow {
  id: string;
  kind: string;
  body: string;
  at: Date;
  contactId: string | null;
  authorId: string;
  createdAt: Date;
  editedAt: Date | null;
  author: { id: string; name: string };
  contact: { id: string; name: string } | null;
}

/** "logged a call with Ali" */
const VERB: Record<NoteKind, string> = {
  note: "added a note",
  call: "logged a call",
  visit: "logged a visit",
  whatsapp: "logged a WhatsApp message",
  email: "logged an email",
};
/** The column of notes that holds the record (a note is on exactly one). */
const onRecord = (type: RecordType, id: string) =>
  type === "inquiry" ? { inquiryId: id } : type === "order" ? { orderId: id } : type === "customer" ? { customerId: id } : { factoryId: id };
/** Not seeing the record (or not seeing factories at all) means not seeing its notes. */
const hidden = (e: unknown) => {
  throw e instanceof NotFoundError || e instanceof ForbiddenError ? new NotFoundError("Note") : e;
};

const quote = (body: string) => {
  const line = body.replace(/\s+/g, " ").trim();
  return `"${line.length > 120 ? `${line.slice(0, 117)}…` : line}"`;
};

/**
 * Notes and call logs on inquiries, orders, customers and factories: kind (note, call, visit, WhatsApp,
 * email), the customer's contact it was with, when it happened, who wrote it. All in one table, notes,
 * each on exactly one record (an inquiry's old endpoint is unchanged). Who sees the record sees
 * its notes; who may change the record adds them; the author changes one within 24 hours; the author or
 * a manager of that kind of record removes one. Each is written to the record's history.
 */
@Injectable()
export class NotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  private view(user: SessionUser, target: RecordRef, n: NoteRow) {
    const mine = n.authorId === user.id;
    return {
      id: n.id,
      target: { type: target.type, id: target.id, label: target.label },
      kind: n.kind as NoteKind,
      body: n.body,
      /** When it happened. */
      at: n.at,
      contact: n.contact,
      author: n.author,
      createdAt: n.createdAt,
      editedAt: n.editedAt,
      can: {
        /** The author, within 24 hours of writing it. */
        edit: mine && this.clock.now().getTime() - n.createdAt.getTime() < EDIT_WINDOW_MS,
        delete: mine || managesNotesOf(user, target.type),
      },
    };
  }

  /** The record's notes, the latest first (by when they happened). */
  async list(user: SessionUser, type: RecordType, id: string) {
    const target = await seeRecord(this.prisma.db, user, type, id);
    const orderBy = [{ at: "desc" as const }, { createdAt: "desc" as const }, { id: "asc" as const }];
    const rows: NoteRow[] = await this.prisma.db.note.findMany({ where: onRecord(type, id), include, orderBy });
    return rows.map((n) => this.view(user, target, n));
  }

  /** The contact must be one of the record's customer's (factories have none to choose). */
  private async checkContact(target: RecordRef, contactId: string | null | undefined) {
    if (!contactId) return;
    const bad = (message: string) => new z.ZodError([{ code: "custom", path: ["contactId"], message, input: contactId }]);
    if (!target.customerId) throw bad("Factories have no contacts to choose; say who it was with in the note.");
    const found = await this.prisma.db.contact.count({ where: { id: contactId, partyId: target.customerId, deletedAt: null } });
    if (!found) throw bad("Choose one of the customer's contacts.");
  }

  private checkAt(at: Date | undefined) {
    if (at && at.getTime() > this.clock.now().getTime() + AHEAD_MS)
      throw new z.ZodError([{ code: "custom", path: ["at"], message: "When it happened cannot be in the future.", input: at }]);
  }

  private async history(
    tx: Tx,
    user: SessionUser,
    target: RecordRef,
    action: "note.added" | "note.edited" | "note.removed",
    summary: string,
    values: { old?: Record<string, unknown>; new?: Record<string, unknown> },
  ) {
    await this.audit.record(tx, {
      userId: user.id,
      action,
      entityType: target.type,
      entityId: target.id,
      summary,
      oldValues: values.old,
      newValues: values.new,
    });
  }

  /**
   * Writes a note on the record and in its history, as the row it is in its table (POST
   * /inquiries/:id/notes answers that, as it always did). Refused (403) for people who may not change the
   * record; 404 for those who do not see it.
   */
  async create(user: SessionUser, type: RecordType, id: string, input: NoteInput) {
    const target = await seeRecord(this.prisma.db, user, type, id);
    if (!canAddTo(user, type)) throw new ForbiddenError(`You cannot add notes to this ${type}.`);
    await this.checkContact(target, input.contactId);
    this.checkAt(input.at);
    const data = { kind: input.kind, body: input.body, contactId: input.contactId ?? null, at: input.at ?? this.clock.now(), authorId: user.id };
    return this.prisma.tx(async (tx) => {
      const row = await tx.note.create({ data: { ...data, ...onRecord(type, id) }, include });
      if (type === "inquiry") await tx.inquiry.update({ where: { id }, data: { updatedAt: new Date() } });
      const kind = row.kind as NoteKind;
      await this.history(
        tx,
        user,
        target,
        "note.added",
        `${target.label}: ${user.name} ${VERB[kind]}${row.contact && kind !== "note" ? ` with ${row.contact.name}` : ""}: ${quote(row.body)}`,
        { new: { note: row.id, kind, at: row.at.toISOString(), ...(row.contact ? { contact: row.contact.name } : {}) } },
      );
      return { row, target };
    });
  }

  /** POST /orders|customers|factories/:id/notes → the note as lists show it. */
  async add(user: SessionUser, type: RecordType, id: string, input: NoteInput) {
    const { row, target } = await this.create(user, type, id, input);
    return this.view(user, target, row);
  }

  /** A note by id, with the record it is on (404 when the person does not see that record). */
  private async find(user: SessionUser, noteId: string) {
    const row = await this.prisma.db.note.findUnique({ where: { id: noteId }, include });
    if (!row) throw new NotFoundError("Note");
    const type: RecordType = row.inquiryId ? "inquiry" : row.orderId ? "order" : row.customerId ? "customer" : "factory";
    const target = await seeRecord(this.prisma.db, user, type, (row.inquiryId ?? row.orderId ?? row.customerId ?? row.factoryId)!).catch(hidden);
    return { row: row as NoteRow, target };
  }

  /** PATCH /notes/:id — its author, within 24 hours of writing it. */
  async edit(user: SessionUser, noteId: string, input: NoteEditInput) {
    const { row, target } = await this.find(user, noteId);
    if (row.authorId !== user.id) throw new ForbiddenError("Only the person who wrote a note can change it.");
    if (this.clock.now().getTime() - row.createdAt.getTime() >= EDIT_WINDOW_MS)
      throw new ForbiddenError("A note can be changed for 24 hours after it is written. Add a new one instead.", "too_late");
    if (input.contactId !== undefined) await this.checkContact(target, input.contactId);
    this.checkAt(input.at);
    const data = {
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
      ...(input.contactId !== undefined ? { contactId: input.contactId } : {}),
      ...(input.at !== undefined ? { at: input.at } : {}),
      editedAt: this.clock.now(),
    };
    const after = await this.prisma.tx(async (tx) => {
      const n: NoteRow = await tx.note.update({ where: { id: noteId }, data, include });
      const pick = (x: NoteRow) => ({ kind: x.kind, body: x.body, at: x.at.toISOString(), contact: x.contact?.name ?? null });
      await this.history(tx, user, target, "note.edited", `${target.label}: ${user.name} changed a note: ${quote(n.body)}`, {
        old: pick(row),
        new: { note: n.id, ...pick(n) },
      });
      return n;
    });
    return this.view(user, target, after);
  }

  /** DELETE /notes/:id — its author, or a manager of that kind of record. */
  async remove(user: SessionUser, noteId: string) {
    const { row, target } = await this.find(user, noteId);
    if (row.authorId !== user.id && !managesNotesOf(user, target.type))
      throw new ForbiddenError("Only the person who wrote a note or a manager can remove it.");
    await this.prisma.tx(async (tx) => {
      await tx.note.delete({ where: { id: noteId } });
      await this.history(tx, user, target, "note.removed", `${target.label}: ${user.name} removed a note by ${row.author.name}: ${quote(row.body)}`, {
        old: { note: row.id, kind: row.kind, body: row.body, at: row.at.toISOString() },
      });
    });
    return { ok: true };
  }
}
