import { Global, Injectable, Module } from "@nestjs/common";
import { DomainError } from "@kebo/utils";
import { PLAN_FEATURE_KEYS } from "@kebo/shared";
import { PrismaService } from "../../database/prisma.service";
import { CompaniesService } from "./companies.service";
import { CompanyContext, type CompanyInfo } from "./company-context";

/** A warning shows from this share of a limit. */
const NEAR = 0.85;
const MB = 1024 * 1024;

export interface Usage {
  /** Active people who can sign in (not the website-form account or a platform admin). */
  users: number;
  /** Bytes of files kept (inquiry files, payment proofs, receipts). */
  storageBytes: number;
}

/**
 * What a company uses against its plan's limits. Near a limit: a warning;
 * at the limit: adding people or files is refused with a clear message.
 * Nothing is ever deleted because of a limit.
 */
@Injectable()
export class LimitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companies: CompaniesService,
  ) {}

  /** One company's usage (its own connection: counts only its rows). */
  async usage(companyId: string): Promise<Usage> {
    const db = this.prisma.company(companyId);
    const [users, files] = await Promise.all([
      db.user.count({ where: { isSystem: false, platformAdminId: null, isActive: true } }),
      db.$queryRaw<{ bytes: bigint | null }[]>`
        select (coalesce((select sum(size) from attachments), 0)
              + coalesce((select sum(file_size) from payments), 0)
              + coalesce((select sum(file_size) from factory_payments), 0)
              + coalesce((select sum(receipt_size) from expenses), 0))::bigint as bytes`,
    ]);
    return { users, storageBytes: Number(files[0]?.bytes ?? 0) };
  }

  /** The current company's plan, usage, and the warnings to show. */
  async summary(company: CompanyInfo = CompanyContext.require()) {
    const [plan, usage] = await Promise.all([this.companies.plan(company), this.usage(company.id)]);
    const warnings: string[] = [];
    const storageMb = usage.storageBytes / MB;
    if (plan?.maxUsers) {
      if (usage.users >= plan.maxUsers)
        warnings.push(`You have reached your plan's ${plan.maxUsers} people: switch someone off or ask for a bigger plan to add more.`);
      else if (usage.users >= plan.maxUsers * NEAR) warnings.push(`${usage.users} of your plan's ${plan.maxUsers} people are in use.`);
    }
    if (plan?.maxStorageMb) {
      if (storageMb >= plan.maxStorageMb)
        warnings.push(`Your files have reached your plan's ${fmtMb(plan.maxStorageMb)}: new files cannot be added.`);
      else if (storageMb >= plan.maxStorageMb * NEAR)
        warnings.push(`Files use ${fmtMb(storageMb)} of your plan's ${fmtMb(plan.maxStorageMb)}.`);
    }
    return {
      plan: plan
        ? {
            name: plan.name,
            maxUsers: plan.maxUsers,
            maxStorageMb: plan.maxStorageMb,
            features: plan.features,
            priceMinor: plan.priceMinor,
            currency: plan.currency,
            period: plan.period,
          }
        : null,
      features: plan ? plan.features : [...PLAN_FEATURE_KEYS],
      usage: { users: usage.users, storageMb: Math.round(storageMb * 10) / 10 },
      warnings,
    };
  }

  /** Before someone is added or switched on. */
  async checkPeople(adding = 1) {
    const company = CompanyContext.require();
    const plan = await this.companies.plan(company);
    if (!plan?.maxUsers) return;
    const { users } = await this.usage(company.id);
    if (users + adding > plan.maxUsers) {
      throw new DomainError(
        `Your plan allows ${plan.maxUsers} people and ${users} are in use. Switch someone off, or ask for a bigger plan.`,
      );
    }
  }

  /** Before a file is kept. */
  async checkStorage(bytes: number) {
    const company = CompanyContext.require();
    const plan = await this.companies.plan(company);
    if (!plan?.maxStorageMb) return;
    const { storageBytes } = await this.usage(company.id);
    if (storageBytes + bytes > plan.maxStorageMb * MB) {
      throw new DomainError(
        `Your plan has room for ${fmtMb(plan.maxStorageMb)} of files and ${fmtMb(storageBytes / MB)} are used. Remove old files, or ask for a bigger plan.`,
      );
    }
  }
}

const fmtMb = (mb: number) => (mb >= 1024 ? `${Math.round((mb / 1024) * 10) / 10} GB` : `${Math.round(mb)} MB`);

@Global()
@Module({ providers: [LimitsService], exports: [LimitsService] })
export class LimitsModule {}
