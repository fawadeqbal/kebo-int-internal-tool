import { promises as dns } from "node:dns";
import { Global, Inject, Injectable, Module } from "@nestjs/common";
import type { CompanyModel as Company } from "@kebo/database";
import { companyOrigin, connectTarget, domainProblem, ownDomainRecord, tidyDomain, type OwnDomainProblem, type OwnDomainStatus, type OwnDomainView } from "@kebo/shared";
import { ConflictError, DomainError } from "@kebo/utils";
import { ENV, type Env } from "../../config/env";
import { PrismaService } from "../../database/prisma.service";
import { CompaniesService } from "./companies.service";

const MINUTE = 60_000;
/** How often a domain is looked up again by itself: while waiting, when lost, when connected (and sooner after a first miss). */
const RECHECK = { waiting: 10 * MINUTE, lost: 60 * MINUTE, connected: 24 * 60 * MINUTE, doubted: 60 * MINUTE } as const;

/** What a look-up found: the record points to us, it does not, or the look-up itself failed (nothing is known). */
export type Lookup = "ours" | "not_ours" | "unknown";

const clean = (h: string) => h.toLowerCase().replace(/\.$/, "");
/** The answer is "there is no such record" (not "the look-up failed"). */
const none = (e: unknown) => ["ENODATA", "ENOTFOUND", "ENONAME"].includes((e as { code?: string })?.code ?? "");

/**
 * Looks a domain up in DNS. On its own so tests (and nothing else) can stand in for the internet.
 * "ours": its CNAME is connect.<BASE_DOMAIN>, or (a provider that flattens the record) every address it
 * has is one of ours.
 */
@Injectable()
export class DomainLookup {
  async find(domain: string, target: string): Promise<Lookup> {
    try {
      const names = await dns.resolveCname(domain);
      if (names.some((n) => clean(n) === target)) return "ours";
    } catch (e) {
      if (!none(e)) return "unknown";
    }
    try {
      const [theirs, ours] = await Promise.all([dns.resolve4(domain), dns.resolve4(target)]);
      return theirs.length > 0 && theirs.every((ip) => ours.includes(ip)) ? "ours" : "not_ours";
    } catch (e) {
      return none(e) ? "not_ours" : "unknown";
    }
  }
}

type Row = Pick<Company, "id" | "slug" | "name" | "ownDomain" | "ownDomainStatus" | "ownDomainProblem" | "ownDomainCheckedAt" | "ownDomainSince" | "ownDomainLostAt">;
const FIELDS = { id: true, slug: true, name: true, ownDomain: true, ownDomainStatus: true, ownDomainProblem: true, ownDomainCheckedAt: true, ownDomainSince: true, ownDomainLostAt: true } as const;
const iso = (d: Date | null) => (d ? d.toISOString() : null);

/**
 * A company's own domain (Settings › Company address): the company keeps its address under ours, or
 * connects a domain it owns with one CNAME record to connect.<BASE_DOMAIN>.
 *
 * - connect(): the domain is kept and looked up at once. Found: connected. Not found: waiting, and the
 *   worker looks again every 10 minutes.
 * - Connected: the domain is the company's address (links in emails, where its address under ours sends
 *   people). Looked up once a day; a record that is gone twice an hour apart makes it lost: people are back
 *   at the address under ours until the record returns (looked up every hour).
 * - A look-up that fails (the resolver, not the record) changes nothing.
 *
 * Switched on by OWN_DOMAINS=true, once the server's proxy takes addresses that are not ours
 * (deploy/Caddyfile.domains). Off: nothing here is offered and no domain is served.
 */
