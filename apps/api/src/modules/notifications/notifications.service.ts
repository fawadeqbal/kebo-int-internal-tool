import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { companyOrigin, messageLine, type Message } from "@kebo/shared";
import { CompanyContext } from "../../common/company/company-context";
import { PrismaService, type Tx } from "../../database/prisma.service";
import { EventBus, type DomainEvent } from "../../common/events/event-bus";
import { ENV, type Env } from "../../config/env";
import { renderEmail } from "../../common/notify/mailer";
import { renderMessageEmail } from "../../common/notify/message-email";
import { Clock } from "../../common/time/clock.service";
import { CompanyMail } from "../../common/notify/company-mail";
import { sendPush } from "../../common/notify/fcm";
import { fromDbDateOrNull } from "@kebo/database";
import { toMinor } from "@kebo/money";
import { factoryPlansOf, fxOf } from "../billing/api";
import { day, inquiryFacts, money, orderFacts, revisionFacts } from "./facts";
import { inquiryLost, inquiryNew, inquiryYours, paymentIn, purchaseOrderSent, quotationAccepted, quotationRejected, quotationSent, shipped } from "./messages";
import type { SessionUser } from "../../common/auth/session-user";
import { SettingsService } from "../settings/settings.service";
import { LimitsService } from "../../common/company/limits.service";

export interface NewNotification {
  type: string;
  title: string;
  body?: string | null;
  /** A path in the web app, e.g. /deals/<id>. */
  link?: string | null;
  /** The same key is never notified twice to the same person (reminders run every hour). */
  dedupeKey?: string | null;
}

export const links = {
  deal: (id: string) => `/inquiries/${id}`,
  order: (id: string) => `/orders/${id}`,
  /** The order's Money tab (payments in, the plan, factory payments). */
  orderMoney: (id: string) => `/orders/${id}/payment`,
};

/**
 * In-app notifications (+ push to phones), and emails to the admin list for the
 * events chosen in Settings. Nobody is notified about their own action.
 */
