import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { companyOrigin, INQUIRY_STAGE_LABEL, LOST_REASON_LABEL, ORDER_STAGE_LABEL, REVISION_STATUS_LABEL } from "@kebo/shared";
import { CompanyContext } from "../../common/company/company-context";
import { PrismaService, type Tx } from "../../database/prisma.service";
import { EventBus, type DomainEvent } from "../../common/events/event-bus";
import { ENV, type Env } from "../../config/env";
import { getMailer, renderEmail } from "../../common/notify/mailer";
import { sendPush } from "../../common/notify/fcm";
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
  orderMoney: (id: string) => `/orders/${id}/money`,
};

/**
 * In-app notifications (+ push to phones), and emails to the admin list for the
 * events chosen in Settings. Nobody is notified about their own action.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly log = new Logger("Notify");

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBus,
    private readonly settings: SettingsService,
    @Inject(ENV) private readonly env: Env,
    private readonly limits: LimitsService,
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
      const slug = CompanyContext.current()?.slug;
      const origin = slug ? companyOrigin(slug, this.env.BASE_DOMAIN, this.env.APP_URL) : this.env.APP_URL;
      const { html, text } = renderEmail({
        ...content,
        link: content.link ? new URL(content.link, origin).toString() : undefined,
        footer: `${s.company.name} · you get this because your email is on the notification list in Settings.`,
      });
      await getMailer().send({ to: s.notifications.emails, subject, html, text });
    } catch (e) {
      this.log.warn(`email failed: ${(e as Error).message}`);
    }
  }

  /* ---------------------------------------------------------------- reacting to events */

  onModuleInit() {
    this.bus.on("inquiry.created", (e) => this.inquiryCreated(e));
    this.bus.on("inquiry.assigned", (e) => this.inquiryAssigned(e));
    this.bus.on("inquiry.stageChanged", (e) => this.stageChanged(e));
    this.bus.on("revision.statusChanged", (e) => this.revisionChanged(e));
    this.bus.on("order.created", (e) =>
      this.notify(
        e.notify,
        {
          type: "order.created",
          title: `Order ${e.refNo} confirmed — send the proforma invoice and wait for the deposit`,
          link: links.order(e.orderId),
        },
        e.actorId,
      ).then(() => undefined),
    );
    this.bus.on("order.stageChanged", (e) =>
      this.notify(
        e.notify,
        {
          type: "order.stage",
          title: `${e.refNo}: ${ORDER_STAGE_LABEL[e.from]} → ${ORDER_STAGE_LABEL[e.to]}`,
          link: links.order(e.orderId),
        },
        e.actorId,
      ).then(() => undefined),
    );
    this.bus.on("payment.recorded", (e) => this.paymentRecorded(e));
  }

  private async inquiryCreated(e: Extract<DomainEvent, { type: "inquiry.created" }>) {
    await this.notify(
      await this.managerIds(),
      {
        type: "inquiry.created",
        title: `New inquiry ${e.refNo}: ${e.title}`,
        body: e.channel === "website" ? "From the website form — assign someone" : null,
        link: links.deal(e.inquiryId),
      },
      e.actorId,
    );
    await this.emailAdmins("newInquiry", `New inquiry ${e.refNo}: ${e.title}`, {
      heading: `New inquiry ${e.refNo}`,
      rows: [
        ["What", e.title],
        ["Came in by", e.channel],
      ],
      link: links.deal(e.inquiryId),
      linkLabel: "Open the inquiry",
    });
  }

  private async inquiryAssigned(e: Extract<DomainEvent, { type: "inquiry.assigned" }>) {
    if (!e.assigneeId) return;
    await this.notify(
      [e.assigneeId],
      {
        type: "inquiry.assigned",
        title: `${e.refNo} is yours: ${e.title}`,
        body: "Next: get factory prices",
        link: links.deal(e.inquiryId),
      },
      e.actorId,
    );
  }

  private async stageChanged(e: Extract<DomainEvent, { type: "inquiry.stageChanged" }>) {
    if (e.to !== "won" && e.to !== "lost") return;
    const title = `${e.refNo} ${e.to === "won" ? "won" : "lost"}: ${e.title}`;
    await this.notify(
      [...e.notify, ...(await this.managerIds())],
      { type: `inquiry.${e.to}`, title, link: links.deal(e.inquiryId) },
      e.actorId,
    );
    const deal = await this.prisma.db.inquiry.findUnique({ where: { id: e.inquiryId }, select: { lostReason: true, lostNote: true } });
    await this.emailAdmins("dealWonOrLost", title, {
      heading: title,
      rows: [
        ["Stage", `${INQUIRY_STAGE_LABEL[e.from]} → ${INQUIRY_STAGE_LABEL[e.to]}`],
        ["Reason", e.to === "lost" && deal?.lostReason ? LOST_REASON_LABEL[deal.lostReason] : null],
      ],
      body: e.to === "lost" ? deal?.lostNote : null,
      link: links.deal(e.inquiryId),
      linkLabel: "Open the inquiry",
    });
  }

  private async revisionChanged(e: Extract<DomainEvent, { type: "revision.statusChanged" }>) {
    if (e.status === "sent") return;
    await this.notify(
      e.notify,
      {
        type: `quotation.${e.status}`,
        title: `${e.refNo}: ${REVISION_STATUS_LABEL[e.status].toLowerCase()} by the customer`,
        link: links.deal(e.inquiryId),
      },
      e.actorId,
    );
  }

  private async paymentRecorded(e: Extract<DomainEvent, { type: "payment.recorded" }>) {
    await this.notify(
      e.notify,
      { type: "payment.in", title: `${e.refNo}: received ${e.amount}`, link: links.orderMoney(e.orderId) },
      e.actorId,
    );
    await this.emailAdmins("paymentReceived", `Payment received on ${e.refNo}: ${e.amount}`, {
      heading: `Payment received: ${e.amount}`,
      rows: [["Order", e.refNo]],
      link: links.orderMoney(e.orderId),
      linkLabel: "Open the order",
    });
  }

  /* ---------------------------------------------------------------- reading */

  async mine(user: SessionUser, opts: { unreadOnly?: boolean; take?: number }) {
    const [items, unread] = await Promise.all([
      this.prisma.db.notification.findMany({
        where: { userId: user.id, ...(opts.unreadOnly ? { readAt: null } : {}) },
        orderBy: { createdAt: "desc" },
        take: Math.min(opts.take ?? 50, 200),
      }),
      this.prisma.db.notification.count({ where: { userId: user.id, readAt: null } }),
    ]);
    return { unread, items };
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
