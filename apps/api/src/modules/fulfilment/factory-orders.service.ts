import { Injectable } from "@nestjs/common";
import { decimalToMinor, fromDbDate, fromDbDateOrNull, nextReference, toDbDate, toDbDateOrNull } from "@kebo/database";
import { documentTotals, fromMinor, settle, splitDeposit } from "@kebo/money";
import { can, type FactoryOrderInput } from "@kebo/shared";
import { DomainError, ForbiddenError, NotFoundError, type ISODate } from "@kebo/utils";
import { PrismaService, type Tx } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { Clock } from "../../common/time/clock.service";
import { EventBus, type DomainEvent } from "../../common/events/event-bus";
import type { SessionUser } from "../../common/auth/session-user";
import { OrdersService } from "../orders/orders.service";

/**
 * Kebo's purchase orders to factories (PO-2026-0001), back-to-back with the
 * customer order: each line points at the order line it supplies. Sending the
 * first one ticks "Factory order placed"; the factory confirming its ready date
 * ticks "Ready date confirmed" and feeds the due dates of the later steps.
 */
@Injectable()
export class FactoryOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly events: EventBus,
    private readonly orders: OrdersService,
  ) {}

  private assertCan(user: SessionUser) {
    if (!can(user.role, "factoryOrders.manage")) throw new ForbiddenError("You cannot place factory orders.");
  }

  /** Payments against a factory order, settled against its total and deposit. */
  private position(fo: { total: { toString(): string }; depositPercent: { toString(): string }; payments: { amount: { toString(): string }; bankCharges: { toString(): string }; voidedAt: Date | null }[] }) {
    const live = fo.payments.filter((p) => !p.voidedAt);
    return settle(decimalToMinor(fo.total), live.map((p) => ({ amountMinor: decimalToMinor(p.amount), bankChargesMinor: decimalToMinor(p.bankCharges) })), Number(fo.depositPercent));
  }

  async forOrder(user: SessionUser, orderId: string) {
    await this.orders.load(user, orderId);
    const rows = await this.prisma.db.factoryOrder.findMany({
      where: { orderId },
      include: { factory: { select: { id: true, name: true } }, lines: { orderBy: { sortOrder: "asc" } }, payments: { orderBy: { paidOn: "asc" } } },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((fo) => {
      const pos = this.position(fo);
      return {
        id: fo.id,
        refNo: fo.refNo,
        status: fo.status,
        factory: fo.factory,
        currency: fo.currency,
        pricesIncludeVat: fo.pricesIncludeVat,
        total: fo.total.toFixed(2),
        depositPercent: Number(fo.depositPercent),
        deposit: fromMinor(splitDeposit(decimalToMinor(fo.total), Number(fo.depositPercent)).deposit),
        paid: fromMinor(pos.settledMinor),
        outstanding: fromMinor(pos.outstandingMinor),
        paymentStatus: pos.status,
        paymentTerms: fo.paymentTerms,
        readyOn: fromDbDateOrNull(fo.readyOn),
        sentOn: fromDbDateOrNull(fo.sentOn),
        confirmedOn: fromDbDateOrNull(fo.confirmedOn),
        vatInvoiceNo: fo.vatInvoiceNo,
        vatInvoiceOn: fromDbDateOrNull(fo.vatInvoiceOn),
        notes: fo.notes,
        lines: fo.lines.map((l) => ({ ...l, quantity: l.quantity.toString(), unitPrice: l.unitPrice.toFixed(2), lineTotal: l.lineTotal.toFixed(2), vatRate: Number(l.vatRate) })),
        payments: fo.payments.map((p) => ({ id: p.id, kind: p.kind, amount: p.amount.toFixed(2), bankCharges: p.bankCharges.toFixed(2), paidOn: fromDbDate(p.paidOn), reference: p.reference, voided: !!p.voidedAt })),
      };
    });
  }

  /**
   * Starting values: the order's goods lines grouped by the factory whose price
   * they were quoted from, at that factory's price and currency.
   */
  async drafts(user: SessionUser, orderId: string) {
    const o = await this.orders.load(user, orderId);
    const lines = await this.prisma.db.orderLine.findMany({
      where: { orderId: o.id, type: "goods" },
      include: { quoteLine: { include: { factoryQuoteLine: { include: { factoryQuote: { include: { factory: true } } } } } } },
      orderBy: { sortOrder: "asc" },
    });
    const byFactory = new Map<string, { factory: { id: string; name: string }; currency: string; pricesIncludeVat: boolean; lines: FactoryOrderInput["lines"] }>();
    const unsourced: { orderLineId: string; description: string }[] = [];
    for (const l of lines) {
      const fql = l.quoteLine?.factoryQuoteLine;
      if (!fql) {
        unsourced.push({ orderLineId: l.id, description: l.description });
        continue;
      }
      const f = fql.factoryQuote.factory;
      const group = byFactory.get(f.id) ?? { factory: { id: f.id, name: f.name }, currency: fql.factoryQuote.currency, pricesIncludeVat: fql.factoryQuote.pricesIncludeVat, lines: [] };
      group.lines.push({
        orderLineId: l.id,
        factoryQuoteLineId: fql.id,
        description: l.description,
        model: l.model,
        quantity: Number(l.quantity),
        unit: l.unit,
        unitPrice: Number(fql.unitPrice),
        vatRate: Number(fql.vatRate),
      });
      byFactory.set(f.id, group);
    }
    return { groups: [...byFactory.values()], unsourced };
  }

  private async rows(tx: Tx, orderId: string, input: FactoryOrderInput) {
    const own = new Set((await tx.orderLine.findMany({ where: { orderId }, select: { id: true } })).map((l) => l.id));
    if (input.lines.some((l) => l.orderLineId && !own.has(l.orderLineId))) throw new DomainError("A line does not belong to this order. Reload and try again.");
    const totals = documentTotals(input.lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice })), 0);
    return {
      total: fromMinor(totals.total),
      lines: input.lines.map((l, i) => ({
        orderLineId: l.orderLineId,
        factoryQuoteLineId: l.factoryQuoteLineId,
        description: l.description,
        model: l.model,
        quantity: l.quantity,
        unit: l.unit,
        unitPrice: l.unitPrice,
        vatRate: l.vatRate,
        lineTotal: fromMinor(totals.lines[i].lineTotal),
        sortOrder: i,
      })),
    };
  }

  async create(user: SessionUser, orderId: string, input: FactoryOrderInput) {
    this.assertCan(user);
    const id = await this.prisma.tx(async (tx) => {
      const o = await this.orders.load(user, orderId, tx);
      if (o.status !== "open") throw new DomainError("This order is closed or cancelled.");
      const factory = await tx.factory.findFirst({ where: { id: input.factoryId, deletedAt: null } });
      if (!factory) throw new DomainError("That factory no longer exists.");
      const { total, lines } = await this.rows(tx, orderId, input);
      const fo = await tx.factoryOrder.create({
        data: {
          refNo: await nextReference(tx, "factoryOrder", Number(this.clock.today().slice(0, 4))),
          orderId,
          factoryId: factory.id,
          currency: input.currency,
          pricesIncludeVat: input.pricesIncludeVat,
          depositPercent: input.depositPercent,
          paymentTerms: input.paymentTerms,
          readyOn: toDbDateOrNull(input.readyOn),
          notes: input.notes,
          total,
          createdById: user.id,
          lines: { create: lines },
        },
      });
      await this.audit.record(tx, { userId: user.id, action: "create", entityType: "factory_order", entityId: fo.id, summary: `${o.refNo}: ${fo.refNo} to ${factory.name} (${input.currency} ${total})` });
      return fo.id;
    });
    return this.one(user, id);
  }

  private async find(user: SessionUser, id: string, tx: Tx | PrismaService["db"] = this.prisma.db) {
    const fo = await tx.factoryOrder.findUnique({ where: { id }, include: { factory: true } });
    if (!fo) throw new NotFoundError("Factory order");
    const order = await this.orders.load(user, fo.orderId, tx);
    return { fo, order };
  }

  async one(user: SessionUser, id: string) {
    const { fo } = await this.find(user, id);
    return (await this.forOrder(user, fo.orderId)).find((x) => x.id === id)!;
  }

  async update(user: SessionUser, id: string, input: FactoryOrderInput) {
    this.assertCan(user);
    await this.prisma.tx(async (tx) => {
      const { fo, order } = await this.find(user, id, tx);
      if (fo.status === "cancelled" || fo.status === "confirmed") throw new DomainError("A confirmed or cancelled factory order cannot be changed. Cancel it and place a new one.");
      const { total, lines } = await this.rows(tx, fo.orderId, input);
      await tx.factoryOrderLine.deleteMany({ where: { factoryOrderId: id } });
      await tx.factoryOrder.update({
        where: { id },
        data: { factoryId: input.factoryId, currency: input.currency, pricesIncludeVat: input.pricesIncludeVat, depositPercent: input.depositPercent, paymentTerms: input.paymentTerms, readyOn: toDbDateOrNull(input.readyOn), notes: input.notes, total, lines: { create: lines } },
      });
      await this.audit.record(tx, { userId: user.id, action: "update", entityType: "factory_order", entityId: id, summary: `${order.refNo}: ${fo.refNo} edited`, oldValues: { total: fo.total.toFixed(2) }, newValues: { total } });
    });
    return this.one(user, id);
  }

  /** Sent to the factory: the order's "Factory order placed" step is done. */
  async send(user: SessionUser, id: string, on: ISODate | null) {
    this.assertCan(user);
    const day = on ?? this.clock.today();
    const events = await this.prisma.tx(async (tx) => {
      const { fo, order } = await this.find(user, id, tx);
      if (fo.status !== "draft") throw new DomainError("This factory order was already sent.");
      await tx.factoryOrder.update({ where: { id }, data: { status: "sent", sentOn: toDbDate(day) } });
      await this.audit.record(tx, { userId: user.id, action: "status_change", entityType: "factory_order", entityId: id, summary: `${order.refNo}: ${fo.refNo} sent to ${fo.factory.name}` });
      const e = await this.orders.stepInTx(tx, user, fo.orderId, { action: "done", key: "factory_order", on: day, note: `${fo.refNo} sent to ${fo.factory.name}` }, { ifTodo: true });
      return e ? [e] : [];
    });
    await this.events.publish(...events);
    return this.one(user, id);
  }

  /**
   * The factory confirmed (with its ready date). The order's ready date is the
   * latest of its factories', and "Ready date confirmed" is done once every
   * live factory order is confirmed.
   */
  async confirm(user: SessionUser, id: string, readyOn: ISODate, on: ISODate | null) {
    this.assertCan(user);
    const day = on ?? this.clock.today();
    const events = await this.prisma.tx(async (tx) => {
      const { fo, order } = await this.find(user, id, tx);
      if (fo.status === "cancelled") throw new DomainError("This factory order is cancelled.");
      if (fo.status === "draft") throw new DomainError("Send the factory order before recording its confirmation.");
      await tx.factoryOrder.update({ where: { id }, data: { status: "confirmed", confirmedOn: toDbDate(day), readyOn: toDbDate(readyOn) } });
      const live = await tx.factoryOrder.findMany({ where: { orderId: fo.orderId, status: { not: "cancelled" } } });
      const latest = live.map((x) => (x.id === id ? readyOn : fromDbDateOrNull(x.readyOn))).filter((d): d is string => !!d).sort().at(-1) ?? readyOn;
      await tx.order.update({ where: { id: fo.orderId }, data: { readyOn: toDbDate(latest) } });
      await this.audit.record(tx, { userId: user.id, action: "status_change", entityType: "factory_order", entityId: id, summary: `${order.refNo}: ${fo.factory.name} confirmed ${fo.refNo}, ready ${readyOn}` });
      const allConfirmed = live.every((x) => x.id === id || x.status === "confirmed");
      if (!allConfirmed) return [];
      const e = await this.orders.stepInTx(tx, user, fo.orderId, { action: "done", key: "factory_confirmed", on: day, note: `Ready on ${latest}` }, { ifTodo: true });
      return e ? [e] : [];
    });
    await this.events.publish(...events);
    return this.one(user, id);
  }

  /** The factory's VAT invoice (fapiao) arrived; when every factory order has one, the step is done. */
  async vatInvoice(user: SessionUser, id: string, number: string, on: ISODate) {
    this.assertCan(user);
    const events = await this.prisma.tx(async (tx) => {
      const { fo, order } = await this.find(user, id, tx);
      await tx.factoryOrder.update({ where: { id }, data: { vatInvoiceNo: number, vatInvoiceOn: toDbDate(on) } });
      await this.audit.record(tx, { userId: user.id, action: "update", entityType: "factory_order", entityId: id, summary: `${order.refNo}: VAT invoice ${number} received for ${fo.refNo}` });
      const live = await tx.factoryOrder.findMany({ where: { orderId: fo.orderId, status: { not: "cancelled" } } });
      if (live.some((x) => x.id !== id && !x.vatInvoiceNo)) return [];
      const e = await this.orders.stepInTx(tx, user, fo.orderId, { action: "done", key: "factory_vat_invoice", on, note: number }, { ifTodo: true });
      return e ? [e] : [];
    });
    await this.events.publish(...events);
    return this.one(user, id);
  }

  async cancel(user: SessionUser, id: string, reason: string) {
    if (!can(user.role, "orders.manage")) throw new ForbiddenError("Only a manager can cancel a factory order.");
    await this.prisma.tx(async (tx) => {
      const { fo, order } = await this.find(user, id, tx);
      if (fo.status === "cancelled") throw new DomainError("Already cancelled.");
      await tx.factoryOrder.update({ where: { id }, data: { status: "cancelled", notes: [fo.notes, `Cancelled: ${reason}`].filter(Boolean).join("\n") } });
      await this.audit.record(tx, { userId: user.id, action: "cancel", entityType: "factory_order", entityId: id, summary: `${order.refNo}: ${fo.refNo} cancelled — ${reason}` });
    });
    return this.one(user, id);
  }

  /** Exposed for the payments service: the position of every live factory order of an order. */
  async positions(tx: Tx, orderId: string) {
    const rows = await tx.factoryOrder.findMany({ where: { orderId, status: { not: "cancelled" } }, include: { payments: true } });
    return rows.map((fo) => ({ id: fo.id, orderStatus: fo.status, currency: fo.currency, ...this.position(fo) }));
  }

  /** For callers outside this service. */
  eventsFor(list: DomainEvent[]) {
    return this.events.publish(...list);
  }
}
