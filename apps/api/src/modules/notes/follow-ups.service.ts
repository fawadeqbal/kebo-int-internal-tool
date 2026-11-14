import { Injectable } from "@nestjs/common";
import { fromDbDate, toDbDate, type Prisma } from "@kebo/database";
import { can, FOLLOW_UP_ESCALATE_DAYS, FOLLOW_UP_KIND_LABEL, OPEN_STAGES, QUOTE_FOLLOW_UP_DAYS, REMINDER_HOUR, rowsOf, type FollowUpDoneInput, type FollowUpEditInput, type FollowUpInput, type FollowUpKind, type FollowUpListQuery } from "@kebo/shared";
import { addDays, daysBetween, DomainError, ForbiddenError, GateError, NotFoundError, startOfDayIn, type ISODate } from "@kebo/utils";
import { PrismaService, type Tx } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { Clock } from "../../common/time/clock.service";
import type { SessionUser } from "../../common/auth/session-user";
import { NotificationsService } from "../notifications/notifications.service";
import { followUpMissed, followUpsMissed, followUpToday } from "../notifications/messages";
import { DayBook, splitLabel } from "../notifications/day-book";
import { recordLabels, seeRecord, type RecordRef, type RecordType } from "./records";

/** Where follow-ups without a record (and the list) open. */
export const FOLLOW_UPS_LINK = "/follow-ups";

const people = { select: { id: true, name: true } } as const;
export const followUpInclude = { assignee: people, createdBy: people, doneBy: people } satisfies Prisma.FollowUpInclude;
export type FollowUpRow = Prisma.FollowUpGetPayload<{ include: typeof followUpInclude }>;

const TARGET_KEYS = [
  ["inquiry", "inquiryId"],
  ["order", "orderId"],
  ["customer", "customerId"],
  ["factory", "factoryId"],
] as const satisfies readonly (readonly [RecordType, string])[];
type TargetIds = { inquiryId?: string | null; orderId?: string | null; customerId?: string | null; factoryId?: string | null };

/** The record a row or an input names: { type, id } or null (a general one). */
export function targetOf(v: TargetIds): { type: RecordType; id: string } | null {
  for (const [type, key] of TARGET_KEYS) if (v[key]) return { type, id: v[key]! };
  return null;
}
const columnsFor = (t: { type: RecordType; id: string } | null) => ({
  inquiryId: t?.type === "inquiry" ? t.id : null,
  orderId: t?.type === "order" ? t.id : null,
  customerId: t?.type === "customer" ? t.id : null,
  factoryId: t?.type === "factory" ? t.id : null,
});

