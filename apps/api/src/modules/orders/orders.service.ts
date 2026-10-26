import { Injectable } from "@nestjs/common";
import { decimalToMinor, fromDbDate, fromDbDateOrNull, toDbDate, toDbDateOrNull, type Prisma } from "@kebo/database";
import { settle } from "@kebo/money";
import {
  can,
  checkStepAction,
  orderPlan,
  STEPS,
  type MilestoneKey,
  type MilestoneState,
  type OrderFacts,
  type OrderPlan,
  type StepActionInput,
} from "@kebo/shared";
import { ForbiddenError, GateError, NotFoundError, type ISODate } from "@kebo/utils";
import { PrismaService, type Tx } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { Clock } from "../../common/time/clock.service";
import type { SessionUser } from "../../common/auth/session-user";
import { SettingsService } from "../settings/settings.service";

/** Staff work on the deals they handle or created; managers see every deal. */
export function orderAccess(user: SessionUser): Prisma.OrderWhereInput {
  if (can(user.role, "inquiries.viewAll")) return {};
  return { inquiry: { OR: [{ assigneeId: user.id }, { createdById: user.id }] } };
}

const orderInclude = {
  milestones: { orderBy: { sortOrder: "asc" } },
  payments: { where: { voidedAt: null }, orderBy: { paidOn: "asc" } },
  customer: { select: { id: true, name: true, country: true } },
  inquiry: { select: { id: true, refNo: true, title: true, assigneeId: true, assignee: { select: { id: true, name: true } } } },
} satisfies Prisma.OrderInclude;

