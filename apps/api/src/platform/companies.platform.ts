import { Inject, Injectable, Logger } from "@nestjs/common";
import type { z } from "zod";
import { fromDbDateOrNull, seedCompanyBase, seedDemoData, toDbDate, toDbDateOrNull, type Prisma } from "@kebo/database";
import {
  billingState,
  LIFECYCLE,
  suggestSlug,
  slugProblem,
  type CompanyCreateInput,
  type companyStatusInput,
  type companyUpdateInput,
  type makeRealInput,
  type subscriptionPaymentInput,
} from "@kebo/shared";
import { addDays, ConflictError, DomainError, NotFoundError, todayIn, type ISODate } from "@kebo/utils";
import { ENV, type Env } from "../config/env";
import { PrismaService } from "../database/prisma.service";
import { CompaniesService, toInfo } from "../common/company/companies.service";
import { LimitsService } from "../common/company/limits.service";
import { AccountsService } from "./accounts.service";
import { CompanyDataService } from "./company-data";
import { PlatformMail } from "./platform-mail";
import { LifecycleService } from "./lifecycle.service";
import type { PlatformAdminUser } from "./platform-auth";

type Actor = Pick<PlatformAdminUser, "id" | "name"> | null;
const DAY = 86_400_000;

/**
 * The companies, as the platform admin runs them: make one (a client or a demo)
 * with its tenant admin, change it, switch it off or on, extend or end a demo,
 * turn a demo into a real company, record payments, export and delete.
 * Everything is written to the platform log.
 */
@Injectable()
export class PlatformCompaniesService {
  private readonly logger = new Logger("Companies");

