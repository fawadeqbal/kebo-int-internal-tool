import { Controller, Get, Inject, Module } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { fromDbDateOrNull } from "@kebo/database";
import { LIFECYCLE } from "@kebo/shared";
import { addDays, todayIn } from "@kebo/utils";
import { ENV, type Env } from "../../config/env";
import { PrismaService } from "../../database/prisma.service";
import { AllowDuringTwoStepSetup } from "../../common/auth/decorators";
import { CompanyContext } from "../../common/company/company-context";
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
    @Inject(ENV) private readonly env: Env,
  ) {}

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
