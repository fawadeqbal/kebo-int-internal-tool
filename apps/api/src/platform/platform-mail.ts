import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { Prisma } from "@kebo/database";
import {
  adminOrigin,
  companyOrigin,
  MAIL_PROVIDER_LABEL,
  marketingOrigin,
  type MailSettingsInput,
  type PlatformMailView,
} from "@kebo/shared";
import { ENV, type Env } from "../config/env";
import { PrismaService } from "../database/prisma.service";
import { getMailer, renderEmail, type Mailer } from "../common/notify/mailer";
import { accountToStore, isStored, mailerFor, mailView, sendTestEmail, type Stored } from "../common/notify/company-mail";
import type { PlatformAdminUser } from "./platform-auth";

export interface PlatformEmail {
  to: string | string[];
  subject: string;
  heading: string;
  rows?: [string, string | null | undefined][];
  body?: string | null;
  link?: string;
  linkLabel?: string;
}

/** Where the platform's own settings live (Platform settings › Emails). */
const MAIL = "mail";
const INBOX = "inbox";

/**
 * Emails from the platform (to companies' admins, and to the platform admins). Never stops the action that sends
 * them. They go out from the platform's own email (Platform settings › Emails) when one is set, else the
 * server's (.env SMTP_*); to the platform admins at the addresses set there, else PLATFORM_EMAIL, else all of them.
 */
@Injectable()
export class PlatformMail implements OnModuleInit {
  private readonly log = new Logger("PlatformMail");
  /** The settings as last read: read again before each email, and after each change here. */
  private account: Stored | null = null;
  private inbox: string[] = [];

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onModuleInit() {
    await this.load().catch((e) => this.log.warn(`could not read the platform's email settings: ${(e as Error).message}`));
  }

  private async load() {
    const rows = await this.prisma.platform.platformSetting.findMany({ where: { key: { in: [MAIL, INBOX] } } });
    const value = (k: string) => rows.find((r) => r.key === k)?.value;
    const mail = value(MAIL);
    this.account = isStored(mail) ? mail : null;
    const inbox = value(INBOX);
    this.inbox = Array.isArray(inbox) ? inbox.filter((e): e is string => typeof e === "string") : [];
  }

  private get mailer(): Mailer {
    try {
      if (this.account) return mailerFor(this.account, this.env.AUTH_SECRET);
    } catch {
      // A secret that cannot be opened (the server's key changed) falls back to the server's own email.
    }
    return getMailer();
  }

  get enabled() {
    return this.mailer.enabled;
  }

  /** A moment as people read it, in the business time zone ("31 Oct 2026, 14:00"). */
  when(d: Date) {
    return `${new Intl.DateTimeFormat("en-GB", { timeZone: this.env.APP_TIME_ZONE, dateStyle: "medium", timeStyle: "short" }).format(d)} (${this.env.APP_TIME_ZONE})`;
  }

  /** The app's address (links in emails): the platform admin's own for /platform links, else the marketing site's (sign-up). */
  url(path = "/") {
    return `${path.startsWith("/platform") ? adminOrigin(this.env.BASE_DOMAIN, this.env.APP_URL) : marketingOrigin(this.env.BASE_DOMAIN, this.env.APP_URL)}${path}`;
  }

  /** A link into a company (its own address, once companies have addresses). */
  companyUrl(slug: string, path = "/") {
    return `${companyOrigin(slug, this.env.BASE_DOMAIN, this.env.APP_URL)}${path}`;
  }

  async send(e: PlatformEmail): Promise<boolean> {
    try {
      await this.load().catch(() => undefined);
      const { html, text } = renderEmail({
        heading: e.heading,
        rows: e.rows,
        body: e.body,
        link: e.link,
        linkLabel: e.linkLabel,
        footer: "RFQ Desk",
      });
      const mailer = this.mailer;
      await mailer.send({ to: e.to, subject: e.subject, html, text });
      return mailer.enabled;
    } catch (err) {
      this.log.warn(`could not send "${e.subject}": ${(err as Error).message}`);
      return false;
    }
  }

  /** The platform admins' inbox: the addresses set in Platform settings, else PLATFORM_EMAIL, else every active platform admin. */
  async admins(): Promise<string[]> {
    return (await this.where()).to;
  }

  private async where(): Promise<{ to: string[]; from: PlatformMailView["inboxFrom"] }> {
    if (this.inbox.length) return { to: this.inbox, from: "here" };
    if (this.env.PLATFORM_EMAIL)
      return {
        from: "server",
        to: this.env.PLATFORM_EMAIL.split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      };
    return {
      from: "admins",
      to: (await this.prisma.platform.platformAdmin.findMany({ where: { isActive: true }, select: { email: true } })).map((a) => a.email),
    };
  }

  async toAdmins(e: Omit<PlatformEmail, "to">) {
    const to = await this.admins();
    if (to.length) await this.send({ ...e, to });
  }

  /* ------------------------------------------------------------ Platform settings › Emails */

  async view(): Promise<PlatformMailView> {
    await this.load();
    const where = await this.where();
    return { ...mailView(this.account, getMailer().enabled), inbox: this.inbox, inboxNow: where.to, inboxFrom: where.from };
  }

  private async put(admin: PlatformAdminUser, key: string, value: unknown | null, summary: string) {
    const db = this.prisma.platform;
    await db.$transaction([
      value === null
        ? db.platformSetting.deleteMany({ where: { key } })
        : db.platformSetting.upsert({
            where: { key },
            create: { key, value: value as Prisma.InputJsonValue, updatedBy: admin.name },
            update: { value: value as Prisma.InputJsonValue, updatedBy: admin.name },
          }),
      // The log says what changed, never the secret.
      db.platformLog.create({ data: { adminId: admin.id, adminName: admin.name, action: "settings", summary } }),
    ]);
    await this.load();
  }

  /** The platform's own sending email. A password or key left empty keeps the stored one (for the same account). */
  async saveAccount(admin: PlatformAdminUser, input: MailSettingsInput): Promise<PlatformMailView> {
    await this.load();
    const before = this.account;
    const { value, typed } = await accountToStore(input, before, this.env.AUTH_SECRET);
    await this.put(
      admin,
      MAIL,
      value,
      `Platform email: ${MAIL_PROVIDER_LABEL[input.provider]}, from ${input.fromEmail}${typed && before ? " (new password or key)" : ""}`,
    );
    return this.view();
  }

  /** Back to the server's own email (.env). */
  async removeAccount(admin: PlatformAdminUser): Promise<PlatformMailView> {
    await this.put(admin, MAIL, null, "Platform email: its own setting removed, the server's is used");
    return this.view();
  }

  /** Where the platform's emails go. Empty: back to PLATFORM_EMAIL, else every platform admin. */
  async saveInbox(admin: PlatformAdminUser, emails: string[]): Promise<PlatformMailView> {
    await this.put(
      admin,
      INBOX,
      emails.length ? emails : null,
      emails.length
        ? `Platform emails go to ${emails.join(", ")}`
        : "Platform emails go to the server's PLATFORM_EMAIL, else every platform admin",
    );
    return this.view();
  }

  async test(to: string) {
    await this.load();
    return sendTestEmail(this.mailer, this.account, to, "Sent from Platform settings › Emails.");
  }
}
