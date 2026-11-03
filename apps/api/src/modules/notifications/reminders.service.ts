import { PROFIT_LABEL } from "@kebo/money";
import { Injectable, Logger } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { fromDbDate, fromDbDateOrNull, toDbDate } from "@kebo/database";
import { instalmentSentence, orderNeeds, PERMISSIONS, planStatus, shippedOnOf } from "@kebo/shared";
import { addDays, dateIn, daysBetween } from "@kebo/utils";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { Clock } from "../../common/time/clock.service";
import { SettingsService } from "../settings/settings.service";
import { links, NotificationsService } from "./notifications.service";
import { goodsOf } from "../orders/orders.service";
import { InsightsService } from "../insights/insights.service";
import { ordersWithMoneyDue } from "../money/due";
import { chargedExpenses, fxOf, moneyFacts, positionOf } from "../money/position";
import { LimitsService } from "../../common/company/limits.service";
import { readyOnOf, readySelect } from "../orders/ready";
import { livePlansOf } from "../money/plan-live";

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
    private readonly modules: ModuleRef,
    private readonly limits: LimitsService,
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
        await note([...who, ...managers], { type: "reminder.quotationExpired", title: `${label} expired without a reply — follow up or mark the inquiry lost`, body: r.quotation.inquiry.title, link: links.deal(r.quotation.inquiry.id), dedupeKey: `quote-expired:${r.id}` });
      } else {
        await note(who, { type: "reminder.quotationDue", title: `${label} is valid until ${until} — follow up with the customer`, link: links.deal(r.quotation.inquiry.id), dedupeKey: `quote-due:${r.id}:${today}` });
      }
    }

    // 5. Orders that sit too long in a stage (no deposit, past the ready date, balance still due):
    //    the handler, then the managers once it is late enough. Orders on hold deals are left alone.
    const orders = await this.prisma.db.order.findMany({
      // Closed orders too: one closed with money still owed keeps being chased (orderNeeds decides).
      // Closed ones only while money is still owed on them (found in the database, not by reading every order).
      where: { inquiry: { onHold: false }, OR: [{ status: "open" }, { status: "closed", id: { in: await ordersWithMoneyDue(this.prisma, fxOf(s, await this.limits.allows("expenses"))) } }] },
      include: {
        payments: { where: { voidedAt: null } },
        planItems: { orderBy: { sortOrder: "asc" } },
        expenses: chargedExpenses,
        inquiry: { select: { id: true, assigneeId: true } },
        lines: { select: { type: true, description: true, quantity: true, receivedQty: true, unit: true, factoryId: true } },
        shipments: { select: { departedOn: true } },
        ...readySelect,
      },
    });
    // The customer's plans as they stand now: each instalment dated from its rule and the order's dates.
    const plans = await livePlansOf(this.prisma.db, orders.map((o) => o.id));
    // Collected first and sent per person: a few one by one, many as one summary,
    // so a backlog (e.g. right after the import of old orders) does not bury people every morning.
    type Late = { orderId: string; refNo: string; title: string; due: string; lateBy: number };
    const lateFor = new Map<string, Late[]>();
    const escalated: Late[] = [];
    const fx = fxOf(s, await this.limits.allows("expenses"));
    for (const o of orders) {
      // The same position as the order page: the plan's deposit, what was charged to the customer.
      const need = orderNeeds(
        {
          ...moneyFacts(positionOf(o, fx)),
          stage: o.stage,
          status: o.status,
          currency: o.currency,
          stageSince: dateIn(o.stageSince, this.clock.timeZone),
          readyOn: readyOnOf(o),
          shippedOn: shippedOnOf(o.shipments.map((x) => ({ departedOn: fromDbDateOrNull(x.departedOn) }))),
          goods: goodsOf(o.lines, o.packedAt),
        },
        today,
        s.reminders,
      );
      if (!need?.late) continue;
      const late: Late = { orderId: o.id, refNo: o.refNo, title: need.title, due: need.due, lateBy: daysBetween(need.due, today) };
      const owner = o.inquiry.assigneeId;
      if (owner) lateFor.set(owner, [...(lateFor.get(owner) ?? []), late]);
      if (!owner || late.lateBy >= s.reminders.escalateAfterDays) escalated.push(late);
    }

    const oldestFirst = (a: Late, b: Late) => b.lateBy - a.lateBy;
    const listOf = (items: Late[]) => items.slice(0, 8).map((x) => `${x.refNo}: ${x.title} — ${x.lateBy} day(s) late`).join("\n") + (items.length > 8 ? `\n…and ${items.length - 8} more` : "");
    for (const [owner, items] of lateFor) {
      // Once a day per person: the first run decides (one by one, or one summary); later runs that day add nothing.
      const day = `order:${today}:${owner}`;
      if (await this.prisma.db.notification.count({ where: { userId: owner, dedupeKey: { startsWith: day } } })) continue;
      items.sort(oldestFirst);
      if (items.length <= 3) {
        for (const x of items) await note([owner], { type: "reminder.order", title: `${x.refNo}: ${x.title} (since ${x.due})`, link: links.order(x.orderId), dedupeKey: `${day}:${x.orderId}` });
      } else {
        const x = items[0]!;
        await note([owner], { type: "reminder.order", title: `${items.length} of your orders need you — the oldest, ${x.refNo}: ${x.title}`, body: listOf(items), link: "/orders?view=mine", dedupeKey: day });
      }
    }
    if (escalated.length) {
      escalated.sort(oldestFirst);
      const x = escalated[0]!;
      await note(
        managers,
        escalated.length === 1
          ? { type: "reminder.orderEscalated", title: `${x.refNo}: ${x.title} — ${x.lateBy} days late`, link: links.order(x.orderId), dedupeKey: `order-esc:${today}` }
          : { type: "reminder.orderEscalated", title: `${escalated.length} orders are late — the oldest, ${x.refNo}: ${x.title}, by ${x.lateBy} days`, body: listOf(escalated), link: "/orders", dedupeKey: `order-esc:${today}` },
      );
    }

    // 6. The customer's instalments: a heads-up to the handler when one is due soon, and the handler
    //    and managers once when it becomes late (the order reminders above keep chasing after that).
    for (const o of orders) {
      const received = positionOf(o, fx).settledMinor;
      const plan = planStatus(plans.get(o.id)?.items ?? [], received, today, s.reminders.dueSoonDays);
      for (const p of plan) {
        if (p.status === "due_soon") await note([o.inquiry.assigneeId ?? managers[0]], { type: "reminder.instalment", title: `${o.refNo}: ${instalmentSentence(p.label, p.openMinor, o.currency, p.dueOn)} — remind the customer`, link: links.orderMoney(o.id), dedupeKey: `plan-soon:${p.id}:${p.dueOn}` });
        if (p.status === "late") await note([o.inquiry.assigneeId, ...managers], { type: "reminder.instalmentLate", title: `${o.refNo}: ${instalmentSentence(p.label, p.openMinor, o.currency, p.dueOn)} — not paid yet`, link: links.orderMoney(o.id), dedupeKey: `plan-late:${p.id}:${p.dueOn}` });
      }
    }

    // 7. The morning summary email, once a day (the counter row is the "already sent" mark). Email reports are a plan feature.
    const reports = await this.limits.allows("email_reports");
    const claimed = reports && (await this.prisma.db.$executeRaw`insert into counters (key, value) values (${`summary-${today}`}, 1) on conflict do nothing`);
    if (claimed) await this.summary(today);

    // 8. On the 1st, last month's report, once.
    if (reports && today.endsWith("-01")) {
      const last = addDays(today, -1).slice(0, 7);
      const monthly = await this.prisma.db.$executeRaw`insert into counters (key, value) values (${`monthly-${last}`}, 1) on conflict do nothing`;
      if (monthly) await this.monthly(last);
    }

    this.log.log(`reminders sent: ${sent}`);
    return { sent };
  }

  /** The numbers for a period, read as the system (every permission): the insights service lives in another module. */
  private async insights(from: string, to: string, before?: { from: string; to: string }) {
    // The figures in the emails are Insights (a plan feature): without it the emails carry the counts only.
    if (!(await this.limits.allows("insights"))) return null;
    try {
      const service = this.modules.get(InsightsService, { strict: false });
      const system = { id: "00000000-0000-0000-0000-000000000000", name: "System", email: "", role: "super_admin", roleName: "System", permissions: [...PERMISSIONS], twoStepSetupRequired: false, sessionId: "" };
      return await service.figures(system as never, { from, to }, before);
    } catch (e) {
      this.log.warn(`insights for the email failed: ${(e as Error).message}`);
      return null;
    }
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
    const i = await this.insights(`${today.slice(0, 7)}-01`, today);
    const m = (v: string | null | undefined) => (i && v !== null && v !== undefined ? `${i.currency} ${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null);
    const target = i?.target ? `${m(i.target.reached)} of ${m(i.target.amount)} (${i.target.percent}%)` : null;
    await this.notifications.emailAdmins("dailySummary", `${(await this.settings.get()).company.name}: summary for ${today}`, {
      heading: `Summary for ${today}`,
      rows: [
        ["New inquiries (since yesterday)", String(newDeals)],
        ["Won / lost since yesterday", `${won} / ${lost}`],
        ["Open inquiries", String(open)],
        ["Open orders", String(overdueOrders)],
        ["Sales this month", m(i?.sales.value)],
        ["Monthly target", target],
        ["Cash in this month", m(i?.cashIn)],
        ["To receive", i ? `${m(i.toReceive)}${Number(i.overdue) > 0 ? ` (${m(i.overdue)} overdue)` : ""}` : null],
        ["In our accounts", m(i?.inHand)],
      ],
      link: "/dashboard",
      linkLabel: "Open Home",
    });
  }

  /** Last month in numbers, against the month before, with a link to the full picture. */
  private async monthly(month: string) {
    const [y, mo] = month.split("-").map(Number) as [number, number];
    const to = `${month}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, "0")}`;
    const prevTo = new Date(Date.UTC(y, mo - 1, 0)).toISOString().slice(0, 10);
    const i = await this.insights(`${month}-01`, to, { from: `${prevTo.slice(0, 7)}-01`, to: prevTo });
    if (!i) return;
    const name = new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
    const m = (v: unknown) => (v === null || v === undefined ? null : `${i.currency} ${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    const ch = (c: number | null) => (c === null ? "" : ` (${c >= 0 ? "▲" : "▼"} ${Math.abs(c)}% vs the month before)`);
    const top = i.topCustomers.map((c, n) => `${n + 1}. ${c.name}: ${m(c.sales)}`).join("\n");
    await this.notifications.emailAdmins("dailySummary", `${(await this.settings.get()).company.name}: ${name} in numbers`, {
      heading: `${name} in numbers`,
      rows: [
        ["Sales", `${m(i.sales.value)}${ch(i.sales.change)}`],
        ["Gross profit", `${m(i.grossProfit.value)}${i.grossProfit.margin !== null ? ` · ${i.grossProfit.margin}% margin` : ""}`],
        [PROFIT_LABEL.expected, i.profitExpected ? `${m(i.profitExpected.value)}${ch(i.profitExpected.change)}` : null],
        ["Orders", `${i.orders.value}${ch(i.orders.change)}`],
        ["Win rate", i.winRate === null ? null : `${i.winRate}%`],
        ["Cash in", m(i.cashIn)],
        ["New customers", String(i.newCustomers)],
        ["To receive now", m(i.toReceive)],
      ],
      body: top ? `Best customers this month\n${top}` : null,
      link: `/insights?period=custom&from=${month}-01&to=${to}`,
      linkLabel: "See the full month",
    });
  }
}
