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
  PLAN_FEATURE_KEYS,
  planFeatureName,
  companyOrigin,
  companyLogKind,
  COMPANY_LOG_KINDS,
  type CompanyLogKind,
} from "@kebo/shared";
import { addDays, ConflictError, daysBetween, DomainError, NotFoundError, todayIn, type ISODate } from "@kebo/utils";
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
 * When each module now off was switched off, and by whom, from the company's log (newest first): the
 * oldest entry of the latest unbroken run of entries in which it is off. Entries since this change say
 * which modules they switched (details.modules); older ones list every module off in their summary.
 */
export function modulesOffSince(
  off: readonly string[],
  log: { at: Date; adminName: string | null; summary: string; details: unknown }[],
): { feature: string; at: Date | null; by: string | null }[] {
  const offIn = (e: (typeof log)[number]): string[] | null => {
    const d = (e.details as { modules?: { now?: string[] } } | null)?.modules;
    if (d?.now) return d.now;
    if (/every module of the plan switched on/.test(e.summary)) return [];
    const m = e.summary.match(/modules switched off: ([^;]*)/);
    if (!m) return null;
    const list = `, ${m[1]!.trim()}, `;
    return PLAN_FEATURE_KEYS.filter((f) => list.includes(`, ${planFeatureName(f).toLowerCase()}, `));
  };
  return off.map((feature) => {
    let since: (typeof log)[number] | null = null;
    for (const e of log) {
      const now = offIn(e);
      if (now === null) continue;
      if (!now.includes(feature)) break;
      since = e;
    }
    return { feature, at: since?.at ?? null, by: since?.adminName ?? null };
  });
}

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
      data: {
        adminId: actor?.id ?? null,
        adminName: actor?.name ?? null,
        action,
        summary,
        companyId: extra.companyId ?? null,
        leadId: extra.leadId ?? null,
        details: (extra.details ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }

  /* ---------------------------------------------------------------- short names */

  /** Why this short name cannot be taken now (rules, in use, held after a rename or delete), or null. */
  slugTaken(slug: string, exceptCompanyId?: string): Promise<string | null> {
    return this.companies.slugTaken(slug, exceptCompanyId);
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
        OR: filter.q
          ? [
              { name: { contains: filter.q, mode: "insensitive" } },
              { slug: { contains: filter.q.toLowerCase() } },
              { contactEmail: { contains: filter.q, mode: "insensitive" } },
            ]
          : undefined,
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

  private view(
    c: Prisma.CompanyGetPayload<{ include: { plan: { select: { id: true; name: true; maxUsers: true; maxStorageMb: true } } } }>,
    today: ISODate,
  ) {
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
      contactPhone: c.contactPhone,
      notes: c.notes,
      lastActiveAt: c.lastActiveAt,
      createdAt: c.createdAt,
      deletedAt: c.deletedAt,
      previousSlug: c.previousSlugUntil && c.previousSlugUntil > new Date() ? c.previousSlug : null,
    };
  }

  async get(id: string) {
    const c = await this.db.company.findUnique({
      where: { id },
      include: {
        plan: {
          select: { id: true, name: true, maxUsers: true, maxStorageMb: true, features: true, priceMinor: true, currency: true, period: true },
        },
      },
    });
    if (!c) throw new NotFoundError("Company");
    const live = c.status !== "deleted";
    const [summary, activity, profile, payments, log, logCount, moduleLog, leads] = await Promise.all([
      live ? this.limits.summary(toInfo(c)) : null,
      live ? this.data.activity(c.id) : null,
      live ? this.data.profile(c.id) : null,
      this.db.subscriptionPayment.findMany({ where: { companyId: id }, orderBy: { paidOn: "desc" } }),
      this.db.platformLog.findMany({ where: { companyId: id }, orderBy: { at: "desc" }, take: 50 }),
      this.db.platformLog.count({ where: { companyId: id } }),
      c.featuresOff.length
        ? this.db.platformLog.findMany({
            where: { companyId: id, action: "update", summary: { contains: "module" } },
            orderBy: { at: "desc" },
            take: 200,
            select: { at: true, adminName: true, summary: true, details: true },
          })
        : [],
      this.db.lead.findMany({ where: { companyId: id }, select: { id: true, name: true, companyName: true, status: true } }),
    ]);
    return {
      ...this.view(c, this.today()),
      usage: summary?.usage ?? null,
      warnings: summary?.warnings ?? [],
      /** Where its people sign in. */
      address: companyOrigin(c.slug, this.env.BASE_DOMAIN, this.env.APP_URL),
      /** The company's own details (its Settings → Company), read-only here. */
      profile,
      /** Modules: what the plan includes (null: no plan, every one) and what is switched off for this company. */
      planFeatures: c.plan ? c.plan.features : null,
      featuresOff: c.featuresOff,
      /** When and by whom each module now off was switched off (from the platform log). */
      modulesOff: modulesOffSince(c.featuresOff, moduleLog),
      activity,
      logCount,
      payments: payments.map((p) => ({
        id: p.id,
        amountMinor: p.amountMinor,
        currency: p.currency,
        paidOn: fromDbDateOrNull(p.paidOn),
        paidUntil: fromDbDateOrNull(p.paidUntil),
        note: p.note,
        createdAt: p.createdAt,
      })),
      log,
      leads,
    };
  }

  /** The company's whole history (the platform log), newest first, optionally of one kind; with the count of each kind. */
  async history(id: string, kind?: string) {
    if (!(await this.db.company.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundError("Company");
    const byAction = await this.db.platformLog.groupBy({ by: ["action"], where: { companyId: id }, _count: true });
    const counts: Record<string, number> = { all: 0 };
    for (const r of byAction) {
      const k = companyLogKind(r.action);
      counts[k] = (counts[k] ?? 0) + r._count;
      counts.all! += r._count;
    }
    const known = kind && kind in COMPANY_LOG_KINDS ? (kind as CompanyLogKind) : null;
    const other = kind === "other";
    const all = Object.values(COMPANY_LOG_KINDS).flatMap((k) => [...k.actions]);
    const rows = await this.db.platformLog.findMany({
      where: {
        companyId: id,
        action: known ? { in: [...COMPANY_LOG_KINDS[known].actions] } : other ? { notIn: all } : undefined,
      },
      orderBy: { at: "desc" },
      take: 5000,
      select: { id: true, adminName: true, action: true, companyId: true, leadId: true, summary: true, at: true },
    });
    return { kind: known ?? (other ? "other" : null), counts, rows };
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
    const days =
      input.kind === "demo" ? (input.days ?? LIFECYCLE.demoDays) : input.kind === "trial" ? (input.days ?? LIFECYCLE.trialDays) : null;
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
      const people = await seedCompanyBase(db, {
        admin: { email: input.adminEmail, name: input.adminName, role: "admin", passwordHash: hash },
        companyName: input.name,
      });
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
    await this.log(
      actor,
      "create",
      `Made the ${what} ${company.name} (${company.slug}) for ${input.adminName} <${input.adminEmail}>${days ? `, ${days} days` : ""}`,
      {
        companyId: company.id,
        leadId: input.leadId,
      },
    );
    if (input.leadId) {
      await this.db.lead
        .update({ where: { id: input.leadId }, data: { companyId: company.id, status: input.kind === "client" ? "client" : "demo" } })
        .catch(() => undefined);
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
            ...(company.endsAt ? ([["Demo ends", this.mail.when(company.endsAt)]] as [string, string][]) : []),
          ],
          body:
            input.kind === "demo"
              ? `Set your password with the button below, then sign in at ${this.mail.companyUrl(company.slug, "/login")}. The demo ${input.sampleData ? "has sample customers, factories and inquiries to try things with" : "starts empty"}.`
              : `Set your password with the button below (the link works for 7 days), then sign in at ${this.mail.companyUrl(company.slug, "/login")}. You can add your team in Settings → People.`,
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
    let modules: { off: string[]; on: string[]; now: string[] } | null = null;
    if (input.name !== undefined && input.name !== c.name) {
      data.name = input.name;
      said.push(`name to ${input.name}`);
    }
    if (input.slug !== undefined && input.slug !== c.slug) {
      const taken = await this.slugTaken(input.slug, id);
      if (taken) throw new ConflictError(taken);
      await this.companies.rename(id, c.slug, input.slug);
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
    if (input.contactPhone !== undefined) data.contactPhone = input.contactPhone;
    if (input.notes !== undefined) data.notes = input.notes;
    if (input.featuresOff !== undefined) {
      const before = c.featuresOff ?? [];
      const off = [...new Set(input.featuresOff)];
      const changed = off.length !== before.length || off.some((f) => !before.includes(f));
      if (changed) {
        data.featuresOff = off;
        modules = { off: off.filter((f) => !before.includes(f)), on: before.filter((f) => !(off as string[]).includes(f)), now: off };
        said.push(off.length ? `modules switched off: ${off.map((f) => planFeatureName(f).toLowerCase()).join(", ")}` : "every module of the plan switched on");
      }
    }
    await this.db.company.update({ where: { id }, data });
    if (said.length) await this.log(actor, "update", `Changed ${c.name}: ${said.join("; ")}`, { companyId: id, details: modules ? { modules } : undefined });
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
    const reason =
      input.reason ??
      (input.status === "off"
        ? "Switched off by the platform admin"
        : input.status === "read_only"
          ? "Made read-only by the platform admin"
          : null);
    await this.db.company.update({ where: { id }, data: { status: input.status, statusManual: true, statusReason: reason } });
    await this.log(
      actor,
      "status",
      `${c.name}: ${input.status === "active" ? "switched on" : input.status === "off" ? "switched off" : "made read-only"}${input.reason ? ` (${input.reason})` : ""}`,
      { companyId: id },
    );
    this.companies.forget(id);
    return this.get(id);
  }

  /** A demo or trial: more days (from its end, or from now when it already ended). */
  async extend(actor: Actor, id: string, days: number) {
    const c = await this.one(id);
    if (c.kind === "client") throw new DomainError("Only demos and trials have an end.");
    const from = Math.max(c.endsAt?.getTime() ?? 0, Date.now());
    const endsAt = new Date(from + days * DAY);
    await this.db.company.update({
      where: { id },
      data: {
        endsAt,
        endingNoticeFor: null,
        status: c.statusManual ? c.status : "active",
        statusReason: c.statusManual ? c.statusReason : null,
      },
    });
    await this.log(actor, "extend", `${c.name}: ${days} more days, now ends ${this.mail.when(endsAt)}`, { companyId: id });
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
    await this.log(actor, "make_real", `${c.name} became a client${input.keepData ? " (data kept)" : " (sample data cleared)"}`, {
      companyId: id,
    });
    this.companies.forget(id);
    return this.get(id);
  }

  /** Delete a company: all its data and files (a copy is kept in storage first). Its row stays (deleted) and holds the short name for a while. */
  async remove(actor: Actor, id: string, reason?: string) {
    const c = await this.one(id);
    const archive = await this.data.archive(id, c.slug);
    const { files } = await this.data.clear(id, true);
    await this.db.company.update({
      where: { id },
      data: { status: "deleted", statusManual: false, statusReason: reason ?? "Deleted", deletedAt: new Date() },
    });
    await this.log(
      actor,
      "delete",
      `Deleted ${c.name} (${c.slug}): all its data and ${files} file(s)${reason ? ` — ${reason}` : ""} (a copy is kept at ${archive})`,
      {
        companyId: id,
      },
    );
    this.companies.forget(id);
    return { ok: true };
  }

  /** A new set-password link for the tenant admin (emailed, and shown to the platform admin). */
  async resetAdminPassword(actor: Actor, id: string, userId?: string) {
    const c = await this.one(id);
    const admins = await this.accounts.tenantAdmins(id);
    const who = userId ? admins.find((a) => a.id === userId) : admins[0];
    if (!who)
      throw new DomainError(userId ? "That person is not one of the company's tenant admins." : "This company has no tenant admin.");
    // A new link only: the current password keeps working until the new one is set.
    const link = await this.accounts.setPasswordLink(id, who.id);
    const emailed = await this.mail.send({
      to: who.email,
      subject: `Set a new password for RFQ Desk`,
      heading: "Set a new password",
      rows: [
        ["Company", c.name],
        ["Your email", who.email],
      ],
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
    // A demo or trial that pays becomes a client first (Make it real), so the rules never delete a paying company.
    if (c.kind !== "client") throw new DomainError(`Make the ${c.kind} a real company first, then record its payments.`);
    await this.db.subscriptionPayment.create({
      data: {
        companyId: id,
        amountMinor: Math.round(input.amount * 100),
        currency: input.currency,
        paidOn: toDbDate(input.paidOn),
        paidUntil: toDbDate(input.paidUntil),
        note: input.note,
        recordedBy: actor?.id ?? null,
      },
    });
    await this.db.company.update({ where: { id }, data: { renewsOn: toDbDate(input.paidUntil) } });
    await this.log(
      actor,
      "payment",
      `${c.name} paid ${input.currency} ${input.amount.toFixed(2)} on ${input.paidOn}; paid until ${input.paidUntil}`,
      { companyId: id },
    );
    this.companies.forget(id);
    await this.applyRules(id);
    return this.get(id);
  }

  async removePayment(actor: Actor, companyId: string, paymentId: string) {
    const p = await this.db.subscriptionPayment.findFirst({ where: { id: paymentId, companyId } });
    if (!p) throw new NotFoundError("Payment");
    await this.db.subscriptionPayment.delete({ where: { id: p.id } });
    await this.log(
      actor,
      "payment_removed",
      `Removed a payment of ${p.currency} ${(p.amountMinor / 100).toFixed(2)} (paid ${fromDbDateOrNull(p.paidOn)})`,
      { companyId },
    );
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
      this.db.lead.findMany({
        where: { followUpOn: { lte: toDbDate(today) }, status: { in: ["new", "contacted", "demo"] } },
        orderBy: { followUpOn: "asc" },
        take: 20,
      }),
      this.db.company.findMany({
        where: {
          kind: { in: ["demo", "trial"] },
          status: { not: "deleted" },
          endsAt: { lte: soon, gt: new Date(Date.now() - LIFECYCLE.readOnlyDays * DAY) },
        },
        orderBy: { endsAt: "asc" },
      }),
      this.db.company.findMany({
        where: { kind: "client", status: { not: "deleted" }, renewsOn: { lt: toDbDate(addDays(today, 7)) } },
        orderBy: { renewsOn: "asc" },
      }),
      this.db.platformLog.findMany({ orderBy: { at: "desc" }, take: 15 }),
    ]);
    return {
      counts: byStatus.map((r) => ({ kind: r.kind, status: r.status, count: r._count })),
      newLeads,
      followUps: followUps.map((l) => ({
        id: l.id,
        name: l.name,
        companyName: l.companyName,
        status: l.status,
        followUpOn: fromDbDateOrNull(l.followUpOn),
      })),
      ending: ending.map((c) => ({ id: c.id, name: c.name, slug: c.slug, kind: c.kind, status: c.status, endsAt: c.endsAt })),
      renewals: overdue.map((c) => ({ id: c.id, name: c.name, slug: c.slug, status: c.status, renewsOn: fromDbDateOrNull(c.renewsOn) })),
      recent,
      dashboard: await this.dashboard(today),
    };
  }

  /**
   * The overview's figures (design system: dashboard frame): paying companies,
   * income this month against last month, renewals in the next 30 days and
   * what they bring, demos and trials (and how many end this week), new client
   * inquiries; the server's warnings of the last day; and one list of the
   * companies to look at — overdue, demos and trials ending within a week,
   * renewals within 30 days.
   */
  private async dashboard(today: ISODate) {
    const month = today.slice(0, 7);
    const monthStart = `${month}-01` as ISODate;
    const lastStart = (() => {
      const [y, m] = month.split("-").map(Number) as [number, number];
      return `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}-01` as ISODate;
    })();
    const in30 = addDays(today, 30);
    const week = new Date(Date.now() + 7 * DAY);
    const monday = (() => {
      const d = new Date(`${today}T00:00:00Z`);
      return addDays(today, -((d.getUTCDay() + 6) % 7));
    })();
    const [clients, payments, trials, newLeads, leadsThisWeek, warnings, demoRequests] = await Promise.all([
      this.db.company.findMany({
        where: { kind: "client", status: { notIn: ["deleted", "off"] } },
        include: { plan: { select: { name: true, priceMinor: true, currency: true, period: true } } },
      }),
      this.db.subscriptionPayment.findMany({ where: { paidOn: { gte: toDbDate(lastStart) } }, select: { amountMinor: true, currency: true, paidOn: true } }),
      this.db.company.findMany({
        where: { kind: { in: ["demo", "trial"] }, status: { notIn: ["deleted", "off"] } },
        include: { plan: { select: { name: true } } },
        orderBy: { endsAt: "asc" },
      }),
      this.db.lead.count({ where: { status: "new" } }),
      this.db.lead.count({ where: { createdAt: { gte: new Date(`${monday}T00:00:00Z`) } } }),
      this.db.platformLog.findMany({
        where: { action: "server_warning", at: { gte: new Date(Date.now() - 26 * 3_600_000) } },
        orderBy: { at: "desc" },
        select: { id: true, summary: true, details: true, at: true },
      }),
      this.db.lead.count({ where: { status: "new", source: "form" } }),
    ]);
    const sum = (from: ISODate, to: ISODate | null) => {
      const by = new Map<string, number>();
      for (const p of payments) {
        const d = fromDbDateOrNull(p.paidOn)!;
        if (d >= from && (!to || d < to)) by.set(p.currency, (by.get(p.currency) ?? 0) + p.amountMinor);
      }
      return [...by].map(([currency, amountMinor]) => ({ currency, amountMinor }));
    };
    const usage = await this.data.usageAll();
    const row = (c: (typeof clients)[number] | (typeof trials)[number], kind: "overdue" | "ending" | "renews", date: string | null) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      status: c.status,
      plan: c.plan?.name ?? null,
      date,
      people: usage.get(c.id)?.users ?? 0,
      reason: kind,
    });
    const overdue = clients.filter((c) => c.renewsOn && fromDbDateOrNull(c.renewsOn)! < today);
    const renewing = clients.filter((c) => c.renewsOn && fromDbDateOrNull(c.renewsOn)! >= today && fromDbDateOrNull(c.renewsOn)! <= in30);
    const ending = trials.filter((c) => c.endsAt && c.endsAt <= week);
    const due = new Map<string, number>();
    for (const c of renewing) if (c.plan?.priceMinor) due.set(c.plan.currency, (due.get(c.plan.currency) ?? 0) + c.plan.priceMinor);
    return {
      paying: clients.length,
      payingNewThisMonth: clients.filter((c) => c.createdAt >= new Date(`${monthStart}T00:00:00Z`)).length,
      incomeThisMonth: sum(monthStart, null),
      incomeLastMonth: sum(lastStart, monthStart),
      renewals: renewing.length,
      renewalsDue: [...due].map(([currency, amountMinor]) => ({ currency, amountMinor })),
      trials: trials.length,
      trialsEndingThisWeek: ending.length,
      newLeads,
      newLeadsDemoRequests: demoRequests,
      leadsThisWeek,
      serverWarnings: warnings.map((w) => ({ id: w.id, title: w.summary.replace(/^Server: /, ""), detail: (w.details as { detail?: string } | null)?.detail ?? null, at: w.at })),
      watch: [
        ...overdue.map((c) => row(c, "overdue", fromDbDateOrNull(c.renewsOn))),
        ...ending.map((c) => row(c, "ending", c.endsAt?.toISOString() ?? null)),
        ...renewing.sort((a, b) => a.renewsOn!.getTime() - b.renewsOn!.getTime()).map((c) => row(c, "renews", fromDbDateOrNull(c.renewsOn))),
      ],
      overdue: overdue.map((c) => ({ id: c.id, name: c.name, days: daysBetween(fromDbDateOrNull(c.renewsOn)!, today) })),
      ending: ending.map((c) => ({ id: c.id, name: c.name, endsAt: c.endsAt })),
    };
  }

  /**
   * How the platform is set up (Platform settings): what comes from the
   * server's settings (read-only here), the platform admins, and the
   * server's warnings (backups, disk) of the last week.
   */
  async settings(signUpOpen: boolean) {
    const [admins, warnings] = await Promise.all([
      this.db.platformAdmin.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true, email: true, isActive: true, totpEnabledAt: true, lastLoginAt: true, createdAt: true },
      }),
      this.db.platformLog.findMany({ where: { action: "server_warning", at: { gte: new Date(Date.now() - 7 * DAY) } }, orderBy: { at: "desc" }, take: 20 }),
    ]);
    return {
      signUpOpen,
      emailOn: !!process.env.SMTP_HOST,
      platformEmail: this.env.PLATFORM_EMAIL ? this.env.PLATFORM_EMAIL.split(",").map((e) => e.trim()).filter(Boolean) : null,
      botCheck: !!process.env.TURNSTILE_SECRET_KEY,
      inquiriesPerHour: Number(process.env.PUBLIC_INQUIRIES_PER_HOUR) || 40,
      baseDomain: this.env.BASE_DOMAIN || null,
      appUrl: this.env.APP_URL,
      timeZone: this.env.APP_TIME_ZONE,
      admins: admins.map((a) => ({ id: a.id, name: a.name, email: a.email, active: a.isActive, twoStepOn: !!a.totpEnabledAt, lastLoginAt: a.lastLoginAt, createdAt: a.createdAt })),
      serverWarnings: warnings.map((w) => ({ id: w.id, title: w.summary.replace(/^Server: /, ""), detail: (w.details as { detail?: string } | null)?.detail ?? null, at: w.at })),
    };
  }
}
