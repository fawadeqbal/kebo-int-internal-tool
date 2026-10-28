import { HttpException, HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { z } from "zod";
import { fromDbDateOrNull, toDbDateOrNull, type Prisma } from "@kebo/database";
import { LIFECYCLE, suggestSlug, type DemoRequestInput, type leadInput, type leadUpdateInput, type SignUpInput } from "@kebo/shared";
import { ConflictError, DomainError, NotFoundError } from "@kebo/utils";
import { ENV, type Env } from "../config/env";
import { PrismaService } from "../database/prisma.service";
import { PlatformCompaniesService } from "./companies.platform";
import { PlatformMail } from "./platform-mail";
import type { PlatformAdminUser } from "./platform-auth";

type Actor = Pick<PlatformAdminUser, "id" | "name"> | null;

/**
 * Client inquiries (leads): people who asked for a demo, signed up for a
 * trial, or were added by hand; their status from new to client or lost; and
 * the self sign-up that makes a trial company once the email is confirmed.
 */
@Injectable()
export class LeadsService {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private readonly logger = new Logger("Leads");

  constructor(
    private readonly prisma: PrismaService,
    private readonly companies: PlatformCompaniesService,
    private readonly mail: PlatformMail,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private get db() {
    return this.prisma.platform;
  }

  /** Per visitor and for everyone: public forms cannot be flooded. */
  limit(key: string, max: number, windowMs: number) {
    const now = Date.now();
    if (this.hits.size > 20_000) this.hits.clear();
    const h = this.hits.get(key);
    if (!h || h.resetAt < now) return void this.hits.set(key, { count: 1, resetAt: now + windowMs });
    if (++h.count > max) throw new HttpException({ message: "Too many requests. Please try again a little later." }, HttpStatus.TOO_MANY_REQUESTS);
  }

  /** Cloudflare Turnstile ("not a robot"), when TURNSTILE_SECRET_KEY is set. */
  async human(token: unknown, ip: string): Promise<boolean> {
    const secret = process.env.TURNSTILE_SECRET_KEY;
    if (!secret) return true;
    if (typeof token !== "string" || !token || token.length > 4000) return false;
    try {
      const body = new URLSearchParams({ secret, response: token, remoteip: ip });
      const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body, signal: AbortSignal.timeout(5000) });
      return !!((await res.json()) as { success?: boolean }).success;
    } catch (e) {
      this.logger.warn(`Turnstile unreachable, accepting: ${(e as Error).message}`);
      return true;
    }
  }

  /* ---------------------------------------------------------------- public: request a demo */

  async request(input: DemoRequestInput, ip: string) {
    // Bots fill the hidden field: pretend it worked.
    if (input.website) return { ok: true };
    this.limit(`lead:${ip}`, 5, 60 * 60_000);
    this.limit("lead:all", 60, 60 * 60_000);
    if (!(await this.human(input.botToken, ip))) throw new DomainError("We could not confirm you are not a robot. Reload the page and try again.");
    const lead = await this.db.lead.create({
      data: { companyName: input.companyName, name: input.name, email: input.email, phone: input.phone, country: input.country, teamSize: input.teamSize, message: input.message, source: "form", ip: ip.slice(0, 64) },
    });
    await this.companies.log(null, "lead", `New demo request: ${input.name} <${input.email}> from ${input.companyName}`, { leadId: lead.id });
    await this.mail.toAdmins({
      subject: `Demo request: ${input.companyName}`,
      heading: "New demo request",
      rows: [
        ["Company", input.companyName],
        ["Name", input.name],
        ["Email", input.email],
        ["Phone / WhatsApp", input.phone],
        ["Country", input.country],
        ["Team size", input.teamSize],
      ],
      body: input.message,
      link: this.mail.url(`/platform/leads/${lead.id}`),
      linkLabel: "Open the lead",
    });
    return { ok: true };
  }

  /* ---------------------------------------------------------------- the platform admin's list */

  async list(filter: { status?: string; q?: string }) {
    const rows = await this.db.lead.findMany({
      where: {
        status: filter.status ? (filter.status as never) : undefined,
        OR: filter.q
          ? [{ companyName: { contains: filter.q, mode: "insensitive" } }, { name: { contains: filter.q, mode: "insensitive" } }, { email: { contains: filter.q, mode: "insensitive" } }]
          : undefined,
      },
      include: { company: { select: { id: true, slug: true, name: true, kind: true, status: true, endsAt: true } }, _count: { select: { notes: true } } },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    return rows.map((l) => this.view(l));
  }

  private view(l: Prisma.LeadGetPayload<{ include: { company: { select: { id: true; slug: true; name: true; kind: true; status: true; endsAt: true } } } }> & { _count?: { notes: number } }) {
    return {
      id: l.id,
      companyName: l.companyName,
      name: l.name,
      email: l.email,
      phone: l.phone,
      country: l.country,
      teamSize: l.teamSize,
      message: l.message,
      source: l.source,
      status: l.status,
      lostReason: l.lostReason,
      followUpOn: fromDbDateOrNull(l.followUpOn),
      company: l.company,
      notes: l._count?.notes ?? 0,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt,
    };
  }

  async get(id: string) {
    const l = await this.db.lead.findUnique({ where: { id }, include: { company: { select: { id: true, slug: true, name: true, kind: true, status: true, endsAt: true } } } });
    if (!l) throw new NotFoundError("Lead");
    const [notes, log] = await Promise.all([
      this.db.leadNote.findMany({ where: { leadId: id }, orderBy: { createdAt: "desc" } }),
      this.db.platformLog.findMany({ where: { leadId: id }, orderBy: { at: "desc" }, take: 30 }),
    ]);
    return { ...this.view(l), notes, log };
  }

  async create(actor: Actor, input: z.infer<typeof leadInput>) {
    const lead = await this.db.lead.create({ data: { ...input, source: "manual" } });
    await this.companies.log(actor, "lead", `Added the lead ${input.name} <${input.email}> (${input.companyName})`, { leadId: lead.id });
    return this.get(lead.id);
  }

  async update(actor: Actor, id: string, input: z.infer<typeof leadUpdateInput>) {
    const l = await this.db.lead.findUnique({ where: { id } });
    if (!l) throw new NotFoundError("Lead");
    if (input.status === "lost" && !input.lostReason && !l.lostReason) throw new DomainError("Say why it was lost.");
    const data: Prisma.LeadUpdateInput = {
      status: input.status,
      lostReason: input.status && input.status !== "lost" ? null : (input.lostReason ?? undefined),
      followUpOn: input.followUpOn === undefined ? undefined : toDbDateOrNull(input.followUpOn),
      companyName: input.companyName,
      name: input.name,
      email: input.email,
      phone: input.phone === undefined ? undefined : input.phone,
      country: input.country === undefined ? undefined : input.country,
    };
    await this.db.lead.update({ where: { id }, data });
    const said = [
      input.status && input.status !== l.status ? `status ${l.status} → ${input.status}${input.status === "lost" && input.lostReason ? ` (${input.lostReason})` : ""}` : null,
      input.followUpOn !== undefined && input.followUpOn !== fromDbDateOrNull(l.followUpOn) ? `follow up ${input.followUpOn ?? "cleared"}` : null,
    ].filter(Boolean);
    if (said.length) await this.companies.log(actor, "lead_update", `${l.name} (${l.companyName}): ${said.join("; ")}`, { leadId: id });
    return this.get(id);
  }

  async addNote(actor: Actor, id: string, text: string) {
    if (!(await this.db.lead.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundError("Lead");
    await this.db.leadNote.create({ data: { leadId: id, text, byId: actor?.id, byName: actor?.name } });
    return this.get(id);
  }

  async remove(actor: Actor, id: string) {
    const l = await this.db.lead.findUnique({ where: { id } });
    if (!l) throw new NotFoundError("Lead");
    await this.db.lead.delete({ where: { id } });
    await this.companies.log(actor, "lead_delete", `Deleted the lead ${l.name} <${l.email}> (${l.companyName})`);
    return { ok: true };
  }

  /** One click: a demo for this lead (its own short name ending in -demo, sample data, a few days). */
  async giveDemo(actor: Actor, id: string, opts: { days?: number | null; sampleData?: boolean; slug?: string | null; planId?: string | null }) {
    const l = await this.db.lead.findUnique({ where: { id } });
    if (!l) throw new NotFoundError("Lead");
    if (l.companyId) {
      const existing = await this.db.company.findUnique({ where: { id: l.companyId } });
      if (existing && existing.status !== "deleted") throw new ConflictError(`${l.companyName} already has ${existing.kind === "client" ? "a company" : "a demo"} (${existing.slug}).`);
    }
    const slug = opts.slug ? opts.slug : await this.companies.freeSlug(`${suggestSlug(l.companyName).slice(0, 25)}-demo`);
    return this.companies.create(actor, {
      name: l.companyName,
      slug,
      kind: "demo",
      planId: opts.planId ?? null,
      adminName: l.name,
      adminEmail: l.email,
      sampleData: opts.sampleData ?? true,
      days: opts.days ?? LIFECYCLE.demoDays,
      renewsOn: null,
      leadId: l.id,
      notes: null,
    });
  }

  /* ---------------------------------------------------------------- public: self sign-up */

  /** Self sign-up is open only when switched on and emails can be sent (the email must be confirmed). */
  get signUpOpen() {
    return process.env.SIGN_UP_OPEN === "true" && this.mail.enabled;
  }

  async startSignUp(input: SignUpInput, ip: string) {
    if (!this.signUpOpen) throw new DomainError("Sign-up is not open yet. Request a demo instead.");
    if (input.website) return { ok: true };
    this.limit(`signup:${ip}`, 5, 60 * 60_000);
    this.limit("signup:all", 40, 60 * 60_000);
    if (!(await this.human(input.botToken, ip))) throw new DomainError("We could not confirm you are not a robot. Reload the page and try again.");
    const taken = await this.companies.slugTaken(input.slug);
    if (taken) throw new ConflictError(taken);
    const token = randomBytes(32).toString("base64url");
    await this.db.signUp.create({
      data: {
        companyName: input.companyName,
        slug: input.slug,
        name: input.name,
        email: input.email,
        passwordHash: await bcrypt.hash(input.password, 12),
        tokenHash: createHash("sha256").update(token).digest("hex"),
        expiresAt: new Date(Date.now() + 24 * 3_600_000),
        ip: ip.slice(0, 64),
      },
    });
    await this.mail.send({
      to: input.email,
      subject: "Confirm your email to start your RFQ Desk trial",
      heading: "Confirm your email",
      rows: [["Company", input.companyName], ["Your email", input.email]],
      body: `Press the button to confirm your email. Your ${LIFECYCLE.trialDays}-day trial starts right away. The link works for 24 hours.`,
      link: this.mail.url(`/sign-up/confirm?token=${encodeURIComponent(token)}`),
      linkLabel: "Confirm and start",
    });
    return { ok: true };
  }

  async confirmSignUp(token: string) {
    const s = await this.db.signUp.findUnique({ where: { tokenHash: createHash("sha256").update(token).digest("hex") } });
    if (!s || s.expiresAt < new Date()) throw new DomainError("This link has expired. Sign up again.");
    if (s.verifiedAt && s.companyId) {
      const c = await this.db.company.findUnique({ where: { id: s.companyId } });
      return { slug: c?.slug ?? s.slug, email: s.email, already: true };
    }
    const slug = (await this.companies.slugTaken(s.slug)) ? await this.companies.freeSlug(s.slug) : s.slug;
    const lead = await this.db.lead.create({ data: { companyName: s.companyName, name: s.name, email: s.email, source: "sign_up", status: "demo", ip: s.ip } });
    const made = await this.companies.create(null, {
      name: s.companyName,
      slug,
      kind: "trial",
      planId: null,
      adminName: s.name,
      adminEmail: s.email,
      sampleData: false,
      days: LIFECYCLE.trialDays,
      renewsOn: null,
      leadId: lead.id,
      notes: null,
      passwordHash: s.passwordHash,
    });
    await this.db.signUp.update({ where: { id: s.id }, data: { verifiedAt: new Date(), companyId: made.id } });
    await this.mail.toAdmins({
      subject: `New trial: ${s.companyName}`,
      heading: "Someone started a trial",
      rows: [["Company", `${s.companyName} (${slug})`], ["Name", s.name], ["Email", s.email]],
      link: this.mail.url(`/platform/companies/${made.id}`),
      linkLabel: "Open in the platform",
    });
    return { slug, email: s.email, already: false };
  }
}
