import { Injectable } from "@nestjs/common";
import { decimalToMinor, fromDbDate, fromDbDateOrNull, nextReference, toDbDate, toDbDateOrNull, type Prisma } from "@kebo/database";
import { fromMinor, settle } from "@kebo/money";
import {
  can,
  checkMove,
  depositOf,
  dueOf,
  nextStage,
  orderNeeds,
  ORDER_STAGE_HINT,
  ORDER_STAGE_LABEL,
  previousStage,
  STAGE_BUTTON,
  type MoveStageInput,
  type OrderDetailsInput,
  type OrderFacts,
  type OrderStage,
} from "@kebo/shared";
import { dateIn, DomainError, ForbiddenError, GateError, NotFoundError, type ISODate } from "@kebo/utils";
import { PrismaService, type Tx } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { Clock } from "../../common/time/clock.service";
import type { SessionUser } from "../../common/auth/session-user";
import { SettingsService } from "../settings/settings.service";
import { EventBus, type DomainEvent } from "../../common/events/event-bus";
import { StagesService } from "../inquiries/stages.service";

/** Staff work on the deals they handle or created; managers see every deal. */
export function orderAccess(user: SessionUser): Prisma.OrderWhereInput {
  if (can(user.role, "inquiries.viewAll")) return {};
  return { inquiry: { OR: [{ assigneeId: user.id }, { createdById: user.id }] } };
}

const orderInclude = {
  payments: { where: { voidedAt: null, direction: "in" }, orderBy: { paidOn: "asc" } },
  customer: { select: { id: true, name: true, country: true } },
  inquiry: { select: { id: true, refNo: true, title: true, assigneeId: true, assignee: { select: { id: true, name: true } } } },
} satisfies Prisma.OrderInclude;

type OrderRow = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