type OrderRow = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly settings: SettingsService,
  ) {}

  /* ---------------------------------------------------------------- reading */

  private facts(o: OrderRow): OrderFacts {
    const paidIn = o.payments.filter((p) => p.direction === "in").map((p) => ({ amountMinor: decimalToMinor(p.amount), bankChargesMinor: decimalToMinor(p.bankCharges) }));
    return {
      status: o.status,
      orderedOn: fromDbDate(o.orderedOn),
      shipBy: fromDbDateOrNull(o.shipBy),
      readyOn: fromDbDateOrNull(o.readyOn),
      currency: o.currency,
      totalMinor: decimalToMinor(o.total),
      depositPercent: Number(o.depositPercent),
      balanceTerms: o.balanceTerms,
      customerSettledMinor: settle(decimalToMinor(o.total), paidIn).settledMinor,
    };
  }

  private states(o: OrderRow): MilestoneState[] {
    return o.milestones.map((m) => ({ key: m.key, status: m.status, doneOn: fromDbDateOrNull(m.doneOn), dueOverride: fromDbDateOrNull(m.dueOverride) }));
  }

  private async planOf(o: OrderRow): Promise<OrderPlan> {
    return orderPlan(this.facts(o), this.states(o), this.clock.today(), (await this.settings.get()).plan);
  }

  private async load(user: SessionUser, id: string, db: PrismaService["db"] | Tx = this.prisma.db): Promise<OrderRow> {
    const o = await db.order.findFirst({ where: { id, ...orderAccess(user) }, include: orderInclude });
    if (!o) throw new NotFoundError("Order");
    return o;
  }

  private view(o: OrderRow, plan: OrderPlan) {
    const facts = this.facts(o);
    const paidIn = o.payments.filter((p) => p.direction === "in");
    const money = settle(facts.totalMinor, paidIn.map((p) => ({ amountMinor: decimalToMinor(p.amount), bankChargesMinor: decimalToMinor(p.bankCharges) })), facts.depositPercent);
    return {
      id: o.id,
      refNo: o.refNo,
      status: o.status,
      stage: plan.stage,
      inquiry: o.inquiry,
      customer: o.customer,
      orderedOn: facts.orderedOn,
      shipBy: facts.shipBy,
      readyOn: facts.readyOn,
      currency: o.currency,
      total: o.total.toString(),
      depositPercent: facts.depositPercent,
      balanceTerms: o.balanceTerms,
      incoterm: o.incoterm,
      incotermPlace: o.incotermPlace,
      customerPayments: { ...money, status: money.status },
      plan,
    };
  }

  async get(user: SessionUser, id: string) {
    const o = await this.load(user, id);
    return this.view(o, await this.planOf(o));
  }

  /** Open orders with their next step, latest-due work first (the orders board and lists). */
  async list(user: SessionUser, filter: { mine?: boolean; overdueOnly?: boolean; status?: "open" | "closed" | "cancelled" }) {
    const rows = await this.prisma.db.order.findMany({
      where: {
        ...orderAccess(user),
        status: filter.status ?? "open",
        ...(filter.mine ? { inquiry: { assigneeId: user.id } } : {}),
      },
      include: orderInclude,
      orderBy: { orderedOn: "desc" },
      take: 200,
    });
    const settings = (await this.settings.get()).plan;
    const today = this.clock.today();
    const items = rows.map((o) => {
      const plan = orderPlan(this.facts(o), this.states(o), today, settings);
      return {
        id: o.id,
        refNo: o.refNo,
        customer: o.customer,
        inquiry: o.inquiry,
        stage: plan.stage,
        next: plan.next && { key: plan.next.key, title: plan.next.title, due: plan.next.due, overdue: plan.next.overdue, blockedBy: plan.next.blockedBy },
        progress: { done: plan.done, total: plan.total },
        overdue: plan.overdue,
      };
    });
    return filter.overdueOnly ? items.filter((i) => i.overdue > 0) : items;
  }

  /** "My to-do": the next step of every open order the person handles, late ones first. */
  async todo(user: SessionUser) {
    const items = (await this.list(user, { mine: true })).filter((i) => i.next);
    return items.sort((a, b) => Number(b.next!.overdue) - Number(a.next!.overdue) || (a.next!.due ?? "9999").localeCompare(b.next!.due ?? "9999"));
  }

  /* ---------------------------------------------------------------- changing */

  /**
   * Mark a step done, skip it, or undo it. The shared rules decide whether it
   * is allowed (gates, required steps, override + note); the order closes by
   * itself when every step is done or skipped, and reopens if one is undone.
   */
  async applyStep(user: SessionUser, id: string, input: StepActionInput) {
    if (!can(user.role, "milestones.update")) throw new ForbiddenError("You cannot change order steps.");
    const today = this.clock.today();
    const on: ISODate = input.on ?? today;
    if (input.action === "done" && on > today) throw new GateError("A step cannot be marked done on a future date.", "future_date");

    await this.prisma.tx(async (tx) => {
      const o = await this.load(user, id, tx);
      // Lock the order row so two people ticking steps at once see each other's change.
      await tx.$queryRaw`select id from orders where id = ${o.id}::uuid for update`;
      const states = this.states(o);
      const reopening = input.action === "undo" && o.status === "closed";
      const check = checkStepAction(input.key, input.action, {
        terms: o.balanceTerms,
        states,
        orderStatus: reopening ? "open" : o.status,
        canOverride: can(user.role, "milestones.override"),
        note: input.note,
      });
      if (!check.ok) throw new GateError(check.message, check.code);

      const m = o.milestones.find((x) => x.key === input.key)!;
      const to = input.action === "done" ? "done" : input.action === "skip" ? "skipped" : "todo";
      await tx.milestone.update({
        where: { id: m.id },
        data: {
          status: to,
          doneOn: to === "done" ? toDbDate(on) : null,
          doneById: to === "todo" ? null : user.id,
          note: input.note ?? (to === "todo" ? null : m.note),
          overridden: check.overridden,
        },
      });
      await tx.milestoneEvent.create({
        data: { milestoneId: m.id, action: input.action, fromStatus: m.status, toStatus: to, on: to === "done" ? toDbDate(on) : null, note: input.note, overridden: check.overridden, byId: user.id },
      });

      const after = states.map((s) => (s.key === input.key ? { ...s, status: to, doneOn: to === "done" ? on : null } : s));
      const complete = after.every((s) => s.status !== "todo");
      if (complete && o.status === "open") await tx.order.update({ where: { id: o.id }, data: { status: "closed", closedAt: new Date() } });
      if (reopening) await tx.order.update({ where: { id: o.id }, data: { status: "open", closedAt: null } });

      const title = STEPS[input.key as MilestoneKey];
      await this.audit.record(tx, {
        userId: user.id,
        action: `step_${input.action}`,
        entityType: "order",
        entityId: o.id,
        summary: `${o.refNo}: ${input.action === "undo" ? `undid "${title.doneTitle}"` : input.action === "skip" ? `skipped "${title.title}"` : title.doneTitle}${check.overridden ? " (manager override)" : ""}${input.note ? ` — ${input.note}` : ""}`,
      });
    });
    return this.get(user, id);
  }

  /** The promised ship date and the factory's ready date drive the later due dates. */
  async setDates(user: SessionUser, id: string, input: { shipBy: ISODate | null; readyOn: ISODate | null }) {
    if (!can(user.role, "milestones.update")) throw new ForbiddenError();
    await this.prisma.tx(async (tx) => {
      const o = await this.load(user, id, tx);
      await tx.order.update({ where: { id: o.id }, data: { shipBy: toDbDateOrNull(input.shipBy), readyOn: toDbDateOrNull(input.readyOn) } });
      await this.audit.record(tx, {
        userId: user.id,
        action: "update",
        entityType: "order",
        entityId: o.id,
        summary: `${o.refNo}: dates changed`,
        oldValues: { shipBy: fromDbDateOrNull(o.shipBy), readyOn: fromDbDateOrNull(o.readyOn) },
        newValues: input,
      });
    });
    return this.get(user, id);
  }

  /** Replace a step's calculated due date (or clear the override with null). */
  async setStepDue(user: SessionUser, id: string, key: MilestoneKey, due: ISODate | null) {
    if (!can(user.role, "milestones.update")) throw new ForbiddenError();
    await this.prisma.tx(async (tx) => {
      const o = await this.load(user, id, tx);
      const m = o.milestones.find((x) => x.key === key);
      if (!m) throw new NotFoundError("Step");
      await tx.milestone.update({ where: { id: m.id }, data: { dueOverride: toDbDateOrNull(due) } });
      await this.audit.record(tx, { userId: user.id, action: "update", entityType: "order", entityId: o.id, summary: `${o.refNo}: due date for "${STEPS[key].title}" set to ${due ?? "automatic"}` });
    });
    return this.get(user, id);
  }
}
