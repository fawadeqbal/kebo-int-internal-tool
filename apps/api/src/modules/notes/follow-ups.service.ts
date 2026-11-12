import { Injectable } from "@nestjs/common";
import { fromDbDate, toDbDate, type Prisma } from "@kebo/database";
import { can, FOLLOW_UP_KIND_LABEL, type FollowUpEditInput, type FollowUpInput, type FollowUpKind, type FollowUpListQuery } from "@kebo/shared";
import { addDays, DomainError, ForbiddenError, NotFoundError, startOfDayIn, type ISODate } from "@kebo/utils";
import { PrismaService, type Tx } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { Clock } from "../../common/time/clock.service";
import type { SessionUser } from "../../common/auth/session-user";
import { NotificationsService } from "../notifications/notifications.service";
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

  private views(user: SessionUser, rows: FollowUpRow[], labels: Map<string, RecordRef>) {
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
        can: { edit: mayChange, done: mayChange, delete: mayChange },
      };
    });
  }

  private async viewsOf(user: SessionUser, rows: FollowUpRow[]) {
    const refs = rows.map(targetOf).filter((t): t is { type: RecordType; id: string } => !!t);
    return this.views(user, rows, await recordLabels(this.prisma.db, refs));
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
    await this.notifications.notify(
      [row.assigneeId],
      {
        type: "followUp.assigned",
        title: `${actor.name} gave you a follow-up: ${row.title}`,
        body: [dueWords(fromDbDate(row.dueOn), row.dueAt), ref?.label, row.place].filter(Boolean).join(" · "),
        link: ref?.link ?? FOLLOW_UPS_LINK,
      },
      actor.id,
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

  /** Ticks it done (again: no change), with what came of it. */
  async done(user: SessionUser, id: string, note: string | null) {
    const row = await this.forChange(user, id);
    if (!row.doneAt) {
      const ref = await this.labelOf(row);
      await this.prisma.tx(async (tx) => {
        const done = await tx.followUp.updateMany({ where: { id, doneAt: null }, data: { doneAt: this.clock.now(), doneById: user.id, doneNote: note } });
        if (!done.count) return;
        await this.history(tx, user, ref, "follow_up.done", id, `${user.name} did "${row.title}"${note ? `: ${note}` : ""}`);
      });
    }
    return this.view(user, id);
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
   * The worker's reminders (every few minutes, each company in its own context): `followUp.due` to the
   * person it is for at the start of the day it is due (only for those made before that day began) and,
   * when it has a time, again from 30 minutes before it until the time. Each carries a dedupe key with its
   * day (and time), so nothing is sent twice; moving it to another day or time reminds again.
   */
  async remind(): Promise<number> {
    const tz = this.clock.timeZone;
    const moment = this.clock.now();
    const today = this.clock.today();
    const rows = await this.prisma.db.followUp.findMany({
      where: {
        doneAt: null,
        dueOn: { gte: toDbDate(today), lte: toDbDate(addDays(today, 1)) },
        assignee: { isActive: true },
      },
      include: followUpInclude,
    });
    if (!rows.length) return 0;
    const labels = await recordLabels(
      this.prisma.db,
      rows.map(targetOf).filter((t): t is { type: RecordType; id: string } => !!t),
    );
    let sent = 0;
    for (const r of rows) {
      const dueOn = fromDbDate(r.dueOn);
      const t = targetOf(r);
      const ref = t ? labels.get(`${t.type}:${t.id}`) : undefined;
      const link = ref?.link ?? FOLLOW_UPS_LINK;
      const at = r.dueAt ? momentIn(dueOn, r.dueAt, tz) : null;
      const soon = at ? moment.getTime() >= at.getTime() - 30 * 60_000 : false;
      // The day's reminder: made before the day began, and not already inside the half hour before its time.
      if (dueOn === today && r.createdAt < startOfDayIn(dueOn, tz) && !soon)
        sent += await this.notifications.notify([r.assigneeId], {
          type: "followUp.due",
          title: `Today: ${r.title}${r.dueAt ? ` · ${r.dueAt}` : ""}`,
          body: [ref?.label, r.place].filter(Boolean).join(" · ") || null,
          link,
          dedupeKey: `followup:${r.id}:day:${dueOn}`,
        });
      if (at && soon && moment.getTime() <= at.getTime()) {
        const minutes = Math.max(Math.round((at.getTime() - moment.getTime()) / 60_000), 0);
        sent += await this.notifications.notify([r.assigneeId], {
          type: "followUp.due",
          title: `At ${r.dueAt}: ${r.title}`,
          body: [minutes ? `in ${minutes} min` : "now", ref?.label, r.place].filter(Boolean).join(" · "),
          link,
          dedupeKey: `followup:${r.id}:at:${dueOn}T${r.dueAt}`,
        });
      }
    }
    return sent;
  }
}
