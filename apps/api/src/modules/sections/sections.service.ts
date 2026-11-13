import { Injectable } from "@nestjs/common";
import { can, FAT_RESULT_LABEL, ORDER_FLOW_STAGES, orderSteps, REQUEST_CHANNEL_LABEL, stageStands, type FactoryFactsInput, type FatResult, type RequestChannel, type SectionFacts } from "@kebo/shared";
import { fromDbDateOrNull, toDbDateOrNull } from "@kebo/database";
import { DomainError, ForbiddenError, NotFoundError } from "@kebo/utils";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
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
    private readonly audit: AuditService,
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
    const [{ status, facts }, features, production] = await Promise.all([this.facts(user, id), this.limits.features(), this.production(id)]);
    const on = orderSteps(features);
    const stands = stageStands(facts, this.clock.today()).filter((s) => on.includes(s.stage));
    return {
      orderId: id,
      status,
      stages: ORDER_FLOW_STAGES.filter((s) => on.includes(s)),
      stands,
      tabs: Object.fromEntries(stands.map((s) => [s.stage, s.tab])) as Record<string, string>,
      production,
    };
  }

  /**
   * Production, per factory of the order (one row, factory null, when the lines name none): its ready
   * date with when and how it was told, its factory test, where its goods were received.
   */
  private async production(orderId: string) {
    const [rows, lines] = await Promise.all([
      this.prisma.db.orderFactory.findMany({ where: { orderId }, include: { factory: { select: { id: true, name: true } }, fatAttendedBy: { select: { id: true, name: true } } } }),
      this.prisma.db.orderLine.findMany({ where: { orderId, type: "goods" }, select: { factoryId: true, factory: { select: { id: true, name: true } } } }),
    ]);
    const factories = [...new Map(lines.flatMap((l) => (l.factory ? [[l.factory.id, l.factory] as const] : []))).values()];
    const slots: ({ id: string; name: string } | null)[] = factories.length ? factories : [null];
    return slots.map((f) => {
      const r = rows.find((x) => x.factoryId === (f?.id ?? null));
      return {
        factory: f,
        readyOn: fromDbDateOrNull(r?.readyOn ?? null),
        readyToldOn: fromDbDateOrNull(r?.readyToldOn ?? null),
        readyToldVia: (r?.readyToldVia as RequestChannel | null) ?? null,
        readyNote: r?.readyNote ?? null,
        fat: {
          plannedOn: fromDbDateOrNull(r?.fatPlannedOn ?? null),
          attendedBy: r?.fatAttendedBy ?? null,
          doneOn: fromDbDateOrNull(r?.fatDoneOn ?? null),
          result: (r?.fatResult as FatResult | null) ?? null,
          remarks: r?.fatRemarks ?? null,
        },
        goodsReceivedAt: r?.goodsReceivedAt ?? null,
      };
    });
  }

  /**
   * PUT /orders/:id/factory-facts — what Production's windows keep for one factory of the order (only the
   * fields sent change). The ready date itself is the order's own (its plans follow it); this keeps when
   * and how it was told, the factory test, and where the goods were received.
   */
  async saveFactoryFacts(user: SessionUser, id: string, input: FactoryFactsInput) {
    if (!can(user, "orders.update")) throw new ForbiddenError("You cannot change this order.");
    const o = await this.prisma.db.order.findFirst({
      where: { id, ...orderAccess(user) },
      select: { id: true, refNo: true, status: true, lines: { where: { type: "goods" }, select: { factoryId: true, factory: { select: { name: true } } } } },
    });
    if (!o) throw new NotFoundError("Order");
    if (o.status !== "open") throw new DomainError(o.status === "closed" ? "This order is closed." : "This order is cancelled.");
    const ids = [...new Set(o.lines.flatMap((l) => (l.factoryId ? [l.factoryId] : [])))];
    const factoryId = input.factoryId ?? (ids.length === 1 ? ids[0]! : null);
    if (factoryId ? !ids.includes(factoryId) : ids.length > 0) throw new DomainError("Choose a factory of this order.");
    if (input.fatAttendedById && !(await this.prisma.db.user.findFirst({ where: { id: input.fatAttendedById }, select: { id: true } }))) throw new DomainError("Choose a person of the company.");
    const name = o.lines.find((l) => l.factoryId === factoryId)?.factory?.name ?? null;

    const data: Record<string, unknown> = {};
    for (const k of ["readyToldVia", "readyNote", "fatAttendedById", "fatResult", "fatRemarks", "goodsReceivedAt"] as const) if (input[k] !== undefined) data[k] = input[k];
    for (const k of ["readyToldOn", "fatPlannedOn", "fatDoneOn"] as const) if (input[k] !== undefined) data[k] = toDbDateOrNull(input[k]);
    if (!Object.keys(data).length) return this.view(user, id);

    await this.prisma.tx(async (tx) => {
      const row = await tx.orderFactory.findFirst({ where: { orderId: id, factoryId } });
      if (row) await tx.orderFactory.update({ where: { id: row.id }, data });
      else await tx.orderFactory.create({ data: { orderId: id, factoryId, ...data } });
      // The history says what changed, in words.
      const said: string[] = [];
      if (input.fatDoneOn !== undefined || input.fatResult !== undefined) {
        const result = (input.fatResult ?? (row?.fatResult as FatResult | null)) || null;
        const done = input.fatDoneOn !== undefined ? input.fatDoneOn : fromDbDateOrNull(row?.fatDoneOn ?? null);
        said.push(done ? `factory test ${result ? FAT_RESULT_LABEL[result].toLowerCase() : "done"} on ${done}` : "factory test result cleared");
      } else if (input.fatPlannedOn !== undefined) said.push(input.fatPlannedOn ? `factory test planned for ${input.fatPlannedOn}` : "factory test plan cleared");
      if (input.readyToldOn !== undefined || input.readyToldVia !== undefined)
        said.push(`ready date told${input.readyToldOn ? ` on ${input.readyToldOn}` : ""}${input.readyToldVia ? ` by ${REQUEST_CHANNEL_LABEL[input.readyToldVia as RequestChannel]}` : ""}`);
      if (input.goodsReceivedAt !== undefined) said.push(input.goodsReceivedAt ? `goods received at ${input.goodsReceivedAt}` : "place of receipt cleared");
      if (!said.length) said.push("production notes changed");
      await this.audit.record(tx, {
        userId: user.id,
        action: "flow.production",
        entityType: "order",
        entityId: id,
        summary: `${o.refNo}: ${said.join(", ")}${name ? ` (${name})` : ""}`,
        newValues: { ...input, factoryId } as Record<string, unknown>,
      });
    });
    return this.view(user, id);
  }
}
