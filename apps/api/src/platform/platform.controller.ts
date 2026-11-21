import { createHash } from "node:crypto";
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { z } from "zod";
import {
  addressOf,
  CONNECT_SUB,
  companyCreateInput,
  companyStatusInput,
  companyUpdateInput,
  demoRequestInput,
  extendInput,
  findCompanyInput,
  leadInput,
  leadNoteInput,
  leadUpdateInput,
  makeRealInput,
  newPasswordField,
  planInput,
  setPasswordInput,
  signUpInput,
  siteContactInput,
  siteContent,
  siteVisitInput,
  slugField,
  subscriptionPaymentInput,
  type CompanyCreateInput,
  type DemoRequestInput,
  type PlanInput,
  type SignUpInput,
  type SiteContactInput,
  type SiteContent,
  PLATFORM_LOG_KINDS,
  platformLogKind,
  type PlatformLogKind,
  mailSettingsInput,
  mailTestInput,
  platformInboxInput,
  type MailSettingsInput,
  type MailTestInput,
  type PlatformInboxInput,
} from "@kebo/shared";
import { PlatformMail } from "./platform-mail";
import { DomainError, NotFoundError } from "@kebo/utils";
import { ENV, type Env } from "../config/env";
import { CompaniesService } from "../common/company/companies.service";
import { CompanyContext } from "../common/company/company-context";
import { SettingsService } from "../modules/settings/settings.service";
import { OwnDomainService } from "../common/company/own-domain.service";
import { Validate } from "../common/http/zod.pipe";
import { Public } from "../common/auth/decorators";
import { PrismaService } from "../database/prisma.service";
import { AccountsService } from "./accounts.service";
import { PlatformCompaniesService } from "./companies.platform";
import { CompanyDataService } from "./company-data";
import { LeadsService } from "./leads.service";
import { PlansService } from "./plans.service";
import { SiteService } from "./site.service";
import { RateLimiter } from "../common/http/rate-limit";
import {
  CurrentAdmin,
  PlatformAuthService,
  PlatformRoute,
  PlatformSetupAllowed,
  platformToken,
  type PlatformAdminUser,
} from "./platform-auth";

const clientIp = (req: Request) => req.ip || req.socket.remoteAddress || "local";
const loginInput = z.object({ email: z.string().trim().min(1, "Enter your email"), password: z.string().min(1, "Enter your password") });
const codeInput = z.object({ code: z.string().trim().min(6, "Enter the code").max(20) });
const passwordInput = z.object({ current: z.string().min(1, "Enter your current password"), next: newPasswordField });
const giveDemoInput = z.object({
  days: z.coerce.number().int().min(1).max(60).nullish(),
  sampleData: z.boolean().default(true),
  slug: slugField.nullish(),
  planId: z.uuid().nullish(),
});
const deleteInput = z.object({
  confirm: z.string().trim().min(1, "Type the company's short name to confirm"),
  reason: z.string().trim().max(200).nullish(),
});
const tokenInput = z.object({ token: z.string().min(10).max(2000) });
/** Page views counted per address and minute (POST /platform/public/visit). */
const VISITS_PER_MINUTE = Number(process.env.SITE_VISITS_PER_MINUTE) || 30;
/** Domain checks on connect.<BASE_DOMAIN> per address and minute (each is a few DNS look-ups). */
const CONNECT_CHECKS_PER_MINUTE = 12;
const ownDomainInput = z.object({ domain: z.string().trim().min(1, "Type the domain").max(260) });

/** Public pages of the platform: request a demo, sign up, confirm, set a password from a link. */
@ApiTags("platform")
@Controller("platform/public")
export class PlatformPublicController {
  private readonly visits = new RateLimiter();

