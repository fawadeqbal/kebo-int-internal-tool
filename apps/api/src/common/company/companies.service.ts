import { Global, Inject, Injectable, Module } from "@nestjs/common";
import type { CompanyModel as Company, PlanModel as Plan } from "@kebo/database";
import { ENV, type Env } from "../../config/env";
import { PrismaService } from "../../database/prisma.service";
import type { CompanyInfo } from "./company-context";

const TTL_MS = 15_000;

export const toInfo = (c: Company): CompanyInfo => ({
  id: c.id,
  slug: c.slug,
  name: c.name,
  kind: c.kind,
  status: c.status,
  statusReason: c.statusReason,
  endsAt: c.endsAt,
  planId: c.planId,
});

/**
 * The companies, read from the platform tables and remembered for a few
 * seconds (every request asks which company it is in). Changes made by the
 * platform admin call forget() so they apply at once.
 */
@Injectable()
export class CompaniesService {
  private readonly byIdCache = new Map<string, { at: number; value: Promise<CompanyInfo | null> }>();
  private readonly plans = new Map<string, { at: number; value: Promise<Plan | null> }>();
  private defaultId: { at: number; value: Promise<string | null> } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  byId(id: string): Promise<CompanyInfo | null> {
    const hit = this.byIdCache.get(id);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
    const value = this.prisma.platform.company.findUnique({ where: { id } }).then((c) => (c && c.status !== "deleted" ? toInfo(c) : null));
    this.byIdCache.set(id, { at: Date.now(), value });
    value.catch(() => this.byIdCache.delete(id));
    return value;
  }

  async bySlug(slug: string): Promise<CompanyInfo | null> {
    const s = slug.trim().toLowerCase();
    const c = await this.prisma.platform.company.findFirst({
      where: { OR: [{ slug: s }, { previousSlug: s, previousSlugUntil: { gt: new Date() } }], status: { not: "deleted" } },
    });
    return c ? toInfo(c) : null;
  }

  /** The company for requests that do not say which (DEFAULT_COMPANY, else the first one made). */
  async defaultCompany(): Promise<CompanyInfo | null> {
    if (!this.defaultId || Date.now() - this.defaultId.at > TTL_MS) {
      const value = (
        this.env.DEFAULT_COMPANY
          ? this.prisma.platform.company.findFirst({
              where: { slug: this.env.DEFAULT_COMPANY, status: { not: "deleted" } },
              select: { id: true },
            })
          : this.prisma.platform.company.findFirst({
              where: { status: { not: "deleted" } },
              orderBy: { createdAt: "asc" },
              select: { id: true },
            })
      ).then((c) => c?.id ?? null);
      this.defaultId = { at: Date.now(), value };
    }
    const id = await this.defaultId.value;
    return id ? this.byId(id) : null;
  }

  /** The company's plan (null: no plan, so no limits and every feature). */
  plan(company: CompanyInfo): Promise<Plan | null> {
    if (!company.planId) return Promise.resolve(null);
    const hit = this.plans.get(company.planId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
    const value = this.prisma.platform.plan.findUnique({ where: { id: company.planId } });
    this.plans.set(company.planId, { at: Date.now(), value });
    return value;
  }

  /** Something about a company or plan changed: read it again next time. */
  forget(companyId?: string) {
    if (companyId) this.byIdCache.delete(companyId);
    else this.byIdCache.clear();
    this.plans.clear();
    this.defaultId = null;
  }
}

@Global()
@Module({ providers: [CompaniesService], exports: [CompaniesService] })
export class CompaniesModule {}
