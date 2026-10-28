import { Inject, Injectable, Logger } from "@nestjs/common";
import { ENV, type Env } from "../config/env";
import { PrismaService } from "../database/prisma.service";
import { getMailer, renderEmail } from "../common/notify/mailer";
import { adminOrigin, companyOrigin } from "@kebo/shared";

export interface PlatformEmail {
  to: string | string[];
  subject: string;
  heading: string;
  rows?: [string, string | null | undefined][];
  body?: string | null;
  link?: string;
  linkLabel?: string;
}

/** Emails from the platform (to companies' admins, and to the platform admins). Never stops the action that sends them. */
@Injectable()
export class PlatformMail {
  private readonly mailer = getMailer();
  private readonly log = new Logger("PlatformMail");

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  get enabled() {
    return this.mailer.enabled;
  }

  /** A moment as people read it, in the business time zone ("31 Oct 2026, 14:00"). */
  when(d: Date) {
    return `${new Intl.DateTimeFormat("en-GB", { timeZone: this.env.APP_TIME_ZONE, dateStyle: "medium", timeStyle: "short" }).format(d)} (${this.env.APP_TIME_ZONE})`;
  }

  /** The app's address (links in emails): the platform admin's own address for /platform links. */
  url(path = "/") {
    return `${path.startsWith("/platform") ? adminOrigin(this.env.BASE_DOMAIN, this.env.APP_URL) : this.env.APP_URL.replace(/\/$/, "")}${path}`;
  }

  /** A link into a company (its own address, once companies have addresses). */
  companyUrl(slug: string, path = "/") {
    return `${companyOrigin(slug, this.env.BASE_DOMAIN, this.env.APP_URL)}${path}`;
  }

  async send(e: PlatformEmail): Promise<boolean> {
    try {
      const { html, text } = renderEmail({
        heading: e.heading,
        rows: e.rows,
        body: e.body,
        link: e.link,
        linkLabel: e.linkLabel,
        footer: "RFQ Desk",
      });
      await this.mailer.send({ to: e.to, subject: e.subject, html, text });
      return this.mailer.enabled;
    } catch (err) {
      this.log.warn(`could not send "${e.subject}": ${(err as Error).message}`);
      return false;
    }
  }

  /** The platform admins' inbox: PLATFORM_EMAIL, else every active platform admin. */
  async admins(): Promise<string[]> {
    if (this.env.PLATFORM_EMAIL)
      return this.env.PLATFORM_EMAIL.split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    return (await this.prisma.platform.platformAdmin.findMany({ where: { isActive: true }, select: { email: true } })).map((a) => a.email);
  }

  async toAdmins(e: Omit<PlatformEmail, "to">) {
    const to = await this.admins();
    if (to.length) await this.send({ ...e, to });
  }
}
