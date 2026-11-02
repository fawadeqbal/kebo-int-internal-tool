import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { fromDbDate, fromDbDateOrNull, toDbDate } from "@kebo/database";
import { BANK_STEP_LABEL, bankStepsFor, can, OPEN_STAGES, ORDER_DOCUMENT_LABEL, requiredDocuments } from "@kebo/shared";
import { addDays, daysBetween, type ISODate } from "@kebo/utils";
import { PrismaService } from "../../database/prisma.service";
import { Clock } from "../../common/time/clock.service";
import { ReadCache } from "../../common/cache/read-cache";
import type { SessionUser } from "../../common/auth/session-user";
import { SettingsService } from "../settings/settings.service";
import { OrdersService } from "../orders/orders.service";
import { inquiryAccess } from "../inquiries/inquiries.service";
import { orderAccess } from "../orders/orders.service";
import { LeaksService } from "../money/leaks.service";
import { LimitsService } from "../../common/company/limits.service";

export type ReminderLevel = "bad" | "warn" | "info";
export type ReminderKind = "order" | "quote" | "deal" | "offer" | "money" | "ship";

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

    // 6. The order flow (each part only with its module): factories not answering, production
    //    running late, the LC's dates, arrivals, papers missing after sailing, the SAT, open claims.
    items.push(...(await this.flowItems(user, today, nameOf)));

    // 7. Whoever keeps the settings: exchange rates not updated for a month (totals use them).
    if (can(user, "settings.manage")) {
      for (const [c, on] of Object.entries(s.sales.rateDates ?? {})) {
        if (!(c in s.sales.exchangeRates) || on > addDays(today, -30)) continue;
        items.push({
          key: `rate:${c}:${on}`,
          kind: "money",
          level: on <= addDays(today, -60) ? "warn" : "info",
          title: `The ${c} rate was last updated ${daysBetween(on, today)} days ago`,
          detail: `1 ${s.sales.currency} = ${s.sales.exchangeRates[c]} ${c} · totals and targets use it`,
          due: addDays(on, 30),
          href: "/settings?tab=sales",
          action: "Update rates",
          who: null,
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

  private async flowItems(user: SessionUser, today: ISODate, nameOf: (u: { name: string } | null | undefined) => string | null): Promise<Reminder[]> {
    const out: Reminder[] = [];
    const on = async (f: Parameters<LimitsService["allows"]>[0]) => this.limits.allows(f);
    const soon = addDays(today, 3);
    const days = (from: ISODate) => daysBetween(from, today);

    // Factories asked for a price that have not answered (people who see factory prices).
    if ((await on("factory_requests")) && can(user, "sourcing.manage")) {
      const waiting = await this.prisma.db.factoryRequest.findMany({
        where: { status: "sent", sentOn: { lte: toDbDate(addDays(today, -3)) }, inquiry: { deletedAt: null, ...inquiryAccess(user), onHold: false, stage: { in: ["new", "sourcing"] } } },
        select: {
          id: true,
          sentOn: true,
          replyBy: true,
          factoryId: true,
          factory: { select: { name: true } },
          inquiry: { select: { id: true, refNo: true, assignee: { select: { name: true } }, factoryQuotes: { where: { deletedAt: null }, select: { factoryId: true } } } },
        },
        take: 200,
      });
      for (const r of waiting) {
        if (r.inquiry.factoryQuotes.some((q) => q.factoryId === r.factoryId)) continue; // their offer is in
        const sent = fromDbDate(r.sentOn);
        const replyBy = fromDbDateOrNull(r.replyBy);
        out.push({
          key: `request:${r.id}`,
          kind: "offer",
          level: replyBy && replyBy < today ? "warn" : "info",
          title: `${r.factory.name} hasn't answered ${r.inquiry.refNo} for ${days(sent)} days`,
          detail: replyBy && replyBy < today ? `They were to reply by ${replyBy}` : "A short message usually gets the price",
          due: replyBy ?? addDays(sent, 3),
          href: `/inquiries/${r.inquiry.id}#factories-asked`,
          action: "Message",
          who: nameOf(r.inquiry.assignee),
        });
      }
    }

    const orders = { status: "open" as const, ...orderAccess(user) };
    const handler = { inquiry: { select: { assignee: { select: { name: true } } } } };

    // Production steps past their planned date.
    if (await on("production")) {
      const steps = await this.prisma.db.productionStep.findMany({
        where: { doneOn: null, plannedOn: { lt: toDbDate(today) }, order: orders },
        select: { id: true, title: true, plannedOn: true, factory: { select: { name: true } }, order: { select: { id: true, refNo: true, ...handler } } },
        orderBy: { plannedOn: "asc" },
        take: 100,
      });
      for (const p of steps) {
        const planned = fromDbDate(p.plannedOn!);
        out.push({
          key: `production:${p.id}:${planned}`,
          kind: "order",
          level: days(planned) >= 3 ? "bad" : "warn",
          title: `${p.order.refNo}: "${p.title}" was planned for ${planned}`,
          detail: `${p.factory?.name ?? "The factory"} · ${days(planned)} day${days(planned) === 1 ? "" : "s"} late: ask for a new date`,
          due: planned,
          href: `/orders/${p.order.id}/factory`,
          action: "Open the timeline",
          who: nameOf(p.order.inquiry.assignee),
        });
      }
    }

    // The LC or contract: the last day to ship, and the expiry date.
    if (await on("bank_contracts")) {
      const contracts = await this.prisma.db.orderBankContract.findMany({
        where: {
          status: { notIn: ["paid", "closed"] },
          order: orders,
          OR: [{ latestShipOn: { lte: toDbDate(addDays(today, 10)) } }, { expiresOn: { lte: toDbDate(addDays(today, 10)) } }],
        },
        select: {
          id: true,
          number: true,
          latestShipOn: true,
          expiresOn: true,
          order: { select: { id: true, refNo: true, shippedOn: true, shipments: { select: { status: true } }, ...handler } },
        },
      });
      for (const c of contracts) {
        const shipped = !!c.order.shippedOn || c.order.shipments.some((s) => ["departed", "arrived", "cleared"].includes(s.status));
        const ship = fromDbDateOrNull(c.latestShipOn);
        const exp = fromDbDateOrNull(c.expiresOn);
        const name = c.number ? `LC ${c.number}` : "the LC";
        if (ship && !shipped && ship <= addDays(today, 10))
          out.push({
            key: `lc:${c.id}:ship:${ship}`,
            kind: "ship",
            level: ship < addDays(today, 4) ? "bad" : "warn",
            title: `${c.order.refNo}: must ship by ${ship} under ${name}`,
            detail: ship < today ? "The date has passed: ask the customer to amend the LC" : `${days(ship) * -1} days left · book the shipment`,
            due: ship,
            href: `/orders/${c.order.id}/shipping`,
            action: "Book shipping",
            who: nameOf(c.order.inquiry.assignee),
          });
        if (exp && exp <= addDays(today, 10))
          out.push({
            key: `lc:${c.id}:expires:${exp}`,
            kind: "money",
            level: exp < addDays(today, 4) ? "bad" : "warn",
            title: `${c.order.refNo}: ${name} ${exp < today ? "expired" : "expires"} on ${exp}`,
            detail: "Present the documents before it expires, or ask for an extension",
            due: exp,
            href: `/orders/${c.order.id}/documents`,
            action: "Documents",
            who: nameOf(c.order.inquiry.assignee),
          });
      }
    }

    // Shipments arriving soon, or past their ETA without arriving.
    if (await on("shipping")) {
      const ships = await this.prisma.db.shipment.findMany({
        where: { status: { in: ["booked", "loaded", "departed"] }, eta: { lte: toDbDate(soon) }, order: orders },
        select: { id: true, eta: true, portOfDischarge: true, mode: true, order: { select: { id: true, refNo: true, customer: { select: { name: true } }, ...handler } } },
      });
      for (const sh of ships) {
        const eta = fromDbDate(sh.eta!);
        out.push({
          key: `ship:${sh.id}:${eta}`,
          kind: "ship",
          level: eta < today ? "warn" : "info",
          title: `${sh.order.refNo}: ${eta < today ? `was due at ${sh.portOfDischarge ?? "port"} on ${eta}` : `arrives at ${sh.portOfDischarge ?? "port"} ${eta === today ? "today" : `on ${eta}`}`}`,
          detail: `${sh.order.customer.name} · tell the customer and their clearing agent`,
          due: eta,
          href: `/orders/${sh.order.id}/shipping`,
          action: "Shipping",
          who: nameOf(sh.order.inquiry.assignee),
        });
      }
    }

    // After sailing: papers not ready, and the bank chain not started.
    if ((await on("bank_documents")) && (await on("shipping"))) {
      const sailed = await this.prisma.db.order.findMany({
        where: { ...orders, shipments: { some: { status: { in: ["departed", "arrived", "cleared"] } } } },
        select: {
          id: true,
          refNo: true,
          paymentRoute: true,
          proformaNo: true,
          packedAt: true,
          customer: { select: { name: true } },
          shipments: { orderBy: { createdAt: "asc" }, select: { mode: true, departedOn: true, eta: true } },
          documents: { select: { kind: true, status: true } },
          bankSteps: { select: { step: true } },
          ...handler,
        },
        take: 200,
      });
      for (const o of sailed) {
        const missing = requiredDocuments(o.paymentRoute, o.shipments[0]?.mode ?? "sea").filter((k) => {
          const rows = o.documents.filter((d) => d.kind === k);
          if (rows.length) return !rows.some((d) => d.status === "ready");
          return k === "proforma_invoice" ? !o.proformaNo : k === "packing_list" ? !o.packedAt : true;
        });
        const eta = fromDbDateOrNull(o.shipments[0]?.eta);
        if (missing.length)
          out.push({
            key: `papers:${o.id}:${missing.join(",")}`,
            kind: "order",
            level: eta && eta <= addDays(today, 7) ? "bad" : "warn",
            title: `${o.refNo}: ${missing.length === 1 ? ORDER_DOCUMENT_LABEL[missing[0]!] : `${missing.length} papers`} not ready, and the goods have sailed`,
            detail: `${o.customer.name} · ${missing.length > 1 ? missing.map((k) => ORDER_DOCUMENT_LABEL[k]).join(", ") : "the documents must reach the customer before the ship"}`,
            due: eta,
            href: `/orders/${o.id}/documents`,
            action: "Documents",
            who: nameOf(o.inquiry.assignee),
          });
        else {
          const next = bankStepsFor(o.paymentRoute).find((st) => !o.bankSteps.some((b) => b.step === st));
          if (next && next !== "customer_paid_bank" && next !== "bank_paid_us")
            out.push({
              key: `bank:${o.id}:${next}`,
              kind: "order",
              level: "warn",
              title: `${o.refNo}: papers ready · next, ${BANK_STEP_LABEL[next].toLowerCase()}`,
              detail: `${o.customer.name} · so they arrive before the goods`,
              due: eta,
              href: `/orders/${o.id}/documents`,
              action: "Documents",
              who: nameOf(o.inquiry.assignee),
            });
        }
      }
    }

    // The SAT coming up, and claims still open.
    if (await on("delivery_sat")) {
      const sats = await this.prisma.db.order.findMany({
        where: { ...orders, satDoneOn: null, satPlannedOn: { lte: toDbDate(soon) } },
        select: { id: true, refNo: true, satPlannedOn: true, customer: { select: { name: true } }, satEngineer: { select: { name: true } }, ...handler },
      });
      for (const o of sats) {
        const on = fromDbDate(o.satPlannedOn!);
        out.push({
          key: `sat:${o.id}:${on}`,
          kind: "order",
          level: on < today ? "warn" : "info",
          title: `${o.refNo}: SAT at ${o.customer.name} ${on < today ? `was planned for ${on}: record the result` : on === today ? "today" : `on ${on}`}`,
          detail: o.satEngineer ? `Engineer: ${o.satEngineer.name}` : "No engineer chosen yet",
          due: on,
          href: `/orders/${o.id}/delivery`,
          action: "Delivery & SAT",
          who: nameOf(o.inquiry.assignee),
        });
      }
      const claims = await this.prisma.db.orderClaim.findMany({
        where: { status: { in: ["open", "with_factory"] }, order: { ...orderAccess(user) } },
        select: { id: true, title: true, openedOn: true, status: true, order: { select: { id: true, refNo: true, customer: { select: { name: true } }, ...handler } } },
      });
      for (const c of claims) {
        const opened = fromDbDate(c.openedOn);
        out.push({
          key: `claim:${c.id}:${c.status}`,
          kind: "order",
          level: days(opened) >= 7 ? "bad" : "warn",
          title: `${c.order.refNo}: claim "${c.title}" open for ${days(opened)} day${days(opened) === 1 ? "" : "s"}`,
          detail: `${c.order.customer.name} · ${c.status === "with_factory" ? "with the factory" : "settle it with the factory and the customer"}`,
          due: opened,
          href: `/orders/${c.order.id}/delivery`,
          action: "Open the claim",
          who: nameOf(c.order.inquiry.assignee),
        });
      }
    }
    return out;
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