  constructor(
    private readonly leads: LeadsService,
    private readonly platform: PlatformCompaniesService,
    private readonly accounts: AccountsService,
    private readonly companies: CompaniesService,
    private readonly site: SiteService,
    private readonly domains: OwnDomainService,
    private readonly settings: SettingsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /* ---------------------------------------------------------------- the marketing site */

  /** The marketing page: its published words and the plans it shows. */
  @Public()
  @Get("site")
  siteContent() {
    return this.site.published();
  }

  /** A page view, from the web app's server (counted without cookies). */
  @Public()
  @Post("visit")
  @HttpCode(200)
  visit(@Body(Validate(siteVisitInput)) body: z.infer<typeof siteVisitInput>, @Req() req: Request) {
    const ip = clientIp(req);
    // The web server sends a view per page load; more than this from one address is not people reading.
    this.visits.check(`visit:${ip}`, VISITS_PER_MINUTE, 60_000, "Too many requests. Please try again a little later.");
    return this.site.visit({ ip, userAgent: body.userAgent, origin: body.origin });
  }

  /** "Questions?" on the marketing page. */
  @Public()
  @Post("contact")
  @HttpCode(200)
  contact(@Body(Validate(siteContactInput)) body: SiteContactInput, @Req() req: Request) {
    return this.leads.contact(body, clientIp(req));
  }

  /** "Sign in" on the marketing page: emails the addresses of the companies this email belongs to. */
  @Public()
  @Post("find-company")
  @HttpCode(200)
  findCompany(@Body(Validate(findCompanyInput)) body: { email: string }, @Req() req: Request) {
    return this.leads.findCompany(body.email, clientIp(req));
  }

  @Public()
  @Post("demo-request")
  @HttpCode(200)
  demoRequest(@Body(Validate(demoRequestInput)) body: DemoRequestInput, @Req() req: Request) {
    return this.leads.request(body, clientIp(req));
  }

  @Public()
  @Get("sign-up")
  signUpState() {
    return { open: this.leads.signUpOpen };
  }

  @Public()
  @Post("sign-up")
  @HttpCode(200)
  signUp(@Body(Validate(signUpInput)) body: SignUpInput, @Req() req: Request) {
    return this.leads.startSignUp(body, clientIp(req));
  }

  @Public()
  @Post("sign-up/confirm")
  @HttpCode(200)
  confirm(@Body(Validate(tokenInput)) body: { token: string }) {
    return this.leads.confirmSignUp(body.token);
  }

  /** Is this short name free? (sign-up form) */
  @Public()
  @Get("slug")
  async slug(@Query("slug") slug = "", @Query("name") name = "") {
    const s = (slug || "").trim().toLowerCase();
    if (!s && name) return { suggestion: await this.platform.freeSlug(name) };
    const problem = await this.platform.slugTaken(s);
    return { slug: s, free: !problem, problem, suggestion: problem ? await this.platform.freeSlug(s || name || "company") : null };
  }

  /**
   * Caddy asks before getting a certificate for a host (on-demand TLS): only the
   * platform's own addresses and real companies' get one. 200 yes, 404 no.
   */
  @Public()
  @Get("domain-check")
  async domainCheck(@Query("domain") domain = "", @Res({ passthrough: true }) res: Response) {
    const base = this.env.BASE_DOMAIN;
    const a = base ? addressOf(domain, base) : { kind: "other" as const };
    const ok =
      a.kind === "root" ||
      a.kind === "admin" ||
      a.kind === "marketing" ||
      // connect.<BASE_DOMAIN>: where companies' own domains point, with a page that explains it (and checks one).
      (a.kind === "company" && a.slug === CONNECT_SUB && this.domains.enabled) ||
      (a.kind === "company" && !!(await this.companies.bySlug(a.slug))) ||
      // A company's own domain (not one of ours).
      (a.kind === "other" && (await this.domains.isOwnDomain(domain)));
    res.status(ok ? 200 : 404);
    return { ok };
  }

  /**
   * The company at an address: only what the web app needs before showing its
   * pages. Its current short name (a renamed company's old address sends people
   * on), and its name for the sign-in page while it is switched on. Never its
   * status, plan or anything else.
   */
  @Public()
  @Get("company")
  async company(@Query("slug") slug = "") {
    const c = await this.companies.bySlug(slug);
    if (!c) throw new NotFoundError("Company");
    // Its own domain, only while one is connected: its address under ours then sends people on to it.
    return { exists: true, slug: c.slug, name: c.status === "active" ? c.name : null, ...(this.domains.enabled && c.domain ? { domain: c.domain } : {}) };
  }

  /**
   * The company's own look for the pages before sign-in (white label): its name, its colour set and whether it
   * has a logo (with a version, so the picture can be kept until it changes). Only while it is switched on; the
   * same things anyone sees on its sign-in page, nothing else.
   */
  @Public()
  @Get("company-look")
  async companyLook(@Query("slug") slug = "") {
    const c = await this.activeCompany(slug);
    const s = (await CompanyContext.run(c, () => this.settings.get())).company;
    return {
      name: s.name || c.name,
      colours: s.colours,
      logo: s.logo ? createHash("sha256").update(s.logo).digest("hex").slice(0, 12) : null,
    };
  }

  /** The company's logo for its sign-in page (a data: URL, as stored), or null. Only while it is switched on. */
  @Public()
  @Get("company-logo")
  async companyLogo(@Query("slug") slug = "") {
    const c = await this.activeCompany(slug);
    return { logo: (await CompanyContext.run(c, () => this.settings.get())).company.logo || null };
  }

  private async activeCompany(slug: string) {
    const c = await this.companies.bySlug(slug);
    // Switched on (or read-only: its people can still sign in to look); never one that is off or deleted.
    if (!c || (c.status !== "active" && c.status !== "read_only")) throw new NotFoundError("Company");
    return c;
  }

  /**
   * connect.<BASE_DOMAIN>'s check: a domain someone is connecting, looked up step by step, with what is
   * wrong. Any domain may be checked; nothing is said about which company it belongs to.
   */
  @Public()
  @Get("connect-check")
  connectCheck(@Query("domain") domain = "", @Req() req: Request) {
    this.visits.check(`connect-check:${clientIp(req)}`, CONNECT_CHECKS_PER_MINUTE, 60_000, "Too many checks. Please try again in a minute.");
    return this.domains.diagnoseTyped(domain);
  }

  /** The company whose own domain an address is (connected ones only): its short name, for the web app. 404: none. */
  @Public()
  @Get("company-at")
  async companyAt(@Query("host") host = "") {
    const c = await this.domains.companyAt(host);
    if (!c) throw new NotFoundError("Company");
    return { slug: c.slug };
  }

  @Public()
  @Get("set-password")
  linkInfo(@Query("token") token = "") {
    return this.accounts.linkInfo(token);
  }

  @Public()
  @Post("set-password")
  @HttpCode(200)
  setPassword(@Body(Validate(setPasswordInput)) body: z.infer<typeof setPasswordInput>) {
    return this.accounts.setPassword(body.token, body.password);
  }
}

@ApiTags("platform")
@Controller("platform/auth")
export class PlatformAuthController {
  constructor(private readonly auth: PlatformAuthService) {}

