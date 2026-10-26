import { Injectable, Logger } from "@nestjs/common";
import { decimalToMinor, fromDbDate, fromDbDateOrNull, toDbDate } from "@kebo/database";
import { formatMinor, settle } from "@kebo/money";
import { orderPlan } from "@kebo/shared";
import { addDays, daysBetween } from "@kebo/utils";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { Clock } from "../../common/time/clock.service";
import { SettingsService } from "../settings/settings.service";
import { links, NotificationsService } from "./notifications.service";

/**
 * The safety net, run every hour by the worker. Every reminder carries a
 * dedupe key with the day in it, so running again the same day sends nothing
 * twice. Deals on hold are left alone.
 */
@Injectable()
export class RemindersService {
  private readonly log = new Logger("Reminders");

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
  ) {}

  async run() {
    const s = await this.settings.get();
    const today = this.clock.today();
    const now = this.clock.now();
    const managers = await this.notifications.managerIds();
    let sent = 0;
    const note = async (to: (string | null | undefined)[], n: Parameters<NotificationsService["notify"]>[1]) => {
      sent += await this.notifications.notify(to, n);
    };

    // 1. New deals nobody has started.
    const stale = await this.prisma.db.inquiry.findMany({
      where: { deletedAt: null, onHold: false, stage: "new", createdAt: { lt: new Date(now.getTime() - s.reminders.newDays * 86_400_000) } },
      select: { id: true, refNo: true, title: true, assigneeId: true },
    });
    for (const i of stale) {
      await note(i.assigneeId ? [i.assigneeId] : managers, { type: "reminder.new", title: `${i.refNo} is still new after ${s.reminders.newDays} day(s)${i.assigneeId ? "" : " — nobody is assigned"}`, body: i.title, link: links.deal(i.id), dedupeKey: `new:${i.id}:${today}` });
    }

    // 2. Sourcing for too long without a quotation sent.
    const sourcing = await this.prisma.db.inquiry.findMany({
      where: {
        deletedAt: null,
        onHold: false,
        stage: "sourcing",
        stageChanges: { some: { toStage: "sourcing", changedAt: { lt: new Date(now.getTime() - s.reminders.sourcingDays * 86_400_000) } } },
      },
      select: { id: true, refNo: true, title: true, assigneeId: true },
    });
    for (const i of sourcing) {
      await note([i.assigneeId ?? managers[0]], { type: "reminder.sourcing", title: `${i.refNo}: sourcing for over ${s.reminders.sourcingDays} days — send a quotation or update the customer`, body: i.title, link: links.deal(i.id), dedupeKey: `sourcing:${i.id}:${today}` });
    }

    // 3. Needed-by dates close or passed on open deals.
    const due = await this.prisma.db.inquiry.findMany({
      where: { deletedAt: null, onHold: false, stage: { in: ["new", "sourcing", "quoted"] }, requiredBy: { lte: toDbDate(addDays(today, s.reminders.dueSoonDays)) } },
      select: { id: true, refNo: true, title: true, assigneeId: true, requiredBy: true },
    });
    for (const i of due) {
      const d = fromDbDate(i.requiredBy!);
      const late = d < today;
      await note(late ? [i.assigneeId, ...managers] : [i.assigneeId], { type: late ? "reminder.overdue" : "reminder.dueSoon", title: late ? `${i.refNo} is past its needed-by date (${d})` : `${i.refNo} is needed by ${d}`, body: i.title, link: links.deal(i.id), dedupeKey: `${late ? "late" : "soon"}:${i.id}:${today}` });
    }

    // 4. Sent quotations: follow up before they expire; mark expired after (only the live revision is ever "sent").
    const quotes = await this.prisma.db.quotationRevision.findMany({
      where: { deletedAt: null, status: "sent", validUntil: { lte: toDbDate(addDays(today, s.reminders.dueSoonDays)) }, quotation: { inquiry: { onHold: false, deletedAt: null } } },
      include: { quotation: { include: { inquiry: { select: { id: true, assigneeId: true, title: true } } } } },
    });
    for (const r of quotes) {
      const until = fromDbDate(r.validUntil);
      const who = [r.quotation.inquiry.assigneeId, r.createdById];
      const label = `${r.quotation.refNo} R${r.number}`;
      if (until < today) {
        await this.prisma.tx(async (tx) => {
          const changed = await tx.quotationRevision.updateMany({ where: { id: r.id, status: "sent" }, data: { status: "expired", answeredOn: toDbDate(today) } });
          if (changed.count) await this.audit.record(tx, { userId: null, action: "status_change", entityType: "quotation", entityId: r.id, summary: `${label}: sent → expired (valid until ${until})` });
        });
        await note([...who, ...managers], { type: "reminder.quotationExpired", title: `${label} expired without a reply — follow up or mark the deal lost`, body: r.quotation.inquiry.title, link: links.deal(r.quotation.inquiry.id), dedupeKey: `quote-expired:${r.id}` });
      } else {
        await note(who, { type: "reminder.quotationDue", title: `${label} is valid until ${until} — follow up with the customer`, link: links.deal(r.quotation.inquiry.id), dedupeKey: `quote-due:${r.id}:${today}` });
      }
    }

    // 5. Order steps past their due date: the handler, then the managers once it is late enough.
    const orders = await this.prisma.db.order.findMany({
      where: { status: "open", inquiry: { onHold: false } },
      include: { milestones: true, payments: { where: { voidedAt: null, direction: "in" } }, inquiry: { select: { id: true, assigneeId: true } } },
    });
    for (const o of orders) {
      const plan = orderPlan(
        {
          status: o.status,
          orderedOn: fromDbDate(o.orderedOn),
          shipBy: fromDbDateOrNull(o.shipBy),
          readyOn: fromDbDateOrNull(o.readyOn),
          currency: o.currency,
          totalMinor: decimalToMinor(o.total),
          depositPercent: Number(o.depositPercent),
          balanceTerms: o.balanceTerms,
        },
        o.milestones.map((m) => ({ key: m.key, status: m.status, doneOn: fromDbDateOrNull(m.doneOn), dueOverride: fromDbDateOrNull(m.dueOverride) })),
        today,
        s.plan,
      );
      for (const st of plan.steps.filter((x) => x.overdue)) {
        const owner = o.milestones.find((m) => m.key === st.key)?.assigneeId ?? o.inquiry.assigneeId;
        const lateBy = daysBetween(st.due!, today);
        await note([owner], { type: "reminder.step", title: `${o.refNo}: "${st.title}" was due ${st.due}`, body: st.hint, link: links.order(o.id), dedupeKey: `step:${o.id}:${st.key}:${today}` });
        if (lateBy >= s.reminders.escalateAfterDays) {
          await note(managers, { type: "reminder.stepEscalated", title: `${o.refNo}: "${st.title}" is ${lateBy} days late`, body: st.hint, link: links.order(o.id), dedupeKey: `step-esc:${o.id}:${st.key}:${today}` });
        }
      }
      // 6. Money the customer still owes after the balance was due.
      const balance = o.milestones.find((m) => m.key === "customer_balance");
      const balanceStep = plan.steps.find((x) => x.key === "customer_balance");
      if (balance?.status === "todo" && balanceStep?.overdue) {
        const pos = settle(decimalToMinor(o.total), o.payments.filter((p) => p.currency === o.currency).map((p) => ({ amountMinor: decimalToMinor(p.amount), bankChargesMinor: decimalToMinor(p.bankCharges) })), Number(o.depositPercent));
        if (pos.outstandingMinor > 0) {
          await note(managers, { type: "reminder.balance", title: `${o.refNo}: ${formatMinor(pos.outstandingMinor, o.currency)} still to receive`, link: links.order(o.id), dedupeKey: `balance:${o.id}:${today}` });
        }
      }
    }

    // 7. The morning summary email, once a day (the counter row is the "already sent" mark).
    const claimed = await this.prisma.db.$executeRaw`insert into counters (key, value) values (${`summary-${today}`}, 1) on conflict do nothing`;
    if (claimed) await this.summary(today);

    this.log.log(`reminders sent: ${sent}`);
    return { sent };
  }

  private async summary(today: string) {
    const yesterday = new Date(`${addDays(today, -1)}T00:00:00Z`);
    const [newDeals, open, won, lost, overdueOrders] = await Promise.all([
      this.prisma.db.inquiry.count({ where: { deletedAt: null, createdAt: { gte: yesterday } } }),
      this.prisma.db.inquiry.count({ where: { deletedAt: null, stage: { in: ["new", "sourcing", "quoted"] } } }),
      this.prisma.db.inquiry.count({ where: { deletedAt: null, stage: "won", closedAt: { gte: yesterday } } }),
      this.prisma.db.inquiry.count({ where: { deletedAt: null, stage: "lost", closedAt: { gte: yesterday } } }),
      this.prisma.db.order.count({ where: { status: "open" } }),
    ]);
    await this.notifications.emailAdmins("dailySummary", `Kebo summary for ${today}`, {
      heading: `Summary for ${today}`,
      rows: [
        ["New inquiries (since yesterday)", String(newDeals)],
        ["Open deals", String(open)],
        ["Won / lost since yesterday", `${won} / ${lost}`],
        ["Open orders", String(overdueOrders)],
      ],
      link: "/dashboard",
      linkLabel: "Open the dashboard",
    });
  }
}