@Injectable()
export class OwnDomainService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companies: CompaniesService,
    private readonly lookup: DomainLookup,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Companies may connect a domain here: addresses per company are on, and the proxy is ready for others' domains. */
  get enabled() {
    return !!this.env.BASE_DOMAIN && process.env.OWN_DOMAINS === "true";
  }

  private row(companyId: string): Promise<Row> {
    return this.prisma.platform.company.findUniqueOrThrow({ where: { id: companyId }, select: FIELDS });
  }

  private view(c: Row, canChange: boolean): OwnDomainView {
    const base = this.env.BASE_DOMAIN ?? "";
    return {
      canChange,
      ours: companyOrigin(c.slug, base, this.env.APP_URL).replace(/^https?:\/\//, ""),
      domain: c.ownDomain,
      status: (c.ownDomainStatus as OwnDomainStatus | null) ?? null,
      problem: (c.ownDomainProblem as OwnDomainProblem | null) ?? null,
      checkedAt: iso(c.ownDomainCheckedAt),
      since: iso(c.ownDomainSince),
      lostAt: iso(c.ownDomainLostAt),
      record: c.ownDomain ? ownDomainRecord(c.ownDomain, base) : null,
    };
  }

  async get(companyId: string, canChange: boolean): Promise<OwnDomainView> {
    return this.view(await this.row(companyId), canChange);
  }

  /** The company whose connected domain this is (the web app asks for an address that is not ours). */
  async companyAt(host: string): Promise<{ slug: string } | null> {
    if (!this.enabled) return null;
    const domain = tidyDomain(host);
    if (!domain || domainProblem(domain, this.env.BASE_DOMAIN!)) return null;
    return this.prisma.platform.company.findFirst({ where: { ownDomain: domain, ownDomainStatus: "connected", status: { not: "deleted" } }, select: { slug: true } });
  }

  /** A certificate may be made for this address: it is some company's domain (connected or still waiting for its first visit). */
  async isOwnDomain(host: string): Promise<boolean> {
    if (!this.enabled) return false;
    const domain = tidyDomain(host);
    if (!domain) return false;
    return !!(await this.prisma.platform.company.count({ where: { ownDomain: domain, ownDomainStatus: { in: ["connected", "waiting"] }, status: { not: "deleted" } } }));
  }

  /** Connects a domain (or another one in its place) and looks it up at once. */
  async connect(companyId: string, typed: string): Promise<Row> {
    if (!this.enabled) throw new DomainError("Connecting your own domain is not switched on here.");
    const domain = tidyDomain(typed);
    const problem = domainProblem(domain, this.env.BASE_DOMAIN!);
    if (problem) throw new DomainError(problem);
    const other = await this.prisma.platform.company.findFirst({ where: { ownDomain: domain, id: { not: companyId } }, select: { id: true } });
    if (other) throw new ConflictError("This domain is connected to another company.");
    await this.prisma.platform.company.update({
      where: { id: companyId },
      data: { ownDomain: domain, ownDomainStatus: "waiting", ownDomainProblem: null, ownDomainCheckedAt: null, ownDomainSince: null, ownDomainLostAt: null },
    });
    this.companies.forget(companyId);
    return this.check(companyId);
  }

  /** Back to the address under ours only. */
  async remove(companyId: string): Promise<Row> {
    await this.prisma.platform.company.update({
      where: { id: companyId },
      data: { ownDomain: null, ownDomainStatus: null, ownDomainProblem: null, ownDomainCheckedAt: null, ownDomainSince: null, ownDomainLostAt: null },
    });
    this.companies.forget(companyId);
    return this.row(companyId);
  }

  /** Looks the company's domain up now and keeps what was found. */
  async check(companyId: string, now = new Date()): Promise<Row> {
    const c = await this.row(companyId);
    if (!c.ownDomain || !this.env.BASE_DOMAIN) return c;
    const found = await this.lookup.find(c.ownDomain, connectTarget(this.env.BASE_DOMAIN));
    // The look-up itself failed: nothing is known, so nothing changes.
    if (found === "unknown") return c;
    const was = c.ownDomainStatus;
    let data: Partial<Pick<Company, "ownDomainStatus" | "ownDomainProblem" | "ownDomainSince" | "ownDomainLostAt">>;
    if (found === "ours") {
      data = { ownDomainStatus: "connected", ownDomainProblem: null, ownDomainLostAt: null, ownDomainSince: was === "connected" || was === "lost" ? (c.ownDomainSince ?? now) : now };
    } else if (was === "connected") {
      // Gone once: looked up again in an hour before people are sent back to our address.
      data = c.ownDomainProblem === "no_record" ? { ownDomainStatus: "lost", ownDomainLostAt: c.ownDomainLostAt ?? now } : { ownDomainProblem: "no_record", ownDomainLostAt: now };
    } else {
      data = { ownDomainProblem: "no_record" };
    }
    await this.prisma.platform.company.update({ where: { id: companyId }, data: { ...data, ownDomainCheckedAt: now } });
    const after = await this.row(companyId);
    if (after.ownDomainStatus !== was) {
      this.companies.forget(companyId);
      const words = after.ownDomainStatus === "connected" ? `is connected to ${c.ownDomain}` : `lost its domain ${c.ownDomain} (the record is gone); its people are back at its address here`;
      await this.prisma.platform.platformLog.create({ data: { action: "update", adminName: "System", summary: `${c.name} ${words}`, companyId } });
    }
    return after;
  }

  /** The worker's round: every domain that is due is looked up again. Returns how many were. */
  async sweep(now = new Date()): Promise<number> {
    if (!this.enabled) return 0;
    const rows = await this.prisma.platform.company.findMany({ where: { ownDomain: { not: null }, status: { not: "deleted" } }, select: FIELDS });
    let n = 0;
    for (const c of rows) {
      const status = c.ownDomainStatus as OwnDomainStatus | null;
      if (!status) continue;
      const every = status === "connected" && c.ownDomainProblem ? RECHECK.doubted : RECHECK[status];
      if (c.ownDomainCheckedAt && now.getTime() - c.ownDomainCheckedAt.getTime() < every) continue;
      await this.check(c.id, now);
      n++;
    }
    return n;
  }
}

@Global()
@Module({ providers: [DomainLookup, OwnDomainService], exports: [DomainLookup, OwnDomainService] })
export class OwnDomainModule {}
