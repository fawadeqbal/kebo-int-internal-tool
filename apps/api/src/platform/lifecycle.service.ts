import { Inject, Injectable, Logger } from "@nestjs/common";
import { fromDbDateOrNull, type CompanyModel } from "@kebo/database";
import { lifecycleStep, LIFECYCLE } from "@kebo/shared";
import { todayIn } from "@kebo/utils";
import { ENV, type Env } from "../config/env";
import { PrismaService } from "../database/prisma.service";
import { CompaniesService } from "../common/company/companies.service";
import { CompanyDataService } from "./company-data";
import { PlatformMail } from "./platform-mail";

const DAY = 86_400_000;

/**
 * The automatic rules (run by the worker, and at once after a change that
 * affects them): demos and trials end, become read-only, are switched off and
 * finally deleted; clients past their paid-until date get a warning, become
 * read-only, then are switched off (never deleted). Emails go to the company's
 * contact and the platform admins. Each step is in the platform log.
 */
@Injectable()
export class LifecycleService {
  private readonly log = new Logger("Lifecycle");

  constructor(
    private readonly prisma: PrismaService,
    private readonly companies: CompaniesService,
    private readonly data: CompanyDataService,
    private readonly mail: PlatformMail,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async run() {
    const all = await this.prisma.platform.company.findMany({ where: { status: { not: "deleted" } } });
    for (const c of all) await this.apply(c).catch((e) => this.log.error(`rules for ${c.slug} failed: ${(e as Error).stack ?? e}`));
    // Deleted companies' short names are free again after the hold.
    const held = new Date(Date.now() - LIFECYCLE.nameHoldDays * DAY);
    const freed = await this.prisma.platform.company.findMany({ where: { status: "deleted", deletedAt: { lt: held }, NOT: { slug: { startsWith: "deleted-" } } }, select: { id: true } });
    for (const f of freed) await this.prisma.platform.company.update({ where: { id: f.id }, data: { slug: `deleted-${f.id.slice(0, 8)}` } });
    // Sign-ups never confirmed are dropped after a week.
    await this.prisma.platform.signUp.deleteMany({ where: { verifiedAt: null, createdAt: { lt: new Date(Date.now() - 7 * DAY) } } });
  }

  async applyOne(id: string) {
    const c = await this.prisma.platform.company.findUnique({ where: { id } });
    if (c && c.status !== "deleted") await this.apply(c);
  }

  private async apply(c: CompanyModel) {
    const now = new Date();
    const step = lifecycleStep(
      { kind: c.kind, status: c.status, statusManual: c.statusManual, endsAt: c.endsAt, renewsOn: fromDbDateOrNull(c.renewsOn), endingNoticeFor: c.endingNoticeFor },
      now,
      todayIn(this.env.APP_TIME_ZONE, now),
    );
    const what = c.kind === "demo" ? "demo" : c.kind === "trial" ? "trial" : "company";
    const db = this.prisma.platform;
    const note = (action: string, summary: string) => db.platformLog.create({ data: { action, summary, companyId: c.id } });
    if (step.do === "nothing") return;

    if (step.do === "ending_notice") {
      await db.company.update({ where: { id: c.id }, data: { endingNoticeFor: c.endsAt } });
      const ends = c.endsAt!.toUTCString();
      if (c.contactEmail) {
        await this.mail.send({
          to: c.contactEmail,
          subject: `Your RFQ Desk ${what} ends tomorrow`,
          heading: `Your ${what} ends tomorrow`,
          rows: [["Company", c.name], ["Ends", ends]],
          body: `After it ends you can still look at everything for ${LIFECYCLE.readOnlyDays} days, but not change anything. To keep using RFQ Desk, reply to this email or contact us.`,
          link: this.mail.url("/login"),
          linkLabel: "Open RFQ Desk",
        });
      }
      await this.mail.toAdmins({
        subject: `${c.name}: ${what} ends tomorrow`,
        heading: `A ${what} ends tomorrow`,
        rows: [["Company", `${c.name} (${c.slug})`], ["Contact", c.contactEmail ? `${c.contactName ?? ""} <${c.contactEmail}>` : null], ["Ends", ends]],
        link: this.mail.url(`/platform/companies/${c.id}`),
        linkLabel: "Open in the platform",
      });
      await note("ending_notice", `${c.name}: told that the ${what} ends tomorrow`);
      return;
    }

    if (step.do === "delete") {
      const { files } = await this.data.clear(c.id, true);
      await db.company.update({ where: { id: c.id }, data: { status: "deleted", statusReason: step.reason, deletedAt: now } });
      await note("delete", `${c.name} (${c.slug}) deleted by the rules: ${step.reason} (${files} file(s) removed)`);
      this.companies.forget(c.id);
      return;
    }

    await db.company.update({ where: { id: c.id }, data: { status: step.status, statusReason: step.reason } });
    await note("status", `${c.name}: ${step.status === "active" ? "switched on" : step.status === "off" ? "switched off" : "now read-only"}${step.reason ? ` (${step.reason})` : ""}`);
    this.companies.forget(c.id);
    if (step.status === "read_only" && c.contactEmail) {
      await this.mail.send({
        to: c.contactEmail,
        subject: c.kind === "client" ? `RFQ Desk: payment overdue` : `Your RFQ Desk ${what} has ended`,
        heading: c.kind === "client" ? "Your payment is overdue" : `Your ${what} has ended`,
        rows: [["Company", c.name]],
        body:
          c.kind === "client"
            ? `${c.name} is now read-only: everyone can look, but nothing can be changed. It is switched off ${LIFECYCLE.overdueOffDays} days after the paid-until date. Contact us to renew.`
            : `${c.name} is now read-only for ${LIFECYCLE.readOnlyDays} days, then switched off. Contact us to keep using RFQ Desk; your data can be kept.`,
      });
    }
    if (step.status !== "active") {
      await this.mail.toAdmins({
        subject: `${c.name}: ${step.status === "off" ? "switched off" : "read-only"} (${step.reason})`,
        heading: `${c.name} is ${step.status === "off" ? "switched off" : "read-only"}`,
        rows: [["Company", `${c.name} (${c.slug})`], ["Why", step.reason]],
        link: this.mail.url(`/platform/companies/${c.id}`),
        linkLabel: "Open in the platform",
      });
    }
  }
}