  @Public()
  @Post("login")
  @HttpCode(200)
  login(@Body(Validate(loginInput)) body: z.infer<typeof loginInput>, @Req() req: Request) {
    return this.auth.login(body.email, body.password, { ip: clientIp(req), userAgent: req.headers["user-agent"] });
  }

  @Public()
  @Post("two-step")
  @HttpCode(200)
  twoStep(@Body(Validate(codeInput)) body: { code: string }, @Req() req: Request) {
    return this.auth.completeTwoStep(platformToken(req.headers), body.code, clientIp(req));
  }

  @Public()
  @Post("set-password")
  @HttpCode(200)
  setPassword(@Body(Validate(setPasswordInput)) body: z.infer<typeof setPasswordInput>) {
    return this.auth.setPassword(body.token, body.password);
  }

  @PlatformRoute()
  @PlatformSetupAllowed()
  @Get("me")
  me(@CurrentAdmin() admin: PlatformAdminUser) {
    return { id: admin.id, name: admin.name, email: admin.email, twoStepOn: admin.twoStepOn };
  }

  @PlatformRoute()
  @PlatformSetupAllowed()
  @Post("logout")
  @HttpCode(200)
  async logout(@CurrentAdmin() admin: PlatformAdminUser) {
    await this.auth.logout(admin);
    return { ok: true };
  }

