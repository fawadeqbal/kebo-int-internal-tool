import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { z } from "zod";
import {
  companyCreateInput,
  companyStatusInput,
  companyUpdateInput,
  demoRequestInput,
  extendInput,
  leadInput,
  leadNoteInput,
  leadUpdateInput,
  makeRealInput,
  newPasswordField,
  planInput,
  setPasswordInput,
  signUpInput,
  slugField,
  subscriptionPaymentInput,
  type CompanyCreateInput,
  type DemoRequestInput,
  type PlanInput,
  type SignUpInput,
} from "@kebo/shared";
import { DomainError } from "@kebo/utils";
import { Validate } from "../common/http/zod.pipe";
import { Public } from "../common/auth/decorators";
import { PrismaService } from "../database/prisma.service";
import { AccountsService } from "./accounts.service";
import { PlatformCompaniesService } from "./companies.platform";
import { CompanyDataService } from "./company-data";
import { LeadsService } from "./leads.service";
import { PlansService } from "./plans.service";
import { CurrentAdmin, PlatformAuthService, PlatformRoute, PlatformSetupAllowed, platformToken, type PlatformAdminUser } from "./platform-auth";

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
const deleteInput = z.object({ confirm: z.string().trim().min(1, "Type the company's short name to confirm"), reason: z.string().trim().max(200).nullish() });
const tokenInput = z.object({ token: z.string().min(10).max(2000) });

/** Public pages of the platform: request a demo, sign up, confirm, set a password from a link. */
@ApiTags("platform")
@Controller("platform/public")
export class PlatformPublicController {
  constructor(
    private readonly leads: LeadsService,
    private readonly platform: PlatformCompaniesService,
    private readonly accounts: AccountsService,
  ) {}

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
  ) {}

  @PlatformRoute()
  @Get("overview")
  overview() {
    return this.companies.overview();
  }

  @PlatformRoute()
  @Get("log")
  log(@Query("companyId") companyId?: string, @Query("leadId") leadId?: string) {
    return this.prisma.platform.platformLog.findMany({
      where: { companyId: companyId || undefined, leadId: leadId || undefined },
      orderBy: { at: "desc" },
      take: 200,
    });
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

  @PlatformRoute()
  @Patch("companies/:id")
  update(@CurrentAdmin() admin: PlatformAdminUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(companyUpdateInput)) body: z.infer<typeof companyUpdateInput>) {
    return this.companies.update(admin, id, body);
  }

  @PlatformRoute()
  @Post("companies/:id/status")
  @HttpCode(200)
  status(@CurrentAdmin() admin: PlatformAdminUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(companyStatusInput)) body: z.infer<typeof companyStatusInput>) {
    return this.companies.setStatus(admin, id, body);
  }

  @PlatformRoute()
  @Post("companies/:id/extend")
  @HttpCode(200)
  extend(@CurrentAdmin() admin: PlatformAdminUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(extendInput)) body: { days: number }) {
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
  makeReal(@CurrentAdmin() admin: PlatformAdminUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(makeRealInput)) body: z.infer<typeof makeRealInput>) {
    return this.companies.makeReal(admin, id, body);
  }

  @PlatformRoute()
  @Delete("companies/:id")
  async remove(@CurrentAdmin() admin: PlatformAdminUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(deleteInput)) body: z.infer<typeof deleteInput>) {
    const c = await this.companies.get(id);
    if (body.confirm.trim().toLowerCase() !== c.slug) throw new DomainError(`Type ${c.slug} to confirm.`);
    return this.companies.remove(admin, id, body.reason ?? undefined);
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
  adminPassword(@CurrentAdmin() admin: PlatformAdminUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(z.object({ userId: z.uuid().nullish() }))) body: { userId?: string | null }) {
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
  pay(@CurrentAdmin() admin: PlatformAdminUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(subscriptionPaymentInput)) body: z.infer<typeof subscriptionPaymentInput>) {
    return this.companies.recordPayment(admin, id, body);
  }

  @PlatformRoute()
  @Delete("companies/:id/payments/:paymentId")
  unpay(@CurrentAdmin() admin: PlatformAdminUser, @Param("id", ParseUUIDPipe) id: string, @Param("paymentId", ParseUUIDPipe) paymentId: string) {
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
  updateLead(@CurrentAdmin() admin: PlatformAdminUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(leadUpdateInput)) body: z.infer<typeof leadUpdateInput>) {
    return this.leads.update(admin, id, body);
  }

  @PlatformRoute()
  @Post("leads/:id/notes")
  note(@CurrentAdmin() admin: PlatformAdminUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(leadNoteInput)) body: { text: string }) {
    return this.leads.addNote(admin, id, body.text);
  }

  @PlatformRoute()
  @Post("leads/:id/demo")
  giveDemo(@CurrentAdmin() admin: PlatformAdminUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(giveDemoInput)) body: z.infer<typeof giveDemoInput>) {
    return this.leads.giveDemo(admin, id, body);
  }

  @PlatformRoute()
  @Delete("leads/:id")
  removeLead(@CurrentAdmin() admin: PlatformAdminUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.leads.remove(admin, id);
  }
}
