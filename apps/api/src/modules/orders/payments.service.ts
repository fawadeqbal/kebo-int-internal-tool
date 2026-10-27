import { Injectable } from "@nestjs/common";
import { decimalToMinor, fromDbDate, toDbDate } from "@kebo/database";
import { formatMinor, fromMinor, settle, toMinor } from "@kebo/money";
import { can, type EditPaymentInput, type PaymentInput } from "@kebo/shared";
import { DomainError, ForbiddenError, NotFoundError } from "@kebo/utils";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { Clock } from "../../common/time/clock.service";
import { EventBus } from "../../common/events/event-bus";
import type { SessionUser } from "../../common/auth/session-user";
import { OrdersService } from "./orders.service";
import { requireReason } from "../../common/audit/reason";

/**
 * Money in from the customer against an order, in the order's currency. The
 * order's money box (received, still due) is worked out from these. Recording a
 * payment never moves the order: the person presses the stage button.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly events: EventBus,
    private readonly orders: OrdersService,
  ) {}

  async forOrder(user: SessionUser, orderId: string) {
    const o = await this.orders.load(user, orderId);
    const all = await this.prisma.db.payment.findMany({ where: { orderId }, orderBy: [{ paidOn: "asc" }, { createdAt: "asc" }] });
    const live = all.filter((p) => !p.voidedAt && p.currency === o.currency);
    const position = settle(decimalToMinor(o.total), live.map((p) => ({ amountMinor: decimalToMinor(p.amount), bankChargesMinor: decimalToMinor(p.bankCharges) })), Number(o.depositPercent));
    // Who recorded each payment, and where the order stood after it (counted payments in date order).
    const people = new Map(
      (await this.prisma.db.user.findMany({ where: { id: { in: [...new Set(all.map((p) => p.recordedById))] } }, select: { id: true, name: true } })).map((u) => [u.id, u]),
    );
    const totalMinor = decimalToMinor(o.total);
    let runningMinor = 0;
    const after = new Map<string, { receivedMinor: number; dueMinor: number }>();
    for (const p of live) {
      runningMinor += decimalToMinor(p.amount) + decimalToMinor(p.bankCharges);
      after.set(p.id, { receivedMinor: runningMinor, dueMinor: Math.max(totalMinor - runningMinor, 0) });
    }
    return {
      currency: o.currency,
      total: fromMinor(position.dueMinor),
      received: fromMinor(position.settledMinor),
      due: fromMinor(position.outstandingMinor),
      depositDue: fromMinor(position.depositOutstandingMinor),
      status: position.status,
      payments: all.map((p) => ({
        id: p.id,
        kind: p.kind,
        amount: p.amount.toFixed(2),
        bankCharges: p.bankCharges.toFixed(2),
        currency: p.currency,
        paidOn: fromDbDate(p.paidOn),
        method: p.method,
        reference: p.reference,
        note: p.note,
        /** Amount plus bank charges: what it settles. */
        counts: fromMinor(decimalToMinor(p.amount) + decimalToMinor(p.bankCharges)),
        recordedBy: people.get(p.recordedById) ?? null,
        recordedAt: p.createdAt,
        /** Received so far and still due once this payment counted (null when removed or in another currency). */
        after: after.has(p.id) ? { received: fromMinor(after.get(p.id)!.receivedMinor), due: fromMinor(after.get(p.id)!.dueMinor) } : null,
        voided: p.voidedAt ? { at: p.voidedAt, reason: p.voidReason } : null,
      })),
    };
  }

  /** Money in from the customer, in the order's currency; never more than is still due. */
  async record(user: SessionUser, orderId: string, input: PaymentInput) {
    if (!can(user, "payments.record")) throw new ForbiddenError("Only accounts (managers) can record payments.");
    if (input.paidOn > this.clock.today()) throw new DomainError("The payment date cannot be in the future.");
    const event = await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`select id from orders where id = ${orderId}::uuid for update`;
      const o = await this.orders.load(user, orderId, tx);
      if (o.status === "cancelled") throw new DomainError("This order is cancelled.");
      if (input.currency !== o.currency) throw new DomainError(`This order is in ${o.currency}. Record the payment in ${o.currency} (convert it first if the customer paid in another currency).`);
      const before = settle(
        decimalToMinor(o.total),
        o.payments.filter((p) => p.currency === o.currency).map((p) => ({ amountMinor: decimalToMinor(p.amount), bankChargesMinor: decimalToMinor(p.bankCharges) })),
        Number(o.depositPercent),
      );
      if (toMinor(input.amount) + toMinor(input.bankCharges) > before.outstandingMinor) throw new DomainError(`That is more than is still due (${formatMinor(before.outstandingMinor, o.currency)}).`);
      await tx.payment.create({
        data: {
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
      await this.audit.record(tx, { userId: user.id, action: "payment_in", entityType: "order", entityId: orderId, summary: `${o.refNo}: received ${o.currency} ${input.amount}${toMinor(input.bankCharges) ? ` (+${input.bankCharges} bank charges)` : ""}, ${input.reference ?? "no reference"}` });
      return { type: "payment.recorded" as const, orderId, refNo: o.refNo, amount: `${o.currency} ${input.amount}`, actorId: user.id, notify: [o.inquiry.assigneeId].filter((v): v is string => !!v) };
    });
    await this.events.publish(event);
    return this.forOrder(user, orderId);
  }

  /** A payment typed wrong (amount, date, reference): changed with a reason, kept in the order's history. */
  async edit(user: SessionUser, paymentId: string, input: EditPaymentInput) {
    if (!can(user, "payments.record")) throw new ForbiddenError("Only accounts (managers) can change payments.");
    if (input.paidOn > this.clock.today()) throw new DomainError("The payment date cannot be in the future.");
    const p = await this.prisma.db.payment.findUnique({ where: { id: paymentId } });
    if (!p) throw new NotFoundError("Payment");
    if (p.voidedAt) throw new DomainError("This payment was removed.");
    const reason = requireReason(input.reason, "payment", "a recorded payment changes");
    await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`select id from orders where id = ${p.orderId}::uuid for update`;
      const o = await this.orders.load(user, p.orderId, tx);
      if (input.currency !== o.currency) throw new DomainError(`This order is in ${o.currency}. Record the payment in ${o.currency}.`);
      const others = settle(
        decimalToMinor(o.total),
        o.payments.filter((x) => x.id !== p.id && x.currency === o.currency).map((x) => ({ amountMinor: decimalToMinor(x.amount), bankChargesMinor: decimalToMinor(x.bankCharges) })),
        Number(o.depositPercent),
      );
      if (toMinor(input.amount) + toMinor(input.bankCharges) > others.outstandingMinor) throw new DomainError(`That is more than is still due (${formatMinor(others.outstandingMinor, o.currency)}).`);
      await tx.payment.update({ where: { id: p.id }, data: { kind: input.kind, amount: input.amount, bankCharges: input.bankCharges, paidOn: toDbDate(input.paidOn), method: input.method, reference: input.reference, note: input.note } });
      await this.audit.record(tx, {
        userId: user.id,
        action: "payment_edit",
        entityType: "order",
        entityId: o.id,
        summary: `${o.refNo}: changed a payment from the customer`,
        oldValues: { amount: p.amount.toFixed(2), bankCharges: p.bankCharges.toFixed(2), paidOn: fromDbDate(p.paidOn), reference: p.reference },
        newValues: { amount: fromMinor(toMinor(input.amount)), bankCharges: fromMinor(toMinor(input.bankCharges)), paidOn: input.paidOn, reference: input.reference },
        reason,
      });
    });
    return this.forOrder(user, p.orderId);
  }

  /** A payment recorded by mistake. It stays visible, crossed out. */
  async void(user: SessionUser, paymentId: string, reason: string) {
    if (!can(user, "orders.manage")) throw new ForbiddenError("Only a manager can remove a payment.");
    const p = await this.prisma.db.payment.findUnique({ where: { id: paymentId } });
    if (!p) throw new NotFoundError("Payment");
    const o = await this.orders.load(user, p.orderId);
    if (p.voidedAt) throw new DomainError("This payment was already removed.");
    await this.prisma.tx(async (tx) => {
      await tx.payment.update({ where: { id: paymentId }, data: { voidedAt: new Date(), voidReason: reason } });
      await this.audit.record(tx, { userId: user.id, action: "payment_void", entityType: "order", entityId: o.id, summary: `${o.refNo}: removed payment of ${p.currency} ${p.amount.toFixed(2)}`, reason });
    });
    return this.forOrder(user, o.id);
  }
}