  @PlatformRoute()
  @PlatformSetupAllowed()
  @Post("two-step/start")
  @HttpCode(200)
  start(@CurrentAdmin() admin: PlatformAdminUser) {
    return this.auth.startTwoStep(admin);
  }

  @PlatformRoute()
  @PlatformSetupAllowed()
  @Post("two-step/confirm")
  @HttpCode(200)
  confirm(@CurrentAdmin() admin: PlatformAdminUser, @Body(Validate(codeInput)) body: { code: string }) {
    return this.auth.confirmTwoStep(admin, body.code);
  }

  @PlatformRoute()
  @Post("password")
  @HttpCode(200)
  async password(@CurrentAdmin() admin: PlatformAdminUser, @Body(Validate(passwordInput)) body: z.infer<typeof passwordInput>) {
    await this.auth.changePassword(admin, body.current, body.next);
    return { ok: true };
  }
}

@ApiTags("platform")
@Controller("platform")
export class PlatformController {
  constructor(
    private readonly companies: PlatformCompaniesService,
    private readonly data: CompanyDataService,
    private readonly accounts: AccountsService,
    private readonly leads: LeadsService,
    private readonly plans: PlansService,
    private readonly prisma: PrismaService,
    private readonly site: SiteService,
    private readonly domains: OwnDomainService,
    private readonly mail: PlatformMail,
  ) {}

  /* ---------------------------------------------------------------- the marketing site */

  @PlatformRoute()
  @Get("site")
  siteEditor() {
    return this.site.editor();
  }

  @PlatformRoute()
  @Put("site")
  saveSite(@CurrentAdmin() admin: PlatformAdminUser, @Body(Validate(z.object({ draft: siteContent }))) body: { draft: SiteContent }) {
    return this.site.saveDraft(admin, body.draft);
  }

  @PlatformRoute()
  @Post("site/publish")
  @HttpCode(200)
  publishSite(@CurrentAdmin() admin: PlatformAdminUser) {
    return this.site.publish(admin);
  }

  @PlatformRoute()
  @Post("site/discard")
  @HttpCode(200)
  discardSite(@CurrentAdmin() admin: PlatformAdminUser) {
    return this.site.discard(admin);
  }

  @PlatformRoute()
  @Get("site/numbers")
  siteNumbers(@Query("month") month?: string) {
    return this.site.numbers(month);
  }

  @PlatformRoute()
  @Get("overview")
  overview() {
    return this.companies.overview();
  }

  /** The numbers beside the platform's menu: companies (not deleted), new client inquiries, plans. */
  @PlatformRoute()
  @Get("counts")
  async counts() {
    const db = this.prisma.platform;
    const [companies, newLeads, plans] = await Promise.all([
      db.company.count({ where: { status: { not: "deleted" } } }),
      db.lead.count({ where: { status: "new" } }),
      db.plan.count(),
    ]);
    return { companies, newLeads, plans };
  }

  /** Platform settings › Emails: the platform's own sending email (secret never sent back) and where its emails go. */
  @PlatformRoute()
  @Get("mail")
  mailView() {
    return this.mail.view();
  }

  @PlatformRoute()
  @Put("mail")
  saveMail(@CurrentAdmin() admin: PlatformAdminUser, @Body(Validate(mailSettingsInput)) body: MailSettingsInput) {
    return this.mail.saveAccount(admin, body);
  }

  /** Back to the server's own email. */
  @PlatformRoute()
  @Delete("mail")
  @HttpCode(200)
  removeMail(@CurrentAdmin() admin: PlatformAdminUser) {
    return this.mail.removeAccount(admin);
  }

  @PlatformRoute()
  @Post("mail/test")
  @HttpCode(200)
  testMail(@Body(Validate(mailTestInput)) body: MailTestInput) {
    return this.mail.test(body.to);
  }

