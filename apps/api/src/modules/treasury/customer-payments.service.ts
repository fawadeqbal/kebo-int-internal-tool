import { Injectable } from "@nestjs/common";
import { decimalToMinor, fileOf, fromDbDate, isCustomer, liveFile, orderPart, toDbDate, type Prisma, routeOf, wordFactsOf, wordSelect, type WithTerms } from "@kebo/database";
import { formatMinor, fromMinor, fxRate, toMinor, type Minor } from "@kebo/money";
import {
  bankStepsFor,
  can,
  countsAsMinor,
  planStatus,
  receivedForMinor,
  type CreditRefundInput,
  type CustomerReceiptInput,
  type EditPaymentInput,
  type PaymentInput,
  type PaymentKind,
  type PaymentMethod,
  type UseCreditInput,
  orderWord,
} from "@kebo/shared";
import { DomainError, ForbiddenError, NotFoundError, todayIn, type ISODate } from "@kebo/utils";
import { PrismaService, type Tx } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { Clock } from "../../common/time/clock.service";
import { EventBus } from "../../common/events/event-bus";
import type { SessionUser } from "../../common/auth/session-user";
import { orderAccess } from "../../common/auth/order-access";
import { OrdersService } from "../orders/orders.service";
import { requireReason } from "../../common/audit/reason";
import { checkAccount } from "./account-check";
import { LimitsService } from "../../common/company/limits.service";
import { fileView } from "./payment-file-view";
import { SettingsService } from "../settings/settings.service";
import { chargedExpenses, fxOf, positionOf, type PositionFacts, type MoneyCtx } from "../billing/api";
import { livePlansOf } from "../billing/api";
import { LedgerPosting, type LedgerRef } from "../ledger/posting.service";
import { creditOf, fromCredit, refund, voidMovement } from "./customer-money";

type Live = { amount: Prisma.Decimal; bankCharges: Prisma.Decimal };
/** Where the order stands with these parts (orderPosition: what was charged to the customer can be paid too). */
const settledOf = (o: Omit<PositionFacts, "allocations">, allocations: Live[], fx: MoneyCtx) => positionOf({ ...o, allocations }, fx);

/** What arrived, before it is split over orders. */
interface Arrived {
  receivedMinor: Minor;
  receivedCurrency: string;
  /** The orders' currency. */
  currency: string;
  /** Units of the received currency per one unit of the orders' currency. */
  rate: number;
  accountId: string | null;
  paidOn: ISODate;
  method: PaymentMethod;
  reference: string | null;
  paidByName: string | null;
  note: string | null;
}

/** One order's part of a transfer. */
interface Part {
  order: { id: string; refNo: string; customerId: string; inquiry: { assigneeId: string | null } };
  kind: PaymentKind;
  amountMinor: Minor;
  bankChargesMinor: Minor;
}

/** An order's part with its payment entry, as the order's money shows it. */
const withMovement = {
  movement: {
    include: {
      account: { select: { id: true, name: true } },
      files: liveFile,
      allocations: { where: { later: false }, select: { id: true, amount: true } },
    },
  },
} satisfies Prisma.AllocationInclude;
type PartRow = Prisma.AllocationGetPayload<{ include: typeof withMovement }>;

/**
 * Part of one transfer that pays more than this (other orders, or left as credit): changed and removed as the
 * whole transfer. Its id then is the movement's ("receiptId", as the screens call it).
 */
const transferOf = (a: PartRow) =>
  !a.later && (a.movement.allocations.length !== 1 || decimalToMinor(a.movement.allocatable) !== decimalToMinor(a.amount))
    ? a.movementId
    : null;

/** The money facts of an order's part as the screens show them: from its payment entry, or from credit. */
function partView(a: PartRow) {
  const m = a.movement;
  return {
    id: a.id,
    receiptNo: a.receiptNo,
    kind: a.kind,
    amount: a.amount.toFixed(2),
    bankCharges: a.bankCharges.toFixed(2),
    currency: m.allocCurrency,
    receivedAmount: a.later ? a.amount.toFixed(2) : a.share.toFixed(2),
    receivedCurrency: a.later ? m.allocCurrency : m.currency,
    rate: a.later ? 1 : Number(m.rate),
    paidByName: a.later ? null : m.paidByName,
    receiptId: transferOf(a),
    paidOn: fromDbDate(a.on),
    method: (a.later ? "credit" : m.method) as PaymentMethod,
    reference: a.later ? null : m.reference,
    note: a.later ? (a.note ?? "Paid from the customer's credit") : m.note,
    account: a.later ? null : m.account,
    file: a.later ? null : fileView(fileOf(m.files)),
  };
}

/**
 * Money in from the customer against their orders, the ERPNext way: one payment entry per transfer
 * (money_movements: what really arrived, in its currency, on its account, with the rate agreed) and what it
 * pays underneath (allocations, one per order, in the order's currency, never moving with later rates). What a
 * transfer pays no order is the customer's credit (their advance): it pays an order later, is refunded or kept
 * as a fee (customer-money.ts). "Money reached us" on a bank route is a payment that ticks the bank step.
 * Recording a payment never moves the order's stage.
 */
