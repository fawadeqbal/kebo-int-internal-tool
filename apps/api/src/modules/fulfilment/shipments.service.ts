import { Injectable } from "@nestjs/common";
import { fromDbDate, fromDbDateOrNull, nextReference, toDbDate, toDbDateOrNull } from "@kebo/database";
import { can, type ShipmentInput } from "@kebo/shared";
import { DomainError, ForbiddenError, NotFoundError, type ISODate } from "@kebo/utils";
import { PrismaService, type Tx } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { Clock } from "../../common/time/clock.service";
import { EventBus, type DomainEvent } from "../../common/events/event-bus";
import type { SessionUser } from "../../common/auth/session-user";
import { SettingsService } from "../settings/settings.service";
import { OrdersService } from "../orders/orders.service";
import { companySnapshot, customerSnapshot } from "../quotations/quotations.service";

const q2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Shipments (SH-2026-0001) and their packing lists. An order can ship in parts:
 * a line can never be packed beyond what is still unshipped. When the last
 * goods leave, "Shipped" is done (inspection, and the balance under
 * before-shipment terms, must be settled first); handing over the original
 * documents of the last shipment does "Documents released" (balance first).
 */
@Injectable()
export class ShipmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly events: EventBus,
    private readonly settings: SettingsService,
    private readonly orders: OrdersService,
  ) {}

  private assertCan(user: SessionUser) {
    if (!can(user.role, "shipments.manage")) throw new ForbiddenError("You cannot manage shipments.");
  }

  /** Each goods line: ordered, already packed on other shipments, and what is left. */
  async remaining(tx: Tx | PrismaService["db"], orderId: string, exceptShipmentId?: string) {
    const lines = await tx.orderLine.findMany({
      where: { orderId, type: "goods" },
      include: { shipmentLines: { where: exceptShipmentId ? { shipmentId: { not: exceptShipmentId } } : {} } },
      orderBy: { sortOrder: "asc" },
    });
    return lines.map((l) => {
      const packed = q2(l.shipmentLines.reduce((s, x) => s + Number(x.quantity), 0));
      return { line: l, ordered: Number(l.quantity), packed, left: q2(Number(l.quantity) - packed) };
    });
  }

  async forOrder(user: SessionUser, orderId: string) {
    await this.orders.load(user, orderId);
    const [shipments, remaining] = await Promise.all([
      this.prisma.db.shipment.findMany({ where: { orderId }, include: { lines: { orderBy: { sortOrder: "asc" } }, invoices: { select: { id: true, number: true, status: true } } }, orderBy: { createdAt: "asc" } }),
      this.remaining(this.prisma.db, orderId),
    ]);
    return {
      remaining: remaining.map((r) => ({ orderLineId: r.line.id, description: r.line.description, unit: r.line.unit, ordered: r.ordered, packed: r.packed, left: r.left })),
      shipments: shipments.map((s) => this.view(s)),
    };
  }

  private view(s: Awaited<ReturnType<PrismaService["db"]["shipment"]["findFirstOrThrow"]>> & { lines: { quantity: { toString(): string }; netWeightKg: { toString(): string }; grossWeightKg: { toString(): string }; cbm: { toString(): string }; packages: number }[] }) {
    const totals = s.lines.reduce(
      (t, l) => ({ packages: t.packages + l.packages, netKg: q2(t.netKg + Number(l.netWeightKg)), grossKg: q2(t.grossKg + Number(l.grossWeightKg)), cbm: Math.round((t.cbm + Number(l.cbm)) * 1000) / 1000 }),
      { packages: 0, netKg: 0, grossKg: 0, cbm: 0 },
    );
    return { ...s, etd: fromDbDateOrNull(s.etd), eta: fromDbDateOrNull(s.eta), departedOn: fromDbDateOrNull(s.departedOn), documentsReleasedOn: fromDbDateOrNull(s.documentsReleasedOn), totals };
  }

  /** What is left to ship, as the starting packing list. */
  async draft(user: SessionUser, orderId: string) {
    await this.orders.load(user, orderId);
    const left = (await this.remaining(this.prisma.db, orderId)).filter((r) => r.left > 0);
    return { lines: left.map((r) => ({ orderLineId: r.line.id, description: r.line.description, quantity: r.left, packages: 1, packageType: "Carton", netWeightKg: 0, grossWeightKg: 0, cbm: 0 })) };
  }

  private async lineRows(tx: Tx, orderId: string, input: ShipmentInput, exceptShipmentId?: string) {
    const remaining = await this.remaining(tx, orderId, exceptShipmentId);
    return input.lines.map((l, i) => {
      const r = remaining.find((x) => x.line.id === l.orderLineId);
      if (!r) throw new DomainError("Only goods lines of this order can be packed. Reload and try again.");
      if (l.quantity > r.left + 1e-9) throw new DomainError(`"${r.line.description.split("\n")[0]}": only ${r.left} ${r.line.unit} left to ship.`);
      return {
        orderLineId: r.line.id,
        description: r.line.description,
        model: r.line.model,
        hsCode: r.line.hsCode,
        quantity: l.quantity,
        unit: r.line.unit,
        packages: l.packages,
        packageType: l.packageType,
        netWeightKg: l.netWeightKg,
        grossWeightKg: l.grossWeightKg,
        cbm: l.cbm,
        sortOrder: i,
      };
    });
  }

  private header(input: ShipmentInput) {
    return {
      forwarder: input.forwarder,
      portOfLoading: input.portOfLoading,
      portOfDischarge: input.portOfDischarge,
      finalDestination: input.finalDestination,
      transport: input.transport,
      containerNos: input.containerNos,
      sealNos: input.sealNos,
      blNo: input.blNo,
      etd: toDbDateOrNull(input.etd),
      eta: toDbDateOrNull(input.eta),
      marks: input.marks,
      notes: input.notes,
    };
  }

  async create(user: SessionUser, orderId: string, input: ShipmentInput) {
    this.assertCan(user);
    const id = await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`select id from orders where id = ${orderId}::uuid for update`;
      const o = await this.orders.load(user, orderId, tx);
      if (o.status === "cancelled") throw new DomainError("This order is cancelled.");
      const lines = await this.lineRows(tx, orderId, input);
      const inquiry = await tx.inquiry.findUniqueOrThrow({ where: { id: o.inquiryId } });
      const s = await tx.shipment.create({
        data: {
          ...this.header(input),
          refNo: await nextReference(tx, "shipment", Number(this.clock.today().slice(0, 4))),
          orderId,
          customerSnapshot: await customerSnapshot(tx, o.customerId, inquiry.contactId),
          companySnapshot: companySnapshot(await this.settings.get()),
          createdById: user.id,
          lines: { create: lines },
        },
      });
      await this.audit.record(tx, { userId: user.id, action: "create", entityType: "shipment", entityId: s.id, summary: `${o.refNo}: shipment ${s.refNo} (${lines.length} lines)` });
      return s.id;
    });
    return this.one(user, id);
  }

  private async find(user: SessionUser, id: string, tx: Tx | PrismaService["db"] = this.prisma.db) {
    const s = await tx.shipment.findUnique({ where: { id }, include: { lines: { orderBy: { sortOrder: "asc" } }, invoices: { select: { id: true, number: true, status: true } } } });
    if (!s) throw new NotFoundError("Shipment");
    const order = await this.orders.load(user, s.orderId, tx);
    return { s, order };
  }

  async one(user: SessionUser, id: string) {
    const { s, order } = await this.find(user, id);
    return { ...this.view(s), order: { id: order.id, refNo: order.refNo, incoterm: order.incoterm, incotermPlace: order.incotermPlace } };
  }

  /** Details can be filled in as they become known; packed quantities only until the goods leave. */
  async update(user: SessionUser, id: string, input: ShipmentInput) {
    this.assertCan(user);
    await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`select id from shipments where id = ${id}::uuid for update`;
      const { s, order } = await this.find(user, id, tx);
      await tx.shipment.update({ where: { id }, data: this.header(input) });
      if (s.status === "planned" || s.status === "booked") {
        const lines = await this.lineRows(tx, s.orderId, input, id);
        await tx.shipmentLine.deleteMany({ where: { shipmentId: id } });
        await tx.shipmentLine.createMany({ data: lines.map((l) => ({ ...l, shipmentId: id })) });
      }
      await this.audit.record(tx, { userId: user.id, action: "update", entityType: "shipment", entityId: id, summary: `${order.refNo}: shipment ${s.refNo} updated` });
    });
    return this.one(user, id);
  }

  async setStatus(user: SessionUser, id: string, to: "booked" | "departed" | "arrived", on: ISODate | null, note: string | null) {
    this.assertCan(user);
    const day = on ?? this.clock.today();
    if (day > this.clock.today()) throw new DomainError("The date cannot be in the future.");
    const events = await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`select id from orders where id = (select order_id from shipments where id = ${id}::uuid) for update`;
      const { s, order } = await this.find(user, id, tx);
      const order_ = ["planned", "booked", "departed", "arrived"];
      if (order_.indexOf(to) <= order_.indexOf(s.status)) throw new DomainError(`This shipment is already ${s.status}.`);
      if (to === "departed" && s.lines.length === 0) throw new DomainError("Pack at least one line before the goods leave.");
      await tx.shipment.update({ where: { id }, data: { status: to, ...(to === "departed" ? { departedOn: toDbDate(day) } : {}) } });
      await this.audit.record(tx, { userId: user.id, action: "status_change", entityType: "shipment", entityId: id, summary: `${order.refNo}: shipment ${s.refNo} ${to}${note ? ` — ${note}` : ""}` });
      if (to !== "departed") return [];
      // Shipped when nothing is left unpacked and every shipment holding goods has left.
      const left = (await this.remaining(tx, s.orderId)).some((r) => r.left > 0);
      const waiting = await tx.shipment.count({ where: { orderId: s.orderId, id: { not: id }, status: { in: ["planned", "booked"] } } });
      if (left || waiting) return [];
      const e = await this.orders.stepInTx(tx, user, s.orderId, { action: "done", key: "shipped", on: day, note: note ?? (s.blNo ? `B/L ${s.blNo}` : null) }, { ifTodo: true });
      return e ? ([e] as DomainEvent[]) : [];
    });
    await this.events.publish(...events);
    return this.one(user, id);
  }

  /** Original B/L (or other documents of title) handed to the customer. */
  async releaseDocuments(user: SessionUser, id: string, on: ISODate | null, note: string | null) {
    this.assertCan(user);
    const day = on ?? this.clock.today();
    const events = await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`select id from orders where id = (select order_id from shipments where id = ${id}::uuid) for update`;
      const { s, order } = await this.find(user, id, tx);
      if (s.status === "planned" || s.status === "booked") throw new DomainError("The goods have not left yet.");
      await tx.shipment.update({ where: { id }, data: { documentsReleasedOn: toDbDate(day) } });
      await this.audit.record(tx, { userId: user.id, action: "documents_released", entityType: "shipment", entityId: id, summary: `${order.refNo}: documents for ${s.refNo} released${note ? ` — ${note}` : ""}` });
      const pending = await tx.shipment.count({ where: { orderId: s.orderId, id: { not: id }, documentsReleasedOn: null } });
      if (pending) return [];
      // Gate: balance first (except letter of credit). Without a manager's written override this throws and nothing is saved.
      const e = await this.orders.stepInTx(tx, user, s.orderId, { action: "done", key: "documents_released", on: day, note }, { ifTodo: true });
      return e ? ([e] as DomainEvent[]) : [];
    });
    await this.events.publish(...events);
    return this.one(user, id);
  }

  /** Days helper for invoices: the date a shipment left (if it has). */
  departed(s: { departedOn: Date | null }) {
    return s.departedOn ? fromDbDate(s.departedOn) : null;
  }
}
