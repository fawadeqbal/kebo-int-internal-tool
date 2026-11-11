import { Injectable } from "@nestjs/common";
import { decimalToMinor, livePurchase, toDbDate } from "@kebo/database";
import { fromMinor, fxRate } from "@kebo/money";
import { can, type CancelOrderInput } from "@kebo/shared";
import { DomainError, ForbiddenError } from "@kebo/utils";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { Clock } from "../../common/time/clock.service";
import type { SessionUser } from "../../common/auth/session-user";
import { EventBus } from "../../common/events/event-bus";
import { LimitsService } from "../../common/company/limits.service";
import { SettingsService } from "../settings/settings.service";
import { StagesService } from "../inquiries/stages.service";
import { LedgerPosting, type LedgerRef } from "../ledger/posting.service";
import { OrdersService } from "../orders/orders.service";
import { checkAccount, fromCredit, refund, releaseOrder } from "../treasury/api";

/**
 * Cancelling an order, as its own command (step 5): the order (Sales) and its money (Treasury) change together,
 * so neither module needs the other's writer. Orders asks nobody; Treasury reads orders; this asks both.
 */
@Injectable()
export class CancelOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly settings: SettingsService,
    private readonly events: EventBus,
    private readonly stages: StagesService,
    private readonly limits: LimitsService,
    private readonly ledger: LedgerPosting,
    private readonly orders: OrdersService,
  ) {}

  /**
   * The customer called it off. The accepted revision becomes "void" and the
   * deal "lost" (customer cancelled); it can be reopened and quoted again.
   * Money already received is released from the order (its payments crossed out,
   * the transfers stand); what happens to it is said: kept as the customer's
   * credit (the default), refunded (now, or later from the credit), or kept as a
   * cancellation fee. Money paid to the factory
   * is a refund expected from the factory (the default) or a loss on the order
   * (an expense, borne by us).
   */
  async cancel(user: SessionUser, id: string, reason: string, money: Partial<CancelOrderInput> = {}) {
    if (!can(user, "orders.manage")) throw new ForbiddenError("Only a manager can cancel an order.");
    const today = this.clock.today();
    if (money.refundOn && money.refundOn > today) throw new DomainError("The refund date cannot be in the future.");
    const cashBook = await this.limits.allows("cash_book");
    const { sales } = await this.settings.get();
    const events = await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`select id from orders where id = ${id}::uuid for update`;
      const o = await this.orders.load(user, id, tx);
      if (o.status === "cancelled") throw new DomainError("This order is already cancelled.");
      // Money in from the customer (in the order's currency), and money out to the factories (per factory and currency).
      const inMinor = o.allocations.reduce((t, p) => t + decimalToMinor(p.amount), 0);
      const factoryPaid = (
        await tx.allocation.findMany({
          where: { purchaseOrderId: id, ...livePurchase },
          include: { movement: { include: { party: { select: { id: true, name: true } } } } },
        })
      ).map((a) => ({ factoryId: a.movement.partyId!, factory: a.movement.party!, currency: a.movement.currency, amount: a.share }));
      const customerMoney = inMinor > 0 ? (money.customerMoney ?? "credit") : null;
      const factoryMoney = factoryPaid.length ? (money.factoryMoney ?? "refund_due") : null;
      const posted: LedgerRef[] = [{ type: "order_all", id }];
      if (customerMoney) {
        // What paid the order is released: the customer's credit again, then kept as a fee or paid back from it.
        await tx.$queryRaw`select id from parties where id = ${o.customerId}::uuid for update`;
        const released = await releaseOrder(tx, id, `${o.refNo} cancelled`);
        const from = {
          partyId: o.customerId,
          currency: o.currency,
          amountMinor: released.minor,
          recordedById: user.id,
          prefer: released.movementIds,
          orderId: id,
        };
        if (customerMoney === "fee")
          for (const f of await fromCredit(tx, { ...from, target: "fee", on: today, note: `Cancellation fee on ${o.refNo}` }))
            posted.push({ type: "allocation", id: f });
        if (customerMoney === "refund" && money.refundNow)
          posted.push({
            type: "movement",
            id: await refund(tx, {
              ...from,
              accountId: await checkAccount(tx, money.refundAccountId, o.currency, null, cashBook),
              on: money.refundOn ?? today,
              note: `Refund for cancelled ${o.refNo}`,
            }),
          });
      }
      if (factoryMoney === "loss") {
        // One expense per factory and currency, borne by us (no account: the money already left with the factory payment).
        const byKey = new Map<string, { factory: { id: string; name: string }; currency: string; minor: number }>();
        for (const p of factoryPaid) {
          const k = `${p.factoryId}:${p.currency}`;
          const cur = byKey.get(k) ?? { factory: p.factory, currency: p.currency, minor: 0 };
          cur.minor += decimalToMinor(p.amount);
          byKey.set(k, cur);
        }
        for (const x of byKey.values()) {
          const rate = fxRate(x.currency, sales.currency, sales.currency, sales.exchangeRates);
          if (rate === null)
            throw new DomainError(`There is no exchange rate for ${x.currency} in Settings: add it before recording the loss.`);
          await tx.expense.create({
            data: {
              orderId: id,
              customerId: o.customerId,
              inquiryId: o.inquiryId,
              factoryId: x.factory.id,
              category: "other",
              step: "factory",
              borneBy: "us",
              description: `Paid to ${x.factory.name}, lost when ${o.refNo} was cancelled`.slice(0, 200),
              amount: fromMinor(x.minor),
              currency: x.currency,
              rate,
              spentOn: toDbDate(today),
              recordedById: user.id,
            },
          });
        }
      }
      await tx.order.update({ where: { id }, data: { status: "cancelled" } });
      // Why and how: its own row (order_cancellations), written only here.
      await tx.orderCancellation.create({ data: { orderId: id, reason, customerMoney, factoryMoney } });
      await tx.quotationRevision.update({ where: { id: o.revisionId }, data: { status: "void" } });
      await this.audit.record(tx, {
        userId: user.id,
        action: "cancel",
        entityType: "order",
        entityId: id,
        summary: `Cancelled order ${o.refNo}${customerMoney ? ` · ${o.currency} ${fromMinor(inMinor)} received: ${customerMoney === "credit" ? "kept as credit" : customerMoney === "fee" ? "kept as a fee" : money.refundNow ? "refunded" : "to refund"}` : ""}${factoryMoney ? ` · paid to the factory: ${factoryMoney === "loss" ? "a loss" : "refund expected"}` : ""}`,
        reason,
        oldValues: { status: o.status },
        newValues: { status: "cancelled", customerMoney, factoryMoney },
      });
      // The ledger: the order and its factories' parts reversed; the money in kept as credit, refunded or a fee.
      await this.ledger.post(tx, posted, { userId: user.id, reason });
      const inquiry = await tx.inquiry.findUniqueOrThrow({ where: { id: o.inquiryId } });
      const moved = await this.stages.after(tx, inquiry, "order_cancelled", user.id);
      return moved ? [moved] : [];
    });
    await this.events.publish(...events);
    return this.orders.get(user, id);
  }
}