  constructor(
    private readonly prisma: PrismaService,
    private readonly companies: CompaniesService,
    private readonly limits: LimitsService,
    private readonly accounts: AccountsService,
    private readonly data: CompanyDataService,
    private readonly mail: PlatformMail,
    private readonly lifecycle: LifecycleService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private get db() {
    return this.prisma.platform;
  }

  today(): ISODate {
    return todayIn(this.env.APP_TIME_ZONE);
  }

  log(actor: Actor, action: string, summary: string, extra: { companyId?: string | null; leadId?: string | null; details?: unknown } = {}) {
    return this.db.platformLog.create({
      data: { adminId: actor?.id ?? null, adminName: actor?.name ?? null, action, summary, companyId: extra.companyId ?? null, leadId: extra.leadId ?? null, details: (extra.details ?? undefined) as Prisma.InputJsonValue | undefined },
    });
  }

  /* ---------------------------------------------------------------- short names */

  /** Why this short name cannot be taken now (rules, in use, held after a rename or delete), or null. */
  async slugTaken(slug: string, exceptCompanyId?: string): Promise<string | null> {
    const rule = slugProblem(slug);
    if (rule) return rule;
    const now = new Date();
    const clash = await this.db.company.findFirst({
      where: {
        id: exceptCompanyId ? { not: exceptCompanyId } : undefined,
        OR: [
          { slug, status: { not: "deleted" } },
          { slug, status: "deleted", deletedAt: { gt: new Date(now.getTime() - LIFECYCLE.nameHoldDays * DAY) } },
          { previousSlug: slug, previousSlugUntil: { gt: now } },
        ],
      },
      select: { id: true },
    });
    return clash ? `"${slug}" is taken. Choose another.` : null;
  }

  /** A free short name close to this one. */
  async freeSlug(wanted: string): Promise<string> {
    const base = slugProblem(wanted) ? suggestSlug(wanted) : wanted;
    if (!(await this.slugTaken(base))) return base;
    for (let n = 2; n < 500; n++) {
      const s = `${base.slice(0, 26)}-${n}`;
      if (!(await this.slugTaken(s))) return s;
    }
    throw new ConflictError("Could not find a free short name. Type one.");
  }

  /* ---------------------------------------------------------------- reading */

  async list(filter: { kind?: string; status?: string; q?: string }) {
    const today = this.today();
    const rows = await this.db.company.findMany({
      where: {
        status: filter.status === "deleted" ? "deleted" : filter.status ? (filter.status as never) : { not: "deleted" },
        kind: filter.kind ? (filter.kind as never) : undefined,
        OR: filter.q ? [{ name: { contains: filter.q, mode: "insensitive" } }, { slug: { contains: filter.q.toLowerCase() } }, { contactEmail: { contains: filter.q, mode: "insensitive" } }] : undefined,
      },
      include: { plan: { select: { id: true, name: true, maxUsers: true, maxStorageMb: true } } },
      orderBy: [{ createdAt: "desc" }],
    });
    const usage = await this.data.usageAll();
    return rows.map((c) => ({
      ...this.view(c, today),
      usage: usage.get(c.id) ?? { users: 0, inquiries: 0, storageMb: 0 },
    }));
  }

  private view(c: Prisma.CompanyGetPayload<{ include: { plan: { select: { id: true; name: true; maxUsers: true; maxStorageMb: true } } } }>, today: ISODate) {
    const renewsOn = fromDbDateOrNull(c.renewsOn);
    return {
      id: c.id,
      slug: c.slug,
      name: c.name,
      kind: c.kind,
      status: c.status,
      statusReason: c.statusReason,
      statusManual: c.statusManual,
      plan: c.plan,
      startsOn: fromDbDateOrNull(c.startsOn),
      renewsOn,
      endsAt: c.endsAt,
      billing: billingState({ kind: c.kind, status: c.status, renewsOn }, today),
      contactName: c.contactName,
      contactEmail: c.contactEmail,
      notes: c.notes,
      lastActiveAt: c.lastActiveAt,
      createdAt: c.createdAt,
      deletedAt: c.deletedAt,
      previousSlug: c.previousSlugUntil && c.previousSlugUntil > new Date() ? c.previousSlug : null,
    };
  }

  async get(id: string) {
    const c = await this.db.company.findUnique({ where: { id }, include: { plan: { select: { id: true, name: true, maxUsers: true, maxStorageMb: true } } } });
    if (!c) throw new NotFoundError("Company");
    const live = c.status !== "deleted";
    const [summary, activity, payments, log, leads] = await Promise.all([
      live ? this.limits.summary(toInfo(c)) : null,
      live ? this.data.activity(c.id) : null,
      this.db.subscriptionPayment.findMany({ where: { companyId: id }, orderBy: { paidOn: "desc" } }),
      this.db.platformLog.findMany({ where: { companyId: id }, orderBy: { at: "desc" }, take: 50 }),
      this.db.lead.findMany({ where: { companyId: id }, select: { id: true, name: true, companyName: true, status: true } }),
    ]);
    return {
      ...this.view(c, this.today()),
      usage: summary?.usage ?? null,
      warnings: summary?.warnings ?? [],
      activity,
      payments: payments.map((p) => ({ id: p.id, amountMinor: p.amountMinor, currency: p.currency, paidOn: fromDbDateOrNull(p.paidOn), paidUntil: fromDbDateOrNull(p.paidUntil), note: p.note, createdAt: p.createdAt })),
      log,
      leads,
    };
  }

  /* ---------------------------------------------------------------- making one */

  /**
   * A new company with its tenant admin (who gets a link to set a password).
   * Demos run for a few days, optionally filled with sample data.
   */
  async create(actor: Actor, input: Omit<CompanyCreateInput, "kind"> & { kind: "client" | "demo" | "trial"; passwordHash?: string }) {
    const taken = await this.slugTaken(input.slug);
    if (taken) throw new ConflictError(taken);
    if (input.planId && !(await this.db.plan.findUnique({ where: { id: input.planId } }))) throw new NotFoundError("Plan");
    const days = input.kind === "demo" ? (input.days ?? LIFECYCLE.demoDays) : input.kind === "trial" ? (input.days ?? LIFECYCLE.trialDays) : null;
    const company = await this.db.company.create({
      data: {
        slug: input.slug,
        name: input.name,
        kind: input.kind,
        planId: input.planId,
        startsOn: toDbDate(this.today()),
        endsAt: days ? new Date(Date.now() + days * DAY) : null,
        renewsOn: input.kind === "client" ? toDbDateOrNull(input.renewsOn) : null,
        contactName: input.adminName,
        contactEmail: input.adminEmail,
        notes: input.notes,
      },
    });
    let adminId: string;
    try {
      const db = this.prisma.company(company.id);
      const hash = input.passwordHash ?? "!";
      const people = await seedCompanyBase(db, { admin: { email: input.adminEmail, name: input.adminName, role: "admin", passwordHash: hash }, companyName: input.name });
      adminId = people.admin.id;
      if (input.sampleData) await seedDemoData(db, people, { timeZone: this.env.APP_TIME_ZONE, samplePasswordHash: "!" });
    } catch (e) {
      // Nothing half-made is left behind.
      this.logger.error(`making ${input.slug} failed: ${(e as Error).stack ?? e}`);
      await this.data.clear(company.id, true).catch(() => undefined);
      await this.db.company.delete({ where: { id: company.id } }).catch(() => undefined);
      throw new DomainError("The company could not be made. Nothing was kept; try again.");
    }
    const what = input.kind === "demo" ? "demo" : input.kind === "trial" ? "trial" : "company";
    await this.log(actor, "create", `Made the ${what} ${company.name} (${company.slug}) for ${input.adminName} <${input.adminEmail}>${days ? `, ${days} days` : ""}`, {
      companyId: company.id,
      leadId: input.leadId,
    });
    if (input.leadId) {
      await this.db.lead.update({ where: { id: input.leadId }, data: { companyId: company.id, status: input.kind === "client" ? "client" : "demo" } }).catch(() => undefined);
    }
    // The tenant admin: a link to set a password (not needed when they chose one at sign-up).
    const link = input.passwordHash ? null : await this.accounts.setPasswordLink(company.id, adminId);
    const emailed = link
      ? await this.mail.send({
          to: input.adminEmail,
          subject: input.kind === "demo" ? `Your RFQ Desk demo is ready` : `Your RFQ Desk account for ${company.name}`,
          heading: input.kind === "demo" ? `Your demo of RFQ Desk is ready` : `Welcome to RFQ Desk`,
          rows: [
            ["Company", company.name],
            ["Your email", input.adminEmail],
            ["Your role", "Tenant admin (Super Admin)"],
            ...(company.endsAt ? ([["Demo ends", company.endsAt.toUTCString()]] as [string, string][]) : []),
          ],
          body:
            input.kind === "demo"
              ? `Set your password with the button below, then sign in at ${this.mail.url("/login")}. The demo ${input.sampleData ? "has sample customers, factories and inquiries to try things with" : "starts empty"}.`
              : `Set your password with the button below (the link works for 7 days), then sign in at ${this.mail.url("/login")}. You can add your team in Settings → People.`,
          link,
          linkLabel: "Set my password",
        })
      : false;
    this.companies.forget(company.id);
    return { id: company.id, slug: company.slug, link, emailed };
  }

  /* ---------------------------------------------------------------- changing one */

  private async one(id: string) {
    const c = await this.db.company.findUnique({ where: { id } });
    if (!c || c.status === "deleted") throw new NotFoundError("Company");
    return c;
  }

  async update(actor: Actor, id: string, input: z.infer<typeof companyUpdateInput>) {
    const c = await this.one(id);
    const data: Prisma.CompanyUpdateInput = {};
    const said: string[] = [];
    if (input.name !== undefined && input.name !== c.name) {
      data.name = input.name;
      said.push(`name to ${input.name}`);
    }
    if (input.slug !== undefined && input.slug !== c.slug) {
      const taken = await this.slugTaken(input.slug, id);
      if (taken) throw new ConflictError(taken);
      Object.assign(data, { slug: input.slug, previousSlug: c.slug, previousSlugUntil: new Date(Date.now() + LIFECYCLE.renameRedirectDays * DAY) });
      said.push(`short name from ${c.slug} to ${input.slug} (the old one works for ${LIFECYCLE.renameRedirectDays} days)`);
    }
    if (input.planId !== undefined && input.planId !== c.planId) {
      const plan = input.planId ? await this.db.plan.findUnique({ where: { id: input.planId } }) : null;
      if (input.planId && !plan) throw new NotFoundError("Plan");
      data.plan = input.planId ? { connect: { id: input.planId } } : { disconnect: true };
      said.push(`plan to ${plan?.name ?? "none (no limits)"}`);
    }
    if (input.renewsOn !== undefined) {
      data.renewsOn = toDbDateOrNull(input.renewsOn);
      said.push(`paid until ${input.renewsOn ?? "(none)"}`);
    }
    if (input.contactName !== undefined) data.contactName = input.contactName;
    if (input.contactEmail !== undefined) data.contactEmail = input.contactEmail;
    if (input.notes !== undefined) data.notes = input.notes;
    await this.db.company.update({ where: { id }, data });
    if (said.length) await this.log(actor, "update", `Changed ${c.name}: ${said.join("; ")}`, { companyId: id });
    this.companies.forget(id);
    if (input.renewsOn !== undefined) await this.applyRules(id);
    return this.get(id);
  }

  /** Switch on, read-only or off by hand (the automatic rules then leave it alone), or back to automatic. */
  async setStatus(actor: Actor, id: string, input: z.infer<typeof companyStatusInput>) {
    const c = await this.one(id);
    if (input.status === "auto") {
      await this.db.company.update({ where: { id }, data: { statusManual: false, status: "active", statusReason: null } });
      await this.log(actor, "status", `${c.name}: back to the automatic rules`, { companyId: id });
      this.companies.forget(id);
      await this.applyRules(id);
      return this.get(id);
    }
    const reason = input.reason ?? (input.status === "off" ? "Switched off by the platform admin" : input.status === "read_only" ? "Made read-only by the platform admin" : null);
    await this.db.company.update({ where: { id }, data: { status: input.status, statusManual: true, statusReason: reason } });
    await this.log(actor, "status", `${c.name}: ${input.status === "active" ? "switched on" : input.status === "off" ? "switched off" : "made read-only"}${input.reason ? ` (${input.reason})` : ""}`, { companyId: id });
    this.companies.forget(id);
    return this.get(id);
  }

  /** A demo or trial: more days (from its end, or from now when it already ended). */
  async extend(actor: Actor, id: string, days: number) {
    const c = await this.one(id);
    if (c.kind === "client") throw new DomainError("Only demos and trials have an end.");
    const from = Math.max(c.endsAt?.getTime() ?? 0, Date.now());
    const endsAt = new Date(from + days * DAY);
    await this.db.company.update({ where: { id }, data: { endsAt, endingNoticeFor: null, status: c.statusManual ? c.status : "active", statusReason: c.statusManual ? c.statusReason : null } });
    await this.log(actor, "extend", `${c.name}: ${days} more days, now ends ${endsAt.toUTCString()}`, { companyId: id });
    this.companies.forget(id);
    return this.get(id);
  }

  /** A demo or trial ends now (read-only, then off and deleted by the rules). */
  async end(actor: Actor, id: string) {
    const c = await this.one(id);
    if (c.kind === "client") throw new DomainError("Only demos and trials end. Switch a client off instead.");
    await this.db.company.update({ where: { id }, data: { endsAt: new Date(), statusManual: false } });
    await this.log(actor, "end", `${c.name}: ended now`, { companyId: id });
    this.companies.forget(id);
    await this.applyRules(id);
    return this.get(id);
  }

  /** A demo or trial becomes a client: keeps its data or starts clean (people, roles and settings stay). */
  async makeReal(actor: Actor, id: string, input: z.infer<typeof makeRealInput>) {
    const c = await this.one(id);
    if (c.kind === "client") throw new DomainError("It is already a client.");
    if (input.planId && !(await this.db.plan.findUnique({ where: { id: input.planId } }))) throw new NotFoundError("Plan");
    if (!input.keepData) await this.data.clear(id, false);
    await this.db.company.update({
      where: { id },
      data: {
        kind: "client",
        endsAt: null,
        endingNoticeFor: null,
        status: "active",
        statusManual: false,
        statusReason: null,
        planId: input.planId ?? c.planId,
        renewsOn: toDbDateOrNull(input.renewsOn),
        // A demo's "-demo" name stays until renamed.
      },
    });
    await this.db.lead.updateMany({ where: { companyId: id }, data: { status: "client" } });
    await this.log(actor, "make_real", `${c.name} became a client${input.keepData ? " (data kept)" : " (sample data cleared)"}`, { companyId: id });
    this.companies.forget(id);
    return this.get(id);
  }

  /** Delete a company: all its data and files. Its row stays (deleted) and holds the short name for a while. */
  async remove(actor: Actor, id: string, reason?: string) {
    const c = await this.one(id);
    const { files } = await this.data.clear(id, true);
    await this.db.company.update({ where: { id }, data: { status: "deleted", statusManual: false, statusReason: reason ?? "Deleted", deletedAt: new Date() } });
    await this.log(actor, "delete", `Deleted ${c.name} (${c.slug}): all its data and ${files} file(s)${reason ? ` — ${reason}` : ""}`, { companyId: id });
    this.companies.forget(id);
    return { ok: true };
  }

  /** A new set-password link for the tenant admin (emailed, and shown to the platform admin). */
  async resetAdminPassword(actor: Actor, id: string, userId?: string) {
    const c = await this.one(id);
    const admins = await this.accounts.tenantAdmins(id);
    const who = userId ? admins.find((a) => a.id === userId) : admins[0];
    if (!who) throw new DomainError(userId ? "That person is not one of the company's tenant admins." : "This company has no tenant admin.");
    // A new link only: the current password keeps working until the new one is set.
    const link = await this.accounts.setPasswordLink(id, who.id);
    const emailed = await this.mail.send({
      to: who.email,
      subject: `Set a new password for RFQ Desk`,
      heading: "Set a new password",
      rows: [["Company", c.name], ["Your email", who.email]],
      body: "The platform admin sent you a link to set a new password. It works once, for 7 days.",
      link,
      linkLabel: "Set a new password",
    });
    await this.log(actor, "password_link", `Sent ${who.email} (${c.name}) a link to set a new password`, { companyId: id });
    return { link, emailed, email: who.email };
  }

  /** A payment from the company (recorded by hand): it is paid until the given date. */
  async recordPayment(actor: Actor, id: string, input: z.infer<typeof subscriptionPaymentInput>) {
    const c = await this.one(id);
    await this.db.subscriptionPayment.create({
      data: { companyId: id, amountMinor: Math.round(input.amount * 100), currency: input.currency, paidOn: toDbDate(input.paidOn), paidUntil: toDbDate(input.paidUntil), note: input.note, recordedBy: actor?.id ?? null },
    });
    await this.db.company.update({ where: { id }, data: { renewsOn: toDbDate(input.paidUntil) } });
    await this.log(actor, "payment", `${c.name} paid ${input.currency} ${input.amount.toFixed(2)} on ${input.paidOn}; paid until ${input.paidUntil}`, { companyId: id });
    this.companies.forget(id);
    await this.applyRules(id);
    return this.get(id);
  }

  async removePayment(actor: Actor, companyId: string, paymentId: string) {
    const p = await this.db.subscriptionPayment.findFirst({ where: { id: paymentId, companyId } });
    if (!p) throw new NotFoundError("Payment");
    await this.db.subscriptionPayment.delete({ where: { id: p.id } });
    await this.log(actor, "payment_removed", `Removed a payment of ${p.currency} ${(p.amountMinor / 100).toFixed(2)} (paid ${fromDbDateOrNull(p.paidOn)})`, { companyId });
    return this.get(companyId);
  }

  /** Apply the automatic rules to one company now (after a change that affects them). */
  private applyRules(id: string) {
    return this.lifecycle.applyOne(id);
  }

  /** The overview: what needs attention. */
  async overview() {
    const today = this.today();
    const soon = new Date(Date.now() + 2 * DAY);
    const [byStatus, newLeads, followUps, ending, overdue, recent] = await Promise.all([
      this.db.company.groupBy({ by: ["kind", "status"], _count: true, where: { status: { not: "deleted" } } }),
      this.db.lead.count({ where: { status: "new" } }),
      this.db.lead.findMany({ where: { followUpOn: { lte: toDbDate(today) }, status: { in: ["new", "contacted", "demo"] } }, orderBy: { followUpOn: "asc" }, take: 20 }),
      this.db.company.findMany({ where: { kind: { in: ["demo", "trial"] }, status: { not: "deleted" }, endsAt: { lte: soon, gt: new Date(Date.now() - LIFECYCLE.readOnlyDays * DAY) } }, orderBy: { endsAt: "asc" } }),
      this.db.company.findMany({ where: { kind: "client", status: { not: "deleted" }, renewsOn: { lt: toDbDate(addDays(today, 7)) } }, orderBy: { renewsOn: "asc" } }),
      this.db.platformLog.findMany({ orderBy: { at: "desc" }, take: 15 }),
    ]);
    return {
      counts: byStatus.map((r) => ({ kind: r.kind, status: r.status, count: r._count })),
      newLeads,
      followUps: followUps.map((l) => ({ id: l.id, name: l.name, companyName: l.companyName, status: l.status, followUpOn: fromDbDateOrNull(l.followUpOn) })),
      ending: ending.map((c) => ({ id: c.id, name: c.name, slug: c.slug, kind: c.kind, status: c.status, endsAt: c.endsAt })),
      renewals: overdue.map((c) => ({ id: c.id, name: c.name, slug: c.slug, status: c.status, renewsOn: fromDbDateOrNull(c.renewsOn) })),
      recent,
    };
  }
}