@Injectable()
export class CustomerPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly events: EventBus,
    private readonly orders: OrdersService,
    private readonly limits: LimitsService,
    private readonly settings: SettingsService,
    private readonly ledger: LedgerPosting,
  ) {}

  private async fx() {
    return fxOf(await this.settings.get(), await this.limits.allows("expenses"));
  }

  /* ---------------------------------------------------------------- reading */

  async forOrder(user: SessionUser, orderId: string) {
    const o = await this.orders.load(user, orderId);
    const all = await this.prisma.db.allocation.findMany({
      where: { orderId, ...orderPart },
      include: withMovement,
      orderBy: [{ on: "asc" }, { createdAt: "asc" }],
    });
    const live = all.filter((p) => !p.voidedAt);
    const position = positionOf(o, await this.fx());
    // Who recorded each payment, and where the order stood after it (counted payments in date order).
    const people = new Map(
      (
        await this.prisma.db.user.findMany({
          where: { id: { in: [...new Set(all.map((p) => p.recordedById))] } },
          select: { id: true, name: true },
        })
      ).map((u) => [u.id, u]),
    );
    let runningMinor = 0;
    const after = new Map<string, { receivedMinor: number; dueMinor: number }>();
    for (const p of live) {
      runningMinor += decimalToMinor(p.amount) + decimalToMinor(p.bankCharges);
      after.set(p.id, { receivedMinor: runningMinor, dueMinor: Math.max(position.owedMinor - runningMinor, 0) });
    }
    const credit = await creditOf(this.prisma.db, o.customerId);
    return {
      currency: o.currency,
      total: fromMinor(position.totalMinor),
      /** Expenses charged to the customer: part of what is due. */
      charged: fromMinor(position.chargedMinor),
      received: fromMinor(position.settledMinor),
      due: fromMinor(position.dueMinor),
      depositDue: fromMinor(position.depositOutstandingMinor),
      status: position.status,
      /** The customer's credit in the order's currency (money we hold for them), and whether it can pay this order now. */
      credit: {
        amount: fromMinor(credit[o.currency] ?? 0),
        canUse: can(user, "payments.record") && o.status !== "cancelled" && (credit[o.currency] ?? 0) > 0 && position.dueMinor > 0,
      },
      payments: all.map((p) => ({
        ...partView(p),
        /** Amount plus bank charges: what it settles. */
        counts: fromMinor(decimalToMinor(p.amount) + decimalToMinor(p.bankCharges)),
        recordedBy: people.get(p.recordedById) ?? null,
        recordedAt: p.createdAt,
        /** Received so far and still due once this payment counted (null when removed). */
        after: after.has(p.id) ? { received: fromMinor(after.get(p.id)!.receivedMinor), due: fromMinor(after.get(p.id)!.dueMinor) } : null,
        voided: p.voidedAt ? { at: p.voidedAt, reason: p.voidReason } : null,
      })),
    };
  }

  /**
   * A customer's payments across their orders (the ones this person may see):
   * each order with what was received and is still due and its next instalment
   * (for splitting a transfer, oldest due first), totals per currency
   * (cancelled orders left out), the credit we hold for them, and every payment.
   */
  async forCustomer(user: SessionUser, customerId: string) {
    const orders = await this.prisma.db.order.findMany({
      where: { ...orderAccess(user), customerId },
      select: {
        id: true,
        refNo: true,
        stage: true,
        currency: true,
        total: true,
        depositPercent: true,
        mainCurrency: true,
        mainRate: true,
        orderedOn: true,
        // What the order's one status word reads (with its status).
        ...wordSelect,
        receivables: { orderBy: { sortOrder: "asc" }, select: { id: true, label: true, amount: true, dueOn: true, part: true } },
        expenses: chargedExpenses,
      },
      orderBy: [{ orderedOn: "desc" }, { refNo: "desc" }],
    });
    const byId = new Map(orders.map((o) => [o.id, o]));
    // Each order's plan as it stands now (dates from the rules, names from the amounts).
    const plans = await livePlansOf(
      this.prisma.db,
      orders.map((o) => o.id),
    );
    const parts = orders.length
      ? await this.prisma.db.allocation.findMany({
          where: { orderId: { in: orders.map((o) => o.id) }, ...orderPart },
          include: withMovement,
          orderBy: [{ on: "desc" }, { createdAt: "desc" }],
        })
      : [];
    const today = this.clock.today();
    const settings = await this.settings.get();
    const soon = settings.reminders.dueSoonDays;
    const fx = fxOf(settings, await this.limits.allows("expenses"));
    const totals = new Map<string, { totalMinor: number; receivedMinor: number; dueMinor: number; orders: number }>();
    const features = await this.limits.features();
    const rows = orders.map((o) => {
      const live = parts.filter((p) => p.orderId === o.id && !p.voidedAt);
      const pos = positionOf({ ...o, allocations: live }, fx);
      if (o.status !== "cancelled") {
        const t = totals.get(o.currency) ?? { totalMinor: 0, receivedMinor: 0, dueMinor: 0, orders: 0 };
        t.totalMinor += pos.totalMinor;
        t.receivedMinor += pos.settledMinor;
        t.dueMinor += pos.dueMinor;
        t.orders += 1;
        totals.set(o.currency, t);
      }
      const plan = planStatus(plans.get(o.id)?.items ?? [], pos.settledMinor, today, soon);
      const next = plan.find((p) => p.status !== "paid") ?? null;
      return {
        id: o.id,
        refNo: o.refNo,
        status: o.status,
        stage: o.stage,
        /** Where it stands in one word (orderWord), as on the order's own page. */
        word: orderWord(wordFactsOf(o), features),
        currency: o.currency,
        orderedOn: fromDbDate(o.orderedOn),
        total: fromMinor(pos.totalMinor),
        charged: fromMinor(pos.chargedMinor),
        received: fromMinor(pos.settledMinor),
        due: fromMinor(pos.dueMinor),
        depositDue: fromMinor(pos.depositOutstandingMinor),
        payStatus: pos.status,
        lastPaidOn: live.length ? fromDbDate(live.reduce((a, b) => (a.on > b.on ? a : b)).on) : null,
        /** The next unpaid instalment (what a transfer pays first). */
        next: next && o.status !== "cancelled" ? { label: next.label, dueOn: next.dueOn, open: fromMinor(next.openMinor) } : null,
      };
    });
    return {
      totals: [...totals.entries()].map(([currency, t]) => ({
        currency,
        orders: t.orders,
        total: fromMinor(t.totalMinor),
        received: fromMinor(t.receivedMinor),
        due: fromMinor(t.dueMinor),
      })),
      orders: rows,
      credit: await this.creditView(user, customerId),
      payments: parts.map((p) => {
        const v = partView(p);
        return {
          id: v.id,
          order: { id: p.orderId!, refNo: byId.get(p.orderId!)!.refNo },
          kind: v.kind,
          amount: v.amount,
          bankCharges: v.bankCharges,
          currency: v.currency,
          receivedAmount: v.receivedAmount,
          receivedCurrency: v.receivedCurrency,
          paidOn: v.paidOn,
          method: v.method,
          reference: v.reference,
          receiptId: v.receiptId,
          voided: !!p.voidedAt,
          hasFile: !!v.file,
        };
      }),
    };
  }

  /**
   * The customer's credit: the balance per currency (what their money in still has unallocated) and its story,
   * newest first: left over from a transfer, kept from a cancelled order, used on an order, refunded, kept as a fee.
   */
  async creditView(user: SessionUser, customerId: string) {
    const movements = await this.prisma.db.moneyMovement.findMany({
      where: { partyId: customerId, partyRole: "customer" },
      include: {
        account: { select: { id: true, name: true } },
        allocations: { include: { order: { select: { id: true, refNo: true } } } },
        refunds: { select: { order: { select: { id: true, refNo: true } } }, take: 1 },
      },
    });
    type Entry = {
      id: string;
      kind: "in" | "used" | "refund" | "fee";
      amount: string;
      currency: string;
      on: ISODate;
      at: Date;
      note: string | null;
      order: { id: string; refNo: string } | null;
      account: { id: string; name: string } | null;
      receipt: { id: string; received: string; method: string; paidOn: ISODate } | null;
      voided: { at: Date; reason: string | null } | null;
    };
    const entries: Entry[] = [];
    const voidOf = (at: Date | null, reason: string | null) => (at ? { at, reason } : null);
    for (const m of movements) {
      if (m.direction === "out") {
        entries.push({
          id: m.id,
          kind: "refund",
          amount: m.amount.toFixed(2),
          currency: m.currency,
          on: fromDbDate(m.valueDate),
          at: m.createdAt,
          note: m.note,
          order: m.refunds[0]?.order ?? null,
          account: m.account,
          receipt: null,
          voided: voidOf(m.voidedAt, m.voidReason),
        });
        continue;
      }
      const receipt = { id: m.id, received: `${m.currency} ${m.amount.toFixed(2)}`, method: m.method, paidOn: fromDbDate(m.valueDate) };
      const atTime = m.allocations.filter((a) => !a.later);
      const leftMinor = decimalToMinor(m.allocatable) - atTime.reduce((t, a) => t + decimalToMinor(a.amount), 0);
      if (leftMinor > 0)
        entries.push({
          id: m.id,
          kind: "in",
          amount: fromMinor(leftMinor),
          currency: m.allocCurrency,
          on: fromDbDate(m.valueDate),
          at: m.createdAt,
          note: `Left over from ${m.currency} ${m.amount.toFixed(2)}${m.reference ? ` (${m.reference})` : ""}`,
          order: null,
          account: null,
          receipt,
          voided: voidOf(m.voidedAt, m.voidReason),
        });
      for (const a of m.allocations) {
        // Released (its order cancelled while the transfer stands): the money is credit again.
        if (!a.later && a.voidedAt && !m.voidedAt)
          entries.push({
            id: a.id,
            kind: "in",
            amount: a.amount.toFixed(2),
            currency: m.allocCurrency,
            on: todayIn(this.clock.timeZone, a.voidedAt) as ISODate,
            at: a.voidedAt,
            note: a.order ? `Kept from cancelled ${a.order.refNo}` : a.voidReason,
            order: a.order,
            account: null,
            receipt,
            voided: null,
          });
        if (!a.later || a.target === "refund") continue;
        entries.push({
          id: a.id,
          kind: a.target === "fee" ? "fee" : "used",
          amount: a.amount.toFixed(2),
          currency: m.allocCurrency,
          on: fromDbDate(a.on),
          at: a.createdAt,
          note: a.target === "fee" ? a.note : a.order ? `Used on ${a.order.refNo}` : null,
          order: a.order,
          account: null,
          receipt: null,
          voided: voidOf(a.voidedAt, a.voidReason),
        });
      }
    }
    entries.sort((a, b) => (a.on !== b.on ? (a.on < b.on ? 1 : -1) : b.at.getTime() - a.at.getTime()));
    const balances = await creditOf(this.prisma.db, customerId);
    return {
      balances: Object.entries(balances).map(([currency, m]) => ({ currency, amount: fromMinor(m) })),
      entries: entries.map(({ at: _at, ...e }) => e),
      canRecord: can(user, "payments.record"),
    };
  }

  /* ---------------------------------------------------------------- recording */

  /**
   * Units of `from` per one unit of `to`: 1 for the same currency, else the
   * rate given, or Settings when none is. A missing rate is refused, never 1:1.
   */
  private async rateFor(from: string, to: string, given: number | null | undefined) {
    if (from === to) return 1;
    if (given) return given;
    const { sales } = await this.settings.get();
    const r = fxRate(from, to, sales.currency, sales.exchangeRates);
    if (r === null)
      throw new DomainError(`There is no exchange rate for ${from} to ${to} in Settings. Enter the rate (${from} per 1 ${to}).`);
    // Kept to 6 decimals, as typed rates are.
    return Math.round(r * 1e6) / 1e6;
  }

  private checkDate(on: ISODate) {
    if (on > this.clock.today()) throw new DomainError("The payment date cannot be in the future.");
  }

  /** The other orders a transfer also pays: the same customer, the same currency, open, each part no more than is due. Locked. */
  private async otherParts(
    tx: Tx | PrismaService["db"],
    user: SessionUser,
    customerId: string,
    currency: string,
    parts: { orderId: string; amount: number }[],
    skip: string | null,
  ) {
    const seen = new Set<string>(skip ? [skip] : []);
    const out: Part[] = [];
    const fx = await this.fx();
    for (const p of [...parts].sort((a, b) => a.orderId.localeCompare(b.orderId))) {
      if (seen.has(p.orderId)) throw new DomainError("Each order can take one part of the payment.");
      seen.add(p.orderId);
      await tx.$queryRaw`select id from orders where id = ${p.orderId}::uuid for update`;
      const o = await this.orders.load(user, p.orderId, tx);
      if (o.customerId !== customerId) throw new DomainError(`${o.refNo} is another customer's order.`);
      if (o.status === "cancelled") throw new DomainError(`${o.refNo} is cancelled.`);
      if (o.currency !== currency)
        throw new DomainError(`${o.refNo} is in ${o.currency}: a transfer pays orders in one currency (${currency}).`);
      const pos = settledOf(o, o.allocations, fx);
      const amountMinor = toMinor(p.amount);
      if (amountMinor > pos.dueMinor)
        throw new DomainError(`${o.refNo}: that is more than is still due (${formatMinor(pos.dueMinor, o.currency)}).`);
      out.push({ order: o, kind: pos.depositOutstandingMinor > 0 ? "deposit" : "balance", amountMinor, bankChargesMinor: 0 });
    }
    // Back in the order they were sent.
    return parts.map((p) => out.find((x) => x.order.id === p.orderId)!);
  }

  /**
   * Saves one arrival: its payment entry, what it pays on each order (the last part, with nothing left over,
   * takes the rest of the transfer to the cent), and the rest unallocated (the customer's credit). Returns the
   * parts' ids (in the order of the parts) and the movement's.
   */
  private async save(tx: Tx, user: SessionUser, customerId: string, a: Arrived, parts: Part[], leftMinor: Minor) {
    const same = a.receivedCurrency === a.currency;
    const countsMinor = parts.reduce((t, p) => t + p.amountMinor, 0) + leftMinor;
    const split = parts.length !== 1 || leftMinor > 0;
    const m = await tx.moneyMovement.create({
      data: {
        direction: "in",
        partyRole: "customer",
        partyId: customerId,
        amount: fromMinor(a.receivedMinor),
        currency: a.receivedCurrency,
        allocCurrency: a.currency,
        rate: a.rate,
        allocatable: fromMinor(countsMinor),
        accountId: a.accountId,
        valueDate: toDbDate(a.paidOn),
        method: a.method,
        reference: a.reference,
        paidByName: a.paidByName,
        note: a.note,
        recordedById: user.id,
      },
    });
    const ids: string[] = [];
    let receivedLeft = a.receivedMinor;
    for (const [i, p] of parts.entries()) {
      // What of the transfer this part used, in the received currency.
      const share = !split
        ? a.receivedMinor
        : i === parts.length - 1 && leftMinor === 0
          ? receivedLeft
          : Math.min(receivedForMinor(p.amountMinor, a.rate, same), receivedLeft);
      receivedLeft -= share;
      const created = await tx.allocation.create({
        data: {
          movementId: m.id,
          target: "order",
          orderId: p.order.id,
          kind: p.kind,
          amount: fromMinor(p.amountMinor),
          bankCharges: fromMinor(p.bankChargesMinor),
          share: fromMinor(share),
          on: toDbDate(a.paidOn),
          recordedById: user.id,
        },
      });
      ids.push(created.id);
      const arrived = same ? "" : ` (${a.receivedCurrency} ${fromMinor(share)} at ${a.rate})`;
      await this.audit.record(tx, {
        userId: user.id,
        action: "payment_in",
        entityType: "order",
        entityId: p.order.id,
        summary: `${p.order.refNo}: received ${a.currency} ${fromMinor(p.amountMinor)}${arrived}${p.bankChargesMinor ? ` (+${fromMinor(p.bankChargesMinor)} bank charges)` : ""}${split ? " from one transfer" : ""}, ${a.reference ?? "no reference"}`,
      });
    }
    if (leftMinor > 0)
      await this.audit.record(tx, {
        userId: user.id,
        action: "credit_in",
        entityType: "customer",
        entityId: customerId,
        summary: `Credit ${a.currency} ${fromMinor(leftMinor)} left over from ${a.receivedCurrency} ${fromMinor(a.receivedMinor)}`,
      });
    // The ledger: the money in, off each order, the rest to the customer's credit.
    await this.ledger.post(tx, [{ type: "movement", id: m.id }, ...parts.map((p) => ({ type: "order_all" as const, id: p.order.id }))], {
      userId: user.id,
    });
    return { ids, movementId: m.id };
  }

  /**
   * Money in on an order. Older clients send `amount` in the order's currency;
   * money v2 sends what arrived (any currency, the rate) and `amount` as this
   * order's part. What is more than the order still owes (and than the other
   * orders named take) becomes the customer's credit, never refused.
   */
  async record(user: SessionUser, orderId: string, input: PaymentInput) {
    if (!can(user, "payments.record")) throw new ForbiddenError("Only accounts (managers) can record payments.");
    const cashBook = await this.checkInput(input);
    let createdId = "";
    const event = await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`select id from orders where id = ${orderId}::uuid for update`;
      const { o, a, parts, leftMinor, thisMinor } = await this.prepare(tx, user, orderId, input, cashBook);
      const { ids, movementId } = await this.save(tx, user, o.customerId, a, parts, leftMinor);
      // The new part (its proof follows on the payment entry); only credit: the entry itself.
      createdId = thisMinor > 0 ? ids[0]! : movementId;
      if (input.bankStep && thisMinor > 0) await this.moneyReachedUs(tx, user, o, createdId, input.paidOn, input.reference);
      return {
        type: "payment.recorded" as const,
        orderId,
        refNo: o.refNo,
        amount: `${o.currency} ${fromMinor(thisMinor)}`,
        actorId: user.id,
        notify: [o.inquiry.assigneeId].filter((v): v is string => !!v),
      };
    });
    await this.events.publish(event);
    /** `createdId`: the new payment, so its proof can follow. */
    return { ...(await this.forOrder(user, orderId)), createdId };
  }

  /**
   * The checks recording runs, without recording anything (a payment sent for approval): the same refusals
   * the person would get from record() now, apart from the permission to record. Things may still change
   * before it is approved; approving runs record() itself.
   */
  async check(user: SessionUser, orderId: string, input: PaymentInput) {
    const cashBook = await this.checkInput(input);
    const { o, thisMinor } = await this.prepare(this.prisma.db, user, orderId, input, cashBook);
    if (input.bankStep && thisMinor > 0 && !bankStepsFor(routeOf(o) as never).includes("bank_paid_us"))
      throw new DomainError("Money reaches us through the banks only on a bank contract or LC.");
    return { id: o.id, refNo: o.refNo };
  }

  /** What is checked before the order is opened: the date, the method, the plan. Returns whether the cash book is on. */
  private async checkInput(input: PaymentInput) {
    this.checkDate(input.paidOn);
    if (input.method === "credit") throw new DomainError("To pay from the customer's credit, use “Use credit”.");
    if (input.bankStep) await this.limits.require("bank_documents");
    return this.limits.allows("cash_book");
  }

  /** The order (locked by the caller when recording), what arrived, and how it splits over the orders and credit. */
  private async prepare(db: Tx | PrismaService["db"], user: SessionUser, orderId: string, input: PaymentInput, cashBook: boolean) {
    const o = await this.orders.load(user, orderId, db);
    if (o.status === "cancelled") throw new DomainError("This order is cancelled.");
    // Older clients: `currency` and `amount` are what arrived (the order's currency, or another with a rate).
    const receivedCurrency = input.receivedCurrency ?? input.currency;
    const same = receivedCurrency === o.currency;
    const receivedMinor = toMinor(input.receivedAmount ?? input.amount);
    if (receivedMinor <= 0) throw new DomainError("Enter the amount received.");
    const rate = await this.rateFor(receivedCurrency, o.currency, input.rate);
    const countsMinor = countsAsMinor(receivedMinor, rate, same);
    if (countsMinor <= 0) throw new DomainError("At that rate the payment counts as nothing. Check the rate.");
    const chargesMinor = toMinor(input.bankCharges);
    const before = settledOf(o, o.allocations, await this.fx());
    // This order's part: as sent (money v2), else what it counts as up to what is still due.
    const explicit = input.receivedAmount !== null && input.amount !== null ? toMinor(input.amount) : null;
    const thisMinor = explicit ?? Math.min(countsMinor, Math.max(before.dueMinor - chargesMinor, 0));
    if (thisMinor + chargesMinor > before.dueMinor)
      throw new DomainError(
        `That is more than is still due (${formatMinor(before.dueMinor, o.currency)}). The rest becomes the customer's credit: lower this order's part.`,
      );
    if (thisMinor <= 0 && !input.parts.length)
      throw new DomainError(`Nothing is due on ${o.refNo}. Record the money on the customer's page: it becomes their credit.`);
    const others = await this.otherParts(db, user, o.customerId, o.currency, input.parts, o.id);
    const leftMinor = countsMinor - thisMinor - others.reduce((t, p) => t + p.amountMinor, 0);
    if (leftMinor < 0)
      throw new DomainError(`The parts add up to more than the payment counts as (${formatMinor(countsMinor, o.currency)}).`);
    // What the money pays (the deposit while it is open, else the balance); only "other" is taken as sent.
    const kind: PaymentKind = input.kind === "other" ? "other" : before.depositOutstandingMinor > 0 ? "deposit" : "balance";
    const parts: Part[] = [
      ...(thisMinor > 0 ? [{ order: o, kind, amountMinor: thisMinor, bankChargesMinor: chargesMinor }] : []),
      ...others,
    ];
    const a: Arrived = {
      receivedMinor,
      receivedCurrency,
      currency: o.currency,
      rate,
      accountId: await checkAccount(db, input.accountId, receivedCurrency, null, cashBook),
      paidOn: input.paidOn,
      method: input.method,
      reference: input.reference,
      paidByName: input.paidByName,
      note: input.note,
    };
    return { o, a, parts, leftMinor, thisMinor };
  }

  /** "Money reached us" ticked by the payment that recorded it (bank routes only). */
  private async moneyReachedUs(
    tx: Tx,
    user: SessionUser,
    o: WithTerms & { id: string; refNo: string },
    allocationId: string,
    on: ISODate,
    reference: string | null,
  ) {
    if (!bankStepsFor(routeOf(o) as never).includes("bank_paid_us"))
      throw new DomainError("Money reaches us through the banks only on a bank contract or LC.");
    const data = { doneOn: toDbDate(on), reference, allocationId };
    await tx.orderBankStep.upsert({
      where: { orderId_step: { orderId: o.id, step: "bank_paid_us" } },
      create: { orderId: o.id, step: "bank_paid_us", ...data },
      update: data,
    });
    await this.audit.record(tx, {
      userId: user.id,
      action: "flow.bank_step",
      entityType: "order",
      entityId: o.id,
      summary: `${o.refNo}: Money reached us (${on}${reference ? `, ${reference}` : ""}) with the payment`,
      newValues: { step: "bank_paid_us", doneOn: on, reference, paymentId: allocationId },
    });
  }

  /**
   * One transfer recorded on the customer's page: the parts per order (the
   * screen fills the oldest due first); the rest is their credit.
   */
  async receive(user: SessionUser, customerId: string, input: CustomerReceiptInput) {
    if (!can(user, "payments.record")) throw new ForbiddenError("Only accounts (managers) can record payments.");
    this.checkDate(input.paidOn);
    if (input.method === "credit") throw new DomainError("Choose how the money came in.");
    const customer = await this.prisma.db.party.findFirst({ where: { ...isCustomer, id: customerId, deletedAt: null } });
    if (!customer) throw new NotFoundError("Customer");
    const cashBook = await this.limits.allows("cash_book");
    const rate = await this.rateFor(input.receivedCurrency, input.currency, input.rate);
    const receivedMinor = toMinor(input.receivedAmount);
    const countsMinor = countsAsMinor(receivedMinor, rate, input.receivedCurrency === input.currency);
    const events = await this.prisma.tx(async (tx) => {
      const parts = await this.otherParts(tx, user, customerId, input.currency, input.parts, null);
      const leftMinor = countsMinor - parts.reduce((t, p) => t + p.amountMinor, 0);
      if (leftMinor < 0)
        throw new DomainError(`The parts add up to more than the payment counts as (${formatMinor(countsMinor, input.currency)}).`);
      await this.save(
        tx,
        user,
        customerId,
        {
          receivedMinor,
          receivedCurrency: input.receivedCurrency,
          currency: input.currency,
          rate,
          accountId: await checkAccount(tx, input.accountId, input.receivedCurrency, null, cashBook),
          paidOn: input.paidOn,
          method: input.method,
          reference: input.reference,
          paidByName: input.paidByName,
          note: input.note,
        },
        parts,
        leftMinor,
      );
      return parts.map((p) => ({
        type: "payment.recorded" as const,
        orderId: p.order.id,
        refNo: p.order.refNo,
        amount: `${input.currency} ${fromMinor(p.amountMinor)}`,
        actorId: user.id,
        notify: [p.order.inquiry.assigneeId].filter((v): v is string => !!v),
      }));
    });
    await this.events.publish(...events);
    return this.forCustomer(user, customerId);
  }

  /* ---------------------------------------------------------------- credit */

  /** Pays (part of) an order from the customer's credit: allocations of their money in that pays nothing yet (oldest first). */
  async useCredit(user: SessionUser, orderId: string, input: UseCreditInput) {
    if (!can(user, "payments.record")) throw new ForbiddenError("Only accounts (managers) can record payments.");
    const on = input.on ?? this.clock.today();
    this.checkDate(on);
    await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`select id from orders where id = ${orderId}::uuid for update`;
      const o = await this.orders.load(user, orderId, tx);
      if (o.status === "cancelled") throw new DomainError("This order is cancelled.");
      await tx.$queryRaw`select id from parties where id = ${o.customerId}::uuid for update`;
      const amountMinor = toMinor(input.amount);
      const pos = settledOf(o, o.allocations, await this.fx());
      const balance = (await creditOf(tx, o.customerId))[o.currency] ?? 0;
      if (amountMinor > balance) throw new DomainError(`The customer has ${formatMinor(balance, o.currency)} of credit.`);
      if (amountMinor > pos.dueMinor) throw new DomainError(`That is more than is still due (${formatMinor(pos.dueMinor, o.currency)}).`);
      await fromCredit(tx, {
        partyId: o.customerId,
        currency: o.currency,
        amountMinor,
        target: "order",
        orderId,
        kind: pos.depositOutstandingMinor > 0 ? "deposit" : "balance",
        on,
        recordedById: user.id,
      });
      await this.audit.record(tx, {
        userId: user.id,
        action: "payment_credit",
        entityType: "order",
        entityId: orderId,
        summary: `${o.refNo}: paid ${o.currency} ${fromMinor(amountMinor)} from the customer's credit`,
      });
      await this.ledger.post(tx, [{ type: "order_all", id: orderId }], { userId: user.id });
    });
    return this.forOrder(user, orderId);
  }

  /** Pays the customer's credit back (from an account, on a day). */
  async refundCredit(user: SessionUser, customerId: string, input: CreditRefundInput) {
    if (!can(user, "payments.record")) throw new ForbiddenError("Only accounts (managers) can record payments.");
    this.checkDate(input.on);
    const customer = await this.prisma.db.party.findFirst({ where: { ...isCustomer, id: customerId } });
    if (!customer) throw new NotFoundError("Customer");
    const cashBook = await this.limits.allows("cash_book");
    await this.prisma.tx(async (tx) => {
      await this.refundIn(
        tx,
        user,
        customerId,
        toMinor(input.amount),
        input.currency,
        input.on,
        await checkAccount(tx, input.accountId, input.currency, null, cashBook),
        input.note,
        null,
      );
    });
    return this.creditView(user, customerId);
  }

  /** Money out paying the credit back (inside the caller's transaction), after checking the credit covers it. */
  async refundIn(
    tx: Tx,
    user: SessionUser,
    customerId: string,
    amountMinor: Minor,
    currency: string,
    on: ISODate,
    accountId: string | null,
    note: string | null,
    orderId: string | null,
    prefer: string[] = [],
  ) {
    await tx.$queryRaw`select id from parties where id = ${customerId}::uuid for update`;
    const id = await refund(tx, {
      partyId: customerId,
      currency,
      amountMinor,
      accountId,
      on,
      note,
      recordedById: user.id,
      prefer,
      orderId,
    });
    await this.ledger.post(tx, [{ type: "movement", id }], { userId: user.id });
    await this.audit.record(tx, {
      userId: user.id,
      action: "credit_refund",
      entityType: orderId ? "order" : "customer",
      entityId: orderId ?? customerId,
      summary: `Refunded ${currency} ${fromMinor(amountMinor)} of the customer's credit`,
    });
  }

  /** A refund recorded by mistake (managers): it stays listed, crossed out, and the credit is back. */
  async voidCredit(user: SessionUser, id: string, reason: string) {
    if (!can(user, "orders.manage")) throw new ForbiddenError("Only a manager can remove a refund.");
    const m = await this.prisma.db.moneyMovement.findUnique({ where: { id } });
    if (!m || m.direction !== "out" || m.partyRole !== "customer") {
      if (m || (await this.prisma.db.allocation.findUnique({ where: { id } })))
        throw new DomainError("Only a refund is removed here; remove the payment or the transfer it belongs to.");
      throw new NotFoundError("Credit entry");
    }
    if (m.voidedAt) throw new DomainError("This entry was already removed.");
    await this.prisma.tx(async (tx) => {
      await voidMovement(tx, id, reason);
      await this.audit.record(tx, {
        userId: user.id,
        action: "credit_refund_void",
        entityType: "customer",
        entityId: m.partyId!,
        summary: `Removed the refund of ${m.currency} ${m.amount.toFixed(2)}`,
        reason,
      });
      await this.ledger.post(tx, [{ type: "movement", id }], { userId: user.id, reason });
    });
    return this.creditView(user, m.partyId!);
  }

  /** A transfer recorded by mistake (managers): it and what it pays are removed together. */
  async voidReceipt(user: SessionUser, id: string, reason: string) {
    if (!can(user, "orders.manage")) throw new ForbiddenError("Only a manager can remove a payment.");
    const m = await this.prisma.db.moneyMovement.findUnique({
      where: { id },
      include: { allocations: { where: { voidedAt: null, ...orderPart } } },
    });
    if (!m || m.direction !== "in" || m.partyRole !== "customer") throw new NotFoundError("Payment");
    if (m.voidedAt) throw new DomainError("This payment was already removed.");
    for (const p of m.allocations) await this.orders.load(user, p.orderId!);
    await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`select id from parties where id = ${m.partyId!}::uuid for update`;
      const { orderIds, partIds } = await voidMovement(tx, id, reason);
      await tx.orderBankStep.deleteMany({ where: { allocationId: { in: partIds } } });
      for (const p of m.allocations)
        await this.audit.record(tx, {
          userId: user.id,
          action: "payment_void",
          entityType: "order",
          entityId: p.orderId!,
          summary: `Removed payment of ${m.allocCurrency} ${p.amount.toFixed(2)} (one transfer)`,
          reason,
        });
      await this.ledger.post(tx, [{ type: "movement", id }, ...orderIds.map((o) => ({ type: "order_all" as const, id: o }))], {
        userId: user.id,
        reason,
      });
    });
    return this.forCustomer(user, m.partyId!);
  }

  /* ---------------------------------------------------------------- changing and removing */

  private async part(id: string) {
    const p = await this.prisma.db.allocation.findUnique({ where: { id }, include: withMovement });
    if (!p || p.target !== "order") throw new NotFoundError("Payment");
    return p;
  }

  /** A payment typed wrong (amount, date, reference, rate): changed with a reason, kept in the order's history. */
  async edit(user: SessionUser, paymentId: string, input: EditPaymentInput) {
    if (!can(user, "payments.record")) throw new ForbiddenError("Only accounts (managers) can change payments.");
    this.checkDate(input.paidOn);
    const p = await this.part(paymentId);
    const m = p.movement;
    const cashBook = await this.limits.allows("cash_book");
    if (p.voidedAt) throw new DomainError("This payment was removed.");
    if (transferOf(p))
      throw new DomainError("This payment is part of one transfer over several orders. Remove the transfer and record it again.");
    if (p.later) throw new DomainError("This payment came from the customer's credit. Remove it and use the credit again.");
    if (input.method === "credit") throw new DomainError("To pay from the customer's credit, use “Use credit”.");
    const reason = requireReason(input.reason, "payment", "a recorded payment changes");
    const orderId = p.orderId!;
    await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`select id from orders where id = ${orderId}::uuid for update`;
      const o = await this.orders.load(user, orderId, tx);
      const receivedCurrency = input.receivedCurrency ?? input.currency;
      const same = receivedCurrency === o.currency;
      const receivedMinor = toMinor(input.receivedAmount ?? input.amount);
      if (receivedMinor <= 0) throw new DomainError("Enter the amount received.");
      // The rate stays as recorded while the currency stays, unless a new one is sent.
      const rate = await this.rateFor(
        receivedCurrency,
        o.currency,
        input.rate ?? (receivedCurrency === m.currency ? Number(m.rate) : null),
      );
      const amountMinor = countsAsMinor(receivedMinor, rate, same);
      const fx = await this.fx();
      const others = settledOf(
        o,
        o.allocations.filter((x) => x.id !== p.id),
        fx,
      );
      if (amountMinor + toMinor(input.bankCharges) > others.dueMinor)
        throw new DomainError(`That is more than is still due (${formatMinor(others.dueMinor, o.currency)}).`);
      // What it pays, against the payments before it; "other" only when sent so (or kept so when not sent).
      const kind: PaymentKind =
        input.kind === "other" || (input.kind === undefined && p.kind === "other")
          ? "other"
          : settledOf(
                o,
                o.allocations.filter(
                  (x) =>
                    x.id !== p.id && (fromDbDate(x.on) < input.paidOn || (fromDbDate(x.on) === input.paidOn && x.createdAt < p.createdAt)),
                ),
                fx,
              ).depositOutstandingMinor > 0
            ? "deposit"
            : "balance";
      await tx.moneyMovement.update({
        where: { id: m.id },
        data: {
          amount: fromMinor(receivedMinor),
          currency: receivedCurrency,
          rate,
          allocatable: fromMinor(amountMinor),
          paidByName: input.paidByName,
          valueDate: toDbDate(input.paidOn),
          method: input.method,
          reference: input.reference,
          note: input.note,
          accountId: await checkAccount(tx, input.accountId, receivedCurrency, m.accountId, cashBook),
        },
      });
      await tx.allocation.update({
        where: { id: p.id },
        data: {
          kind,
          amount: fromMinor(amountMinor),
          bankCharges: input.bankCharges,
          share: fromMinor(receivedMinor),
          on: toDbDate(input.paidOn),
        },
      });
      await tx.orderBankStep.updateMany({
        where: { allocationId: p.id },
        data: { doneOn: toDbDate(input.paidOn), reference: input.reference },
      });
      await this.audit.record(tx, {
        userId: user.id,
        action: "payment_edit",
        entityType: "order",
        entityId: o.id,
        summary: `${o.refNo}: changed a payment from the customer`,
        oldValues: {
          amount: p.amount.toFixed(2),
          received: `${m.currency} ${m.amount.toFixed(2)}`,
          rate: Number(m.rate),
          bankCharges: p.bankCharges.toFixed(2),
          paidOn: fromDbDate(p.on),
          reference: m.reference,
        },
        newValues: {
          amount: fromMinor(amountMinor),
          received: `${receivedCurrency} ${fromMinor(receivedMinor)}`,
          rate,
          bankCharges: fromMinor(toMinor(input.bankCharges)),
          paidOn: input.paidOn,
          reference: input.reference,
        },
        reason,
      });
      await this.ledger.post(
        tx,
        [
          { type: "movement", id: m.id },
          { type: "order_all", id: o.id },
        ],
        { userId: user.id, reason },
      );
    });
    return this.forOrder(user, orderId);
  }

  /** A payment recorded by mistake. It stays visible, crossed out (from credit: the credit comes back; money reached us: the step is open again). */
  async void(user: SessionUser, paymentId: string, reason: string) {
    if (!can(user, "orders.manage")) throw new ForbiddenError("Only a manager can remove a payment.");
    const p = await this.part(paymentId);
    const o = await this.orders.load(user, p.orderId!);
    if (p.voidedAt) throw new DomainError("This payment was already removed.");
    if (transferOf(p))
      throw new DomainError("This payment is part of one transfer over several orders. Remove the transfer on the customer's page.");
    await this.prisma.tx(async (tx) => {
      const refs: LedgerRef[] = [{ type: "order_all", id: o.id }];
      if (p.later) {
        // From credit: only this allocation goes; the money is credit again.
        await tx.allocation.update({ where: { id: p.id }, data: { voidedAt: new Date(), voidReason: reason } });
        refs.push({ type: "allocation", id: p.id });
      } else {
        await voidMovement(tx, p.movementId, reason);
        refs.push({ type: "movement", id: p.movementId });
      }
      const steps = await tx.orderBankStep.deleteMany({ where: { allocationId: p.id } });
      await this.audit.record(tx, {
        userId: user.id,
        action: "payment_void",
        entityType: "order",
        entityId: o.id,
        summary: `${o.refNo}: removed payment of ${p.movement.allocCurrency} ${p.amount.toFixed(2)}${p.later ? " (the credit is back)" : ""}${steps.count ? " (Money reached us undone)" : ""}`,
        reason,
      });
      await this.ledger.post(tx, refs, { userId: user.id, reason });
    });
    return this.forOrder(user, o.id);
  }
}
