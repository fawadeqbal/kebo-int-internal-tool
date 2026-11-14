import { PROFIT_LABEL } from "@kebo/money";
import { Injectable, Logger } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { claimOnce, livePart, fromDbDate, fromDbDateOrNull, toDbDate } from "@kebo/database";
import { orderNeeds, PERMISSIONS, planStatus, REMINDER_HOUR, rowsOf, shippedOnOf, type Message, type MessageListRow } from "@kebo/shared";
import { formatMinor } from "@kebo/money";
import { addDays, dateIn, daysBetween } from "@kebo/utils";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { Clock } from "../../common/time/clock.service";
import { SettingsService } from "../settings/settings.service";
import { NotificationsService } from "./notifications.service";
import { DayBook } from "./day-book";
import { dayShort, inquiryFacts, orderFacts, revisionFacts, type OrderFacts } from "./facts";
import { factoryPayment, inquiryWaiting, neededBy, orderWaiting, ordersLate, paymentDue, quotationEnding, yourDay } from "./messages";
import { goodsOf } from "../orders/orders.service";
import { InsightsService } from "../insights/insights.service";
import { factoryPlansOf, ordersOwingFactories, ordersWithMoneyDue } from "../billing/api";
import { chargedExpenses, fxOf, moneyFacts, positionOf } from "../billing/api";
import { LimitsService } from "../../common/company/limits.service";
import { readyOnOf, readySelect } from "@kebo/database";
import { livePlansOf } from "../billing/api";
import { FollowUpsService, timeIn } from "../notes/follow-ups.service";

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

  /**
   * `force`: now, without waiting for the morning hour (an admin pressed "run now"). The worker's own runs
   * send the day's reminders from REMINDER_HOUR on, so nobody's phone buzzes just after midnight; before
   * that hour only what is tied to a time of day goes out (a follow-up 30 minutes before its time).
   */
  async run(force = false) {
    const s = await this.settings.get();
    const today = this.clock.today();
    const now = this.clock.now();
    if (!force && Number(timeIn(now, this.clock.timeZone).slice(0, 2)) < REMINDER_HOUR) return { sent: await this.followUps() };
    const managers = await this.notifications.managerIds();
    let sent = 0;
    // Each reminder goes to the bell and the phone on its own; the morning email gathers them per person.
    const book = new DayBook();
    const send = async (m: Message, to: { ids: (string | null | undefined)[]; as: string }[], dedupeKey: string) => {
      sent += await this.notifications.send(m, to, { email: false, dedupeKey });
    };
    const handler = (id: string | null | undefined) => ({ ids: [id], as: "who handles it" });
    const managersToo = { ids: managers, as: "a manager" };
    const orderFactsOf = new Map<string, Promise<OrderFacts | null>>();
    const expensesOn = await this.limits.allows("expenses");
    const orderOf = (id: string) => {
      if (!orderFactsOf.has(id)) orderFactsOf.set(id, orderFacts(this.prisma.db, id, s, expensesOn, today));
      return orderFactsOf.get(id)!;
    };

    // 1. New inquiries nobody has started.
    const stale = await this.prisma.db.inquiry.findMany({
      where: { deletedAt: null, onHold: false, stage: "new", createdAt: { lt: new Date(now.getTime() - s.reminders.newDays * 86_400_000) } },
      select: { id: true, createdAt: true },
    });
    for (const x of stale) {
      const i = await inquiryFacts(this.prisma.db, x.id);
      if (!i) continue;
      const days = daysBetween(dateIn(x.createdAt, this.clock.timeZone), today);
      const to = i.assigneeId ? [handler(i.assigneeId)] : [managersToo];
      await send(inquiryWaiting(i, "new", days, null), to, `new:${i.id}:${today}`);
      book.add(i.assigneeId ? [i.assigneeId] : managers, "Inquiries waiting", { ref: i.refNo, party: i.customerName, what: `Still new: ${i.title}`, when: `${days} days`, late: true });
    }

    // 2. Asking factories for too long without a quotation sent.
    const sourcing = await this.prisma.db.inquiry.findMany({
      where: {
        deletedAt: null,
        onHold: false,
        stage: "sourcing",
        stageChanges: { some: { toStage: "sourcing", changedAt: { lt: new Date(now.getTime() - s.reminders.sourcingDays * 86_400_000) } } },
      },
      select: {
        id: true,
        stageChanges: { where: { toStage: "sourcing" }, orderBy: { changedAt: "asc" }, take: 1, select: { changedAt: true } },
        _count: { select: { factoryQuotes: true, factoryRequests: true } },
      },
    });
    for (const x of sourcing) {
      const i = await inquiryFacts(this.prisma.db, x.id);
      if (!i) continue;
      const since = x.stageChanges[0]?.changedAt ?? now;
      const days = daysBetween(dateIn(since, this.clock.timeZone), today);
      await send(inquiryWaiting(i, "sourcing", days, { in: x._count.factoryQuotes, asked: x._count.factoryRequests }), [handler(i.assigneeId ?? managers[0])], `sourcing:${i.id}:${today}`);
      book.add([i.assigneeId ?? managers[0]], "Inquiries waiting", { ref: i.refNo, party: i.customerName, what: `No quotation yet: ${i.title}`, when: `${days} days`, late: true });
    }

    // 3. Needed-by dates close or passed on open inquiries.
    const due = await this.prisma.db.inquiry.findMany({
      where: { deletedAt: null, onHold: false, stage: { in: ["new", "sourcing", "quoted"] }, requiredBy: { lte: toDbDate(addDays(today, s.reminders.dueSoonDays)) } },
      select: { id: true, requiredBy: true },
    });
    for (const x of due) {
      const i = await inquiryFacts(this.prisma.db, x.id);
      if (!i) continue;
      const d = fromDbDate(x.requiredBy!);
      const passed = d < today;
      await send(neededBy(i, passed), passed ? [handler(i.assigneeId), managersToo] : [handler(i.assigneeId)], `${passed ? "late" : "soon"}:${i.id}:${today}`);
      book.add(passed ? [i.assigneeId, ...managers] : [i.assigneeId], "Inquiries waiting", { ref: i.refNo, party: i.customerName, what: `Needed by ${d}: ${i.title}`, when: passed ? `passed ${dayShort(d)}` : `by ${dayShort(d)}`, late: passed });
    }

    // 4. Sent quotations: follow up before they end; mark them ended after (only the live revision is ever "sent").
    const quotes = await this.prisma.db.quotationRevision.findMany({
      where: { deletedAt: null, status: "sent", validUntil: { lte: toDbDate(addDays(today, s.reminders.dueSoonDays)) }, quotation: { inquiry: { onHold: false, deletedAt: null } } },
      select: { id: true, number: true, validUntil: true, createdById: true, quotation: { select: { refNo: true, inquiryId: true } } },
    });
    for (const q of quotes) {
      const until = fromDbDate(q.validUntil);
      const label = `${q.quotation.refNo} R${q.number}`;
      const ended = until < today;
      if (ended) {
        await this.prisma.tx(async (tx) => {
          const changed = await tx.quotationRevision.updateMany({ where: { id: q.id, status: "sent" }, data: { status: "expired", answeredOn: toDbDate(today) } });
          if (changed.count) await this.audit.record(tx, { userId: null, action: "status_change", entityType: "quotation", entityId: q.id, summary: `${label}: sent → expired (valid until ${until})` });
        });
      }
      const [i, r] = await Promise.all([inquiryFacts(this.prisma.db, q.quotation.inquiryId), revisionFacts(this.prisma.db, q.id)]);
      if (!i || !r) continue;
      const who = [i.assigneeId, q.createdById];
      await send(quotationEnding(i, r, ended), ended ? [handler(i.assigneeId), { ids: [q.createdById], as: "who made the quotation" }, managersToo] : [handler(i.assigneeId), { ids: [q.createdById], as: "who made the quotation" }], ended ? `quote-expired:${q.id}` : `quote-due:${q.id}:${today}`);
      book.add(ended ? [...who, ...managers] : who, "Quotations ending", { ref: label, party: i.customerName, what: "No answer yet", when: ended ? `ended ${dayShort(until)}` : `ends ${dayShort(until)}`, late: ended });
    }

    // 5. Orders waiting on something past its day (no deposit, past the ready date, balance still due):
    //    the handler, then the managers once it is late enough. Orders on hold deals are left alone.
    const orders = await this.prisma.db.order.findMany({
      // Closed ones only while money is still owed on them (found in the database, not by reading every order).
      where: { inquiry: { onHold: false }, OR: [{ status: "open" }, { status: "closed", id: { in: await ordersWithMoneyDue(this.prisma, fxOf(s, expensesOn)) } }] },
      include: {
        allocations: { where: livePart },
        receivables: { orderBy: { sortOrder: "asc" } },
        expenses: chargedExpenses,
        customer: { select: { name: true } },
        inquiry: { select: { id: true, assigneeId: true } },
        lines: { select: { type: true, description: true, quantity: true, receivedQty: true, unit: true, factoryId: true } },
        shipments: { select: { departedOn: true } },
        ...readySelect,
      },
    });
    // The customer's plans as they stand now: each instalment dated from its rule and the order's dates.
    const plans = await livePlansOf(this.prisma.db, orders.map((o) => o.id));
    type Late = { orderId: string; refNo: string; customer: string; title: string; due: string; lateBy: number };
    const lateFor = new Map<string, Late[]>();
    const escalated: Late[] = [];
    const fx = fxOf(s, expensesOn);
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
      const late: Late = { orderId: o.id, refNo: o.refNo, customer: o.customer.name, title: need.title, due: need.due, lateBy: daysBetween(need.due, today) };
      const owner = o.inquiry.assigneeId;
      if (owner) lateFor.set(owner, [...(lateFor.get(owner) ?? []), late]);
      if (!owner || late.lateBy >= s.reminders.escalateAfterDays) escalated.push(late);
    }

    const oldestFirst = (a: Late, b: Late) => b.lateBy - a.lateBy;
    const rowOf = (x: Late, team = false): MessageListRow => ({ ref: x.refNo, party: x.customer, what: x.title, when: `${x.lateBy} day${x.lateBy === 1 ? "" : "s"} late`, late: true, ...(team ? {} : {}) });
    for (const [owner, items] of lateFor) {
      items.sort(oldestFirst);
      for (const x of items) book.add([owner], "Orders waiting on you", rowOf(x));
      // Once a day per person: the first run decides (one by one, or one list); later runs that day add nothing.
      const day = `order:${today}:${owner}`;
      if (await this.prisma.db.notification.count({ where: { userId: owner, dedupeKey: { startsWith: day } } })) continue;
      if (items.length <= 3) {
        for (const x of items) {
          const o = await orderOf(x.orderId);
          if (o) await send(orderWaiting(o, x), [{ ids: [owner], as: "who handles the order" }], `${day}:${x.orderId}`);
        }
      } else await send(ordersLate(items.map((x) => rowOf(x)), { link: "/orders?view=mine" }, false), [{ ids: [owner], as: "who handles the orders" }], day);
    }
    if (escalated.length) {
      escalated.sort(oldestFirst);
      for (const x of escalated) book.add(managers, "Late across the team", rowOf(x, true));
      if (escalated.length === 1) {
        const o = await orderOf(escalated[0]!.orderId);
        if (o) await send(orderWaiting(o, escalated[0]!), [managersToo], `order-esc:${today}`);
      } else await send(ordersLate(escalated.map((x) => rowOf(x, true)), { link: "/orders" }, true), [managersToo], `order-esc:${today}`);
    }

    // 6. The customer's instalments: a heads-up to the handler when one is due soon, and the handler and
    //    managers once when it becomes late; every morning in the email while it is not paid.
    for (const o of orders) {
      const received = positionOf(o, fx).settledMinor;
      const plan = planStatus(plans.get(o.id)?.items ?? [], received, today, s.reminders.dueSoonDays);
      for (const p of plan) {
        if (p.status !== "due_soon" && p.status !== "late") continue;
        const facts = await orderOf(o.id);
        if (!facts) continue;
        const lateBy = p.status === "late" && p.dueOn ? daysBetween(p.dueOn, today) : null;
        const who = o.inquiry.assigneeId ?? managers[0];
        const row: MessageListRow = { ref: o.refNo, party: o.customer.name, what: `${p.label} ${formatMinor(p.openMinor, o.currency)}`, when: lateBy !== null ? `${lateBy} days late` : p.dueOn ? `due ${dayShort(p.dueOn)}` : "due", late: lateBy !== null };
        if (lateBy === null) {
          await send(paymentDue(facts, p, null), [handler(who)], `plan-soon:${p.id}:${p.dueOn}`);
          book.add([who], "Money to collect", row);
        } else {
          await send(paymentDue(facts, p, lateBy), [handler(o.inquiry.assigneeId), managersToo], `plan-late:${p.id}:${p.dueOn}`);
          book.add([o.inquiry.assigneeId, ...managers], "Money to collect", row);
        }
      }
    }

    // 7. What we owe factories: due within the reminder days, or late. To who handles the order and the
    //    managers, only those who see costs (the factory's prices).
    const owing = await ordersOwingFactories(this.prisma, fx);
    const costPeople = new Set(await this.notifications.idsWith("sourcing.manage"));
    for (const id of owing) {
      const facts = await orderOf(id);
      if (!facts) continue;
      const plansOfFactories = await factoryPlansOf(this.prisma.db, id, s.sales.factoryAdvancePercent, today, s.reminders.dueSoonDays, fx);
      for (const f of plansOfFactories)
        for (const r of f.rows) {
          if (r.status !== "due" && r.status !== "late") continue;
          const lateBy = r.status === "late" && r.due ? daysBetween(r.due, today) : null;
          const who = [facts.handlerId, ...managers].filter((u): u is string => !!u && costPeople.has(u));
          const contact = await this.prisma.db.contact.findFirst({ where: { partyId: f.factory.id, deletedAt: null }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], select: { name: true, phone: true, whatsapp: true, wechat: true } });
          const m = factoryPayment(
            facts,
            { factory: f.factory.name, contact: contact ? [contact.name, contact.wechat ? `WeChat ${contact.wechat}` : contact.whatsapp || contact.phone].filter(Boolean).join(" · ") : null, currency: f.currency, owed: f.owed, paid: f.paid },
            { label: r.label, open: r.open, due: r.due, lateBy },
          );
          await send(m, [{ ids: who.filter((u) => u === facts.handlerId), as: "who handles the order" }, { ids: who, as: "a manager" }], `fpay-${lateBy !== null ? "late" : "due"}:${id}:${f.factory.id}:${r.label}:${r.due}`);
          book.add(who, "Pay the factory", { ref: facts.refNo, party: f.factory.name, what: `${r.label} ${formatMinor(Math.round(Number(r.open) * 100), f.currency)}`, when: lateBy !== null ? `${lateBy} days late` : r.due === today ? "due today" : `due ${dayShort(r.due)}`, late: lateBy !== null || r.due === today });
        }
    }

    // 8. Follow-ups: on the day, before their time, and missed (the worker also runs these every few minutes).
    sent += await this.followUps(force, book);

    // 9. "Your day": one email a morning to each person with everything above that is theirs.
    if (await this.notifications.canEmail()) {
      const stamp = today.replaceAll("-", "");
      const people = await this.prisma.db.user.findMany({ where: { id: { in: book.people() }, isActive: true }, select: { id: true, name: true } });
      for (const p of people) {
        if (!(await claimOnce(this.prisma.db, `yd${stamp}${p.id}`))) continue;
        await this.notifications.emailMessage(yourDay(p.name, book.sections(p.id)), [{ id: p.id, as: "Every morning at 08:00, when something needs you." }]);
      }
    }

    // 10. The company's morning summary email, once a day (the counter row is the "already sent" mark). Email reports are a plan feature.
    const reports = await this.limits.allows("email_reports");
    const claimed = reports && (await claimOnce(this.prisma.db, `summary-${today}`));
    if (claimed) await this.summary(today);

    // 11. On the 1st, last month's report, once.
    if (reports && today.endsWith("-01")) {
      const last = addDays(today, -1).slice(0, 7);
      const monthly = await claimOnce(this.prisma.db, `monthly-${last}`);
      if (monthly) await this.monthly(last);
    }

    this.log.log(`reminders sent: ${sent}`);
    return { sent };
  }

  /**
   * Follow-ups' reminders (followUp.due), for the current company. The notes module holds them; it is
   * looked up here (as Insights is below) since it sends through this module's notifications.
   */
  async followUps(force = false, book?: DayBook): Promise<number> {
    try {
      return await this.modules.get(FollowUpsService, { strict: false }).remind(force, book);
    } catch (e) {
      this.log.warn(`follow-up reminders failed: ${(e as Error).message}`);
      return 0;
    }
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
    const rows: [string, string | null | undefined][] = [
      ["Sales this month", m(i?.sales.value)],
      ["Monthly target", target],
      ["Cash in this month", m(i?.cashIn)],
      ["To receive", i ? `${m(i.toReceive)}${Number(i.overdue) > 0 ? ` (${m(i.overdue)} overdue)` : ""}` : null],
      ["In our accounts", m(i?.inHand)],
    ];
    await this.notifications.emailList(
      {
        kind: "digest.company",
        group: "people",
        tag: "Company summary",
        subject: `${(await this.settings.get()).company.name}: ${newDeals} new inquir${newDeals === 1 ? "y" : "ies"}, ${won} won, ${lost} lost since yesterday`,
        sentence: `Since yesterday: ${newDeals} new inquir${newDeals === 1 ? "y" : "ies"}, ${won} won, ${lost} lost. Open now: ${open} inquiries and ${overdueOrders} orders.`,
        tiles: [
          { value: String(newDeals), label: "new inquiries" },
          { value: String(won), label: "won" },
          { value: String(lost), label: "lost", bad: lost > 0 },
          { value: String(open), label: "open inquiries" },
        ],
        money: rowsOf(rows),
        next: "Open Home for the whole picture.",
        button: "Open Home",
        link: "/dashboard",
      },
      "dailySummary",
    );
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
    await this.notifications.emailList(
      {
        kind: "digest.month",
        group: "people",
        tag: "Month in numbers",
        subject: `${(await this.settings.get()).company.name}: ${name} in numbers — sales ${m(i.sales.value)}`,
        sentence: `${name}, against the month before.${top ? `\n\nBest customers this month\n${top}` : ""}`,
        money: rowsOf([
          ["Sales", `${m(i.sales.value)}${ch(i.sales.change)}`],
          ["Gross profit", `${m(i.grossProfit.value)}${i.grossProfit.margin !== null ? ` · ${i.grossProfit.margin}% margin` : ""}`],
          [PROFIT_LABEL.expected, i.profitExpected ? `${m(i.profitExpected.value)}${ch(i.profitExpected.change)}` : null],
          ["Orders", `${i.orders.value}${ch(i.orders.change)}`],
          ["Win rate", i.winRate === null ? null : `${i.winRate}%`],
          ["Cash in", m(i.cashIn)],
          ["New customers", String(i.newCustomers)],
          ["To receive now", m(i.toReceive)],
        ]),
        next: "See the full month in Reports.",
        button: "See the full month",
        link: `/reports?period=custom&from=${month}-01&to=${to}`,
      },
      "dailySummary",
    );
  }
}