/**
 * An order is Confirmed → In production → Shipped → Done, moved one button at
 * a time. Nothing blocks a move: a warning (no deposit yet, money still due)
 * asks the person to confirm, and every move is kept in the order's history.
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly settings: SettingsService,
    private readonly events: EventBus,
    private readonly stages: StagesService,
  ) {}

  /* ---------------------------------------------------------------- creating and cancelling */

  /** The order made when a revision is accepted (inside that transaction): the accepted lines frozen and the terms copied. */
  async createFromRevision(tx: Tx, revisionId: string, acceptedOn: ISODate, actorId: string) {
    const rev = await tx.quotationRevision.findUniqueOrThrow({ where: { id: revisionId }, include: { lines: { orderBy: { sortOrder: "asc" } }, quotation: { include: { inquiry: true } } } });
    const inquiry = rev.quotation.inquiry;
    const refNo = await nextReference(tx, "order", Number(this.clock.today().slice(0, 4)));
    const order = await tx.order.create({
      data: {
        refNo,
        inquiryId: inquiry.id,
        revisionId: rev.id,
        customerId: inquiry.customerId,
        orderedOn: toDbDate(acceptedOn),
        stage: "confirmed",
        currency: rev.currency,
        total: rev.total,
        depositPercent: rev.depositPercent,
        balanceTerms: rev.balanceTerms,
        incoterm: rev.incoterm,
        incotermPlace: rev.incotermPlace,
        createdById: actorId,
        lines: {
          create: rev.lines.map((l) => ({
            quoteLineId: l.id,
            type: l.type,
            description: l.description,
            model: l.model,
            hsCode: l.hsCode,
            quantity: l.quantity,
            unit: l.unit,
            unitPrice: l.unitPrice,
            lineTotal: l.lineTotal,
            unitCost: l.unitCost,
            sortOrder: l.sortOrder,
          })),
        },
        stageChanges: { create: { toStage: "confirmed", byId: actorId, note: `${rev.quotation.refNo} R${rev.number} accepted` } },
      },
    });
    await this.audit.record(tx, { userId: actorId, action: "create", entityType: "order", entityId: order.id, summary: `Order ${refNo} from ${rev.quotation.refNo} R${rev.number} (${rev.currency} ${rev.total.toString()})` });
    const event: DomainEvent = { type: "order.created", orderId: order.id, refNo, inquiryId: inquiry.id, actorId, notify: [inquiry.assigneeId, inquiry.createdById].filter((v): v is string => !!v) };
    return { order, event };
  }

  /**
   * The customer called it off. The accepted revision becomes "void" and the
   * deal "lost" (customer cancelled); it can be reopened and quoted again.
   * Money already received stays recorded on the order.
   */
  async cancel(user: SessionUser, id: string, reason: string) {
    if (!can(user.role, "orders.manage")) throw new ForbiddenError("Only a manager can cancel an order.");
    const events = await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`select id from orders where id = ${id}::uuid for update`;
      const o = await this.load(user, id, tx);
      if (o.status === "cancelled") throw new DomainError("This order is already cancelled.");
      await tx.order.update({ where: { id }, data: { status: "cancelled", cancelledAt: new Date(), cancelReason: reason } });
      await tx.quotationRevision.update({ where: { id: o.revisionId }, data: { status: "void" } });
      await this.audit.record(tx, { userId: user.id, action: "cancel", entityType: "order", entityId: id, summary: `Cancelled order ${o.refNo}: ${reason}` });
      const inquiry = await tx.inquiry.findUniqueOrThrow({ where: { id: o.inquiryId } });
      const moved = await this.stages.after(tx, inquiry, "order_cancelled", user.id);
      return moved ? [moved] : [];
    });
    await this.events.publish(...events);
    return this.get(user, id);
  }

  /* ---------------------------------------------------------------- reading */

  /** An order the person may see, or 404. */
  async load(user: SessionUser, id: string, db: PrismaService["db"] | Tx = this.prisma.db): Promise<OrderRow> {
    const o = await db.order.findFirst({ where: { id, ...orderAccess(user) }, include: orderInclude });
    if (!o) throw new NotFoundError("Order");
    return o;
  }

  /** Money in, in the order's currency (another currency must be converted first and is not mixed in). */
  private moneyOf(o: OrderRow) {
    const totalMinor = decimalToMinor(o.total);
    const ins = o.payments.filter((p) => p.currency === o.currency).map((p) => ({ amountMinor: decimalToMinor(p.amount), bankChargesMinor: decimalToMinor(p.bankCharges) }));
    const position = settle(totalMinor, ins, Number(o.depositPercent));
    return { totalMinor, receivedMinor: position.settledMinor, depositPercent: Number(o.depositPercent), currency: o.currency, balanceTerms: o.balanceTerms, position };
  }

  private facts(o: OrderRow): OrderFacts {
    const m = this.moneyOf(o);
    return {
      totalMinor: m.totalMinor,
      receivedMinor: m.receivedMinor,
      depositPercent: m.depositPercent,
      currency: o.currency,
      stage: o.stage,
      status: o.status,
      stageSince: dateIn(o.stageSince, this.clock.timeZone),
      readyOn: fromDbDateOrNull(o.readyOn),
      shippedOn: fromDbDateOrNull(o.shippedOn),
    };
  }

  /** The one button to show, or none (done or cancelled). */
  private nextOf(o: OrderRow) {
    const to = o.status === "cancelled" ? null : nextStage(o.stage);
    return to ? { to, label: STAGE_BUTTON[to], stage: ORDER_STAGE_LABEL[to], hint: ORDER_STAGE_HINT[to] } : null;
  }

  private async view(o: OrderRow) {
    const m = this.moneyOf(o);
    const days = (await this.settings.get()).reminders;
    const history = await this.prisma.db.orderStageChange.findMany({ where: { orderId: o.id }, orderBy: { at: "asc" }, include: { by: { select: { id: true, name: true } } } });
    const back = o.status === "cancelled" ? null : previousStage(o.stage);
    return {
      id: o.id,
      refNo: o.refNo,
      status: o.status,
      stage: o.stage,
      stageSince: dateIn(o.stageSince, this.clock.timeZone),
      inquiry: o.inquiry,
      customer: o.customer,
      orderedOn: fromDbDate(o.orderedOn),
      shipBy: fromDbDateOrNull(o.shipBy),
      readyOn: fromDbDateOrNull(o.readyOn),
      shippedOn: fromDbDateOrNull(o.shippedOn),
      blNo: o.blNo,
      currency: o.currency,
      total: o.total.toFixed(2),
      depositPercent: m.depositPercent,
      balanceTerms: o.balanceTerms,
      incoterm: o.incoterm,
      incotermPlace: o.incotermPlace,
      money: {
        total: fromMinor(m.totalMinor),
        deposit: fromMinor(depositOf(m)),
        received: fromMinor(m.receivedMinor),
        bankCharges: fromMinor(m.position.bankChargesMinor),
        due: fromMinor(dueOf(m)),
        depositDue: fromMinor(m.position.depositOutstandingMinor),
        status: m.position.status,
      },
      next: this.nextOf(o),
      back: back ? { to: back, label: `Back to ${ORDER_STAGE_LABEL[back]}` } : null,
      needs: orderNeeds(this.facts(o), this.clock.today(), days),
      history: history.map((h) => ({ id: h.id, from: h.fromStage, to: h.toStage, note: h.note, confirmed: h.confirmed, by: h.by, at: h.at })),
      cancelled: o.status === "cancelled" ? { at: o.cancelledAt, reason: o.cancelReason } : null,
      documents: this.documentsOf(o),
    };
  }

  /** The documents of an order, always available to print or download. */
  private documentsOf(o: OrderRow) {
    const docs = [
      { kind: "proforma", label: "Proforma invoice" },
      { kind: "invoice", label: "Commercial invoice" },
      { kind: "packing-list", label: "Packing list" },
    ];
    return [{ kind: "quotation", label: "Quotation (accepted)", revisionId: o.revisionId }, ...docs];
  }

  async get(user: SessionUser, id: string) {
    return this.view(await this.load(user, id));
  }

  /**
   * Orders with their stage, money due and what each needs now.
   * status: open (the board: Confirmed, In production, Shipped), closed (Done) or cancelled.
   */
  async list(user: SessionUser, filter: { mine?: boolean; status?: "open" | "closed" | "cancelled"; stage?: OrderStage; lateOnly?: boolean }) {
    const rows = await this.prisma.db.order.findMany({
      where: {
        ...orderAccess(user),
        status: filter.status ?? "open",
        ...(filter.stage ? { stage: filter.stage } : {}),
        ...(filter.mine ? { inquiry: { assigneeId: user.id } } : {}),
      },
      include: orderInclude,
      orderBy: [{ stageSince: "asc" }],
      take: 300,
    });
    const days = (await this.settings.get()).reminders;
    const today = this.clock.today();
    const items = rows.map((o) => {
      const m = this.moneyOf(o);
      return {
        id: o.id,
        refNo: o.refNo,
        status: o.status,
        stage: o.stage,
        stageSince: dateIn(o.stageSince, this.clock.timeZone),
        customer: o.customer,
        inquiry: o.inquiry,
        orderedOn: fromDbDate(o.orderedOn),
        readyOn: fromDbDateOrNull(o.readyOn),
        shippedOn: fromDbDateOrNull(o.shippedOn),
        currency: o.currency,
        total: o.total.toFixed(2),
        received: fromMinor(m.receivedMinor),
        due: fromMinor(dueOf(m)),
        next: this.nextOf(o),
        needs: orderNeeds(this.facts(o), today, days),
      };
    });
    return filter.lateOnly ? items.filter((i) => i.needs?.late) : items;
  }

  /** "My to-do": what each open order I handle needs, late ones first, then by date. */
  async todo(user: SessionUser) {
    const items = (await this.list(user, { mine: true })).filter((i) => i.needs);
    return items.sort((a, b) => Number(b.needs!.late) - Number(a.needs!.late) || a.needs!.due.localeCompare(b.needs!.due));
  }

  /* ---------------------------------------------------------------- moving */

  /**
   * One stage forward or back. A forward move with warnings (no deposit, money
   * due) is refused with code "confirm" and the warnings, until it is sent again
   * with confirm: true. Moving to Shipped records the ship date and B/L; Done
   * closes the order; moving back from Done reopens it.
   */
  async moveStage(user: SessionUser, id: string, input: MoveStageInput) {
    if (!can(user.role, "orders.update")) throw new ForbiddenError("You cannot change orders.");
    const today = this.clock.today();
    if (input.shippedOn && input.shippedOn > today) throw new DomainError("The ship date cannot be in the future.");
    const event = await this.prisma.tx(async (tx) => {
      // Lock the order first: two people pressing the button at once are served one after the other.
      await tx.$queryRaw`select id from orders where id = ${id}::uuid for update`;
      const o = await this.load(user, id, tx);
      const m = this.moneyOf(o);
      const check = checkMove(o.stage, input.to, o.status, m);
      if (!check.ok) throw new GateError(check.message, check.code);
      if (check.warnings.length && !input.confirm) throw new GateError(check.warnings.map((w) => w.message).join(" "), "confirm");
      const forward = input.to === nextStage(o.stage);
      const data: Prisma.OrderUpdateInput = { stage: input.to, stageSince: new Date() };
      if (input.to === "in_production" && input.readyOn) data.readyOn = toDbDate(input.readyOn);
      if (input.to === "shipped" && forward) {
        data.shippedOn = toDbDate(input.shippedOn ?? today);
        if (input.blNo) data.blNo = input.blNo;
      }
      if (input.to === "done") Object.assign(data, { status: "closed", closedAt: new Date() });
      if (o.stage === "done" && !forward) Object.assign(data, { status: "open", closedAt: null });
      await tx.order.update({ where: { id: o.id }, data });
      await tx.orderStageChange.create({ data: { orderId: o.id, fromStage: o.stage, toStage: input.to, note: input.note, confirmed: check.warnings.length > 0, byId: user.id } });
      await this.audit.record(tx, {
        userId: user.id,
        action: "stage_change",
        entityType: "order",
        entityId: o.id,
        summary: `${o.refNo}: ${ORDER_STAGE_LABEL[o.stage]} → ${ORDER_STAGE_LABEL[input.to]}${check.warnings.length ? ` (went ahead: ${check.warnings.map((w) => w.message).join(" ")})` : ""}${input.note ? ` — ${input.note}` : ""}`,
      });
      return {
        type: "order.stageChanged",
        orderId: o.id,
        refNo: o.refNo,
        from: o.stage,
        to: input.to,
        actorId: user.id,
        notify: [o.inquiry.assigneeId].filter((v): v is string => !!v),
      } satisfies DomainEvent;
    });
    await this.events.publish(event);
    return this.get(user, id);
  }

  /** Dates and the B/L number, editable at any stage. */
  async setDetails(user: SessionUser, id: string, input: OrderDetailsInput) {
    if (!can(user.role, "orders.update")) throw new ForbiddenError("You cannot change orders.");
    if (input.shippedOn && input.shippedOn > this.clock.today()) throw new DomainError("The ship date cannot be in the future.");
    await this.prisma.tx(async (tx) => {
      const o = await this.load(user, id, tx);
      const before = { shipBy: fromDbDateOrNull(o.shipBy), readyOn: fromDbDateOrNull(o.readyOn), shippedOn: fromDbDateOrNull(o.shippedOn), blNo: o.blNo };
      await tx.order.update({ where: { id: o.id }, data: { shipBy: toDbDateOrNull(input.shipBy), readyOn: toDbDateOrNull(input.readyOn), shippedOn: toDbDateOrNull(input.shippedOn), blNo: input.blNo } });
      await this.audit.record(tx, { userId: user.id, action: "update", entityType: "order", entityId: o.id, summary: `${o.refNo}: dates and B/L changed`, oldValues: before, newValues: input });
    });
    return this.get(user, id);
  }
}
