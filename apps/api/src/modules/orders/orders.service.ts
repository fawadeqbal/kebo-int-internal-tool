import { Injectable } from "@nestjs/common";
import { decimalToMinor, fromDbDate, fromDbDateOrNull, livePart, livePurchase, nextCount, nextReference, toDbDate, toDbDateOrNull, type Prisma, isCustomer } from "@kebo/database";
import { fromMinor, fxRate } from "@kebo/money";
import {
  can,
  checkMove,
  balanceTermsOf,
  balanceWhenOf,
  buyerChanges,
  type BuyerSnapshot,
  customerLetters,
  orderReadyOn,
  routeFromTerms,
  routePlan,
  nextStage,
  numberQuoteLines,
  orderNeeds,
  ORDER_STAGE_HINT,
  ORDER_STAGE_LABEL,
  previousStage,
  proformaNumber,
  STAGE_BUTTON,
  STAGE_FLOW,
  type CancelOrderInput,
  type MoveStageInput,
  type OrderDetailsInput,
  type OrderFacts,
  type OrderGoods,
  type OrderLineInput,
  type OrderStage,
  type PackingInput,
  type ReceiptInput,
  type LineCondition,
  LINE_CONDITION_LABEL,
} from "@kebo/shared";
import { addDays, dateIn, DomainError, ForbiddenError, GateError, NotFoundError, type ISODate } from "@kebo/utils";
import { PrismaService, type Tx } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { Clock } from "../../common/time/clock.service";
import type { SessionUser } from "../../common/auth/session-user";
import { orderAccess } from "../../common/auth/order-access";
import { SettingsService } from "../settings/settings.service";
import { EventBus, type DomainEvent } from "../../common/events/event-bus";
import { StagesService } from "../inquiries/stages.service";
import { requireReason } from "../../common/audit/reason";
import { ordersWithMoneyDue } from "../billing/api";
import { chargedExpenses, fxOf, moneyFacts, positionOf, type MoneyCtx } from "../billing/api";
import { LimitsService } from "../../common/company/limits.service";
import { checkAccount } from "../treasury/api";
import { factoryPlansOf } from "../billing/api";
import { createPlan, termsOf } from "../billing/api";
import { buyerAtOrder, buyerNow, buyerOf } from "./buyer";
import { freezeOrderDoc, packingFinalNow } from "./order-docs";
import { LedgerPosting, type LedgerRef } from "../ledger/posting.service";
import { fromCredit, refund, releaseOrder } from "../treasury/api";
import { onPrimaryShipment, orderShipments, shipFacts } from "./shipment-facts";
import { readyWords, setReadyAll, setReadyDates } from "./ready";
import { readyByOf, readyOnOf, readySelect } from "@kebo/database";

/** Staff work on the deals they handle or created; managers see every deal. */
/** Orders whose number, customer or inquiry (number, title) has the words. */
function orderSearch(term: string | undefined): Prisma.OrderWhereInput {
  const t = term?.trim();
  if (!t) return {};
  return {
    OR: [
      { refNo: { contains: t, mode: "insensitive" } },
      { customer: { name: { contains: t, mode: "insensitive" } } },
      { inquiry: { refNo: { contains: t, mode: "insensitive" } } },
      { inquiry: { title: { contains: t, mode: "insensitive" } } },
    ],
  };
}

const orderInclude = {
  allocations: { where: livePart, orderBy: [{ on: "asc" }, { createdAt: "asc" }] },
  // With what pays it, what the position needs: the plan's deposit and what was charged to the customer.
  receivables: { orderBy: { sortOrder: "asc" }, select: { amount: true, part: true } },
  expenses: chargedExpenses,
  lines: {
    orderBy: { sortOrder: "asc" },
    // The factory each line was quoted from (through the quotation line and the factory's price).
    include: {
      quoteLine: {
        select: {
          requestedItemId: true,
          requestedItem: { select: { parentId: true } },
          factoryQuoteLineId: true,
          factoryQuoteLine: { select: { parentId: true } },
        },
      },
      // The factory it was bought from (frozen when the order was made).
      factory: { select: { id: true, name: true } },
    },
  },
  customer: { select: { id: true, name: true, country: true } },
  inquiry: { select: { id: true, refNo: true, title: true, assigneeId: true, requiredBy: true, assignee: { select: { id: true, name: true } } } },
  // The shipments hold the B/L, the day the goods left and the container (Shipment 1 first).
  shipments: orderShipments,
  // Each factory's ready date (the order's is the latest of them).
  ...readySelect,
} satisfies Prisma.OrderInclude;

type OrderRow = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

/** "1", "2", "2.1" for an order's lines (a factory's parts under their line). */
export function orderLineNumbers(
  lines: {
    id: string;
    quoteLine: {
      requestedItemId: string | null;
      requestedItem: { parentId: string | null } | null;
      factoryQuoteLineId: string | null;
      factoryQuoteLine: { parentId: string | null } | null;
    } | null;
  }[],
) {
  return numberQuoteLines(
    lines.map((l) => ({
      id: l.id,
      factoryQuoteLineId: l.quoteLine?.factoryQuoteLineId ?? null,
      factoryParentId: l.quoteLine?.factoryQuoteLine?.parentId ?? null,
      requestedItemId: l.quoteLine?.requestedItemId ?? null,
      itemParentId: l.quoteLine?.requestedItem?.parentId ?? null,
    })),
  );
}

const qty = (d: { toString(): string }) => Number(d.toString());
const trimQty = (d: { toString(): string }) => String(qty(d));

/** What came in from the factory and whether the packing list is made, for the rules in @kebo/shared. */
export function goodsOf(
  lines: { type: string; description: string; quantity: { toString(): string }; receivedQty: { toString(): string }; unit: string }[],
  packedAt: Date | null,
): OrderGoods {
  const goods = lines.filter((l) => l.type === "goods");
  const short = goods.filter((l) => qty(l.receivedQty) < qty(l.quantity));
  return {
    short: short.map((l) => `${l.description.split("\n")[0]!.slice(0, 60)}: ${trimQty(l.receivedQty)} of ${trimQty(l.quantity)} ${l.unit}`),
    lines: goods.length,
    received: goods.length - short.length,
    packed: packedAt !== null,
  };
}

type LineRow = OrderRow["lines"][number];

/** What a line shows besides the order's own columns: what reached the customer (Delivery & SAT on), the factory's price (people who see factory prices). */
interface LineShows {
  delivered: boolean;
  factoryPrices: boolean;
}

/** A line of the order as the screens get it: the order's columns, then what each step adds (received, packing, delivered, the factory's price). */
function lineView(l: LineRow, no: string, show: LineShows) {
  return {
    id: l.id,
    no,
    type: l.type,
    description: l.description,
    model: l.model,
    quantity: trimQty(l.quantity),
    unit: l.unit,
    unitPrice: l.unitPrice.toFixed(2),
    lineTotal: l.lineTotal.toFixed(2),
    factory: l.factory ?? null,
    receivedQty: trimQty(l.receivedQty),
    receivedOn: fromDbDateOrNull(l.receivedOn),
    packing: {
      packages: l.packages,
      packageType: l.packageType,
      netWeightKg: l.netWeightKg?.toFixed(2) ?? null,
      grossWeightKg: l.grossWeightKg?.toFixed(2) ?? null,
      cbm: l.cbm?.toFixed(3) ?? null,
    },
    delivered: show.delivered
      ? { qty: trimQty(l.deliveredQty), condition: (l.deliveredCondition as LineCondition | null) ?? null, note: l.deliveryNote }
      : null,
    factoryPrice:
      show.factoryPrices && l.factoryUnitPrice !== null
        ? {
            unitPrice: l.factoryUnitPrice.toFixed(2),
            taxRate: l.factoryTaxRate?.toString() ?? "0",
            /** The price already has the tax in it (not added again). */
            taxIncluded: l.factoryTaxIncluded,
            currency: l.factoryCurrency,
          }
        : null,
  };
}