/** "09:05": the time of day of a moment in a time zone. */
export const timeIn = (moment: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(moment);

/** The moment a day and an "HH:MM" time are in a time zone. */
export function momentIn(date: ISODate, time: string, timeZone: string): Date {
  const [h, m] = time.split(":").map(Number) as [number, number];
  return new Date(startOfDayIn(date, timeZone).getTime() + (h * 60 + m) * 60_000);
}

/** "Thu 5 Nov" / "Thu 5 Nov 11:00" */
export function dueWords(dueOn: ISODate, dueAt: string | null) {
  const day = new Date(`${dueOn}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  return dueAt ? `${day} ${dueAt}` : day;
}

/**
 * After a follow-up the system set on a sent quotation ("quote1": 3 days after), the one that comes next
 * ("quote2", 4 days later: 7 days after it was sent), or null after the last (then the person sets the next).
 */
export function nextQuoteStep(auto: string | null): { auto: string; gap: number } | null {
  const n = Number(/^quote(\d)$/.exec(auto ?? "")?.[1] ?? 0);
  if (!n || n >= QUOTE_FOLLOW_UP_DAYS.length) return null;
  return { auto: `quote${n + 1}`, gap: QUOTE_FOLLOW_UP_DAYS[n]! - QUOTE_FOLLOW_UP_DAYS[n - 1]! };
}

/** Late: not done, and its day has passed, or it is today and its time has passed. */
export const isLate = (r: { doneAt: Date | null; dueOn: ISODate; dueAt: string | null }, today: ISODate, now: string) =>
  !r.doneAt && (r.dueOn < today || (r.dueOn === today && r.dueAt !== null && r.dueAt < now));

/**
 * Follow-ups: planned calls, visits and meetings for someone, on an inquiry, order, customer or factory
 * (or none). Everyone may add them on the records they see and give them to anyone. Each person sees the
 * ones for them or made by them, and every one on a record they see; followups.viewAll sees all. Those it
 * is for, who made it, and managers (followups.viewAll) change, tick, reopen and remove them; others who
 * see one through its record only read it. The person it is given to is told (followUp.assigned); the
 * worker reminds them on the day and before its time (RemindersService, followUp.due).
 */
@Injectable()
export class FollowUpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly notifications: NotificationsService,
  ) {}

  private now() {
    const moment = this.clock.now();
    return { today: this.clock.today(), time: timeIn(moment, this.clock.timeZone) };
  }

  /** Changes it: the person it is for, who made it, or a manager. */
  private changes(user: SessionUser, r: { assigneeId: string; createdById: string }) {
    return can(user, "followups.viewAll") || r.assigneeId === user.id || r.createdById === user.id;
  }

  /**
   * The follow-ups, among these, that are the last open one of an open inquiry. An open inquiry is never left
   * without a next follow-up, so finishing one of these needs the next one (and it cannot be removed).
   */
  private async lastOpenOnInquiry(rows: { id: string; inquiryId: string | null; doneAt: Date | null; auto: string | null }[]): Promise<Set<string>> {
    const mine = rows.filter((r) => !r.doneAt && r.inquiryId);
    const ids = [...new Set(mine.map((r) => r.inquiryId!))];
    if (!ids.length) return new Set();
    const [open, counts] = await Promise.all([
      this.prisma.db.inquiry.findMany({ where: { id: { in: ids }, deletedAt: null, stage: { in: [...OPEN_STAGES] } }, select: { id: true, stage: true } }),
      this.prisma.db.followUp.groupBy({ by: ["inquiryId"], where: { inquiryId: { in: ids }, doneAt: null }, _count: { _all: true } }),
    ]);
    const stageOf = new Map(open.map((i) => [i.id, i.stage]));
    const left = new Map(counts.map((c) => [c.inquiryId, c._count._all]));
    // While the customer has not answered a quotation, the system sets the next one itself (after 3, 7, 14 days).
    const systemGoesOn = (r: (typeof mine)[number]) => stageOf.get(r.inquiryId!) === "quoted" && nextQuoteStep(r.auto) !== null;
    return new Set(mine.filter((r) => stageOf.has(r.inquiryId!) && (left.get(r.inquiryId) ?? 0) <= 1 && !systemGoesOn(r)).map((r) => r.id));
  }

  private views(user: SessionUser, rows: FollowUpRow[], labels: Map<string, RecordRef>, last: Set<string> = new Set()) {
    const { today, time } = this.now();
    return rows.map((r) => {
      const t = targetOf(r);
      const ref = t ? labels.get(`${t.type}:${t.id}`) : undefined;
      const dueOn = fromDbDate(r.dueOn);
      const mayChange = this.changes(user, r);
      return {
        id: r.id,
        title: r.title,
        kind: r.kind as FollowUpKind,
        /** The day it is due (YYYY-MM-DD, the company's calendar). */
        dueOn,
        /** "HH:MM" that day in the company's time zone, or null (some time that day). */
        dueAt: r.dueAt,
        place: r.place,
        note: r.note,
        /** The record it is on: { type: inquiry | order | customer | factory, id, label } or null. */
        target: t ? { type: t.type, id: t.id, label: ref?.label ?? "" } : null,
        /** Where it opens: the record, or the follow-ups list. */
        link: ref?.link ?? FOLLOW_UPS_LINK,
        assignee: r.assignee,
        createdBy: r.createdBy,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        done: !!r.doneAt,
        doneAt: r.doneAt,
        doneBy: r.doneBy,
        doneNote: r.doneNote,
        late: isLate({ doneAt: r.doneAt, dueOn, dueAt: r.dueAt }, today, time),
        /** The last open follow-up of an open inquiry: finishing it asks for the next one. */
        needsNext: last.has(r.id),
        can: { edit: mayChange, done: mayChange, delete: mayChange && !last.has(r.id) },
      };
    });
  }

  private async viewsOf(user: SessionUser, rows: FollowUpRow[]) {
    const refs = rows.map(targetOf).filter((t): t is { type: RecordType; id: string } => !!t);
    return this.views(user, rows, await recordLabels(this.prisma.db, refs), await this.lastOpenOnInquiry(rows));
  }

  private async view(user: SessionUser, id: string) {
    const row = await this.prisma.db.followUp.findUniqueOrThrow({ where: { id }, include: followUpInclude });
    return (await this.viewsOf(user, [row]))[0]!;
  }

  /** The person it is for: anyone active in the company (not the platform's hidden accounts). */
  private async checkAssignee(id: string) {
    const found = await this.prisma.db.user.count({ where: { id, isActive: true, isSystem: false, platformAdminId: null } });
    if (!found) throw new DomainError("Choose someone who works here and is active.");
  }

  /** The record, checked: the person must see it (404 / 403 as its own page answers). */
  private async record(user: SessionUser, t: { type: RecordType; id: string } | null) {
    return t ? seeRecord(this.prisma.db, user, t.type, t.id) : null;
  }

  /** One they may see: theirs (for them or made by them), on a record they see, or any with followups.viewAll. */
  private async visible(user: SessionUser, id: string) {
    const row = await this.prisma.db.followUp.findUnique({ where: { id }, include: followUpInclude });
    if (!row) throw new NotFoundError("Follow-up");
    if (this.changes(user, row)) return row;
    const t = targetOf(row);
    if (t) {
      const sees = await seeRecord(this.prisma.db, user, t.type, t.id).then(
        () => true,
        () => false,
      );
      if (sees) return row;
    }
    throw new NotFoundError("Follow-up");
  }

  private async forChange(user: SessionUser, id: string) {
    const row = await this.visible(user, id);
    if (!this.changes(user, row)) throw new ForbiddenError("Only the person it is for, who made it, or a manager can change a follow-up.");
    return row;
  }

  /** In the record's history (general ones in the audit log only). */
  private async history(tx: Tx, user: SessionUser, ref: RecordRef | null, action: string, id: string, summary: string, values: Record<string, unknown> = {}) {
    await this.audit.record(tx, {
      userId: user.id,
      action,
      entityType: ref?.type ?? "follow_up",
      entityId: ref?.id ?? id,
      summary: ref ? `${ref.label}: ${summary}` : summary,
      newValues: { followUp: id, ...values },
    });
  }

  private async tellAssignee(actor: SessionUser, row: FollowUpRow, ref: RecordRef | null) {
    const when = dueWords(fromDbDate(row.dueOn), row.dueAt);
    const [refNo, ...rest] = (ref?.label ?? "").split(" · ");
    const kind = FOLLOW_UP_KIND_LABEL[row.kind as FollowUpKind].toLowerCase();
    await this.notifications.send(
      {
        kind: "followUp.assigned",
        group: "followups",
        tag: "Follow-up for you",
        subject: `${actor.name} gave you a follow-up: ${row.title}, ${when}`,
        sentence: `${actor.name} planned ${kind === "other" ? "a follow-up" : `a ${kind}`} for you on ${when}${row.place ? ` at ${row.place}` : ""}.${row.note ? `\n${row.note}` : ""}`,
        where: ref ? { ref: refNo!, title: rest.join(" · ") || row.title } : null,
        people: rowsOf([
          ["About", ref?.label],
          ["Given by", actor.name],
        ]),
        next: `${row.title}, ${when}${row.place ? ` at ${row.place}` : ""}. When done, say what happened and set the next one.`,
        button: "Open the follow-up",
        link: ref?.link ?? FOLLOW_UPS_LINK,
      },
      [{ ids: [row.assigneeId], as: "the person it is for" }],
      { actorId: actor.id },
    );
  }

  /* ---------------------------------------------------------------- reading */

  /**
   * ?mine=true: those for me. Otherwise everyone's with followups.viewAll, else those for me or made by me.
   * With inquiryId | orderId | customerId | factoryId: every one on that record (when I see it).
   * ?on= / ?from= / ?to=: by the day due; ?open=true: not done, ?open=false: done.
   * Open ones by when they are due (those without a time first that day); done ones the latest done first.
   */
  async list(user: SessionUser, q: FollowUpListQuery) {
    const t = targetOf(q);
    if (t) await seeRecord(this.prisma.db, user, t.type, t.id);
    const scope: Prisma.FollowUpWhereInput[] = [];
    if (t)
      scope.push(
        t.type === "inquiry" ? { inquiryId: t.id } : t.type === "order" ? { orderId: t.id } : t.type === "customer" ? { customerId: t.id } : { factoryId: t.id },
      );
    if (q.mine) scope.push({ assigneeId: user.id });
    else if (!t && !can(user, "followups.viewAll")) scope.push({ OR: [{ assigneeId: user.id }, { createdById: user.id }] });
    if (q.on) scope.push({ dueOn: toDbDate(q.on) });
    if (q.from) scope.push({ dueOn: { gte: toDbDate(q.from) } });
    if (q.to) scope.push({ dueOn: { lte: toDbDate(q.to) } });
    if (q.who) scope.push({ assigneeId: q.who });
    if (q.q) scope.push({ OR: (["title", "place", "note"] as const).map((f) => ({ [f]: { contains: q.q, mode: "insensitive" as const } })) });
    if (q.about)
      scope.push(
        q.about === "none"
          ? { inquiryId: null, orderId: null, customerId: null, factoryId: null }
          : { [`${q.about}Id`]: { not: null } },
      );
    const { today, time } = this.now();
    const lateWhere: Prisma.FollowUpWhereInput = { doneAt: null, OR: [{ dueOn: { lt: toDbDate(today) } }, { dueOn: toDbDate(today), dueAt: { lt: time } }] };
    const base: Prisma.FollowUpWhereInput = { AND: scope };
    const where: Prisma.FollowUpWhereInput = q.late
      ? { AND: [...scope, lateWhere] }
      : q.open === undefined
        ? base
        : { AND: [...scope, q.open ? { doneAt: null } : { doneAt: { not: null } }] };
    const [rows, total, open, done, lateDays, lateToday] = await Promise.all([
      this.prisma.db.followUp.findMany({
        where,
        include: followUpInclude,
        orderBy:
          q.open === false
            ? [{ doneAt: "desc" }, { id: "asc" }]
            : [{ dueOn: "asc" }, { dueAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }, { id: "asc" }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.db.followUp.count({ where }),
      this.prisma.db.followUp.count({ where: { AND: [...scope, { doneAt: null }] } }),
      this.prisma.db.followUp.count({ where: { AND: [...scope, { doneAt: { not: null } }] } }),
      this.prisma.db.followUp.count({ where: { AND: [...scope, { doneAt: null, dueOn: { lt: toDbDate(today) } }] } }),
      this.prisma.db.followUp.count({ where: { AND: [...scope, { doneAt: null, dueOn: toDbDate(today), dueAt: { lt: time } }] } }),
    ]);
    return {
      rows: await this.viewsOf(user, rows),
      total,
      page: q.page,
      pageSize: q.pageSize,
      /** For the same filters, whatever ?open says. */
      counts: { open, done, late: lateDays + lateToday },
      /** Whether this person may see everyone's (the list's "Everyone" choice). */
      canViewAll: can(user, "followups.viewAll"),
    };
  }

  async get(user: SessionUser, id: string) {
    await this.visible(user, id);
    return this.view(user, id);
  }

  /** GET /me/today: my open follow-ups due today or earlier, by when they are due; `late` on each. */
  async today(user: SessionUser) {
    const { today, time } = this.now();
    const rows = await this.prisma.db.followUp.findMany({
      where: { assigneeId: user.id, doneAt: null, dueOn: { lte: toDbDate(today) } },
      include: followUpInclude,
      orderBy: [{ dueOn: "asc" }, { dueAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }, { id: "asc" }],
      take: 200,
    });
    const views = await this.viewsOf(user, rows);
    return { today, now: time, total: views.length, late: views.filter((v) => v.late).length, rows: views };
  }

  /* ---------------------------------------------------------------- changing */

  async create(user: SessionUser, input: FollowUpInput) {
    const t = targetOf(input);
    const ref = await this.record(user, t);
    const assigneeId = input.assigneeId ?? user.id;
    if (assigneeId !== user.id) await this.checkAssignee(assigneeId);
    const id = await this.prisma.tx(async (tx) => {
      const row = await tx.followUp.create({
        data: {
          title: input.title,
          kind: input.kind,
          dueOn: toDbDate(input.dueOn),
          dueAt: input.dueAt,
          place: input.place,
          note: input.note,
          ...columnsFor(t),
          assigneeId,
          createdById: user.id,
          // The service's clock (as "today" and the reminders read it).
          createdAt: this.clock.now(),
        },
        include: followUpInclude,
      });
      await this.history(
        tx,
        user,
        ref,
        "follow_up.added",
        row.id,
        `${user.name} planned a ${FOLLOW_UP_KIND_LABEL[input.kind].toLowerCase()} for ${assigneeId === user.id ? "themselves" : row.assignee.name} on ${dueWords(input.dueOn, input.dueAt)}: ${row.title}`,
        { assignee: row.assignee.name, dueOn: input.dueOn, dueAt: input.dueAt },
      );
      return row.id;
    });
    const row = await this.prisma.db.followUp.findUniqueOrThrow({ where: { id }, include: followUpInclude });
    if (assigneeId !== user.id) await this.tellAssignee(user, row, ref);
    return this.view(user, id);
  }

  /** The fields sent change; the record changes when any of its four ids is sent; a new person is told. */
  async edit(user: SessionUser, id: string, input: FollowUpEditInput) {
    const before = await this.forChange(user, id);
    const moving = TARGET_KEYS.some(([, key]) => input[key] !== undefined);
    const t = moving ? targetOf(input) : targetOf(before);
    const same = !moving || (targetOf(before)?.type === t?.type && targetOf(before)?.id === t?.id);
    // A new record must be one they see; the one it was on is kept even if they no longer see it.
    const ref = same ? (t ? ((await recordLabels(this.prisma.db, [t])).get(`${t.type}:${t.id}`) ?? null) : null) : await this.record(user, t);
    if (input.assigneeId && input.assigneeId !== before.assigneeId) await this.checkAssignee(input.assigneeId);
    const data: Prisma.FollowUpUncheckedUpdateInput = {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
      ...(input.dueOn !== undefined ? { dueOn: toDbDate(input.dueOn) } : {}),
      ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
      ...(input.place !== undefined ? { place: input.place } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
      ...(moving ? columnsFor(t) : {}),
      ...(input.assigneeId ? { assigneeId: input.assigneeId } : {}),
    };
    const after = await this.prisma.tx(async (tx) => {
      const row = await tx.followUp.update({ where: { id }, data, include: followUpInclude });
      const pick = (r: FollowUpRow) => ({
        title: r.title,
        kind: r.kind,
        due: dueWords(fromDbDate(r.dueOn), r.dueAt),
        place: r.place,
        note: r.note,
        assignee: r.assignee.name,
      });
      const old = pick(before);
      const now = pick(row);
      const changed = Object.fromEntries(Object.entries(now).filter(([k, v]) => old[k as keyof typeof old] !== v));
      await this.audit.record(tx, {
        userId: user.id,
        action: "follow_up.changed",
        entityType: ref?.type ?? "follow_up",
        entityId: ref?.id ?? id,
        summary: `${ref ? `${ref.label}: ` : ""}${user.name} changed the follow-up "${row.title}"`,
        oldValues: Object.fromEntries(Object.keys(changed).map((k) => [k, old[k as keyof typeof old]])),
        newValues: { followUp: id, ...changed },
      });
      return row;
    });
    if (after.assigneeId !== before.assigneeId) await this.tellAssignee(user, after, ref);
    return this.view(user, id);
  }

  /**
   * Ticks it done (again: no change), with what came of it. The last open follow-up of an open inquiry is
   * finished together with the next one (`next`), made in the same save: the inquiry is never left alone.
   */
  async done(user: SessionUser, id: string, note: string | null, next?: FollowUpDoneInput["next"]) {
    const row = await this.forChange(user, id);
    let made: FollowUpRow | null = null;
    if (!row.doneAt) {
      const last = (await this.lastOpenOnInquiry([row])).has(row.id);
      if (last && !next) throw new GateError("Set the next follow-up for this inquiry (or mark the inquiry won or lost).", "next_follow_up");
      if (next && next.dueOn < this.clock.today()) throw new DomainError("Choose today or a later day for the next follow-up.");
      const nextFor = next?.assigneeId ?? row.assigneeId;
      if (next && nextFor !== row.assigneeId && nextFor !== user.id) await this.checkAssignee(nextFor);
      // A quotation's follow-up set by the system, and the customer has not answered: the system sets the one after it.
      const step = next ? null : await this.quoteStepAfter(row);
      const ref = await this.labelOf(row);
      made = await this.prisma.tx(async (tx) => {
        const done = await tx.followUp.updateMany({ where: { id, doneAt: null }, data: { doneAt: this.clock.now(), doneById: user.id, doneNote: note } });
        if (!done.count) return null;
        await this.history(tx, user, ref, "follow_up.done", id, `${user.name} did "${row.title}"${note ? `: ${note}` : ""}`);
        if (!next && !step) return null;
        const dueOn = next ? next.dueOn : step!.dueOn;
        const after = await tx.followUp.create({
          data: {
            title: next?.title ?? row.title,
            kind: row.kind,
            dueOn: toDbDate(dueOn),
            dueAt: next?.dueAt ?? null,
            inquiryId: row.inquiryId,
            orderId: row.orderId,
            customerId: row.customerId,
            factoryId: row.factoryId,
            assigneeId: nextFor,
            createdById: next ? user.id : row.createdById,
            auto: next ? null : step!.auto,
            createdAt: this.clock.now(),
          },
          include: followUpInclude,
        });
        const who = nextFor === user.id ? "themselves" : after.assignee.name;
        await this.history(
          tx,
          user,
          ref,
          "follow_up.added",
          after.id,
          next ? `${user.name} set the next follow-up for ${who} on ${dueWords(dueOn, after.dueAt)}: ${after.title}` : `The next follow-up is set for ${dueWords(dueOn, null)}: ${after.title}`,
          { assignee: after.assignee.name, dueOn, dueAt: after.dueAt },
        );
        return after;
      });
      if (made && next && made.assigneeId !== user.id) await this.tellAssignee(user, made, ref);
    }
    return { ...(await this.view(user, id)), next: made ? await this.view(user, made.id) : null };
  }

  /** The system's next follow-up on a sent quotation the customer has not answered: 7, then 14 days after it was sent, and never before tomorrow. */
  private async quoteStepAfter(row: FollowUpRow): Promise<{ auto: string; dueOn: ISODate } | null> {
    const step = nextQuoteStep(row.auto);
    if (!step || !row.inquiryId) return null;
    const inquiry = await this.prisma.db.inquiry.findFirst({ where: { id: row.inquiryId, deletedAt: null, stage: "quoted" }, select: { id: true } });
    if (!inquiry) return null;
    const planned = addDays(fromDbDate(row.dueOn), step.gap);
    const tomorrow = addDays(this.clock.today(), 1);
    return { auto: step.auto, dueOn: planned > tomorrow ? planned : tomorrow };
  }

  /** Not done after all (again: no change). */
  async reopen(user: SessionUser, id: string) {
    const row = await this.forChange(user, id);
    if (row.doneAt) {
      const ref = await this.labelOf(row);
      await this.prisma.tx(async (tx) => {
        const open = await tx.followUp.updateMany({ where: { id, doneAt: { not: null } }, data: { doneAt: null, doneById: null, doneNote: null } });
        if (!open.count) return;
        await this.history(tx, user, ref, "follow_up.reopened", id, `${user.name} reopened "${row.title}"`);
      });
    }
    return this.view(user, id);
  }

  async remove(user: SessionUser, id: string) {
    const row = await this.forChange(user, id);
    if ((await this.lastOpenOnInquiry([row])).has(row.id))
      throw new GateError("This is the inquiry's only open follow-up. Move it to another day, or finish it and set the next one.", "last_follow_up");
    const ref = await this.labelOf(row);
    await this.prisma.tx(async (tx) => {
      await tx.followUp.delete({ where: { id } });
      await this.history(tx, user, ref, "follow_up.removed", id, `${user.name} removed the follow-up "${row.title}"`);
    });
    return { ok: true };
  }

  private async labelOf(row: FollowUpRow) {
    const t = targetOf(row);
    return t ? ((await recordLabels(this.prisma.db, [t])).get(`${t.type}:${t.id}`) ?? null) : null;
  }

  /* ---------------------------------------------------------------- reminders */

  /**
   * The worker's reminders (every few minutes, each company in its own context). A follow-up never stops
   * reminding until it is done or moved to another day:
   *  - the day it is due, from the morning hour (REMINDER_HOUR): `followUp.due` to the person it is for
   *    (those made before that day began), and when it has a time, again from 30 minutes before it;
   *  - every morning after, while it is not done: `followUp.missed` to the person (one by one up to
   *    three, more as one summary);
   *  - from FOLLOW_UP_ESCALATE_DAYS missed, every morning: `followUp.missedTold` to the managers and to
   *    who gave it;
   *  - and one email a morning to each of them with the whole list (when the company's email is set up).
   * Each alert carries a dedupe key with its day (and time), so running again sends nothing twice.
   * `force`: without waiting for the morning hour (an admin pressed "run now").
   */
  async remind(force = false, book?: DayBook): Promise<number> {
    const tz = this.clock.timeZone;
    const moment = this.clock.now();
    const today = this.clock.today();
    const morning = force || Number(timeIn(moment, tz).slice(0, 2)) >= REMINDER_HOUR;
    const rows = await this.prisma.db.followUp.findMany({
      where: { doneAt: null, dueOn: { lte: toDbDate(addDays(today, 1)) }, assignee: { isActive: true } },
      include: followUpInclude,
      orderBy: [{ dueOn: "asc" }, { createdAt: "asc" }],
    });
    if (!rows.length) return 0;
    const labels = await recordLabels(
      this.prisma.db,
      rows.map(targetOf).filter((t): t is { type: RecordType; id: string } => !!t),
    );
    const refOf = (r: FollowUpRow) => {
      const t = targetOf(r);
      return t ? labels.get(`${t.type}:${t.id}`) : undefined;
    };
    const plain = (r: FollowUpRow) => ({ title: r.title, dueOn: fromDbDate(r.dueOn), dueAt: r.dueAt, place: r.place, note: r.note });
    const one = { email: false } as const;
    let sent = 0;
    type Missed = { row: FollowUpRow; days: number; ref: RecordRef | undefined };
    const missedFor = new Map<string, Missed[]>();
    for (const r of rows) {
      const dueOn = fromDbDate(r.dueOn);
      const ref = refOf(r);
      if (dueOn < today) {
        missedFor.set(r.assigneeId, [...(missedFor.get(r.assigneeId) ?? []), { row: r, days: daysBetween(dueOn, today), ref }]);
        continue;
      }
      if (dueOn === today) book?.add([r.assigneeId], "Follow-ups today", { ...splitLabel(ref?.label), what: r.title, when: r.dueAt ?? "today" });
      const at = r.dueAt ? momentIn(dueOn, r.dueAt, tz) : null;
      const soon = at ? moment.getTime() >= at.getTime() - 30 * 60_000 : false;
      const to = [{ ids: [r.assigneeId], as: "the person it is for" }];
      // The day's reminder: made before the day began, and not already inside the half hour before its time.
      if (morning && dueOn === today && r.createdAt < startOfDayIn(dueOn, tz) && !soon)
        sent += await this.notifications.send(followUpToday(plain(r), ref ?? null, null), to, { ...one, dedupeKey: `followup:${r.id}:day:${dueOn}` });
      if (at && soon && moment.getTime() <= at.getTime()) {
        const minutes = Math.max(Math.round((at.getTime() - moment.getTime()) / 60_000), 0);
        sent += await this.notifications.send(followUpToday(plain(r), ref ?? null, minutes), to, { ...one, dedupeKey: `followup:${r.id}:at:${dueOn}T${r.dueAt}` });
      }
    }
    if (!morning) return sent;

    const daysWords = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
    const rowOf = (m: Missed, who = false) => ({ ...splitLabel(m.ref?.label), what: `${who ? `${m.row.assignee.name}: ` : ""}${m.row.title}`, when: `missed ${daysWords(m.days)}`, late: true });

    // Every morning, to the person it is for: the oldest first; many as one list so a backlog does not bury them.
    for (const [userId, items] of missedFor) {
      items.sort((a, b) => b.days - a.days);
      for (const m of items) book?.add([userId], "Missed", rowOf(m));
      const to = [{ ids: [userId], as: "the person it is for" }];
      if (items.length <= 3) {
        for (const m of items) sent += await this.notifications.send(followUpMissed(plain(m.row), m.ref ?? null, m.days, null), to, { ...one, dedupeKey: `followup:${m.row.id}:missed:${today}` });
      } else {
        const x = items[0]!;
        sent += await this.notifications.send(followUpsMissed(items.map((m) => rowOf(m)), false, `${daysWords(x.days)}: ${x.row.title}`), to, { ...one, dedupeKey: `followup:missed:${today}:${userId}` });
      }
    }

    // Missed long enough: the managers and who gave it are told too, every morning until it is done.
    const managers = await this.notifications.managerIds();
    const toldFor = new Map<string, Missed[]>();
    for (const [userId, items] of missedFor)
      for (const m of items.filter((x) => x.days >= FOLLOW_UP_ESCALATE_DAYS))
        for (const to of new Set([...managers, m.row.createdById]))
          if (to !== userId) toldFor.set(to, [...(toldFor.get(to) ?? []), m]);
    for (const [to, items] of toldFor) {
      items.sort((a, b) => b.days - a.days);
      for (const m of items) book?.add([to], "Missed by your team", rowOf(m, true));
      const who = [{ ids: [to], as: "a manager, or who gave it" }];
      if (items.length <= 3) {
        for (const m of items)
          sent += await this.notifications.send(followUpMissed(plain(m.row), m.ref ?? null, m.days, m.row.assignee.name), who, { ...one, dedupeKey: `followup:${m.row.id}:missed-told:${today}` });
      } else {
        const x = items[0]!;
        sent += await this.notifications.send(followUpsMissed(items.map((m) => rowOf(m, true)), true, `${x.row.assignee.name}: ${x.row.title} (${daysWords(x.days)})`), who, {
          ...one,
          dedupeKey: `followup:missed-told:${today}:${to}`,
        });
      }
    }
    return sent;
  }
}
