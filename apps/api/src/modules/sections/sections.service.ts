import { Injectable } from "@nestjs/common";
import { can, ORDER_FLOW_STAGES, orderSteps, stageStands, type SectionFacts } from "@kebo/shared";
import { NotFoundError } from "@kebo/utils";
import { PrismaService } from "../../database/prisma.service";
import { Clock } from "../../common/time/clock.service";
import { LimitsService } from "../../common/company/limits.service";
import type { SessionUser } from "../../common/auth/session-user";
import { orderAccess } from "../../common/auth/order-access";
import { MoneyService } from "../money/money.service";
import { SettingsService } from "../settings/settings.service";
import { fxOf } from "../billing/api";
import { checklistFactsOf, checklistOrderInclude } from "../checklist/checklist-facts";

/**
 * The order without checklists: where each stage of an order stands, read from
 * what is stored (see @kebo/shared workflows/order-sections). Nothing is kept
 * here and nothing is ticked: the words follow the data.
 */
@Injectable()
export class SectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly limits: LimitsService,
    private readonly money: MoneyService,
    private readonly settings: SettingsService,
  ) {}

  /** What the factories are owed and paid, for people who may see factory money (null otherwise). */
  private async factoriesOf(user: SessionUser, orderId: string): Promise<SectionFacts["factories"]> {
    if (!can(user, "sourcing.manage")) return null;
    const m = await this.money.forOrder(user, orderId);
    return m.factories ? m.factories.rows.map((r) => ({ name: r.factory.name, currency: r.currency, owed: r.owed, paid: r.paid, toPay: r.toPay })) : [];
  }

  /** The order's facts: what every section's word is read from. */
  async facts(user: SessionUser, id: string): Promise<{ status: string; facts: SectionFacts }> {
    const o = await this.prisma.db.order.findFirst({ where: { id, ...orderAccess(user) }, include: checklistOrderInclude });
    if (!o) throw new NotFoundError("Order");
    const [factories, settings, expenses] = await Promise.all([this.factoriesOf(user, o.id), this.settings.get(), this.limits.allows("expenses")]);
    const facts = { ...checklistFactsOf(o, factories, this.clock.timeZone, fxOf(settings, expenses), settings.reminders.lcCourierDays), papersOff: settings.papers.off };
    return { status: o.status, facts };
  }

  /**
   * GET /orders/:id/sections — "Where it stands": one line per stage in the tabs' order (its word, a
   * sentence of facts, what is still empty), and the small word beside each tab. A stage whose module
   * the company has switched off is left out.
   */
  async view(user: SessionUser, id: string) {
    const [{ status, facts }, features] = await Promise.all([this.facts(user, id), this.limits.features()]);
    const on = orderSteps(features);
    const stands = stageStands(facts, this.clock.today()).filter((s) => on.includes(s.stage));
    return {
      orderId: id,
      status,
      stages: ORDER_FLOW_STAGES.filter((s) => on.includes(s)),
      stands,
      tabs: Object.fromEntries(stands.map((s) => [s.stage, s.tab])) as Record<string, string>,
    };
  }
}