/** The Alerts page's chips: the starts of the notification types each one shows. */
export const NOTIFICATION_GROUPS = ["payments", "inquiries", "orders", "followUps", "mentions"] as const;
export type NotificationGroup = (typeof NOTIFICATION_GROUPS)[number];
const GROUP_TYPES: Record<NotificationGroup, string[]> = {
  payments: ["payment.", "approval.", "reminder.instalment"],
  inquiries: ["inquiry.", "quotation.", "reminder.new", "reminder.sourcing", "reminder.overdue", "reminder.dueSoon", "reminder.quotation"],
  orders: ["order.", "reminder.order"],
  followUps: ["followUp."],
  mentions: ["mention."],
};

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly log = new Logger("Notify");

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBus,
    private readonly settings: SettingsService,
    @Inject(ENV) private readonly env: Env,
    private readonly limits: LimitsService,
    private readonly mail: CompanyMail,
    private readonly clock: Clock,
  ) {}

  /* ---------------------------------------------------------------- sending */

  /** The people who get the managers' reminders: the Super Admin and every role that sees every deal. */
  async managerIds(db: PrismaService["db"] | Tx = this.prisma.db) {
    return (
      await db.user.findMany({
        where: {
          access: { OR: [{ superAdmin: true }, { permissions: { has: "inquiries.viewAll" } }] },
          isActive: true,
          isSystem: false,
          platformAdminId: null,
        },
        select: { id: true },
      })
    ).map((u) => u.id);
  }

  /** Store for each person (once per dedupe key) and push to their phones. Returns how many were new. */
  async notify(userIds: (string | null | undefined)[], n: NewNotification, exceptActor?: string | null): Promise<number> {
    const ids = [...new Set(userIds.filter((u): u is string => !!u && u !== exceptActor))];
    if (!ids.length) return 0;
    const res = await this.prisma.db.notification.createManyAndReturn({
      data: ids.map((userId) => ({
        userId,
        type: n.type,
        title: n.title.slice(0, 255),
        body: n.body ?? null,
        link: n.link ?? null,
        dedupeKey: n.dedupeKey ?? null,
      })),
      skipDuplicates: true,
      select: { userId: true },
    });
    const fresh = res.map((r) => r.userId);
    if (fresh.length) void this.push(fresh, n);
    return fresh.length;
  }

  /**
   * The one way to tell people something (claude/messages-design.md): the message is kept in each person's bell
   * (its subject, and its record and next step), pushed to their phones, and emailed to them in full. `to`:
   * groups of people with what they are to it ("who handles it", "a manager"), said at the foot of the email;
   * someone in two groups is told once, as the first. Nobody is told about their own action. `dedupeKey`: never
   * the same twice to the same person. `email: false`: bell and phone only (a reminder 30 minutes before).
   * `copy`: also emailed to the admin list in Company settings › Emails when that kind is switched on there.
   * Returns how many people were told (new ones only).
   */
  async send(
    m: Message,
    to: { ids: (string | null | undefined)[]; as: string }[],
    opts: { actorId?: string | null; dedupeKey?: string | null; email?: boolean; copy?: "newInquiry" | "dealWonOrLost" | "paymentReceived" } = {},
  ): Promise<number> {
    const as = new Map<string, string>();
    for (const g of to) for (const id of g.ids) if (id && id !== opts.actorId && !as.has(id)) as.set(id, g.as);
    let fresh: string[] = [];
    if (as.size) {
      const res = await this.prisma.db.notification.createManyAndReturn({
        data: [...as.keys()].map((userId) => ({
          userId,
          type: m.kind,
          title: m.subject.slice(0, 255),
          body: messageLine(m),
          link: m.link,
          dedupeKey: opts.dedupeKey ?? null,
          message: m as unknown as object,
        })),
        skipDuplicates: true,
        select: { userId: true },
      });
      fresh = res.map((r) => r.userId);
      if (fresh.length) void this.push(fresh, { type: m.kind, title: m.subject, body: m.next, link: m.link });
    }
    if (opts.email !== false && fresh.length) await this.emailMessage(m, fresh.map((id) => ({ id, as: as.get(id)! })));
    if (opts.copy) await this.copyToList(m, opts.copy);
    return fresh.length;
  }

  /** Where links in emails go, and how the company and the time read in them. */
  private async emailContext() {
    const company = CompanyContext.current();
    const origin = company ? companyOrigin(company.slug, this.env.BASE_DOMAIN, this.env.APP_URL, company.domain) : this.env.APP_URL;
    const at = new Intl.DateTimeFormat("en-GB", { timeZone: this.clock.timeZone, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(this.clock.now());
    return { company: (await this.settings.get()).company.name || company?.name || "Kebo ERP", origin, at };
  }

  /** The message, emailed to each person at their own address (active people with an email; nothing when email is not set up). */
  async emailMessage(m: Message, people: { id: string; as: string }[]) {
    try {
      const mailer = await this.mail.mailer();
      if (!mailer.enabled || !people.length) return;
      const users = await this.prisma.db.user.findMany({
        where: { id: { in: people.map((p) => p.id) }, isActive: true, isSystem: false, platformAdminId: null },
        select: { id: true, email: true },
      });
      const ctx = await this.emailContext();
      for (const p of people) {
        const email = users.find((u) => u.id === p.id)?.email;
        if (!email) continue;
        const { subject, html, text } = renderMessageEmail(m, { ...ctx, why: p.as });
        await mailer.send({ to: email, subject, html, text }).catch((e: Error) => this.log.warn(`email to a person failed: ${e.message}`));
      }
    } catch (e) {
      this.log.warn(`email failed: ${(e as Error).message}`);
    }
  }

  /** A copy to the admin list (Company settings › Emails), for the kinds switched on there. */
  private async copyToList(m: Message, kind: "newInquiry" | "dealWonOrLost" | "paymentReceived" | "dailySummary") {
    const s = await this.settings.get();
    if (!s.notifications[kind] || !s.notifications.emails.length) return;
    try {
      const mailer = await this.mail.mailer();
      if (!mailer.enabled) return;
      const { subject, html, text } = renderMessageEmail(m, { ...(await this.emailContext()), why: "your email is on the list in Company settings › Emails" });
      await mailer.send({ to: s.notifications.emails, subject, html, text });
    } catch (e) {
      this.log.warn(`email to the list failed: ${(e as Error).message}`);
    }
  }

  private async push(userIds: string[], n: NewNotification) {
    try {
      // Phones get pushes only while the company's plan includes the phone app.
      if (!(await this.limits.allows("mobile_app"))) return;
      const devices = await this.prisma.db.deviceToken.findMany({
        where: { userId: { in: userIds }, OR: [{ sessionId: null }, { session: { revokedAt: null, expiresAt: { gt: new Date() } } }] },
        select: { token: true },
      });
      const dead = await sendPush(
        devices.map((d) => d.token),
        { title: n.title, body: n.body, data: n.link ? { link: n.link } : {} },
      );
      if (dead.length) await this.prisma.db.deviceToken.deleteMany({ where: { token: { in: dead } } });
    } catch (e) {
      this.log.warn(`push failed: ${(e as Error).message}`);
    }
  }

  /** Email the admin list (Settings → notifications), when that kind of event is switched on. */
  async emailAdmins(
    kind: "newInquiry" | "dealWonOrLost" | "paymentReceived" | "dailySummary",
    subject: string,
    content: Parameters<typeof renderEmail>[0],
  ) {
    const s = await this.settings.get();
    if (!s.notifications[kind] || !s.notifications.emails.length) return;
    try {
      // Links go to the company's own address (once companies have addresses).
      const company = CompanyContext.current();
      const origin = company ? companyOrigin(company.slug, this.env.BASE_DOMAIN, this.env.APP_URL, company.domain) : this.env.APP_URL;
      const { html, text } = renderEmail({
        ...content,
        link: content.link ? new URL(content.link, origin).toString() : undefined,
        footer: `${s.company.name} · you get this because your email is on the notification list in Settings.`,
      });
      await (await this.mail.mailer()).send({ to: s.notifications.emails, subject, html, text });
    } catch (e) {
      this.log.warn(`email failed: ${(e as Error).message}`);
    }
  }

  /** Email can be sent now: the company's own (Admin settings › Email sending), or the server's. */
  async canEmail(): Promise<boolean> {
    return (await this.mail.mailer()).enabled;
  }

  /**
   * An email to one person of the company, at their own address (their reminders). Nothing when they are
   * not active or email is not set up; a failure is logged and never stops the work that sent it.
   */
  async emailUser(userId: string, subject: string, content: Parameters<typeof renderEmail>[0]): Promise<boolean> {
    try {
      const mailer = await this.mail.mailer();
      if (!mailer.enabled) return false;
      const to = await this.prisma.db.user.findFirst({ where: { id: userId, isActive: true, isSystem: false, platformAdminId: null }, select: { email: true } });
      if (!to?.email) return false;
      const company = CompanyContext.current();
      const origin = company ? companyOrigin(company.slug, this.env.BASE_DOMAIN, this.env.APP_URL, company.domain) : this.env.APP_URL;
      const s = await this.settings.get();
      const { html, text } = renderEmail({
        ...content,
        link: content.link ? new URL(content.link, origin).toString() : undefined,
        footer: `${s.company.name}${content.footer ? ` · ${content.footer}` : ""}`,
      });
      await mailer.send({ to: to.email, subject, html, text });
      return true;
    } catch (e) {
      this.log.warn(`email to a person failed: ${(e as Error).message}`);
      return false;
    }
  }

  /* ---------------------------------------------------------------- reacting to events */

  onModuleInit() {
    this.bus.on("inquiry.created", (e) => this.inquiryCreated(e));
    this.bus.on("inquiry.assigned", (e) => this.inquiryAssigned(e));
    this.bus.on("inquiry.stageChanged", (e) => this.stageChanged(e));
    this.bus.on("revision.statusChanged", (e) => this.revisionChanged(e));
    // A sales order is made only when the customer accepts: "Customer accepted" says it (one message, not three).
    this.bus.on("order.stageChanged", (e) => this.orderStage(e));
    this.bus.on("purchaseOrder.sent", (e) => this.purchaseOrderSent(e));
    this.bus.on("payment.recorded", (e) => this.paymentRecorded(e));
  }

  private nameOf = async (id: string | null | undefined) =>
    id ? ((await this.prisma.db.user.findUnique({ where: { id }, select: { name: true } }))?.name ?? null) : null;

  private async orderOf(id: string) {
    const s = await this.settings.get();
    return orderFacts(this.prisma.db, id, s, await this.limits.allows("expenses"), this.clock.today());
  }

  private async inquiryCreated(e: Extract<DomainEvent, { type: "inquiry.created" }>) {
    const i = await inquiryFacts(this.prisma.db, e.inquiryId);
    if (!i) return;
    await this.send(inquiryNew(i, await this.nameOf(e.actorId)), [{ ids: await this.managerIds(), as: "a manager" }], {
      actorId: e.actorId,
      copy: "newInquiry",
    });
  }

  private async inquiryAssigned(e: Extract<DomainEvent, { type: "inquiry.assigned" }>) {
    if (!e.assigneeId) return;
    const i = await inquiryFacts(this.prisma.db, e.inquiryId);
    if (!i) return;
    await this.send(inquiryYours(i, e.actorId === e.assigneeId ? null : await this.nameOf(e.actorId)), [{ ids: [e.assigneeId], as: "the person it is given to" }], {
      actorId: e.actorId,
    });
  }

  private async stageChanged(e: Extract<DomainEvent, { type: "inquiry.stageChanged" }>) {
    // Won: said by "Customer accepted".
    if (e.to !== "lost") return;
    const i = await inquiryFacts(this.prisma.db, e.inquiryId);
    if (!i) return;
    const last = await this.prisma.db.quotationRevision.findFirst({
      where: { quotation: { inquiryId: i.id }, deletedAt: null, status: { not: "draft" } },
      orderBy: { number: "desc" },
      select: { id: true },
    });
    const r = last ? await revisionFacts(this.prisma.db, last.id) : null;
    const cancelled = e.from === "won" ? await this.prisma.db.order.findFirst({ where: { inquiryId: i.id, status: "cancelled" }, orderBy: { createdAt: "desc" }, select: { refNo: true } }) : null;
    await this.send(
      inquiryLost(i, await this.nameOf(e.actorId), r?.headline ?? null, cancelled?.refNo ?? null),
      [
        { ids: e.notify, as: "who handles it" },
        { ids: await this.managerIds(), as: "a manager" },
      ],
      { actorId: e.actorId, copy: "dealWonOrLost" },
    );
  }

  private async revisionChanged(e: Extract<DomainEvent, { type: "revision.statusChanged" }>) {
    if (e.status !== "sent" && e.status !== "accepted" && e.status !== "rejected") return;
    const [i, r] = await Promise.all([inquiryFacts(this.prisma.db, e.inquiryId), e.revisionId ? revisionFacts(this.prisma.db, e.revisionId) : null]);
    if (!i || !r) return;
    const by = await this.nameOf(e.actorId);
    const managers = { ids: await this.managerIds(), as: "a manager" };
    const team = [
      { ids: [i.assigneeId], as: "who handles it" },
      { ids: [r.createdById], as: "who made the quotation" },
      managers,
    ];
    if (e.status === "sent") await this.send(quotationSent(i, r, by), [managers], { actorId: e.actorId });
    else if (e.status === "accepted") {
      const o = r.order ? await this.orderOf(r.order.id) : null;
      await this.send(quotationAccepted(i, r, o, by), team, { actorId: e.actorId, copy: "dealWonOrLost" });
    } else await this.send(quotationRejected(i, r, by, e.reason ?? null), team, { actorId: e.actorId });
  }

  private async orderStage(e: Extract<DomainEvent, { type: "order.stageChanged" }>) {
    if (e.to !== "shipped") return;
    const o = await this.orderOf(e.orderId);
    if (!o) return;
    const sh = await this.prisma.db.shipment.findFirst({
      where: { orderId: o.id, departedOn: { not: null } },
      orderBy: { departedOn: "desc" },
      select: { departedOn: true, eta: true, vessel: true, blNo: true, portOfLoading: true, portOfDischarge: true, forwarder: true, containerNo: true, containerType: true },
    });
    const message = shipped(o, {
      departedOn: fromDbDateOrNull(sh?.departedOn ?? null),
      eta: fromDbDateOrNull(sh?.eta ?? null),
      vessel: sh?.vessel ?? null,
      blNo: sh?.blNo ?? null,
      port: sh?.portOfLoading ?? null,
      to: sh?.portOfDischarge ?? null,
      forwarder: sh?.forwarder ?? null,
      container: [sh?.containerType, sh?.containerNo].filter(Boolean).join(" ") || null,
    });
    await this.send(
      message,
      [
        { ids: [o.handlerId], as: "who handles the order" },
        { ids: await this.managerIds(), as: "a manager" },
      ],
      { actorId: e.actorId, dedupeKey: `shipped:${o.id}` },
    );
  }

  private async purchaseOrderSent(e: Extract<DomainEvent, { type: "purchaseOrder.sent" }>) {
    const o = await this.orderOf(e.orderId);
    const po = await this.prisma.db.purchaseOrder.findUnique({
      where: { id: e.purchaseOrderId },
      select: {
        number: true,
        sentEarlyReason: true,
        supplierId: true,
        supplier: { select: { name: true, contacts: { where: { deletedAt: null }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], take: 1, select: { name: true, phone: true, whatsapp: true, wechat: true, email: true } } } },
      },
    });
    if (!o || !po) return;
    const s = await this.settings.get();
    const plan = (await factoryPlansOf(this.prisma.db, o.id, s.sales.factoryAdvancePercent, this.clock.today(), s.reminders.dueSoonDays, fxOf(s, await this.limits.allows("expenses")))).find(
      (f) => f.factory.id === po.supplierId,
    );
    const c = po.supplier.contacts[0];
    const owed = plan ? toMinor(plan.owed) : 0;
    const first = plan?.rows.find((r) => r.status !== "paid") ?? null;
    await this.send(
      purchaseOrderSent(o, {
        number: po.number,
        factory: po.supplier.name,
        contact: c ? [c.name, c.wechat ? `WeChat ${c.wechat}` : c.whatsapp || c.phone].filter(Boolean).join(" · ") : null,
        amount: owed > 0 && plan ? money(owed, plan.currency) : null,
        advance: first && plan ? `${money(toMinor(first.open), plan.currency)} · ${first.label.toLowerCase()}${first.due ? `, due ${day(first.due)}` : ""}` : null,
        by: await this.nameOf(e.actorId),
        early: po.sentEarlyReason,
      }),
      [
        { ids: [o.handlerId], as: "who handles the order" },
        { ids: await this.managerIds(), as: "a manager" },
      ],
      { actorId: e.actorId, dedupeKey: `po-sent:${e.purchaseOrderId}` },
    );
  }

  private async paymentRecorded(e: Extract<DomainEvent, { type: "payment.recorded" }>) {
    const o = await this.orderOf(e.orderId);
    if (!o) return;
    const amount = (() => {
      const [cur, value] = e.amount.split(" ");
      return cur && value ? money(toMinor(value), cur) : e.amount;
    })();
    await this.send(
      paymentIn(o, amount, await this.nameOf(e.actorId), e.paidOn ?? null),
      [
        { ids: [...e.notify, o.handlerId], as: "who handles the order" },
        { ids: await this.managerIds(), as: "a manager" },
      ],
      { actorId: e.actorId, copy: "paymentReceived" },
    );
  }

  /* ---------------------------------------------------------------- reading */

  /** Mine, newest first, `take` at a time (page 1 by default); `total`: how many there are with the same filter. */
  async mine(user: SessionUser, opts: { unreadOnly?: boolean; take?: number; page?: number; group?: NotificationGroup }) {
    const where = {
      userId: user.id,
      ...(opts.unreadOnly ? { readAt: null } : {}),
      ...(opts.group ? { OR: GROUP_TYPES[opts.group].map((t) => ({ type: { startsWith: t } })) } : {}),
    };
    const take = Math.min(opts.take ?? 50, 200);
    const [items, unread, total] = await Promise.all([
      this.prisma.db.notification.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: ((opts.page ?? 1) - 1) * take, take }),
      this.prisma.db.notification.count({ where: { userId: user.id, readAt: null } }),
      this.prisma.db.notification.count({ where }),
    ]);
    return { unread, total, items };
  }

  async markRead(user: SessionUser, ids: string[] | "all") {
    await this.prisma.db.notification.updateMany({
      where: { userId: user.id, readAt: null, ...(ids === "all" ? {} : { id: { in: ids } }) },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }

  /** A phone signed in to the app, for push. */
  async registerDevice(user: SessionUser, token: string, platform: string) {
    await this.prisma.db.deviceToken.upsert({
      where: { companyId_token: { companyId: CompanyContext.require().id, token } },
      create: { token, platform, userId: user.id, sessionId: user.sessionId },
      update: { userId: user.id, sessionId: user.sessionId, platform, lastSeenAt: new Date() },
    });
    return { ok: true };
  }

  async removeDevice(user: SessionUser, token: string) {
    await this.prisma.db.deviceToken.deleteMany({ where: { token, userId: user.id } });
    return { ok: true };
  }
}
