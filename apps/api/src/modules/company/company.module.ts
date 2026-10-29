import { randomBytes } from "node:crypto";
import { Body, Controller, Get, HttpCode, Inject, Module, Post, Put, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { fromDbDateOrNull } from "@kebo/database";
import { companyOrigin, LIFECYCLE, slugField } from "@kebo/shared";
import { addDays, ConflictError, DomainError, ForbiddenError, todayIn } from "@kebo/utils";
import { ENV, type Env } from "../../config/env";
import { PrismaService } from "../../database/prisma.service";
import { AllowDuringTwoStepSetup, CurrentUser, RequirePermissions } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { Validate } from "../../common/http/zod.pipe";
import { AuditService } from "../../common/audit/audit.service";
import { CompanyContext } from "../../common/company/company-context";
import { CompaniesService } from "../../common/company/companies.service";
import { LimitsService } from "../../common/company/limits.service";

/**
 * The signed-in person's company as the app shows it: its name and status,
 * the plan, what is used, and the warnings to show (demo or trial ending,
 * payment overdue, near a limit).
 */
@ApiTags("company")
@Controller("company")
class CompanyController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limits: LimitsService,
    private readonly companies: CompaniesService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /* ---------------------------------------------------------------- address */

  /** When the company may change its address again (one change per renameRedirectDays: the old one is held that long). */
  private async nextChange(id: string) {
    const row = await this.prisma.platform.company.findUniqueOrThrow({ where: { id }, select: { previousSlugUntil: true } });
    return row.previousSlugUntil && row.previousSlugUntil > new Date() ? row.previousSlugUntil : null;
  }

  private async mayChange(user: SessionUser) {
    if (user.viaPlatform) return true;
    const role = await this.prisma.db.role.findFirst({ where: { key: user.role }, select: { superAdmin: true } });
    return !!role?.superAdmin;
  }

  /** The company's address, and whether a new short name is free (?slug=, for the live check while typing). */
  @Get("address")
  @RequirePermissions("settings.manage")
  async address(@CurrentUser() user: SessionUser, @Query("slug") wanted?: string) {
    const c = CompanyContext.require();
    const slug = wanted?.trim().toLowerCase().slice(0, 63);
    const next = await this.nextChange(c.id);
    return {
      /** Only a Super Admin (or the platform admin visiting) changes it. */
      canChange: await this.mayChange(user),
      slug: c.slug,
      url: companyOrigin(c.slug, this.env.BASE_DOMAIN, this.env.APP_URL),
      baseDomain: this.env.BASE_DOMAIN || null,
      /** Not before this (the last change is recent). */
      nextChangeOn: next,
      check: slug
        ? {
            slug,
            url: companyOrigin(slug, this.env.BASE_DOMAIN, this.env.APP_URL),
            problem: slug === c.slug ? "This is the address now." : await this.companies.slugTaken(slug, c.id),
          }
        : null,
    };
  }

  /** A new address (Super Admin): the old one sends people on for a while, then becomes free. */
  @Put("address")
  @RequirePermissions("settings.manage")
  async changeAddress(@CurrentUser() user: SessionUser, @Body(Validate(z.object({ slug: slugField }))) body: { slug: string }) {
    const c = CompanyContext.require();
    if (!(await this.mayChange(user))) throw new ForbiddenError("Only a Super Admin can change the company's address.");
    if (body.slug === c.slug) throw new DomainError("This is the address now.");
    const next = await this.nextChange(c.id);
    if (next && !user.viaPlatform) {
      throw new DomainError(
        `The address was changed recently. It can change again on ${next.toISOString().slice(0, 10)}, or ask us to change it.`,
      );
    }
    const taken = await this.companies.slugTaken(body.slug, c.id);
    if (taken) throw new ConflictError(taken);
    await this.companies.rename(c.id, c.slug, body.slug);
    const days = LIFECYCLE.renameRedirectDays;
    await this.prisma.tx((tx) =>
      this.audit.record(tx, {
        userId: user.id,
        action: "update",
        entityType: "settings",
        summary: `Changed the company's address from ${c.slug} to ${body.slug} (the old one sends people on for ${days} days)`,
      }),
    );
    await this.prisma.platform.platformLog.create({
      data: {
        action: "update",
        adminName: `${user.name} (${c.name})`,
        summary: `${c.name} changed its address from ${c.slug} to ${body.slug}`,
        companyId: c.id,
      },
    });
    return { slug: body.slug, url: companyOrigin(body.slug, this.env.BASE_DOMAIN, this.env.APP_URL) };
  }

  /* ---------------------------------------------------------------- website form */

  /** The company's website form: its key and the snippet to paste (Super Admin). */
  @Get("website-form")
  @RequirePermissions("settings.manage")
  async websiteForm(@CurrentUser() user: SessionUser) {
    const c = CompanyContext.require();
    if (!(await this.mayChange(user))) throw new ForbiddenError("Only a Super Admin can see the website form's key.");
    const row = await this.prisma.platform.company.findUniqueOrThrow({ where: { id: c.id }, select: { formKey: true } });
    return { key: row.formKey, endpoint: `${this.apiOrigin()}/api/public/inquiries`, allowed: await this.limits.allows("website_form", c) };
  }

  /** A new key: the old one stops working at once (paste the new snippet). */
  @Post("website-form/new-key")
  @HttpCode(200)
  @RequirePermissions("settings.manage")
  async newFormKey(@CurrentUser() user: SessionUser) {
    const c = CompanyContext.require();
    if (!(await this.mayChange(user))) throw new ForbiddenError("Only a Super Admin can change the website form's key.");
    await this.prisma.platform.company.update({ where: { id: c.id }, data: { formKey: randomBytes(24).toString("hex") } });
    await this.prisma.tx((tx) =>
      this.audit.record(tx, {
        userId: user.id,
        action: "update",
        entityType: "settings",
        summary: "Made a new key for the website form (the old one stopped working)",
      }),
    );
    return this.websiteForm(user);
  }

  /** Where the API is reached from outside: the company's own address (or the one shared address). */
  private apiOrigin() {
    return companyOrigin(CompanyContext.require().slug, this.env.BASE_DOMAIN, this.env.APP_URL);
  }

  @AllowDuringTwoStepSetup()
  @Get()
  async get() {
    const c = CompanyContext.require();
    const [row, summary] = await Promise.all([
      this.prisma.platform.company.findUniqueOrThrow({ where: { id: c.id } }),
      this.limits.summary(c),
    ]);
    const today = todayIn(this.env.APP_TIME_ZONE);
    const renewsOn = fromDbDateOrNull(row.renewsOn);
    const notices: { tone: "info" | "warn" | "danger"; text: string }[] = [];
    const what = c.kind === "demo" ? "demo" : "trial";
    if (c.status === "off")
      notices.push({ tone: "danger", text: `${c.name} is switched off${c.statusReason ? ` (${c.statusReason.toLowerCase()})` : ""}.` });
    else if (c.status === "read_only")
      notices.push({
        tone: "danger",
        text: `${c.name} is read-only${c.statusReason ? ` (${c.statusReason.toLowerCase()})` : ""}: you can look, but not change anything. Contact us to carry on.`,
      });
    else if (c.kind !== "client" && row.endsAt) {
      const ends = new Intl.DateTimeFormat("en-GB", { timeZone: this.env.APP_TIME_ZONE, dateStyle: "medium", timeStyle: "short" }).format(
        row.endsAt,
      );
      notices.push({
        tone: row.endsAt.getTime() - Date.now() < 86_400_000 ? "warn" : "info",
        text: `This is a ${what}: it ends on ${ends}. Contact us to keep using RFQ Desk.`,
      });
    } else if (c.kind === "client" && renewsOn && today > renewsOn) {
      notices.push({
        tone: "warn",
        text: `Payment is overdue (paid until ${renewsOn}). ${c.name} becomes read-only on ${addDays(renewsOn, LIFECYCLE.overdueGraceDays + 1)}.`,
      });
    }
    for (const w of summary.warnings) notices.push({ tone: "warn", text: w });
    return {
      slug: c.slug,
      name: c.name,
      kind: c.kind,
      status: c.status,
      statusReason: c.statusReason,
      endsAt: row.endsAt,
      renewsOn,
      plan: summary.plan,
      features: summary.features,
      usage: summary.usage,
      notices,
    };
  }
}

@Module({ controllers: [CompanyController] })
export class CompanyModule {}