/** The goods side of the order: what came in, whether it is packed, the container (Shipment 1's) and the packing totals. */
function goodsSummary(o: Pick<OrderRow, "lines" | "packedAt" | "shipments" | "shippingMarks">) {
  const g = goodsOf(o.lines, o.packedAt);
  const goodsLines = o.lines.filter((l) => l.type === "goods");
  const sum = (f: (l: (typeof goodsLines)[number]) => number) => goodsLines.reduce((t, l) => t + f(l), 0);
  return {
    lines: g.lines,
    received: g.received,
    allReceived: g.lines > 0 && g.received === g.lines,
    short: g.short,
    packed: g.packed,
    packedAt: o.packedAt,
    /** Shipment 1's container (edited on the shipment; read-only on the packing form). */
    containerNo: shipFacts(o.shipments).containerNo,
    shippingMarks: o.shippingMarks,
    totals: {
      packages: sum((l) => l.packages ?? 0),
      netWeightKg: sum((l) => Number(l.netWeightKg ?? 0)).toFixed(2),
      grossWeightKg: sum((l) => Number(l.grossWeightKg ?? 0)).toFixed(2),
      cbm: sum((l) => Number(l.cbm ?? 0)).toFixed(3),
    },
  };
}

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
    private readonly limits: LimitsService,
    private readonly ledger: LedgerPosting,
  ) {}

  /* ---------------------------------------------------------------- creating and cancelling */

  /** The order made when a revision is accepted (inside that transaction): the accepted lines frozen and the terms copied. */
  async createFromRevision(tx: Tx, revisionId: string, optionId: string, acceptedOn: ISODate, actorId: string) {
    const rev = await tx.quotationRevision.findUniqueOrThrow({
      where: { id: revisionId },
      include: { quotation: { include: { inquiry: true } } },
    });
    // The order is the accepted option: its lines, its total.
    // With the factory price each line was bought at (frozen on the order: what we owe the factory),
    // and the costs to reach the basis it was sold on (part of its cost).
    const option = await tx.quotationOption.findFirstOrThrow({
      where: { id: optionId, revisionId },
      include: {
        lines: {
          orderBy: { sortOrder: "asc" },
          include: {
            factoryQuoteLine: {
              select: { unitPrice: true, taxRate: true, factoryQuote: { select: { factoryId: true, currency: true, taxIncluded: true } } },
            },
          },
        },
        costs: true,
      },
    });
    const inquiry = rev.quotation.inquiry;
    const refNo = await nextReference(tx, "order", Number(this.clock.today().slice(0, 4)));
    // The order's rate to the main currency today, kept so its revenue never moves with later rates.
    const { sales } = await this.settings.get();
    const mainRate = fxRate(rev.currency, sales.currency, sales.currency, sales.exchangeRates);
    // The buyer every paper of the order prints: the quotation's customer, details missing there from the customer now.
    const buyer = await buyerAtOrder(tx, { customerId: inquiry.customerId, contactId: inquiry.contactId, sent: rev.customerSnapshot }, this.clock.today());
    const order = await tx.order.create({
      data: {
        refNo,
        inquiryId: inquiry.id,
        revisionId: rev.id,
        customerId: inquiry.customerId,
        orderedOn: toDbDate(acceptedOn),
        stage: "confirmed",
        currency: rev.currency,
        total: option.total,
        depositPercent: rev.depositPercent,
        balanceTerms: rev.balanceTerms,
        incoterm: rev.incoterm,
        incotermPlace: rev.incotermPlace,
        mainCurrency: sales.currency,
        mainRate,
        buyerSnapshot: buyer as unknown as Prisma.InputJsonValue,
        createdById: actorId,
        costs: {
          create: option.costs
            .filter((c) => Number(c.cost) > 0)
            .map((c) => ({ step: c.step, amount: c.amount, currency: c.currency, cost: c.cost, fxRate: c.fxRate, note: c.note })),
        },
        lines: {
          create: option.lines.map((l) => ({
            quoteLineId: l.id,
            type: l.type,
            description: l.description,
            model: l.model,
            quantity: l.quantity,
            unit: l.unit,
            unitPrice: l.unitPrice,
            lineTotal: l.lineTotal,
            unitCost: l.unitCost,
            sortOrder: l.sortOrder,
            factoryId: l.factoryQuoteLine?.factoryQuote.factoryId ?? null,
            factoryUnitPrice: l.factoryQuoteLine?.unitPrice ?? null,
            factoryTaxRate: l.factoryQuoteLine?.taxRate ?? null,
            factoryTaxIncluded: l.factoryQuoteLine?.factoryQuote.taxIncluded ?? false,
            factoryCurrency: l.factoryQuoteLine?.factoryQuote.currency ?? null,
          })),
        },
        stageChanges: {
          create: { toStage: "confirmed", byId: actorId, note: `${rev.quotation.refNo} R${rev.number} Option ${option.letter} accepted` },
        },
      },
    });
    // The order starts on the route the accepted terms imply (an LC for "letter of credit", informal with that
    // balance timing), shown "from the quotation" and changeable (choosing another rebuilds what is not paid or
    // changed by hand). The plan is built from it: the deposit dated, the balance with its due rule.
    const days = (await this.settings.get()).reminders;
    const implied = routeFromTerms(rev.balanceTerms);
    const route =
      implied.route && implied.route !== "informal" && !(await this.limits.allows("bank_contracts"))
        ? { route: null, balanceWhen: balanceWhenOf(rev.balanceTerms), lcTerms: null, lcDays: null }
        : implied;
    const plan = routePlan(decimalToMinor(option.total), Number(rev.depositPercent), route, acceptedOn, days.depositDays, days.balanceDays);
    await createPlan(tx, order.id, plan);
    if (route.route || route.balanceWhen)
      await tx.order.update({
        where: { id: order.id },
        data: { paymentRoute: route.route, balanceWhen: route.balanceWhen, lcTerms: route.lcTerms, lcDays: route.lcDays },
      });
    await this.audit.record(tx, {
      userId: actorId,
      action: "create",
      entityType: "order",
      entityId: order.id,
      summary: `Order ${refNo} from ${rev.quotation.refNo} R${rev.number} Option ${option.letter} (${rev.currency} ${option.total.toString()})`,
    });
    // The ledger: the customer owes the order total, and we owe each factory its part, from today.
    await this.ledger.post(tx, [{ type: "order_all", id: order.id }], { userId: actorId });
    const event: DomainEvent = {
      type: "order.created",
      orderId: order.id,
      refNo,
      inquiryId: inquiry.id,
      actorId,
      notify: [inquiry.assigneeId, inquiry.createdById].filter((v): v is string => !!v),
    };
    return { order, event };
  }

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
      const o = await this.load(user, id, tx);
      if (o.status === "cancelled") throw new DomainError("This order is already cancelled.");
      // Money in from the customer (in the order's currency), and money out to the factories (per factory and currency).
      const inMinor = o.allocations.reduce((t, p) => t + decimalToMinor(p.amount), 0);
      const factoryPaid = (
        await tx.allocation.findMany({ where: { purchaseOrderId: id, ...livePurchase }, include: { movement: { include: { party: { select: { id: true, name: true } } } } } })
      ).map((a) => ({ factoryId: a.movement.partyId!, factory: a.movement.party!, currency: a.movement.currency, amount: a.share }));
      const customerMoney = inMinor > 0 ? (money.customerMoney ?? "credit") : null;
      const factoryMoney = factoryPaid.length ? (money.factoryMoney ?? "refund_due") : null;
      const posted: LedgerRef[] = [{ type: "order_all", id }];
      if (customerMoney) {
        // What paid the order is released: the customer's credit again, then kept as a fee or paid back from it.
        await tx.$queryRaw`select id from parties where id = ${o.customerId}::uuid for update`;
        const released = await releaseOrder(tx, id, `${o.refNo} cancelled`);
        const from = { partyId: o.customerId, currency: o.currency, amountMinor: released.minor, recordedById: user.id, prefer: released.movementIds, orderId: id };
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
          if (rate === null) throw new DomainError(`There is no exchange rate for ${x.currency} in Settings: add it before recording the loss.`);
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
      await tx.order.update({
        where: { id },
        data: { status: "cancelled", cancelledAt: new Date(), cancelReason: reason, cancelCustomerMoney: customerMoney, cancelFactoryMoney: factoryMoney },
      });
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
    return this.get(user, id);
  }

  /**
   * Gives the proforma its number, dated today: prefix (Settings), YYMMDD,
   * the customer's letters and the deal handler's count this year, e.g.
   * KEB260916TN07. Once issued the number does not change.
   */
  async issueProforma(user: SessionUser, id: string) {
    if (!can(user, "orders.update")) throw new ForbiddenError("You cannot issue proformas.");
    const settings = await this.settings.get();
    const { company } = settings;
    const fx = fxOf(settings, await this.limits.allows("expenses"));
    await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`select id from orders where id = ${id}::uuid for update`;
      const o = await this.load(user, id, tx);
      if (o.status === "cancelled") throw new DomainError("This order is cancelled.");
      const today = this.clock.today();
      if (o.proformaNo) {
        // Issued, with its next version open (Make again): that version is made final as it prints now.
        const latest = await tx.orderPaper.findFirst({ where: { orderId: id, kind: "proforma" }, orderBy: { version: "desc" } });
        if (latest?.status !== "draft") throw new DomainError(`The proforma is already issued as ${o.proformaNo}.`);
        await freezeOrderDoc(tx, id, "proforma", { settings, fx, today, byId: user.id });
        await this.audit.record(tx, {
          userId: user.id,
          action: "paper.final",
          entityType: "order",
          entityId: id,
          summary: `${o.refNo}: Proforma invoice ${o.proformaNo} made final (version ${latest.version})`,
          newValues: { kind: "proforma", number: o.proformaNo, version: latest.version, step: "payment" },
        });
        return;
      }
      const customer = await tx.party.findUniqueOrThrow({ where: { ...isCustomer, id: o.customerId }, select: { name: true, initials: true } });
      const letters = customer.initials || customerLetters(customer.name);
      // The count belongs to the person handling the deal (or whoever issues it when nobody does).
      const person = o.inquiry.assigneeId ?? user.id;
      const key = `pi:${person}:${today.slice(0, 4)}`;
      let number = "";
      // Two people can reach the same number for the same customer on the same day: take the next count then.
      for (let tries = 0; tries < 20 && !number; tries++) {
        const candidate = proformaNumber(company.proformaPrefix, today, letters, await nextCount(tx, key));
        if (!(await tx.order.findFirst({ where: { proformaNo: candidate }, select: { id: true } }))) number = candidate;
      }
      if (!number) throw new DomainError("Could not find a free proforma number. Try again.");
      await tx.order.update({ where: { id }, data: { proformaNo: number, proformaIssuedOn: toDbDate(today) } });
      // Issued is final: exactly what it prints now is kept, and re-printing the number shows it.
      await freezeOrderDoc(tx, id, "proforma", { settings, fx, today, byId: user.id });
      await this.audit.record(tx, {
        userId: user.id,
        action: "update",
        entityType: "order",
        entityId: id,
        summary: `Issued proforma ${number} for order ${o.refNo}`,
        newValues: { proformaNo: number, proformaIssuedOn: today },
      });
    });
    return this.get(user, id);
  }

  /* ---------------------------------------------------------------- reading */

  /** An order the person may see, or 404. */
  async load(user: SessionUser, id: string, db: PrismaService["db"] | Tx = this.prisma.db): Promise<OrderRow> {
    const o = await db.order.findFirst({ where: { id, ...orderAccess(user) }, include: orderInclude });
    if (!o) throw new NotFoundError("Order");
    return o;
  }

  /** Where the order stands with the customer (orderPosition: the same on every screen), in the order's currency. */
  private moneyOf(o: OrderRow, fx: MoneyCtx) {
    const position = positionOf(o, fx);
    return {
      ...moneyFacts(position),
      currency: o.currency,
      // The terms the route now means (the accepted ones until a route is chosen).
      balanceTerms: balanceTermsOf(termsOf(o), o.balanceTerms),
      position,
    };
  }

  private facts(o: OrderRow, fx: MoneyCtx): OrderFacts {
    const m = this.moneyOf(o, fx);
    return {
      ...moneyFacts(m.position),
      currency: o.currency,
      stage: o.stage,
      status: o.status,
      stageSince: dateIn(o.stageSince, this.clock.timeZone),
      readyOn: readyOnOf(o),
      shippedOn: shipFacts(o.shipments).shippedOn,
      goods: goodsOf(o.lines, o.packedAt),
    };
  }

  /** The one button to show, or none (done or cancelled). */
  private nextOf(o: OrderRow) {
    const to = o.status === "cancelled" ? null : nextStage(o.stage);
    return to ? { to, label: STAGE_BUTTON[to], stage: ORDER_STAGE_LABEL[to], hint: ORDER_STAGE_HINT[to] } : null;
  }

  private async view(o: OrderRow, user: SessionUser) {
    const show = await this.lineShows(user);
    const settings = await this.settings.get();
    const fx = fxOf(settings, await this.limits.allows("expenses"));
    const m = this.moneyOf(o, fx);
    const p = m.position;
    const days = settings.reminders;
    const history = await this.prisma.db.orderStageChange.findMany({
      where: { orderId: o.id },
      orderBy: { at: "asc" },
      include: { by: { select: { id: true, name: true } } },
    });
    const back = o.status === "cancelled" ? null : previousStage(o.stage);
    const numbers = orderLineNumbers(o.lines);
    const ship = shipFacts(o.shipments);
    const { requiredBy, ...inquiry } = o.inquiry;
    return {
      id: o.id,
      refNo: o.refNo,
      status: o.status,
      stage: o.stage,
      stageSince: dateIn(o.stageSince, this.clock.timeZone),
      inquiry,
      customer: o.customer,
      orderedOn: fromDbDate(o.orderedOn),
      shipBy: fromDbDateOrNull(o.shipBy),
      /** When the customer wanted it (the deal's "wanted by"): the suggestion for ship-by while it is empty. */
      shipBySuggested: o.shipBy ? null : fromDbDateOrNull(requiredBy),
      /** The latest of the factories' ready dates (known once each has given one). */
      readyOn: readyOnOf(o),
      /** Each factory's own ready date. */
      readyBy: readyByOf(o).map((r) => ({ ...r, name: o.lines.find((l) => l.factory?.id === r.factoryId)?.factory?.name ?? null })),
      /** The shipment's, never the order's: the earliest day a shipment left, and Shipment 1's B/L. */
      shippedOn: ship.shippedOn,
      blNo: ship.blNo,
      /** Shipment 1, where shipped on / B/L / container are edited (null: no shipment yet). */
      shipment: ship.primary
        ? {
            id: ship.primary.id,
            mode: ship.primary.mode,
            count: ship.list.length,
            blNo: ship.primary.blNo,
            containerNo: ship.primary.containerNo,
            departedOn: fromDbDateOrNull(ship.primary.departedOn),
          }
        : null,
      documentTitle: o.documentTitle,
      portOfDischarge: o.portOfDischarge,
      currency: o.currency,
      total: o.total.toFixed(2),
      /** The deposit % as accepted on the quotation (the plan may ask for another: money.depositPercent). */
      depositPercent: Number(o.depositPercent),
      balanceTerms: o.balanceTerms,
      incoterm: o.incoterm,
      incotermPlace: o.incotermPlace,
      money: {
        total: fromMinor(p.totalMinor),
        /** Expenses charged to the customer: part of what is due ("incl. USD 800 charged"). */
        charged: fromMinor(p.chargedMinor),
        /** The deposit asked for: the plan's deposit row (else the accepted %), and that as a %. */
        deposit: fromMinor(p.depositMinor),
        depositPercent: p.depositPercent,
        received: fromMinor(p.settledMinor),
        bankCharges: fromMinor(p.bankChargesMinor),
        due: fromMinor(p.dueMinor),
        depositDue: fromMinor(p.depositOutstandingMinor),
        status: p.status,
      },
      lines: o.lines.map((l, i) => lineView(l, numbers[i]!, show)),
      goods: goodsSummary(o),
      next: this.nextOf(o),
      back: back ? { to: back, label: `Back to ${ORDER_STAGE_LABEL[back]}` } : null,
      needs: orderNeeds(this.facts(o, fx), this.clock.today(), days),
      history: history.map((h) => ({
        id: h.id,
        from: h.fromStage,
        to: h.toStage,
        note: h.note,
        confirmed: h.confirmed,
        by: h.by,
        at: h.at,
      })),
      cancelled:
        o.status === "cancelled"
          ? { at: o.cancelledAt, reason: o.cancelReason, customerMoney: o.cancelCustomerMoney, factoryMoney: o.cancelFactoryMoney }
          : null,
      documents: this.documentsOf(o),
      /** null until issued (the proforma is a draft without a number until then). */
      proforma: o.proformaNo ? { number: o.proformaNo, issuedOn: fromDbDateOrNull(o.proformaIssuedOn) } : null,
    };
  }

  /** The documents of an order, always available to print or download. */
  private documentsOf(o: OrderRow) {
    const docs = [
      { kind: "proforma", label: "Proforma invoice" },
      { kind: "packing-list", label: "Packing list" },
    ];
    return [{ kind: "quotation", label: "Quotation (accepted)", revisionId: o.revisionId }, ...docs];
  }

  async get(user: SessionUser, id: string) {
    const o = await this.load(user, id);
    return { ...(await this.view(o, user)), factoryFiles: await this.factoryFilesOf(user, o.id) };
  }

  /**
   * The factory's own quotation, catalogue and screenshots kept with the offer
   * this order was made from (evidence for what was bought), for people who
   * see factory prices. The deal's URS and documents are the deal's files.
   */
  private async factoryFilesOf(user: SessionUser, orderId: string) {
    if (!can(user, "sourcing.manage")) return [];
    const quotes = await this.prisma.db.factoryQuote.findMany({
      where: { lines: { some: { quoteLines: { some: { orderLines: { some: { orderId } } } } } } },
      select: { id: true, factory: { select: { name: true } } },
    });
    if (!quotes.length) return [];
    const files = await this.prisma.db.attachment.findMany({
      where: { factoryQuoteId: { in: quotes.map((q) => q.id) }, deletedAt: null, replacedById: null },
      orderBy: { createdAt: "asc" },
    });
    return files.map((f) => ({
      id: f.id,
      fileName: f.fileName,
      mimeType: f.mimeType,
      size: f.size,
      kind: f.kind,
      note: f.note,
      uploadedOn: f.createdAt.toISOString(),
      factory: quotes.find((q) => q.id === f.factoryQuoteId)!.factory.name,
    }));
  }

  /** How many orders there are with this status (mine, or all the person may see). */
  async count(user: SessionUser, filter: { mine?: boolean; status?: "open" | "closed" | "cancelled" }) {
    const count = await this.prisma.db.order.count({
      where: { ...orderAccess(user), status: filter.status ?? "open", ...(filter.mine ? { inquiry: { assigneeId: user.id } } : {}) },
    });
    return { count };
  }

  /**
   * Orders with their stage, money due and what each needs now.
   * status: open (the board: Confirmed, In production, Shipped), closed (Done) or cancelled.
   */
  async list(
    user: SessionUser,
    filter: {
      mine?: boolean;
      /** "all": every status. */
      status?: "open" | "closed" | "cancelled" | "all";
      stage?: OrderStage;
      lateOnly?: boolean;
      recent?: boolean;
      limit?: number;
      skip?: number;
      ids?: string[];
      /** A search (refNo, customer, inquiry). */
      q?: string;
    },
  ) {
    const rows = await this.prisma.db.order.findMany({
      where: {
        ...orderAccess(user),
        ...(filter.ids ? { id: { in: filter.ids } } : {}),
        ...(filter.status === "all" ? {} : { status: filter.status ?? "open" }),
        ...(filter.stage ? { stage: filter.stage } : {}),
        ...(filter.mine ? { inquiry: { assigneeId: user.id } } : {}),
        ...orderSearch(filter.q),
      },
      include: orderInclude,
      // Waiting longest first on the board; the latest first for Done.
      orderBy: [{ stageSince: filter.recent ? "desc" : "asc" }, { id: "asc" }],
      skip: filter.skip,
      take: filter.limit ?? 300,
    });
    const settings = await this.settings.get();
    const days = settings.reminders;
    const fx = fxOf(settings, await this.limits.allows("expenses"));
    const today = this.clock.today();
    const items = rows.map((o) => {
      const p = positionOf(o, fx);
      return {
        id: o.id,
        refNo: o.refNo,
        status: o.status,
        stage: o.stage,
        stageSince: dateIn(o.stageSince, this.clock.timeZone),
        customer: o.customer,
        inquiry: o.inquiry,
        orderedOn: fromDbDate(o.orderedOn),
        readyOn: readyOnOf(o),
        shippedOn: shipFacts(o.shipments).shippedOn,
        currency: o.currency,
        total: o.total.toFixed(2),
        received: fromMinor(p.settledMinor),
        charged: fromMinor(p.chargedMinor),
        due: fromMinor(p.dueMinor),
        next: this.nextOf(o),
        needs: orderNeeds(this.facts(o, fx), today, days),
      };
    });
    return filter.lateOnly ? items.filter((i) => i.needs?.late) : items;
  }

  /**
   * The orders list, a page at a time: ?status=open (the default) | late | closed | cancelled | all, with
   * mine and a search, and how many each status chip holds for the same search. Late is worked out from
   * what each open order needs (not stored), so the open orders are read for it; the open and late lists
   * show the late ones first, then by when the next thing is needed.
   */
  async page(
    user: SessionUser,
    q: { status: "open" | "late" | "closed" | "cancelled" | "all"; mine?: boolean; q?: string; page: number; pageSize: number },
  ) {
    const where: Prisma.OrderWhereInput = { ...orderAccess(user), ...(q.mine ? { inquiry: { assigneeId: user.id } } : {}), ...orderSearch(q.q) };
    const [open, closed, cancelled, openRows] = await Promise.all([
      this.prisma.db.order.count({ where: { ...where, status: "open" } }),
      this.prisma.db.order.count({ where: { ...where, status: "closed" } }),
      this.prisma.db.order.count({ where: { ...where, status: "cancelled" } }),
      this.list(user, { mine: q.mine, q: q.q, status: "open", limit: 1000 }),
    ]);
    const late = openRows.filter((o) => o.needs?.late);
    const counts = { open, late: late.length, closed, cancelled, all: open + closed + cancelled };
    const skip = (q.page - 1) * q.pageSize;
    const urgentFirst = (a: (typeof openRows)[number], b: (typeof openRows)[number]) =>
      Number(!!b.needs?.late) - Number(!!a.needs?.late) || (a.needs?.due ?? "9999").localeCompare(b.needs?.due ?? "9999");
    const rows =
      q.status === "open" || q.status === "late"
        ? (q.status === "late" ? late : openRows).sort(urgentFirst).slice(skip, skip + q.pageSize)
        : await this.list(user, { mine: q.mine, q: q.q, status: q.status, recent: true, skip, limit: q.pageSize });
    const total = q.status === "late" ? late.length : q.status === "open" ? openRows.length : counts[q.status];
    return { rows, total, page: q.page, pageSize: q.pageSize, counts };
  }

  /** "My to-do": what each open order I handle needs, late ones first, then by date. */
  async todo(user: SessionUser) {
    // Closed orders appear only while money is still owed on them: the database picks those, so years
    // of finished orders are not read on every Home.
    const due = await ordersWithMoneyDue(this.prisma, fxOf(await this.settings.get(), await this.limits.allows("expenses")));
    const all = [...(await this.list(user, { mine: true })), ...(await this.list(user, { mine: true, status: "closed", ids: due }))];
    // A checklist item of the order that is late or due soon comes first when it is due before what the order needs.
    const today = this.clock.today();
    const soon = (await this.settings.get()).reminders.dueSoonDays;
    const dated = await this.prisma.db.orderChecklistItem.findMany({
      where: {
        key: null,
        doneAt: null,
        skippedAt: null,
        dueOn: { lte: toDbDate(addDays(today, soon)) },
        orderId: { in: all.filter((i) => i.status === "open").map((i) => i.id) },
      },
      select: { orderId: true, title: true, dueOn: true, route: true, order: { select: { paymentRoute: true } } },
      orderBy: { dueOn: "asc" },
    });
    for (const i of all) {
      const c = dated.find((d) => d.orderId === i.id && (!d.route || d.route === d.order.paymentRoute));
      if (!c) continue;
      const on = fromDbDate(c.dueOn!);
      if (!i.needs || on < i.needs.due) i.needs = { title: c.title ?? "Checklist item", due: on, late: on < today };
    }
    // A factory's part (the advance, the balance on the ready date) due soon or late, for people who see factory money.
    if (can(user, "sourcing.manage")) {
      const { sales } = await this.settings.get();
      for (const i of all.filter((x) => x.status === "open")) {
        for (const p of await factoryPlansOf(this.prisma.db, i.id, sales.factoryAdvancePercent, today, soon, fxOf(await this.settings.get(), await this.limits.allows("expenses")))) {
          const n = p.next;
          if (!n?.due || (n.status !== "due" && n.status !== "late")) continue;
          if (!i.needs || n.due < i.needs.due) i.needs = { title: `Pay ${p.factory.name}: ${n.label} ${p.currency} ${n.open}`, due: n.due, late: n.due < today };
        }
      }
    }
    const items = all.filter((i) => i.needs);
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
    if (!can(user, "orders.update")) throw new ForbiddenError("You cannot change orders.");
    const today = this.clock.today();
    if (input.shippedOn && input.shippedOn > today) throw new DomainError("The ship date cannot be in the future.");
    const event = await this.prisma.tx(async (tx) => {
      // Lock the order first: two people pressing the button at once are served one after the other.
      await tx.$queryRaw`select id from orders where id = ${id}::uuid for update`;
      const o = await this.load(user, id, tx);
      const m = this.moneyOf(o, fxOf(await this.settings.get(), await this.limits.allows("expenses")));
      const check = checkMove(o.stage, input.to, o.status, { ...m, goods: goodsOf(o.lines, o.packedAt) });
      if (!check.ok) throw new GateError(check.message, check.code);
      if (check.warnings.some((w) => w.code === "money_due") && !can(user, "orders.manage")) {
        throw new GateError(
          `${check.warnings.find((w) => w.code === "money_due")!.message} Record the payment first, or ask a manager to close it.`,
          "manager_needed",
        );
      }
      if (check.warnings.length && !input.confirm) throw new GateError(check.warnings.map((w) => w.message).join(" "), "confirm");
      const forward = input.to === nextStage(o.stage);
      const given = input.reason?.trim() || input.note;
      const reason = !forward
        ? requireReason(given, "orderBack", "the order moves back")
        : input.to === "done" && check.warnings.some((w) => w.code === "money_due")
          ? requireReason(given, "closeWithDue", "the order closes with money still due")
          : given;
      const data: Prisma.OrderUpdateInput = { stage: input.to, stageSince: new Date() };
      if (input.to === "shipped" && forward) {
        // The ship date and B/L are the shipment's (Shipment 1, made when there is none). Shipped again after
        // a move back: the real ship date is kept unless a new one is given.
        const was = shipFacts(o.shipments).shippedOn;
        if (input.shippedOn || !was || input.blNo)
          await onPrimaryShipment(tx, o, {
            ...(input.shippedOn || !was ? { departedOn: input.shippedOn ?? today } : {}),
            ...(input.blNo ? { blNo: input.blNo } : {}),
          });
      }
      if (input.to === "done") Object.assign(data, { status: "closed", closedAt: new Date() });
      if (o.stage === "done" && !forward) Object.assign(data, { status: "open", closedAt: null });
      await tx.order.update({ where: { id: o.id }, data });
      // The goods' ready date (every factory's): the customer's and the factories' plans follow it by themselves.
      if (input.to === "in_production" && input.readyOn) await setReadyAll(tx, o.id, input.readyOn);
      if (input.to === "shipped" && forward) await this.freezePacking(tx, o.id, user.id);
      await tx.orderStageChange.create({
        data: {
          orderId: o.id,
          fromStage: o.stage,
          toStage: input.to,
          note: input.note ?? (reason || null),
          confirmed: check.warnings.length > 0,
          byId: user.id,
        },
      });
      await this.audit.record(tx, {
        userId: user.id,
        action: "stage_change",
        entityType: "order",
        entityId: o.id,
        summary: `${o.refNo}: ${ORDER_STAGE_LABEL[o.stage]} → ${ORDER_STAGE_LABEL[input.to]}${check.warnings.length ? ` (went ahead: ${check.warnings.map((w) => w.message).join(" ")})` : ""}${input.note ? ` — ${input.note}` : ""}`,
        oldValues: { stage: o.stage },
        newValues: { stage: input.to },
        reason,
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

  /**
   * The order flow moved on (ordered from the factory, a shipment left): the
   * order's stage follows by itself, forward only and only while it is open.
   * No warnings are asked (the work already happened); the history says why.
   * Nothing is copied: the ship date and B/L stay on the shipment.
   * Runs inside the caller's transaction; publish the returned event after it.
   */
  async followFlow(tx: Tx, user: SessionUser, orderId: string, to: "in_production" | "shipped", why: string) {
    const o = await this.load(user, orderId, tx);
    if (o.status !== "open" || STAGE_FLOW.indexOf(o.stage) >= STAGE_FLOW.indexOf(to)) return null;
    const data: Prisma.OrderUpdateInput = { stage: to, stageSince: new Date() };
    await tx.order.update({ where: { id: o.id }, data });
    if (to === "shipped") await this.freezePacking(tx, o.id, user.id);
    await tx.orderStageChange.create({
      data: { orderId: o.id, fromStage: o.stage, toStage: to, note: why, confirmed: false, byId: user.id },
    });
    await this.audit.record(tx, {
      userId: user.id,
      action: "stage_change",
      entityType: "order",
      entityId: o.id,
      summary: `${o.refNo}: ${ORDER_STAGE_LABEL[o.stage]} → ${ORDER_STAGE_LABEL[to]} by itself (${why})`,
      oldValues: { stage: o.stage },
      newValues: { stage: to },
    });
    return {
      type: "order.stageChanged",
      orderId: o.id,
      refNo: o.refNo,
      from: o.stage,
      to,
      actorId: user.id,
      notify: [o.inquiry.assigneeId].filter((v): v is string => !!v),
    } satisfies DomainEvent;
  }

  /** Publish what followFlow returned, once its transaction is committed. */
  async announce(event: DomainEvent | null) {
    if (event) await this.events.publish(event);
  }

  /**
   * The packing list is final once the order is shipped and its packing filled in (whichever comes last):
   * what it prints then is kept. A later change needs "Make again" (version 2).
   */
  private async freezePacking(tx: Tx, orderId: string, byId: string) {
    const o = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { stage: true, packedAt: true } });
    if (!packingFinalNow(o) || (await tx.orderPaper.findFirst({ where: { orderId, kind: "packing-list" }, select: { id: true } }))) return;
    const settings = await this.settings.get();
    await freezeOrderDoc(tx, orderId, "packing-list", {
      settings,
      fx: fxOf(settings, await this.limits.allows("expenses")),
      today: this.clock.today(),
      byId,
    });
  }

  /**
   * POST /orders/:id/buyer — "Refresh from customer": the buyer on the order's papers taken again from the
   * customer as it is now, and why (in the history, with what changed). Only papers made from now on print
   * it: final papers, the issued proforma included, keep the buyer they were printed with.
   */
  async refreshBuyer(user: SessionUser, id: string, reason: string) {
    if (!can(user, "documents.manage") && !can(user, "orders.update")) throw new ForbiddenError("You cannot change the papers of orders.");
    await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`select id from orders where id = ${id}::uuid for update`;
      const o = await this.load(user, id, tx);
      if (o.status === "cancelled") throw new DomainError("This order is cancelled.");
      const full = await tx.order.findUniqueOrThrow({
        where: { id },
        select: { buyerSnapshot: true, customerId: true, inquiry: { select: { contactId: true } }, revision: { select: { customerSnapshot: true } } },
      });
      const today = this.clock.today();
      const was = await buyerOf(tx, full, today);
      const now = await buyerNow(tx, full.customerId, full.inquiry.contactId, today);
      const changed = buyerChanges(was, now);
      await tx.order.update({ where: { id }, data: { buyerSnapshot: now as unknown as Prisma.InputJsonValue } });
      await this.audit.record(tx, {
        userId: user.id,
        action: "order.buyer",
        entityType: "order",
        entityId: id,
        summary: `${o.refNo}: buyer on the papers refreshed from the customer (${changed.length ? changed.join(", ") : "nothing changed"}) — ${reason}`,
        oldValues: { buyer: was },
        newValues: { buyer: now, step: "documents" },
        reason,
      });
    });
    return this.buyerView(user, id);
  }

  /** The buyer on the order's papers, and what differs from the customer now (the Make page's "Buyer as on the order"). */
  async buyerView(user: SessionUser, id: string) {
    await this.load(user, id);
    const o = await this.prisma.db.order.findUniqueOrThrow({
      where: { id },
      select: { buyerSnapshot: true, customerId: true, inquiry: { select: { contactId: true } }, revision: { select: { customerSnapshot: true } } },
    });
    const today = this.clock.today();
    const buyer: BuyerSnapshot = await buyerOf(this.prisma.db, o, today);
    const now = await buyerNow(this.prisma.db, o.customerId, o.inquiry.contactId, today);
    return { buyer, changes: buyerChanges(buyer, now) };
  }

  /** POST /orders/:id/quoted-terms — print the quotation's own payment text although the route now differs (or stop). */
  async setQuotedTerms(user: SessionUser, id: string, print: boolean) {
    if (!can(user, "documents.manage") && !can(user, "orders.update")) throw new ForbiddenError("You cannot change the papers of orders.");
    await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`select id from orders where id = ${id}::uuid for update`;
      const o = await this.load(user, id, tx);
      if (o.printQuotedTerms === print) return;
      await tx.order.update({ where: { id }, data: { printQuotedTerms: print } });
      await this.audit.record(tx, {
        userId: user.id,
        action: "update",
        entityType: "order",
        entityId: id,
        summary: `${o.refNo}: the quotation's payment text ${print ? "printed on the papers too" : "left off the papers"} (the route differs from it)`,
        oldValues: { printQuotedTerms: o.printQuotedTerms },
        newValues: { printQuotedTerms: print, step: "payment" },
      });
    });
    return { print };
  }

  /* ---------------------------------------------------------------- goods */

  /** The goods lines of an order the person may change (not cancelled), locked for this transaction. */
  private async goodsLinesFor(tx: Tx, user: SessionUser, id: string, lineIds: string[]) {
    await tx.$queryRaw`select id from orders where id = ${id}::uuid for update`;
    const o = await this.load(user, id, tx);
    if (o.status === "cancelled") throw new DomainError("This order is cancelled.");
    const byId = new Map(o.lines.filter((l) => l.type === "goods").map((l) => [l.id, l]));
    for (const lineId of lineIds)
      if (!byId.has(lineId)) throw new DomainError("Only the goods lines of this order can be received or packed.");
    if (new Set(lineIds).size !== lineIds.length) throw new DomainError("Each line can appear only once.");
    return { o, byId };
  }

  /** How many of each goods line came in from the factory so far (totals, not additions). */
  async recordReceipt(user: SessionUser, id: string, input: ReceiptInput) {
    if (!can(user, "orders.update")) throw new ForbiddenError("You cannot change orders.");
    const today = this.clock.today();
    const on = input.on ?? today;
    if (on > today) throw new DomainError("The date cannot be in the future.");
    await this.prisma.tx(async (tx) => {
      const { o, byId } = await this.goodsLinesFor(
        tx,
        user,
        id,
        input.lines.map((l) => l.lineId),
      );
      const changes: string[] = [];
      for (const r of input.lines) {
        const line = byId.get(r.lineId)!;
        if (r.receivedQty > qty(line.quantity))
          throw new DomainError(
            `${line.description.split("\n")[0]}: ${r.receivedQty} is more than the ${trimQty(line.quantity)} ${line.unit} ordered.`,
          );
        if (r.receivedQty === qty(line.receivedQty)) continue;
        await tx.orderLine.update({
          where: { id: line.id },
          data: { receivedQty: r.receivedQty, receivedOn: r.receivedQty > 0 ? toDbDate(on) : null },
        });
        changes.push(`${line.description.split("\n")[0]!.slice(0, 40)} ${trimQty(line.receivedQty)} → ${r.receivedQty}`);
      }
      if (changes.length)
        await this.audit.record(tx, {
          userId: user.id,
          action: "goods_received",
          entityType: "order",
          entityId: o.id,
          summary: `${o.refNo}: received from the factory (${on}): ${changes.join("; ")}`,
        });
    });
    return this.get(user, id);
  }

  /** The packing list: packages, weights and volume per goods line, the container and the shipping marks. */
  async savePacking(user: SessionUser, id: string, input: PackingInput) {
    if (!can(user, "orders.update")) throw new ForbiddenError("You cannot change orders.");
    await this.prisma.tx(async (tx) => {
      const { o, byId } = await this.goodsLinesFor(
        tx,
        user,
        id,
        input.lines.map((l) => l.lineId),
      );
      for (const p of input.lines) {
        if (p.netWeightKg !== null && p.grossWeightKg !== null && p.netWeightKg > p.grossWeightKg)
          throw new DomainError(`${byId.get(p.lineId)!.description.split("\n")[0]}: the net weight cannot be more than the gross weight.`);
        await tx.orderLine.update({
          where: { id: p.lineId },
          data: {
            packages: p.packages,
            packageType: p.packageType,
            netWeightKg: p.netWeightKg,
            grossWeightKg: p.grossWeightKg,
            cbm: p.cbm,
          },
        });
      }
      // Made once every goods line has its packages counted.
      const lines = await tx.orderLine.findMany({ where: { orderId: o.id, type: "goods" }, select: { packages: true } });
      const complete = lines.length > 0 && lines.every((l) => (l.packages ?? 0) > 0);
      await tx.order.update({
        where: { id: o.id },
        data: { shippingMarks: input.shippingMarks, packedAt: complete ? (o.packedAt ?? new Date()) : null },
      });
      // The container is the shipment's: sent here (older clients), it is saved on Shipment 1.
      if (input.containerNo !== undefined && input.containerNo !== shipFacts(o.shipments).containerNo)
        await onPrimaryShipment(tx, o, { containerNo: input.containerNo });
      await this.freezePacking(tx, o.id, user.id);
      await this.audit.record(tx, {
        userId: user.id,
        action: "packing_list",
        entityType: "order",
        entityId: o.id,
        summary: `${o.refNo}: packing list ${complete ? "saved" : "saved (not complete: some lines have no packages)"}`,
      });
    });
    return this.get(user, id);
  }

  /** What the screens show of the lines for this person and company. */
  private async lineShows(user: SessionUser): Promise<LineShows> {
    return { delivered: await this.limits.allows("delivery_sat"), factoryPrices: can(user, "sourcing.manage") };
  }

  /**
   * One goods line, changed in a step's line table: what came in from the
   * factory (Production), its packing (Shipping) or what reached the customer
   * (Delivery & SAT). Only the fields sent change. Same rules and history as
   * the whole-list saves (PUT receipt / packing); answers the line and the
   * order's goods summary.
   */
  async editLine(user: SessionUser, lineId: string, input: OrderLineInput) {
    if (input.set === "delivered") {
      await this.limits.require("delivery_sat");
      if (!can(user, "delivery.manage")) throw new ForbiddenError("You cannot manage delivery and SAT.");
    } else if (!can(user, "orders.update")) throw new ForbiddenError("You cannot change orders.");
    const today = this.clock.today();
    const orderId = await this.prisma.tx(async (tx) => {
      // Another company's line, or a line that does not exist, is not found (row-level security).
      const found = await tx.orderLine.findFirst({ where: { id: lineId }, select: { orderId: true } });
      if (!found) throw new NotFoundError("Line");
      const { o, byId } = await this.goodsLinesFor(tx, user, found.orderId, [lineId]);
      const line = byId.get(lineId)!;
      const name = line.description.split("\n")[0]!.slice(0, 40);
      const of = qty(line.quantity);
      const more = (n: number) =>
        new DomainError(`${line.description.split("\n")[0]}: ${n} is more than the ${trimQty(line.quantity)} ${line.unit} ordered.`);
      const record = (action: string, summary: string, oldValues: Record<string, unknown>, newValues: Record<string, unknown>) =>
        this.audit.record(tx, { userId: user.id, action, entityType: "order", entityId: o.id, summary, oldValues, newValues });

      if (input.set === "received") {
        const was = { receivedQty: qty(line.receivedQty), receivedOn: fromDbDateOrNull(line.receivedOn) };
        const got = input.receivedQty ?? was.receivedQty;
        if (got > of) throw more(got);
        if (input.receivedOn && input.receivedOn > today) throw new DomainError("The date cannot be in the future.");
        if (input.receivedOn && got === 0) throw new DomainError("Enter how many came in before the date.");
        // A new quantity is dated today unless a date comes with it; nothing in, no date.
        let on = input.receivedOn !== undefined ? input.receivedOn : got !== was.receivedQty ? today : was.receivedOn;
        if (got === 0) on = null;
        else on ??= today;
        if (got === was.receivedQty && on === was.receivedOn) return o.id;
        await tx.orderLine.update({ where: { id: line.id }, data: { receivedQty: got, receivedOn: toDbDateOrNull(on) } });
        const what =
          got !== was.receivedQty ? `${name} ${trimQty(line.receivedQty)} → ${got}` : `${name} received on ${was.receivedOn ?? "—"} → ${on}`;
        await record("goods_received", `${o.refNo}: received from the factory (${on ?? "nothing in"}): ${what}`, { lineId, ...was }, { lineId, receivedQty: got, receivedOn: on });
        return o.id;
      }

      if (input.set === "packing") {
        const num = (d: { toString(): string } | null) => (d === null ? null : Number(d.toString()));
        const was = {
          packages: line.packages,
          packageType: line.packageType,
          netWeightKg: num(line.netWeightKg),
          grossWeightKg: num(line.grossWeightKg),
          cbm: num(line.cbm),
        };
        const next = { ...was };
        for (const k of ["packages", "packageType", "netWeightKg", "grossWeightKg", "cbm"] as const)
          if (input[k] !== undefined) (next as Record<string, unknown>)[k] = input[k];
        // As on the whole packing list: packages without a type are cartons.
        if (next.packages && !next.packageType) next.packageType = "Carton";
        if (next.netWeightKg !== null && next.grossWeightKg !== null && next.netWeightKg > next.grossWeightKg)
          throw new DomainError(`${line.description.split("\n")[0]}: the net weight cannot be more than the gross weight.`);
        const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== was[k]);
        if (!changed.length) return o.id;
        await tx.orderLine.update({ where: { id: line.id }, data: next });
        // Made once every goods line has its packages counted (as the whole list).
        const lines = await tx.orderLine.findMany({ where: { orderId: o.id, type: "goods" }, select: { packages: true } });
        const complete = lines.length > 0 && lines.every((l) => (l.packages ?? 0) > 0);
        await tx.order.update({ where: { id: o.id }, data: { packedAt: complete ? (o.packedAt ?? new Date()) : null } });
        const label: Record<keyof typeof next, string> = {
          packages: "packages",
          packageType: "packed in",
          netWeightKg: "net kg",
          grossWeightKg: "gross kg",
          cbm: "CBM",
        };
        await record(
          "packing_list",
          `${o.refNo}: packing list, ${name}: ${changed.map((k) => `${label[k]} ${was[k] ?? "—"} → ${next[k] ?? "—"}`).join(", ")}${complete ? "" : " (not complete: some lines have no packages)"}`,
          { lineId, ...Object.fromEntries(changed.map((k) => [k, was[k]])) },
          { lineId, ...Object.fromEntries(changed.map((k) => [k, next[k]])) },
        );
        return o.id;
      }

      const was = {
        deliveredQty: qty(line.deliveredQty),
        condition: (line.deliveredCondition as LineCondition | null) ?? null,
        note: line.deliveryNote,
      };
      const next = {
        deliveredQty: input.deliveredQty ?? was.deliveredQty,
        condition: input.condition !== undefined ? input.condition : was.condition,
        note: input.note !== undefined ? input.note : was.note,
      };
      if (next.deliveredQty > of) throw more(next.deliveredQty);
      const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== was[k]);
      if (!changed.length) return o.id;
      await tx.orderLine.update({
        where: { id: line.id },
        data: { deliveredQty: next.deliveredQty, deliveredCondition: next.condition, deliveryNote: next.note },
      });
      const parts = [
        `${next.deliveredQty} of ${trimQty(line.quantity)} ${line.unit}`,
        next.condition ? LINE_CONDITION_LABEL[next.condition].toLowerCase() : null,
        changed.includes("note") ? (next.note ? `note "${next.note}"` : "note cleared") : null,
      ].filter(Boolean);
      await record(
        "delivered",
        `${o.refNo}: delivered, ${name}: ${parts.join(", ")}`,
        { lineId, ...Object.fromEntries(changed.map((k) => [k, was[k]])) },
        { lineId, step: "delivery", ...Object.fromEntries(changed.map((k) => [k, next[k]])) },
      );
      return o.id;
    });
    const o = await this.load(user, orderId);
    const numbers = orderLineNumbers(o.lines);
    const at = o.lines.findIndex((l) => l.id === lineId);
    return { line: lineView(o.lines[at]!, numbers[at]!, await this.lineShows(user)), goods: goodsSummary(o) };
  }

  /**
   * Dates and details, editable at any stage. Only the fields sent change; an empty one is cleared.
   * Shipped on, the B/L and the container are Shipment 1's (made when there is none): saved there, the one
   * place the papers, the checklist and the reports read them from.
   */
  async setDetails(user: SessionUser, id: string, input: OrderDetailsInput) {
    if (!can(user, "orders.update")) throw new ForbiddenError("You cannot change orders.");
    if (input.shippedOn && input.shippedOn > this.clock.today()) throw new DomainError("The ship date cannot be in the future.");
    await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`select id from orders where id = ${id}::uuid for update`;
      const o = await this.load(user, id, tx);
      if (o.status === "cancelled") throw new DomainError("This order is cancelled.");
      const data: Prisma.OrderUpdateInput = {};
      if (input.shipBy !== undefined) data.shipBy = toDbDateOrNull(input.shipBy);
      if (input.documentTitle !== undefined) data.documentTitle = input.documentTitle;
      if (input.portOfDischarge !== undefined) data.portOfDischarge = input.portOfDischarge;
      if (input.shippingMarks !== undefined) data.shippingMarks = input.shippingMarks;
      const ship = shipFacts(o.shipments);
      // Once shipped, the ship date and B/L are on the customer's documents: changing them says why.
      const shippedFacts =
        (o.stage === "shipped" || o.stage === "done") &&
        ((input.shippedOn !== undefined && input.shippedOn !== ship.shippedOn && ship.shippedOn !== null) ||
          (input.blNo !== undefined && (input.blNo ?? null) !== ship.blNo && ship.blNo !== null));
      const reason = shippedFacts ? requireReason(input.reason, "shipping", "the ship date or B/L changes after shipping") : input.reason;
      const before = {
        shipBy: fromDbDateOrNull(o.shipBy),
        readyOn: readyOnOf(o),
        shippedOn: ship.shippedOn,
        blNo: ship.blNo,
        documentTitle: o.documentTitle,
        portOfDischarge: o.portOfDischarge,
        containerNo: ship.containerNo,
        shippingMarks: o.shippingMarks,
      };
      const onShipment = {
        ...(input.shippedOn !== undefined && input.shippedOn !== ship.shippedOn ? { departedOn: input.shippedOn } : {}),
        ...(input.blNo !== undefined && input.blNo !== ship.blNo ? { blNo: input.blNo } : {}),
        ...(input.containerNo !== undefined && input.containerNo !== ship.containerNo ? { containerNo: input.containerNo } : {}),
      };
      if (Object.keys(onShipment).length) await onPrimaryShipment(tx, o, onShipment);
      if (Object.keys(data).length) await tx.order.update({ where: { id: o.id }, data });
      // The ready date is each factory's: one date for all of them, or each factory's own.
      const ready =
        input.readyBy !== undefined
          ? await setReadyDates(tx, o.id, input.readyBy)
          : input.readyOn !== undefined
            ? await setReadyAll(tx, o.id, input.readyOn)
            : null;
      const names = new Map(o.lines.flatMap((l) => (l.factory ? [[l.factory.id, l.factory.name] as const] : [])));
      const { readyBy: _readyBy, ...sent } = input;
      await this.audit.record(tx, {
        userId: user.id,
        action: "update",
        entityType: "order",
        entityId: o.id,
        summary:
          input.containerNo !== undefined || input.shippingMarks !== undefined
            ? `${o.refNo}: container and shipping marks changed`
            : ready && ready.after.length > 1
              ? `${o.refNo}: ready dates ${readyWords(ready.after, names)}`
              : `${o.refNo}: dates and B/L changed`,
        oldValues: { ...before, ...(ready && ready.before.length > 1 ? { readyBy: readyWords(ready.before, names) } : {}) },
        newValues: {
          ...sent,
          ...(ready ? { readyOn: orderReadyOn(ready.after.flatMap((r) => (r.factoryId ? [r.factoryId] : [])), ready.after) } : {}),
          ...(ready && ready.after.length > 1 ? { readyBy: readyWords(ready.after, names) } : {}),
          reason: undefined,
        },
        reason,
      });
    });
    return this.get(user, id);
  }
}
