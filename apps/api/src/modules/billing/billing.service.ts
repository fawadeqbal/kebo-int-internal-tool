import { Injectable } from "@nestjs/common";
import { decimalToMinor, fromDbDateOrNull, isSupplier, livePart, toDbDateOrNull, type Prisma } from "@kebo/database";
import { formatMinor, fromMinor, toMinor, type Minor } from "@kebo/money";
import { can, dueRuleWords, type FactoryPlanInput, type PaymentPlanInput, type PlanDueRule } from "@kebo/shared";
import { DomainError, ForbiddenError, NotFoundError } from "@kebo/utils";
import { LimitsService } from "../../common/company/limits.service";
import { PrismaService, type Tx } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { requireReason } from "../../common/audit/reason";
import { orderAccess } from "../../common/auth/order-access";
import { Clock } from "../../common/time/clock.service";
import type { SessionUser } from "../../common/auth/session-user";
import { SettingsService } from "../settings/settings.service";
import { ordersOwingFactories } from "./due";
import { factoryPlansOf, owedByFactory } from "./factory-plan";
import { factoryBorneExpenses, factoryPositionOf, fxOf, supplierPaidRelation } from "./position";
import { livePlanOf } from "./plan-live";

const person = { select: { id: true, name: true } } as const;

/** Lines of an order with the factory price frozen on them when it was made (for what we owe each factory). */
const linesWithFactory = {
  orderBy: { sortOrder: "asc" },
  include: { factory: { select: { id: true, name: true, owner: person } } },
} satisfies Prisma.Order$linesArgs;

type FactoryRow = { id: string; name: string; owner: { id: string; name: string } | null };

