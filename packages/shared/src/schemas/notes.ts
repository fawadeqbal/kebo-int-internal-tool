import { z } from "zod";
import { isoDate, optionalId, optionalText, text } from "./common";

/** What a note records: a plain note, or a call, visit, WhatsApp or email with the customer or factory. */
export const NOTE_KINDS = ["note", "call", "visit", "whatsapp", "email"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];
export const NOTE_KIND_LABEL: Record<NoteKind, string> = {
  note: "Note",
  call: "Call",
  visit: "Visit",
  whatsapp: "WhatsApp",
  email: "Email",
};

/** The records that have notes. Inquiries keep theirs apart (inquiry_notes), with the same fields. */
export const NOTE_TARGETS = ["inquiry", "order", "customer", "factory"] as const;
export type NoteTarget = (typeof NOTE_TARGETS)[number];

/** A planned call, visit or meeting. */
export const FOLLOW_UP_KINDS = ["call", "visit", "meeting", "other"] as const;
export type FollowUpKind = (typeof FOLLOW_UP_KINDS)[number];
export const FOLLOW_UP_KIND_LABEL: Record<FollowUpKind, string> = { call: "Call", visit: "Visit", meeting: "Meeting", other: "Other" };

/** The records a follow-up can be on (none: a general one). */
export const FOLLOW_UP_TARGETS = ["inquiry", "order", "customer", "factory"] as const;
export type FollowUpTarget = (typeof FOLLOW_UP_TARGETS)[number];

/** "" and null: not given. */
const blank = (v: unknown) => (v === "" || v === null ? undefined : v);

/** When it happened: an ISO date-time with its offset or Z ("2026-11-04T09:02:00+05:00"); not given: now. */
const happenedAt = z.preprocess(
  blank,
  z.iso
    .datetime({ offset: true, message: "Say when it happened as a date and time (2026-11-04T09:02:00+05:00)" })
    .transform((v) => new Date(v))
    .optional(),
);

const noteKind = z.preprocess(blank, z.enum(NOTE_KINDS, "Choose note, call, visit, whatsapp or email").optional());

/**
 * POST /inquiries/:id/notes. The same body as before ({ body }) still works: kind, contactId and at are
 * optional (a plain note, now). Up to 5,000 characters, as inquiry notes always took.
 */
export const noteInput = z.object({
  body: text(5000, "Write a note first"),
  kind: noteKind.transform((v) => v ?? "note"),
  contactId: optionalId,
  at: happenedAt,
});
export type NoteInput = z.infer<typeof noteInput>;

/** POST /orders/:id/notes, /customers/:id/notes, /factories/:id/notes. */
export const recordNoteInput = noteInput.extend({ body: text(4000, "Write a note first") });
export type RecordNoteInput = z.infer<typeof recordNoteInput>;