  /** { emails: [] }: where the platform's emails go; empty, back to PLATFORM_EMAIL, else every platform admin. */
  @PlatformRoute()
  @Put("mail/inbox")
  saveInbox(@CurrentAdmin() admin: PlatformAdminUser, @Body(Validate(platformInboxInput)) body: PlatformInboxInput) {
    return this.mail.saveInbox(admin, body.emails);
  }

  /** How the platform is set up (Platform settings): the server's settings (read-only), the platform admins, the server's warnings. */
  @PlatformRoute()
  @Get("settings")
  async settings() {
    // Email is on when the platform's own email (Platform settings › Emails) or the server's is set.
    return { ...(await this.companies.settings(this.leads.signUpOpen)), emailOn: this.mail.enabled };
  }

  /**
   * The platform log (its list page): newest first, 25 a page (?page=), searched (?q= in what and who)
   * and filtered by kind (?kind=companies|inquiries|plans|admins|server|other), with the count of each kind;
   * or one company's or lead's entries (?companyId=, ?leadId=).
   */
  @PlatformRoute()
  @Get("log")
  async log(
    @Query("companyId") companyId?: string,
    @Query("leadId") leadId?: string,
    @Query("q") q?: string,
    @Query("kind") kind?: string,
    @Query("page") page?: string,
  ) {
    const db = this.prisma.platform.platformLog;
    const text = q?.trim().slice(0, 100);
    const base = {
      companyId: companyId || undefined,
      leadId: leadId || undefined,
      ...(text
        ? {
            OR: [
              { summary: { contains: text, mode: "insensitive" as const } },
              { adminName: { contains: text, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };
    const all = Object.values(PLATFORM_LOG_KINDS).flatMap((k) => [...k.actions]);
    const known = kind && kind in PLATFORM_LOG_KINDS ? (kind as PlatformLogKind) : null;
    const where = {
      ...base,
      ...(known ? { action: { in: [...PLATFORM_LOG_KINDS[known].actions] } } : kind === "other" ? { action: { notIn: all } } : {}),
    };
    const size = 25;
    const p = Math.max(1, Math.min(10_000, Number(page) || 1));
    const [rows, total, byAction] = await Promise.all([
      db.findMany({ where, orderBy: { at: "desc" }, take: size, skip: (p - 1) * size }),
      db.count({ where }),
      db.groupBy({ by: ["action"], where: base, _count: true }),
    ]);
    const counts: Record<string, number> = { all: 0 };
    for (const r of byAction) {
      const k = platformLogKind(r.action);
      counts[k] = (counts[k] ?? 0) + r._count;
      counts.all! += r._count;
    }
    return { rows, total, page: p, pageSize: size, kind: known ?? (kind === "other" ? "other" : null), counts };
  }

  /* ---------------------------------------------------------------- companies */

  @PlatformRoute()
  @Get("companies")
  list(@Query("kind") kind?: string, @Query("status") status?: string, @Query("q") q?: string) {
    return this.companies.list({ kind: kind || undefined, status: status || undefined, q: q || undefined });
  }

  @PlatformRoute()
  @Post("companies")
  create(@CurrentAdmin() admin: PlatformAdminUser, @Body(Validate(companyCreateInput)) body: CompanyCreateInput) {
    return this.companies.create(admin, body);
  }

  @PlatformRoute()
  @Get("companies/:id")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.companies.get(id);
  }

  /** The company's whole history, newest first (?kind=payments|changes|status|access|other), with counts per kind. */
  @PlatformRoute()
  @Get("companies/:id/history")
  history(@Param("id", ParseUUIDPipe) id: string, @Query("kind") kind?: string) {
    return this.companies.history(id, kind || undefined);
  }

  @PlatformRoute()
  @Patch("companies/:id")
  update(
    @CurrentAdmin() admin: PlatformAdminUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(Validate(companyUpdateInput)) body: z.infer<typeof companyUpdateInput>,
  ) {
    return this.companies.update(admin, id, body);
  }

  @PlatformRoute()
  @Post("companies/:id/status")
  @HttpCode(200)
  status(
    @CurrentAdmin() admin: PlatformAdminUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(Validate(companyStatusInput)) body: z.infer<typeof companyStatusInput>,
  ) {
    return this.companies.setStatus(admin, id, body);
  }

  @PlatformRoute()
  @Post("companies/:id/extend")
  @HttpCode(200)
  extend(
    @CurrentAdmin() admin: PlatformAdminUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(Validate(extendInput)) body: { days: number },
  ) {
    return this.companies.extend(admin, id, body.days);
  }

  @PlatformRoute()
  @Post("companies/:id/end")
  @HttpCode(200)
  end(@CurrentAdmin() admin: PlatformAdminUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.companies.end(admin, id);
  }

  @PlatformRoute()
  @Post("companies/:id/make-real")
  @HttpCode(200)
  makeReal(
    @CurrentAdmin() admin: PlatformAdminUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(Validate(makeRealInput)) body: z.infer<typeof makeRealInput>,
  ) {
    return this.companies.makeReal(admin, id, body);
  }

  @PlatformRoute()
  @Delete("companies/:id")
  async remove(
    @CurrentAdmin() admin: PlatformAdminUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(Validate(deleteInput)) body: z.infer<typeof deleteInput>,
  ) {
    const c = await this.companies.get(id);
    if (body.confirm.trim().toLowerCase() !== c.slug) throw new DomainError(`Type ${c.slug} to confirm.`);
    return this.companies.remove(admin, id, body.reason ?? undefined);
  }

  /* ---------------------------------------------------------------- a company's web address (claude/own-domains-admin-design.md) */

  /** Its address under ours and its own domain, with a full look-up of the domain (company page › Details). */
  @PlatformRoute()
  @Get("companies/:id/domain")
  async domain(@Param("id", ParseUUIDPipe) id: string) {
    await this.companies.get(id);
    const [view, diagnosis] = await Promise.all([this.domains.get(id, true), this.domains.diagnose(id)]);
    return { enabled: this.domains.enabled, ...view, diagnosis };
  }

  /** Looks the domain up now and keeps what was found ("Check now"). */
  @PlatformRoute()
  @Post("companies/:id/domain/check")
  @HttpCode(200)
  async checkDomain(@Param("id", ParseUUIDPipe) id: string) {
    await this.companies.get(id);
    await this.domains.check(id);
    return this.domain(id);
  }

  /** Connects a domain for the company (asked for by the client): kept, and looked up at once. */
  @PlatformRoute()
  @Put("companies/:id/domain")
  async connectDomain(@CurrentAdmin() admin: PlatformAdminUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(ownDomainInput)) body: { domain: string }) {
    const c = await this.companies.get(id);
    const row = await this.domains.connect(id, body.domain);
    await this.companies.log(admin, "update", `Connected ${c.name}'s own domain ${row.ownDomain}${row.ownDomainStatus === "connected" ? "" : " (waiting for its record)"}`, { companyId: id });
    return this.domain(id);
  }

  /** Removes it: the company is at its address under ours only. */
  @PlatformRoute()
  @Delete("companies/:id/domain")
  async removeDomain(@CurrentAdmin() admin: PlatformAdminUser, @Param("id", ParseUUIDPipe) id: string) {
    const c = await this.companies.get(id);
    const before = await this.domains.get(id, true);
    if (before.domain) {
      await this.domains.remove(id);
      await this.companies.log(admin, "update", `Removed ${c.name}'s own domain ${before.domain}; its people are at ${before.ours}`, { companyId: id });
    }
    return this.domain(id);
  }

  @PlatformRoute()
  @Get("companies/:id/export")
  async export(@CurrentAdmin() admin: PlatformAdminUser, @Param("id", ParseUUIDPipe) id: string, @Res() res: Response) {
    const c = await this.companies.get(id);
    if (c.status === "deleted") throw new DomainError("A deleted company has nothing left to export.");
    await this.companies.log(admin, "export", `Exported ${c.name}`, { companyId: id });
    await this.data.export(id, c.slug, res);
  }

  @PlatformRoute()
  @Post("companies/:id/admin-password")
  @HttpCode(200)
  adminPassword(
    @CurrentAdmin() admin: PlatformAdminUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(Validate(z.object({ userId: z.uuid().nullish() }))) body: { userId?: string | null },
  ) {
    return this.companies.resetAdminPassword(admin, id, body.userId ?? undefined);
  }

  /** Work inside the company (logged there and here). The web app turns the token into a session. */
  @PlatformRoute()
  @Post("companies/:id/open")
  @HttpCode(200)
  open(@CurrentAdmin() admin: PlatformAdminUser, @Param("id", ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.accounts.open(admin, id, { ip: clientIp(req), userAgent: req.headers["user-agent"] });
  }

  @PlatformRoute()
  @Post("companies/:id/payments")
  pay(
    @CurrentAdmin() admin: PlatformAdminUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(Validate(subscriptionPaymentInput)) body: z.infer<typeof subscriptionPaymentInput>,
  ) {
    return this.companies.recordPayment(admin, id, body);
  }

  @PlatformRoute()
  @Delete("companies/:id/payments/:paymentId")
  unpay(
    @CurrentAdmin() admin: PlatformAdminUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("paymentId", ParseUUIDPipe) paymentId: string,
  ) {
    return this.companies.removePayment(admin, id, paymentId);
  }

  /* ---------------------------------------------------------------- plans */

  @PlatformRoute()
  @Get("plans")
  listPlans() {
    return this.plans.list();
  }

  @PlatformRoute()
  @Post("plans")
  createPlan(@CurrentAdmin() admin: PlatformAdminUser, @Body(Validate(planInput)) body: PlanInput) {
    return this.plans.create(admin, body);
  }

  @PlatformRoute()
  @Put("plans/:id")
  updatePlan(@CurrentAdmin() admin: PlatformAdminUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(planInput)) body: PlanInput) {
    return this.plans.update(admin, id, body);
  }

  @PlatformRoute()
  @Delete("plans/:id")
  removePlan(@CurrentAdmin() admin: PlatformAdminUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.plans.remove(admin, id);
  }

  /* ---------------------------------------------------------------- leads */

  @PlatformRoute()
  @Get("leads")
  listLeads(@Query("status") status?: string, @Query("q") q?: string) {
    return this.leads.list({ status: status || undefined, q: q || undefined });
  }

  @PlatformRoute()
  @Post("leads")
  createLead(@CurrentAdmin() admin: PlatformAdminUser, @Body(Validate(leadInput)) body: z.infer<typeof leadInput>) {
    return this.leads.create(admin, body);
  }

  @PlatformRoute()
  @Get("leads/:id")
  getLead(@Param("id", ParseUUIDPipe) id: string) {
    return this.leads.get(id);
  }

  @PlatformRoute()
  @Patch("leads/:id")
  updateLead(
    @CurrentAdmin() admin: PlatformAdminUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(Validate(leadUpdateInput)) body: z.infer<typeof leadUpdateInput>,
  ) {
    return this.leads.update(admin, id, body);
  }

  @PlatformRoute()
  @Post("leads/:id/notes")
  note(
    @CurrentAdmin() admin: PlatformAdminUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(Validate(leadNoteInput)) body: { text: string },
  ) {
    return this.leads.addNote(admin, id, body.text);
  }

  @PlatformRoute()
  @Post("leads/:id/demo")
  giveDemo(
    @CurrentAdmin() admin: PlatformAdminUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(Validate(giveDemoInput)) body: z.infer<typeof giveDemoInput>,
  ) {
    return this.leads.giveDemo(admin, id, body);
  }

  @PlatformRoute()
  @Delete("leads/:id")
  removeLead(@CurrentAdmin() admin: PlatformAdminUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.leads.remove(admin, id);
  }
}
