import { Injectable } from "@nestjs/common";
import { ConflictError, NotFoundError } from "@kebo/utils";
import type { PlanInput } from "@kebo/shared";
import { PrismaService } from "../database/prisma.service";
import { CompaniesService } from "../common/company/companies.service";
import { PlatformCompaniesService } from "./companies.platform";
import type { PlatformAdminUser } from "./platform-auth";

/** Plans: a price, limits (people, storage) and the features they include. */
@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companies: CompaniesService,
    private readonly platform: PlatformCompaniesService,
  ) {}

  async list() {
    const plans = await this.prisma.platform.plan.findMany({
      orderBy: [{ isActive: "desc" }, { priceMinor: "asc" }],
      include: { _count: { select: { companies: { where: { status: { not: "deleted" } } } } } },
    });
    return plans.map(({ _count, ...p }) => ({ ...p, companies: _count.companies }));
  }

  private data(input: PlanInput) {
    return {
      name: input.name,
      description: input.description,
      priceMinor: Math.round(input.price * 100),
      currency: input.currency,
      period: input.period,
      maxUsers: input.maxUsers,
      maxStorageMb: input.maxStorageMb,
      features: input.features,
      isActive: input.isActive,
    };
  }

  async create(actor: PlatformAdminUser, input: PlanInput) {
    if (await this.prisma.platform.plan.findUnique({ where: { name: input.name } }))
      throw new ConflictError("There is already a plan with this name.");
    const plan = await this.prisma.platform.plan.create({ data: this.data(input) });
    await this.platform.log(actor, "plan", `Made the plan ${plan.name}`);
    return plan;
  }

  async update(actor: PlatformAdminUser, id: string, input: PlanInput) {
    const before = await this.prisma.platform.plan.findUnique({ where: { id } });
    if (!before) throw new NotFoundError("Plan");
    const clash = await this.prisma.platform.plan.findFirst({ where: { name: input.name, id: { not: id } } });
    if (clash) throw new ConflictError("There is already a plan with this name.");
    const plan = await this.prisma.platform.plan.update({ where: { id }, data: this.data(input) });
    await this.platform.log(actor, "plan", `Changed the plan ${plan.name}`, { details: { before, after: plan } });
    this.companies.forget();
    return plan;
  }

  async remove(actor: PlatformAdminUser, id: string) {
    const plan = await this.prisma.platform.plan.findUnique({ where: { id }, include: { _count: { select: { companies: true } } } });
    if (!plan) throw new NotFoundError("Plan");
    if (plan._count.companies)
      throw new ConflictError(
        `${plan._count.companies} compan${plan._count.companies === 1 ? "y is" : "ies are"} on this plan. Move them first, or switch the plan off instead.`,
      );
    await this.prisma.platform.plan.delete({ where: { id } });
    await this.platform.log(actor, "plan", `Deleted the plan ${plan.name}`);
    return { ok: true };
  }
}