/** PATCH /notes/:id — what changes (the author, within 24 hours). */
export const noteEditInput = z
  .object({
    body: text(4000, "Write a note first").optional(),
    kind: noteKind,
    contactId: optionalId.optional(),
    at: happenedAt,
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Send what changes: body, kind, contactId or at");
export type NoteEditInput = z.infer<typeof noteEditInput>;

/** "14:30": a time of day, 24-hour clock. */
export const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;
const timeOfDay = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || TIME_OF_DAY.test(v), "Use a time like 14:30");

const targets = {
  inquiryId: optionalId,
  orderId: optionalId,
  customerId: optionalId,
  factoryId: optionalId,
};
const TARGET_KEYS = ["inquiryId", "orderId", "customerId", "factoryId"] as const;
const oneTarget = (v: Partial<Record<(typeof TARGET_KEYS)[number], string | null | undefined>>, ctx: z.RefinementCtx) => {
  const given = TARGET_KEYS.filter((k) => v[k]);
  if (given.length > 1)
    ctx.addIssue({
      code: "custom",
      path: [given[1]!],
      message: "A follow-up is on one record at most: an inquiry, an order, a customer or a factory",
    });
};

const followUpFields = {
  title: text(200, "Say what to do"),
  kind: z.preprocess(blank, z.enum(FOLLOW_UP_KINDS, "Choose call, visit, meeting or other").default("other")),
  dueOn: isoDate("Choose the day (YYYY-MM-DD)"),
  dueAt: timeOfDay,
  place: optionalText(160),
  note: optionalText(2000),
  ...targets,
  /** Who it is for (default: the person adding it). */
  assigneeId: optionalId,
};

/** POST /follow-ups */
export const followUpInput = z.object(followUpFields).superRefine(oneTarget);
export type FollowUpInput = z.infer<typeof followUpInput>;

/**
 * PATCH /follow-ups/:id — the fields that change. When any of inquiryId, orderId, customerId or factoryId
 * is sent, the follow-up is on exactly what is sent (all null or "": a general one).
 */
export const followUpEditInput = z
  .object({
    title: followUpFields.title.optional(),
    kind: z.preprocess(blank, z.enum(FOLLOW_UP_KINDS, "Choose call, visit, meeting or other").optional()),
    dueOn: followUpFields.dueOn.optional(),
    dueAt: timeOfDay.optional(),
    place: optionalText(160).optional(),
    note: optionalText(2000).optional(),
    inquiryId: optionalId.optional(),
    orderId: optionalId.optional(),
    customerId: optionalId.optional(),
    factoryId: optionalId.optional(),
    assigneeId: optionalId.optional(),
  })
  .superRefine(oneTarget);
export type FollowUpEditInput = z.infer<typeof followUpEditInput>;

/** The hour the day's reminders go out (business time zone): not at midnight, when the day begins. */
export const REMINDER_HOUR = 8;
/** A follow-up missed this many days is told to the managers and to who gave it, every morning until it is done. */
export const FOLLOW_UP_ESCALATE_DAYS = 2;

/** A new inquiry: the system sets "Reply to the customer" this many days on, for who handles it. */
export const REPLY_WITHIN_DAYS = 1;
/** A quotation sent: the system sets a follow-up this many days after, one after the other, until the customer answers. */
export const QUOTE_FOLLOW_UP_DAYS = [3, 7, 14] as const;

/**
 * POST /follow-ups/:id/done — what came of it (optional), and the next follow-up. An open inquiry is never
 * left without a next follow-up: finishing its last open one needs `next` (the day, and optionally a time,
 * what to do and who), which is made in the same save. The other way out is closing the inquiry (won or lost).
 */
export const followUpDoneInput = z.object({
  note: optionalText(2000),
  next: z
    .object({
      dueOn: isoDate("Choose the day of the next follow-up"),
      dueAt: timeOfDay,
      title: z.preprocess(blank, z.string().trim().max(200).optional()),
      assigneeId: optionalId,
    })
    .nullish(),
});
export type FollowUpDoneInput = z.infer<typeof followUpDoneInput>;

const flag = z
  .enum(["true", "false"])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === "true"));
const optionalDay = z.preprocess(blank, isoDate().optional());

/** GET /follow-ups?mine=true&on=&from=&to=&open=true|false&inquiryId|orderId|customerId|factoryId&page&pageSize */
export const followUpListQuery = z
  .object({
    /** Only those for me. Without it: everyone's (followups.viewAll), else those for me or made by me. */
    mine: flag,
    /** Due that day. */
    on: optionalDay,
    /** Due from that day on. */
    from: optionalDay,
    /** Due up to that day. */
    to: optionalDay,
    /** true: not done yet; false: done; not given: both. */
    open: flag,
    /** Only the late ones (open, past their day or time). */
    late: flag,
    /** Words in the title, place or note. */
    q: z.preprocess(blank, z.string().trim().max(100).optional()),
    /** Only those for this person. */
    who: z.preprocess(blank, z.uuid().optional()),
    /** Only those on this kind of record ("none": on nothing). */
    about: z.preprocess(blank, z.enum(["inquiry", "order", "customer", "factory", "none"]).optional()),
    ...targets,
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(100),
  })
  .superRefine(oneTarget);
export type FollowUpListQuery = z.infer<typeof followUpListQuery>;
