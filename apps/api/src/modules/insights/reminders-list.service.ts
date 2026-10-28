import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { fromDbDate, fromDbDateOrNull, toDbDate } from "@kebo/database";
import { can, OPEN_STAGES } from "@kebo/shared";
import { addDays, daysBetween, type ISODate } from "@kebo/utils";
import { PrismaService } from "../../database/prisma.service";
import { Clock } from "../../common/time/clock.service";
import { ReadCache } from "../../common/cache/read-cache";
import type { SessionUser } from "../../common/auth/session-user";
import { SettingsService } from "../settings/settings.service";
import { OrdersService } from "../orders/orders.service";
import { inquiryAccess } from "../inquiries/inquiries.service";
import { LeaksService } from "../money/leaks.service";
import { LimitsService } from "../../common/company/limits.service";

export type ReminderLevel = "bad" | "warn" | "info";
export type ReminderKind = "order" | "quote" | "deal" | "offer" | "money";

export interface Reminder {
  /** Stable while the same thing needs doing (marking it done or snoozing is kept against it). */
  key: string;
  kind: ReminderKind;
  level: ReminderLevel;
  title: string;
  detail: string | null;
  /** When it is (or was) due. */
  due: ISODate | null;
  href: string;
  action: string;
  /** Who handles it, shown to managers. */
  who: string | null;
}

const LEVEL_ORDER: Record<ReminderLevel, number> = { bad: 0, warn: 1, info: 2 };
const MAX_ITEMS = 100;
const shortHash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 12);

/**
 * "Needs attention" on Home: what each person has to do now, worked out from
 * the data every time — orders that need a step or money, quotations about to
 * expire or with no answer, deals nobody started or past their needed-by date,
 * factory prices running out, and (for managers) the money warnings. A person
 * can mark one done or put it off; it comes back when it changes.
 */