/**
 * Billing (claude/billing-4-design.md): the invoices of each order, both sides. The customer's are the
 * instalments of its payment plan (each with its payment request number), a supplier's the parts we pay
 * it in. Only Billing writes them; paid, due and late are worked out from the order's payments.
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly limits: LimitsService,
    private readonly clock: Clock,
  ) {}

  /** The order, if the person may see it (locked first by the caller), with what pays it. */
  private async orderFor(user: SessionUser, orderId: string, tx: Tx) {
    const o = await tx.order.findFirst({
      where: { id: orderId, ...orderAccess(user) },
      select: { id: true, refNo: true, status: true, total: true, currency: true, allocations: { where: livePart, select: { id: true } } },
    });
    if (!o) throw new NotFoundError("Order");
    return o;
  }

  /* ---------------------------------------------------------------- the plan */

  /**
   * Replace the order's instalments. They must add up to the order total. Once
   * the customer has paid something, changing the plan says why.
   */
  async setPlan(user: SessionUser, orderId: string, input: PaymentPlanInput) {
    if (!can(user, "orders.update")) throw new ForbiddenError("You cannot change orders.");
    await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`select id from orders where id = ${orderId}::uuid for update`;
      const o = await this.orderFor(user, orderId, tx);
      if (o.status === "cancelled") throw new DomainError("This order is cancelled.");
      const sum = input.items.reduce((t, i) => t + toMinor(i.amount), 0);
      const total = decimalToMinor(o.total);
      if (sum !== total)
        throw new DomainError(
          `The instalments add up to ${formatMinor(sum, o.currency)}, but the order is ${formatMinor(total, o.currency)}. Make them match.`,
        );
      const before = await tx.invoice.findMany({ where: { orderId }, orderBy: { sortOrder: "asc" } });
      const live = await livePlanOf(tx, orderId);
      const { reminders } = await this.settings.get();
      // Each row's due rule: as sent; else a date typed makes it fixed (unless it is the date its rule gives now),
      // and no date keeps the rule it had. Only a fixed row keeps a date; the others are worked out each time.
      const rows = input.items.map((i, n) => {
        const old = i.id ? before.find((b) => b.id === i.id) : undefined;
        const oldRule = old?.dueRule && old.dueRule !== "fixed" ? (old.dueRule as PlanDueRule) : null;
        const rule: PlanDueRule | null =
          i.dueRule !== undefined
            ? i.dueRule
            : i.dueOn
              ? oldRule && live.items.find((x) => x.id === old!.id)?.dueOn === i.dueOn
                ? oldRule
                : "fixed"
              : oldRule;
        if (rule === "fixed" && !i.dueOn) throw new DomainError(`Give “${i.label}” its date.`);
        const dueDays =
          rule === "on_ship_plus_days"
            ? (i.dueDays ?? old?.dueDays ?? reminders.balanceDays)
            : rule === "after_papers"
              ? (i.dueDays ?? old?.dueDays ?? 0)
              : null;
        return {
          id: i.id,
          label: i.label,
          amount: i.amount,
          dueOn: rule === "fixed" ? i.dueOn : null,
          dueRule: rule,
          dueDays,
          sortOrder: n,
        };
      });
      const describe = (rows: { label: string; amount: string; dueOn: string | null; dueRule: string | null; dueDays: number | null }[]) =>
        rows.map((r) => `${r.label} ${r.amount}${r.dueOn ? ` by ${r.dueOn}` : dueRuleWords(r) ? ` ${dueRuleWords(r)}` : ""}`).join("; ");
      const was = describe(
        before.map((b) => ({
          label: b.label,
          amount: b.amount.toFixed(2),
          dueOn: fromDbDateOrNull(b.dueOn),
          dueRule: b.dueRule,
          dueDays: b.dueDays,
        })),
      );
      const now = describe(rows.map((r) => ({ ...r, amount: fromMinor(toMinor(r.amount)) })));
      if (was === now) return;
      const paid = o.allocations.length > 0;
      const reason = paid
        ? requireReason(input.reason, "plan", "the payment plan changes after the customer has paid")
        : (input.reason ?? null);
      const keep = new Set(before.map((b) => b.id));
      await tx.invoice.deleteMany({
        where: { orderId, id: { notIn: rows.map((i) => i.id).filter((id): id is string => !!id && keep.has(id)) } },
      });
      for (const { id, ...r } of rows) {
        const row = {
          label: r.label,
          amount: r.amount,
          dueOn: toDbDateOrNull(r.dueOn),
          dueRule: r.dueRule,
          dueDays: r.dueDays,
          sortOrder: r.sortOrder,
        };
        if (id && keep.has(id)) await tx.invoice.update({ where: { id }, data: row });
        else await tx.invoice.create({ data: { ...row, orderId } });
      }
      await this.audit.record(tx, {
        userId: user.id,
        action: "payment_plan",
        entityType: "order",
        entityId: orderId,
        summary: `${o.refNo}: payment plan changed`,
        oldValues: { plan: was },
        newValues: { plan: now },
        reason,
      });
    });
  }

  /**
   * The factory's payment plan on this order: its parts in order (they add up
   * to what we owe it on the order's lines), each due when we order, on the
   * ready date (it moves with it) or on a fixed day.
   */
  async setFactoryPlan(user: SessionUser, orderId: string, input: FactoryPlanInput) {
    if (!can(user, "sourcing.manage")) throw new ForbiddenError("You cannot change what we pay the factories.");
    await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`select id from orders where id = ${orderId}::uuid for update`;
      const o = await this.orderFor(user, orderId, tx);
      if (o.status === "cancelled") throw new DomainError("This order is cancelled.");
      const f = await tx.party.findFirst({ where: { ...isSupplier, id: input.factoryId } });
      if (!f) throw new DomainError("Choose a factory of this order.");
      const lines = await tx.orderLine.findMany({
        where: { orderId, factoryId: f.id },
        include: { factory: { select: { id: true, name: true } } },
      });
      const owed = [...owedByFactory(lines).values()][0];
      if (!owed) throw new DomainError(`${f.name} has no lines with a price on this order.`);
      const sum = input.items.reduce((t, i) => t + toMinor(i.amount), 0);
      if (sum !== owed.owedMinor)
        throw new DomainError(
          `The parts add up to ${formatMinor(sum, owed.currency)}, but we owe ${f.name} ${formatMinor(owed.owedMinor, owed.currency)}. Make them match.`,
        );
      for (const i of input.items) if (i.dueRule === "fixed" && !i.dueOn) throw new DomainError(`Give “${i.label}” its date.`);
      const before = await tx.invoice.findMany({ where: { purchaseOrderId: orderId, supplierId: f.id }, orderBy: { sortOrder: "asc" } });
      await tx.invoice.deleteMany({ where: { purchaseOrderId: orderId, supplierId: f.id } });
      await tx.invoice.createMany({
        data: input.items.map((i, n) => ({
          purchaseOrderId: orderId,
          supplierId: f.id,
          label: i.label,
          percent: i.percent,
          amount: i.amount,
          currency: owed.currency,
          dueRule: i.dueRule,
          dueOn: i.dueRule === "fixed" ? toDbDateOrNull(i.dueOn) : null,
          sortOrder: n,
        })),
      });
      const describe = (rows: { label: string; amount: string; dueRule: string | null }[]) =>
        rows.map((r) => `${r.label} ${r.amount} (${r.dueRule})`).join("; ");
      await this.audit.record(tx, {
        userId: user.id,
        action: "payment_out_plan",
        entityType: "order",
        entityId: orderId,
        summary: `${o.refNo}: plan for paying ${f.name} set`,
        oldValues: { plan: describe(before.map((b) => ({ label: b.label, amount: b.amount.toFixed(2), dueRule: b.dueRule }))) },
        newValues: {
          plan: describe(input.items.map((i) => ({ label: i.label, amount: fromMinor(toMinor(i.amount)), dueRule: i.dueRule }))),
        },
      });
    });
  }

  /** What we still owe each factory across all orders that are not cancelled (people who see costs). */
  async payables(user: SessionUser, mine: boolean) {
    if (!can(user, "sourcing.manage")) throw new ForbiddenError("You cannot see factory costs.");
    // Only orders where a factory may still be owed (worked out in the database, the same rule), not every order ever.
    const s = await this.settings.get();
    const fx = fxOf(s, await this.limits.allows("expenses"));
    const owing = await ordersOwingFactories(this.prisma, fx);
    const orders = await this.prisma.db.order.findMany({
      where: { status: { not: "cancelled" }, id: { in: owing } },
      select: {
        id: true,
        refNo: true,
        stage: true,
        customer: { select: { name: true } },
        lines: linesWithFactory,
        supplierPaid: supplierPaidRelation,
        expenses: factoryBorneExpenses,
      },
      orderBy: { orderedOn: "asc" },
    });
    const byFactory = new Map<
      string,
      {
        factory: FactoryRow;
        currency: string;
        owedMinor: Minor;
        paidMinor: Minor;
        orders: {
          id: string;
          refNo: string;
          stage: string;
          customer: string;
          toPay: string;
          next: { label: string; due: string | null; open: string; status: string } | null;
        }[];
      }
    >();
    const today = this.clock.today();
    for (const o of orders) {
      const factoryOf = new Map(o.lines.flatMap((l) => (l.factory ? [[l.factory.id, l.factory] as const] : [])));
      // What we owe each factory here, less what we paid and what it bears: factoryPosition, as on the order.
      for (const f of factoryPositionOf(o, fx).filter((r) => r.lines > 0)) {
        // Only orders with something still to pay count, so "paid X of Y" is about those.
        if (f.toPayMinor <= 0) continue;
        const factory = factoryOf.get(f.factoryId)!;
        const row = byFactory.get(f.key) ?? { factory, currency: f.currency, owedMinor: 0, paidMinor: 0, orders: [] };
        row.owedMinor += f.owedMinor;
        row.paidMinor += f.settledMinor;
        // The next part of its payment plan (advance, balance on the ready date…): when it is due.
        const plan = (await factoryPlansOf(this.prisma.db, o.id, s.sales.factoryAdvancePercent, today, s.reminders.dueSoonDays, fx)).find(
          (p) => `${p.factory.id}:${p.currency}` === f.key,
        );
        row.orders.push({
          id: o.id,
          refNo: o.refNo,
          stage: o.stage,
          customer: o.customer.name,
          toPay: fromMinor(f.toPayMinor),
          next: plan?.next ?? null,
        });
        byFactory.set(f.key, row);
      }
    }
    return [...byFactory.values()]
      .filter((r) => r.orders.length && (!mine || r.factory.owner?.id === user.id))
      .map((r) => ({
        factory: { id: r.factory.id, name: r.factory.name },
        lookedAfterBy: r.factory.owner,
        currency: r.currency,
        owed: fromMinor(r.owedMinor),
        paid: fromMinor(r.paidMinor),
        toPay: fromMinor(r.orders.reduce((t, o) => t + toMinor(o.toPay), 0)),
        orders: r.orders,
      }))
      .sort((a, b) => Number(b.toPay) - Number(a.toPay));
  }
}
