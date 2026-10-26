import { Injectable } from "@nestjs/common";
import { decimalToMinor, fromDbDate, fromDbDateOrNull, nextReference, toDbDate, toDbDateOrNull } from "@kebo/database";
import { allocate, documentTotals, fromMinor, splitDeposit } from "@kebo/money";
import { can, type InvoiceInput } from "@kebo/shared";
import { addDays, DomainError, ForbiddenError, NotFoundError, type ISODate } from "@kebo/utils";
import { PrismaService, type Tx } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { Clock } from "../../common/time/clock.service";
import { EventBus, type DomainEvent } from "../../common/events/event-bus";
import type { SessionUser } from "../../common/auth/session-user";
import { SettingsService } from "../settings/settings.service";
import { OrdersService } from "../orders/orders.service";
import { companySnapshot, customerSnapshot } from "../quotations/quotations.service";

/**
 * Invoices for an order.
 * - Proforma (PI-…): the whole order with the deposit asked for; issuing it is
 *   the "Proforma invoice sent" step. It can be voided and issued again.
 * - Commercial (INV-…): bills the goods of one shipment (plus the order's service
 *   and charge lines on the first one), with its share of the order discount, so
 *   the commercial invoices of an order always add up to the order total. Once
 *   issued it is locked; a mistake is voided (with a reason) and issued again.
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly events: EventBus,
    private readonly settings: SettingsService,
    private readonly orders: OrdersService,
  ) {}

  private assertCan(user: SessionUser) {
    if (!can(user.role, "invoices.manage")) throw new ForbiddenError("Only accounts (managers) can make invoices.");
  }

  private view(i: Awaited<ReturnType<PrismaService["db"]["invoice"]["findFirstOrThrow"]>> & { lines: { quantity: { toString(): string }; unitPrice: { toFixed(n: number): string }; lineTotal: { toFixed(n: number): string } }[] }) {
    return {
      ...i,
      issueDate: fromDbDateOrNull(i.issueDate),
      dueDate: fromDbDateOrNull(i.dueDate),
      subtotal: i.subtotal.toFixed(2),
      discount: i.discount.toFixed(2),
      vatAmount: i.vatAmount.toFixed(2),
      total: i.total.toFixed(2),
      vatRate: Number(i.vatRate),
      depositPercent: i.depositPercent === null ? null : Number(i.depositPercent),
      deposit: i.depositPercent === null ? null : fromMinor(splitDeposit(decimalToMinor(i.total), Number(i.depositPercent)).deposit),
      lines: i.lines.map((l) => ({ ...l, quantity: l.quantity.toString(), unitPrice: l.unitPrice.toFixed(2), lineTotal: l.lineTotal.toFixed(2) })),
    };
  }

  async forOrder(user: SessionUser, orderId: string) {
    await this.orders.load(user, orderId);
    const rows = await this.prisma.db.invoice.findMany({ where: { orderId }, include: { lines: { orderBy: { sortOrder: "asc" } } }, orderBy: { createdAt: "asc" } });
    return rows.map((r) => this.view(r));
  }

  async one(user: SessionUser, id: string) {
    const inv = await this.prisma.db.invoice.findUnique({ where: { id }, include: { lines: { orderBy: { sortOrder: "asc" } }, order: { select: { id: true, refNo: true, incoterm: true, incotermPlace: true, balanceTerms: true } } } });
    if (!inv) throw new NotFoundError("Invoice");
    await this.orders.load(user, inv.orderId);
    return { ...this.view(inv), order: inv.order };
  }

  /** The lines and money for a new invoice (built, not yet saved). */
  private async build(tx: Tx, orderId: string, input: InvoiceInput) {
    const o = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: { orderBy: { sortOrder: "asc" } }, revision: true } });
    const vat = { rate: Number(o.revision.vatRate), pricesIncludeVat: o.revision.pricesIncludeVat };
    const orderDiscount = decimalToMinor(o.revision.discount);
    const orderSubtotal = o.lines.reduce((s, l) => s + decimalToMinor(l.lineTotal), 0);
    if (input.type === "proforma") {
      const t = documentTotals(o.lines.map((l) => ({ quantity: l.quantity.toString(), unitPrice: l.unitPrice.toString() })), fromMinor(orderDiscount), vat);
      return { o, vat, totals: t, depositPercent: o.depositPercent, lines: o.lines.map((l) => ({ orderLineId: l.id, type: l.type, description: l.description, model: l.model, hsCode: l.hsCode, quantity: l.quantity, unit: l.unit, unitPrice: l.unitPrice, lineTotal: l.lineTotal })) };
    }
    if (!input.shipmentId) throw new DomainError("Choose the shipment this invoice bills.");
    const s = await tx.shipment.findFirst({ where: { id: input.shipmentId, orderId }, include: { lines: true } });
    if (!s) throw new NotFoundError("Shipment");
    const live = await tx.invoice.findMany({ where: { orderId, type: "commercial", status: { not: "void" } }, include: { lines: true } });
    if (live.some((i) => i.shipmentId === s.id)) throw new DomainError("This shipment already has a commercial invoice. Void it first to issue a new one.");
    const firstInvoice = live.length === 0;
    const goods = s.lines.map((sl) => {
      const ol = o.lines.find((l) => l.id === sl.orderLineId)!;
      return { orderLineId: ol.id, type: ol.type, description: ol.description, model: ol.model, hsCode: ol.hsCode, quantity: sl.quantity.toString(), unit: ol.unit, unitPrice: ol.unitPrice.toString() };
    });
    const extras = firstInvoice
      ? o.lines.filter((l) => l.type !== "goods").map((l) => ({ orderLineId: l.id, type: l.type, description: l.description, model: l.model, hsCode: l.hsCode, quantity: l.quantity.toString(), unit: l.unit, unitPrice: l.unitPrice.toString() }))
      : [];
    const lines = [...goods, ...extras];
    const gross = documentTotals(lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice })), 0).subtotal;
    // The order discount, shared by amount; the invoice that completes the order takes what is left.
    const alreadyDiscounted = live.reduce((s, i) => s + decimalToMinor(i.discount), 0);
    const billedBefore = live.reduce((s, i) => s + decimalToMinor(i.subtotal), 0);
    const completes = billedBefore + gross >= orderSubtotal;
    const share = completes ? orderDiscount - alreadyDiscounted : allocate(orderDiscount, [gross, orderSubtotal - gross])[0];
    const totals = documentTotals(lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice })), fromMinor(Math.max(share, 0)), vat);
    return {
      o,
      vat,
      totals,
      depositPercent: null,
      shipment: s,
      lines: lines.map((l, i) => ({ ...l, lineTotal: fromMinor(totals.lines[i].lineTotal) })),
    };
  }

  async create(user: SessionUser, orderId: string, input: InvoiceInput) {
    this.assertCan(user);
    const id = await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`select id from orders where id = ${orderId}::uuid for update`;
      const order = await this.orders.load(user, orderId, tx);
      if (order.status === "cancelled") throw new DomainError("This order is cancelled.");
      if (input.type === "proforma" && (await tx.invoice.count({ where: { orderId, type: "proforma", status: { not: "void" } } }))) {
        throw new DomainError("This order already has a proforma invoice. Void it to issue a new one.");
      }
      const b = await this.build(tx, orderId, input);
      const inv = await tx.invoice.create({
        data: {
          type: input.type,
          orderId,
          shipmentId: input.type === "commercial" ? input.shipmentId : null,
          status: "draft",
          issueDate: toDbDateOrNull(input.issueDate),
          dueDate: toDbDateOrNull(input.dueDate),
          currency: order.currency,
          vatRate: b.vat.rate,
          pricesIncludeVat: b.vat.pricesIncludeVat,
          subtotal: fromMinor(b.totals.subtotal),
          discount: fromMinor(b.totals.discount),
          vatAmount: fromMinor(b.totals.vat),
          total: fromMinor(b.totals.total),
          depositPercent: b.depositPercent,
          notes: input.notes,
          createdById: user.id,
          lines: { create: b.lines.map((l, i) => ({ ...l, sortOrder: i })) },
        },
      });
      await this.audit.record(tx, { userId: user.id, action: "create", entityType: "invoice", entityId: inv.id, summary: `${order.refNo}: ${input.type} invoice drafted (${order.currency} ${inv.total.toFixed(2)})` });
      return inv.id;
    });
    return this.one(user, id);
  }

  /** When the balance on a commercial invoice is due, from the order's terms. */
  private async dueFor(balanceTerms: string, issue: ISODate, departed: ISODate | null): Promise<ISODate> {
    const plan = (await this.settings.get()).plan;
    if (balanceTerms === "before_shipment") return issue;
    const base = departed ?? issue;
    return addDays(base, balanceTerms === "after_arrival" ? plan.balanceAfterArrivalDays : plan.balanceAfterShipDays);
  }

  /** Numbered, dated and frozen. A proforma ticks "Proforma invoice sent". */
  async issue(user: SessionUser, id: string, on: ISODate | null) {
    this.assertCan(user);
    const events = await this.prisma.tx(async (tx) => {
      const inv = await tx.invoice.findUnique({ where: { id }, include: { shipment: true } });
      if (!inv) throw new NotFoundError("Invoice");
      await tx.$queryRaw`select id from orders where id = ${inv.orderId}::uuid for update`;
      const order = await this.orders.load(user, inv.orderId, tx);
      if (inv.status !== "draft") throw new DomainError("This invoice is already issued.");
      const issue = on ?? fromDbDateOrNull(inv.issueDate) ?? this.clock.today();
      if (issue > this.clock.today()) throw new DomainError("The issue date cannot be in the future.");
      const settings = await this.settings.get();
      const inquiry = await tx.inquiry.findUniqueOrThrow({ where: { id: order.inquiryId } });
      const due = fromDbDateOrNull(inv.dueDate) ?? (inv.type === "proforma" ? addDays(issue, settings.plan.depositDays) : await this.dueFor(order.balanceTerms, issue, inv.shipment?.departedOn ? fromDbDate(inv.shipment.departedOn) : null));
      const number = await nextReference(tx, inv.type === "proforma" ? "proformaInvoice" : "commercialInvoice", Number(issue.slice(0, 4)));
      await tx.invoice.update({
        where: { id },
        data: { status: "issued", number, issueDate: toDbDate(issue), dueDate: toDbDate(due), customerSnapshot: await customerSnapshot(tx, order.customerId, inquiry.contactId), companySnapshot: companySnapshot(settings) },
      });
      await this.audit.record(tx, { userId: user.id, action: "issue", entityType: "invoice", entityId: id, summary: `${order.refNo}: issued ${number} (${inv.currency} ${inv.total.toFixed(2)})` });
      if (inv.type !== "proforma") return [];
      const e = await this.orders.stepInTx(tx, user, inv.orderId, { action: "done", key: "proforma_sent", on: issue, note: number }, { ifTodo: true });
      return e ? ([e] as DomainEvent[]) : [];
    });
    await this.events.publish(...events);
    return this.one(user, id);
  }

  async update(user: SessionUser, id: string, input: Pick<InvoiceInput, "issueDate" | "dueDate" | "notes">) {
    this.assertCan(user);
    const inv = await this.one(user, id);
    if (inv.status !== "draft") throw new DomainError("An issued invoice is locked. Void it and issue a new one to correct it.");
    await this.prisma.db.invoice.update({ where: { id }, data: { issueDate: toDbDateOrNull(input.issueDate), dueDate: toDbDateOrNull(input.dueDate), notes: input.notes } });
    return this.one(user, id);
  }

  /** Drafts are deleted; issued invoices are voided with a reason (the number is never reused). */
  async void(user: SessionUser, id: string, reason: string) {
    if (!can(user.role, "orders.manage")) throw new ForbiddenError("Only a manager can void an invoice.");
    const inv = await this.one(user, id);
    await this.prisma.tx(async (tx) => {
      if (inv.status === "draft") await tx.invoice.delete({ where: { id } });
      else await tx.invoice.update({ where: { id }, data: { status: "void", voidReason: reason } });
      await this.audit.record(tx, { userId: user.id, action: inv.status === "draft" ? "delete" : "void", entityType: "invoice", entityId: id, summary: `${inv.order.refNo}: ${inv.number ?? "draft invoice"} ${inv.status === "draft" ? "deleted" : "voided"} — ${reason}` });
    });
    return { ok: true };
  }
}