@Injectable()
export class RemindersListService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly settings: SettingsService,
    private readonly orders: OrdersService,
    private readonly leaks: LeaksService,
    private readonly cache: ReadCache,
    private readonly limits: LimitsService,
  ) {}

  async list(user: SessionUser) {
    const today = this.clock.today();
    // Worked out once per person while nothing changes (ReadCache); done and put-off are applied fresh.
    // The money warnings come from Insights and expenses (plan features): part of the key, so a plan change shows at once.
    const warnings = (await this.limits.allows("insights")) && (await this.limits.allows("expenses"));
    const items = await this.cache.get(`reminders:${user.id}:${today}:${warnings}`, () => this.build(user, today, warnings));
    return this.withStates(user, items, today);
  }

  private async build(user: SessionUser, today: ISODate, warnings: boolean): Promise<Reminder[]> {
    const s = await this.settings.get();
    const manager = can(user, "inquiries.viewAll");
    const scope = { deletedAt: null, ...inquiryAccess(user) };
    const items: Reminder[] = [];
    const nameOf = (u: { name: string } | null | undefined) => (manager ? (u?.name ?? "Nobody") : null);

    // 1. Orders: the next step or the money each one needs (mine; managers also every late one).
    const mine = await this.orders.todo(user);
    const late = manager ? (await this.orders.list(user, { status: "open", lateOnly: true })).filter((o) => !mine.some((m) => m.id === o.id)) : [];
    for (const o of [...mine, ...late]) {
      if (!o.needs) continue;
      const days = o.needs.late ? daysBetween(o.needs.due, today) : 0;
      items.push({
        key: `order:${o.id}:${o.needs.due}`,
        kind: o.needs.title.match(/deposit|balance|pay/i) ? "money" : "order",
        level: o.needs.late ? "bad" : o.needs.due <= addDays(today, s.reminders.dueSoonDays) ? "warn" : "info",
        title: `${o.refNo}: ${o.needs.title}`,
        detail: `${o.customer.name} · ${o.needs.late ? `${days} day${days === 1 ? "" : "s"} late` : `by ${o.needs.due}`}`,
        due: o.needs.due,
        href: `/orders/${o.id}`,
        action: "Open the order",
        who: nameOf(o.inquiry.assignee),
      });
    }

    // 2. Sent quotations: about to expire, or waiting for an answer for a while.
    const quotes = await this.prisma.db.quotationRevision.findMany({
      where: { deletedAt: null, status: "sent", quotation: { inquiry: { ...scope, onHold: false } } },
      select: {
        id: true,
        number: true,
        sentOn: true,
        validUntil: true,
        quotation: { select: { refNo: true, inquiry: { select: { id: true, customer: { select: { name: true } }, assignee: { select: { name: true } } } } } },
      },
    });
    for (const q of quotes) {
      const until = fromDbDate(q.validUntil);
      const sent = fromDbDateOrNull(q.sentOn);
      const label = `${q.quotation.refNo} R${q.number}`;
      const d = q.quotation.inquiry;
      if (until <= addDays(today, s.reminders.dueSoonDays))
        items.push({
          key: `quote:${q.id}:expiring`,
          kind: "quote",
          level: until < addDays(today, 2) ? "bad" : "warn",
          title: `${label} expires ${until === today ? "today" : `on ${until}`}: no answer yet`,
          detail: `${d.customer.name} · follow up, or give a new validity`,
          due: until,
          href: `/inquiries/${d.id}/quotation`,
          action: "Follow up",
          who: nameOf(d.assignee),
        });
      else if (sent && sent <= addDays(today, -5))
        items.push({
          key: `quote:${q.id}:waiting`,
          kind: "quote",
          level: "info",
          title: `${label}: no answer for ${daysBetween(sent, today)} days`,
          detail: `${d.customer.name} · a short follow-up message often wins it`,
          due: addDays(sent, 5),
          href: `/inquiries/${d.id}/quotation`,
          action: "Follow up",
          who: nameOf(d.assignee),
        });
    }

    // 3. Deals: nobody on a new one, a new one not started, needed-by date passed.
    const deals = await this.prisma.db.inquiry.findMany({
      where: { ...scope, onHold: false, stage: { in: [...OPEN_STAGES] } },
      select: { id: true, refNo: true, title: true, stage: true, createdAt: true, requiredBy: true, assigneeId: true, assignee: { select: { name: true } }, customer: { select: { name: true } } },
    });
    for (const d of deals) {
      const created = d.createdAt.toISOString().slice(0, 10);
      const needed = fromDbDateOrNull(d.requiredBy);
      if (d.stage === "new" && !d.assigneeId && manager && created <= addDays(today, -1))
        items.push({
          key: `deal:${d.id}:unassigned`,
          kind: "deal",
          level: "warn",
          title: `${d.refNo}: nobody handles it yet`,
          detail: `${d.customer.name} · ${d.title}`,
          due: created,
          href: `/inquiries/${d.id}`,
          action: "Assign someone",
          who: null,
        });
      else if (d.stage === "new" && d.assigneeId && created <= addDays(today, -s.reminders.newDays))
        items.push({
          key: `deal:${d.id}:new`,
          kind: "deal",
          level: "warn",
          title: `${d.refNo}: not started after ${daysBetween(created, today)} days`,
          detail: `${d.customer.name} · get factory prices`,
          due: addDays(created, s.reminders.newDays),
          href: `/inquiries/${d.id}/sourcing`,
          action: "Get prices",
          who: nameOf(d.assignee),
        });
      if (needed && needed < today)
        items.push({
          key: `deal:${d.id}:needed:${needed}`,
          kind: "deal",
          level: "bad",
          title: `${d.refNo}: the customer needed it by ${needed}`,
          detail: `${d.customer.name} · ${d.title}`,
          due: needed,
          href: `/inquiries/${d.id}`,
          action: "Open the inquiry",
          who: nameOf(d.assignee),
        });
    }

    // 4. Factory prices running out on deals still open.
    if (can(user, "sourcing.manage")) {
      const offers = await this.prisma.db.factoryQuote.findMany({
        where: { deletedAt: null, validUntil: { lte: toDbDate(addDays(today, 3)) }, inquiry: { ...scope, onHold: false, stage: { in: ["sourcing", "quoted"] } } },
        select: { id: true, validUntil: true, factory: { select: { name: true } }, inquiry: { select: { id: true, refNo: true, assignee: { select: { name: true } } } } },
      });
      for (const f of offers) {
        const until = fromDbDate(f.validUntil!);
        items.push({
          key: `offer:${f.id}:${until}`,
          kind: "offer",
          level: until < today ? "warn" : "info",
          title: `${f.inquiry.refNo}: ${f.factory.name}'s price ${until < today ? "ran out" : "runs out"} ${until === today ? "today" : `on ${until}`}`,
          detail: "Confirm it with the factory, or get a new price",
          due: until,
          href: `/inquiries/${f.inquiry.id}/sourcing`,
          action: "Check the price",
          who: nameOf(f.inquiry.assignee),
        });
      }
    }

    // 5. Managers: the money warnings (orders losing money, money stuck, expense jumps…).
    if (warnings && can(user, "expenses.manage")) {
      const r = await this.leaks.report(user, {});
      for (const w of r.warnings)
        items.push({
          key: `warn:${shortHash(`${w.href}:${w.text.replace(/[\d.,]+/g, "#")}`)}`,
          kind: "money",
          level: w.level,
          title: w.text,
          detail: null,
          due: null,
          href: w.href ?? "/insights?tab=profit",
          action: "Open",
          who: null,
        });
    }

    return items;
  }

  /** Leaves out what this person marked done, or put off until later; the most urgent first. */
  private async withStates(user: SessionUser, items: Reminder[], today: ISODate) {
    const states = await this.prisma.db.reminderState.findMany({ where: { userId: user.id, key: { in: items.map((i) => i.key) } } });
    const hidden = new Map(states.filter((x) => x.doneAt || (x.snoozedUntil && fromDbDate(x.snoozedUntil) > today)).map((x) => [x.key, x]));
    const shown = items
      .filter((i) => !hidden.has(i.key))
      .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || (a.due ?? "9999").localeCompare(b.due ?? "9999"));
    // The most urgent hundred are plenty for a screen; the counts are for all of them.
    return {
      items: shown.slice(0, MAX_ITEMS),
      counts: { total: shown.length, bad: shown.filter((i) => i.level === "bad").length, hidden: hidden.size },
    };
  }

  /** Put one off for some days. */
  async snooze(user: SessionUser, key: string, days: number) {
    const until = toDbDate(addDays(this.clock.today(), days));
    await this.prisma.db.reminderState.upsert({
      where: { userId_key: { userId: user.id, key } },
      create: { userId: user.id, key, snoozedUntil: until },
      update: { snoozedUntil: until, doneAt: null },
    });
    return { ok: true };
  }

  async done(user: SessionUser, key: string) {
    await this.prisma.db.reminderState.upsert({
      where: { userId_key: { userId: user.id, key } },
      create: { userId: user.id, key, doneAt: new Date() },
      update: { doneAt: new Date(), snoozedUntil: null },
    });
    return { ok: true };
  }

  /** Show it again (undo done or snooze). */
  async restore(user: SessionUser, key: string) {
    await this.prisma.db.reminderState.deleteMany({ where: { userId: user.id, key } });
    return { ok: true };
  }
}
