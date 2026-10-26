import { Injectable } from "@nestjs/common";
import { decimalToMinor, fromDbDate, toDbDate } from "@kebo/database";
import { formatMinor, fromMinor, settle, toMinor } from "@kebo/money";
import { can, type PaymentInput } from "@kebo/shared";
import { DomainError, ForbiddenError, NotFoundError } from "@kebo/utils";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { Clock } from "../../common/time/clock.service";
import { EventBus, type DomainEvent } from "../../common/events/event-bus";
import type { SessionUser } from "../../common/auth/session-user";
import { OrdersService } from "../orders/orders.service";
import { FactoryOrdersService } from "./factory-orders.service";

/**
 * Money in from the customer and out to factories, always against an order.
 * Recording a payment ticks its step in the same transaction (deposit, balance,
 * factory deposit, factory paid in full), so the same gates apply: a payment to
 * a factory before the customer's deposit is refused unless a manager writes why.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly events: EventBus,
    private readonly orders: OrdersService,
    private readonly factoryOrders: FactoryOrdersService,
  ) {}

  private assertCan(user: SessionUser) {
    if (!can(user.role, "payments.record")) throw new ForbiddenError("Only accounts (managers) can record payments.");
  }

  async forOrder(user: SessionUser, orderId: string) {
    const o = await this.orders.load(user, orderId);
    const all = await this.prisma.db.payment.findMany({ where: { orderId }, include: { factory: { select: { id: true, name: true } }, factoryOrder: { select: { id: true, refNo: true } } }, orderBy: [{ paidOn: "asc" }, { createdAt: "asc" }] });
    const customerIn = all.filter((p) => p.direction === "in" && !p.voidedAt && p.currency === o.currency);
    const position = settle(decimalToMinor(o.total), customerIn.map((p) => ({ amountMinor: decimalToMinor(p.amount), bankChargesMinor: decimalToMinor(p.bankCharges) })), Number(o.depositPercent));
    return {
      currency: o.currency,
      customer: {
        due: fromMinor(position.dueMinor),
        received: fromMinor(position.receivedMinor),
        bankCharges: fromMinor(position.bankChargesMinor),
        outstanding: fromMinor(position.outstandingMinor),
        depositOutstanding: fromMinor(position.depositOutstandingMinor),
        status: position.status,
      },
      payments: all.map((p) => ({
        id: p.id,
        direction: p.direction,
        kind: p.kind,
        amount: p.amount.toFixed(2),
        bankCharges: p.bankCharges.toFixed(2),
        currency: p.currency,
        paidOn: fromDbDate(p.paidOn),
        method: p.method,
        reference: p.reference,
        note: p.note,
        factory: p.factory,
        factoryOrder: p.factoryOrder,
        voided: p.voidedAt ? { at: p.voidedAt, reason: p.voidReason } : null,
      })),
    };
  }

  /** Money in from the customer, in the order's currency; never more than is still due. */
  async recordIn(user: SessionUser, orderId: string, input: PaymentInput) {
    this.assertCan(user);
    if (input.paidOn > this.clock.today()) throw new DomainError("The payment date cannot be in the future.");
    const events = await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`select id from orders where id = ${orderId}::uuid for update`;
      const o = await this.orders.load(user, orderId, tx);
      if (o.status === "cancelled") throw new DomainError("This order is cancelled.");
      if (input.currency !== o.currency) throw new DomainError(`This order is in ${o.currency}. Record the payment in ${o.currency} (convert it first if the customer paid in another currency).`);
      const before = settle(
        decimalToMinor(o.total),
        o.payments.filter((p) => p.direction === "in" && p.currency === o.currency).map((p) => ({ amountMinor: decimalToMinor(p.amount), bankChargesMinor: decimalToMinor(p.bankCharges) })),
        Number(o.depositPercent),
      );
      const settling = toMinor(input.amount) + toMinor(input.bankCharges);
      if (settling > before.outstandingMinor) throw new DomainError(`That is more than the balance due (${formatMinor(before.outstandingMinor, o.currency)}).`);
      const p = await tx.payment.create({
        data: {
          direction: "in",
          kind: input.kind,
          orderId,
          customerId: o.customerId,
          amount: input.amount,
          bankCharges: input.bankCharges,
          currency: input.currency,
          paidOn: toDbDate(input.paidOn),
          method: input.method,
          reference: input.reference,
          note: input.note,
          recordedById: user.id,
        },
      });
      const after = settle(before.dueMinor, [{ amountMinor: before.settledMinor + settling }], Number(o.depositPercent));
      await this.audit.record(tx, { userId: user.id, action: "payment_in", entityType: "order", entityId: orderId, summary: `${o.refNo}: received ${o.currency} ${input.amount}${toMinor(input.bankCharges) ? ` (+${input.bankCharges} bank charges)` : ""}, ${input.reference ?? "no reference"}` });
      const out: DomainEvent[] = [{ type: "payment.recorded", orderId, refNo: o.refNo, direction: "in", amount: `${o.currency} ${input.amount}`, actorId: user.id, notify: [o.inquiry.assigneeId].filter((v): v is string => !!v) }];
      const note = `Payment ${input.reference ?? p.id.slice(0, 8)}`;
      if (after.depositOutstandingMinor === 0 && Number(o.depositPercent) > 0) {
        const e = await this.orders.stepInTx(tx, user, orderId, { action: "done", key: "customer_deposit", on: input.paidOn, note }, { ifTodo: true });
        if (e) out.push(e);
      }
      if (after.status === "paid") {
        const e = await this.orders.stepInTx(tx, user, orderId, { action: "done", key: "customer_balance", on: input.paidOn, note }, { ifTodo: true });
        if (e) out.push(e);
      }
      return out;
    });
    await this.events.publish(...events);
    return this.forOrder(user, orderId);
  }

  /** Money out to a factory against one of its factory orders, in that order's currency. */
  async recordOut(user: SessionUser, orderId: string, input: PaymentInput) {
    this.assertCan(user);
    if (!input.factoryOrderId) throw new DomainError("Choose the factory order this payment is for.");
    if (input.paidOn > this.clock.today()) throw new DomainError("The payment date cannot be in the future.");
    const events = await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`select id from orders where id = ${orderId}::uuid for update`;
      const o = await this.orders.load(user, orderId, tx);
      const fo = await tx.factoryOrder.findFirst({ where: { id: input.factoryOrderId!, orderId }, include: { factory: true } });
      if (!fo) throw new NotFoundError("Factory order");
      if (fo.status === "cancelled") throw new DomainError("That factory order is cancelled.");
      if (fo.status === "draft") throw new DomainError("Send the factory order before paying it.");
      if (input.currency !== fo.currency) throw new DomainError(`${fo.refNo} is in ${fo.currency}. Record the payment in ${fo.currency}.`);
      const before = (await this.factoryOrders.positions(tx, orderId)).find((x) => x.id === fo.id)!;
      const amount = toMinor(input.amount) + toMinor(input.bankCharges);
      if (amount > before.outstandingMinor) throw new DomainError(`That is more than is still owed on ${fo.refNo} (${formatMinor(before.outstandingMinor, fo.currency)}).`);
      await tx.payment.create({
        data: {
          direction: "out",
          kind: input.kind,
          orderId,
          factoryId: fo.factoryId,
          factoryOrderId: fo.id,
          amount: input.amount,
          bankCharges: input.bankCharges,
          currency: input.currency,
          paidOn: toDbDate(input.paidOn),
          method: input.method,
          reference: input.reference,
          note: input.note,
          recordedById: user.id,
        },
      });
      await this.audit.record(tx, { userId: user.id, action: "payment_out", entityType: "order", entityId: orderId, summary: `${o.refNo}: paid ${fo.factory.name} ${fo.currency} ${input.amount} on ${fo.refNo}` });
      const out: DomainEvent[] = [{ type: "payment.recorded", orderId, refNo: o.refNo, direction: "out", amount: `${fo.currency} ${input.amount}`, actorId: user.id, notify: [] }];
      const positions = await this.factoryOrders.positions(tx, orderId);
      // The steps cover all factories of the order: done when every live factory order is covered.
      if (positions.every((x) => x.orderStatus !== "draft" && x.depositOutstandingMinor === 0)) {
        // Gate: the customer's deposit first. Without a manager's written override, this throws and nothing is saved.
        const e = await this.orders.stepInTx(tx, user, orderId, { action: "done", key: "factory_deposit", on: input.paidOn, note: input.note }, { ifTodo: true });
        if (e) out.push(e);
      }
      if (positions.every((x) => x.outstandingMinor === 0)) {
        const e = await this.orders.stepInTx(tx, user, orderId, { action: "done", key: "factory_balance", on: input.paidOn, note: input.note }, { ifTodo: true });
        if (e) out.push(e);
      }
      return out;
    });
    await this.events.publish(...events);
    return this.forOrder(user, orderId);
  }

  /** A payment recorded by mistake. It stays visible, crossed out; steps already ticked are left for a person to check. */
  async void(user: SessionUser, paymentId: string, reason: string) {
    if (!can(user.role, "orders.manage")) throw new ForbiddenError("Only a manager can remove a payment.");
    const p = await this.prisma.db.payment.findUnique({ where: { id: paymentId } });
    if (!p) throw new NotFoundError("Payment");
    const o = await this.orders.load(user, p.orderId);
    if (p.voidedAt) throw new DomainError("This payment was already removed.");
    await this.prisma.tx(async (tx) => {
      await tx.payment.update({ where: { id: paymentId }, data: { voidedAt: new Date(), voidReason: reason } });
      await this.audit.record(tx, { userId: user.id, action: "payment_void", entityType: "order", entityId: o.id, summary: `${o.refNo}: removed payment of ${p.currency} ${p.amount.toFixed(2)} — ${reason}` });
    });
    return this.forOrder(user, o.id);
  }
}
