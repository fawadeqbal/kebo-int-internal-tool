import { Injectable } from "@nestjs/common";
import { decimalToMinor, fromDbDate, toDbDate, type Prisma, isCustomer } from "@kebo/database";
import { formatMinor, fromMinor, fxRate, toMinor, type Minor } from "@kebo/money";
import {
  bankStepsFor,
  can,
  countsAsMinor,
  creditBalances,
  planStatus,
  receivedForMinor,
  type CreditRefundInput,
  type CustomerReceiptInput,
  type EditPaymentInput,
  type PaymentInput,
  type PaymentKind,
  type PaymentMethod,
  type UseCreditInput,
} from "@kebo/shared";
import { DomainError, ForbiddenError, NotFoundError, type ISODate } from "@kebo/utils";
import { PrismaService, type Tx } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { Clock } from "../../common/time/clock.service";
import { EventBus } from "../../common/events/event-bus";
import type { SessionUser } from "../../common/auth/session-user";
import { orderAccess, OrdersService } from "./orders.service";
import { requireReason } from "../../common/audit/reason";
import { checkAccount } from "../money/account-check";
import { LimitsService } from "../../common/company/limits.service";
import { fileView } from "../money/payment-file-view";
import { SettingsService } from "../settings/settings.service";
import { chargedExpenses, fxOf, positionOf, type PositionFacts, type MoneyCtx } from "../money/position";
import { livePlansOf } from "../money/plan-live";
import { LedgerPosting } from "../ledger/posting.service";

type Live = { amount: Prisma.Decimal; bankCharges: Prisma.Decimal; currency: string };
/** Where the order stands with these payments (orderPosition: what was charged to the customer can be paid too). */
const settledOf = (o: Omit<PositionFacts, "payments">, payments: Live[], fx: MoneyCtx) => positionOf({ ...o, payments }, fx);

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

/**
 * Money in from the customer against their orders (money v2):
 * - what really arrived is kept (amount, currency, account of that currency,
 *   who paid) with the rate agreed; the payment counts on the order in the
 *   order's currency (received ÷ rate, to the cent) and never moves with later rates;
 * - one transfer can pay several orders (a customer receipt); what is left over
 *   is the customer's credit, which can pay an order later or be refunded;
 * - "Money reached us" on a bank route is a payment that ticks the bank step.
 * Recording a payment never moves the order's stage.
 */
@Injectable()
export class PaymentsService {
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

  /* ---------------------------------------------------------------- reading */

  async forOrder(user: SessionUser, orderId: string) {
    const o = await this.orders.load(user, orderId);
    const all = await this.prisma.db.payment.findMany({
      where: { orderId },
      include: { account: { select: { id: true, name: true } } },
      orderBy: [{ paidOn: "asc" }, { createdAt: "asc" }],
    });
    const live = all.filter((p) => !p.voidedAt);
    const position = positionOf(o, fxOf(await this.settings.get(), await this.limits.allows("expenses")));
    // Who recorded each payment, and where the order stood after it (counted payments in date order).
    const people = new Map(
      (await this.prisma.db.user.findMany({ where: { id: { in: [...new Set(all.map((p) => p.recordedById))] } }, select: { id: true, name: true } })).map((u) => [u.id, u]),
    );
    let runningMinor = 0;
    const after = new Map<string, { receivedMinor: number; dueMinor: number }>();
    for (const p of live) {
      runningMinor += decimalToMinor(p.amount) + decimalToMinor(p.bankCharges);
      after.set(p.id, { receivedMinor: runningMinor, dueMinor: Math.max(position.owedMinor - runningMinor, 0) });
    }
    const credit = await this.creditOf(o.customerId);
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
        id: p.id,
        /** Its receipt's number (RC-…-n), given when it was recorded and never moved. */
        receiptNo: p.receiptNo,
        kind: p.kind,
        amount: p.amount.toFixed(2),
        bankCharges: p.bankCharges.toFixed(2),
        currency: p.currency,
        /** What really arrived, in its currency, and the rate it was counted at (units per one of the order's currency). */
        receivedAmount: p.receivedAmount.toFixed(2),
        receivedCurrency: p.receivedCurrency,
        rate: Number(p.rate),
        paidByName: p.paidByName,
        /** Part of one transfer over several orders (and credit). */
        receiptId: p.receiptId,
        paidOn: fromDbDate(p.paidOn),
        method: p.method,
        reference: p.reference,
        note: p.note,
        account: p.account ? { id: p.account.id, name: p.account.name } : null,
        /** Amount plus bank charges: what it settles. */
        counts: fromMinor(decimalToMinor(p.amount) + decimalToMinor(p.bankCharges)),
        recordedBy: people.get(p.recordedById) ?? null,
        recordedAt: p.createdAt,
        /** Received so far and still due once this payment counted (null when removed or in another currency). */
        after: after.has(p.id) ? { received: fromMinor(after.get(p.id)!.receivedMinor), due: fromMinor(after.get(p.id)!.dueMinor) } : null,
        voided: p.voidedAt ? { at: p.voidedAt, reason: p.voidReason } : null,
        /** A photo or PDF proving it (bank slip, transfer screenshot). */
        file: fileView(p),
      })),
    };
  }

  /** The customer's credit balance per currency (live rows). */
  private async creditOf(customerId: string, db: PrismaService["db"] | Tx = this.prisma.db): Promise<Record<string, Minor>> {
    const rows = await db.customerCredit.findMany({ where: { customerId, voidedAt: null }, select: { kind: true, amount: true, currency: true } });
    return creditBalances(rows.map((r) => ({ kind: r.kind, amountMinor: decimalToMinor(r.amount), currency: r.currency })));
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
        status: true,
        stage: true,
        currency: true,
        total: true,
        depositPercent: true,
        mainCurrency: true,
        mainRate: true,
        orderedOn: true,
        planItems: { orderBy: { sortOrder: "asc" }, select: { id: true, label: true, amount: true, dueOn: true, part: true } },
        expenses: chargedExpenses,
      },
      orderBy: [{ orderedOn: "desc" }, { refNo: "desc" }],
    });
    const byId = new Map(orders.map((o) => [o.id, o]));
    // Each order's plan as it stands now (dates from the rules, names from the amounts).
    const plans = await livePlansOf(this.prisma.db, orders.map((o) => o.id));
    const payments = orders.length
      ? await this.prisma.db.payment.findMany({
          where: { orderId: { in: orders.map((o) => o.id) } },
          orderBy: [{ paidOn: "desc" }, { createdAt: "desc" }],
        })
      : [];
    const today = this.clock.today();
    const settings = await this.settings.get();
    const soon = settings.reminders.dueSoonDays;
    const fx = fxOf(settings, await this.limits.allows("expenses"));
    const totals = new Map<string, { totalMinor: number; receivedMinor: number; dueMinor: number; orders: number }>();
    const rows = orders.map((o) => {
      const live = payments.filter((p) => p.orderId === o.id && !p.voidedAt);
      const pos = positionOf({ ...o, payments: live }, fx);
      if (o.status !== "cancelled") {
        const t = totals.get(o.currency) ?? { totalMinor: 0, receivedMinor: 0, dueMinor: 0, orders: 0 };
        t.totalMinor += pos.totalMinor;
        t.receivedMinor += pos.settledMinor;
        t.dueMinor += pos.dueMinor;
        t.orders += 1;
        totals.set(o.currency, t);
      }
      const plan = planStatus(
        plans.get(o.id)?.items ?? [],
        pos.settledMinor,
        today,
        soon,
      );
      const next = plan.find((p) => p.status !== "paid") ?? null;
      return {
        id: o.id,
        refNo: o.refNo,
        status: o.status,
        stage: o.stage,
        currency: o.currency,
        orderedOn: fromDbDate(o.orderedOn),
        total: fromMinor(pos.totalMinor),
        charged: fromMinor(pos.chargedMinor),
        received: fromMinor(pos.settledMinor),
        due: fromMinor(pos.dueMinor),
        depositDue: fromMinor(pos.depositOutstandingMinor),
        payStatus: pos.status,
        lastPaidOn: live.length ? fromDbDate(live.reduce((a, b) => (a.paidOn > b.paidOn ? a : b)).paidOn) : null,
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
      payments: payments.map((p) => ({
        id: p.id,
        order: { id: p.orderId, refNo: byId.get(p.orderId)!.refNo },
        kind: p.kind,
        amount: p.amount.toFixed(2),
        bankCharges: p.bankCharges.toFixed(2),
        currency: p.currency,
        receivedAmount: p.receivedAmount.toFixed(2),
        receivedCurrency: p.receivedCurrency,
        paidOn: fromDbDate(p.paidOn),
        method: p.method,
        reference: p.reference,
        receiptId: p.receiptId,
        voided: !!p.voidedAt,
        hasFile: !!fileView(p),
      })),
    };
  }

  /** The customer's credit: balance per currency and every entry, newest first. */
  async creditView(user: SessionUser, customerId: string) {
    const rows = await this.prisma.db.customerCredit.findMany({
      where: { customerId },
      include: {
        order: { select: { id: true, refNo: true } },
        account: { select: { id: true, name: true } },
        receipt: { select: { id: true, receivedAmount: true, receivedCurrency: true, method: true, paidOn: true } },
      },
      orderBy: [{ on: "desc" }, { createdAt: "desc" }],
    });
    const balances = creditBalances(rows.filter((r) => !r.voidedAt).map((r) => ({ kind: r.kind, amountMinor: decimalToMinor(r.amount), currency: r.currency })));
    return {
      balances: Object.entries(balances)
        .filter(([, m]) => m !== 0)
        .map(([currency, m]) => ({ currency, amount: fromMinor(m) })),
      entries: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        amount: r.amount.toFixed(2),
        currency: r.currency,
        on: fromDbDate(r.on),
        note: r.note,
        order: r.order,
        account: r.account,
        receipt: r.receipt && {
          id: r.receipt.id,
          received: `${r.receipt.receivedCurrency} ${r.receipt.receivedAmount.toFixed(2)}`,
          method: r.receipt.method,
          paidOn: fromDbDate(r.receipt.paidOn),
        },
        voided: r.voidedAt ? { at: r.voidedAt, reason: r.voidReason } : null,
      })),
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
    if (r === null) throw new DomainError(`There is no exchange rate for ${from} to ${to} in Settings. Enter the rate (${from} per 1 ${to}).`);
    // Kept to 6 decimals, as typed rates are.
    return Math.round(r * 1e6) / 1e6;
  }

  private checkDate(on: ISODate) {
    if (on > this.clock.today()) throw new DomainError("The payment date cannot be in the future.");
  }

  /** The other orders a transfer also pays: the same customer, the same currency, open, each part no more than is due. Locked. */
  private async otherParts(tx: Tx | PrismaService["db"], user: SessionUser, customerId: string, currency: string, parts: { orderId: string; amount: number }[], skip: string | null) {
    const seen = new Set<string>(skip ? [skip] : []);
    const out: Part[] = [];
    for (const p of [...parts].sort((a, b) => a.orderId.localeCompare(b.orderId))) {
      if (seen.has(p.orderId)) throw new DomainError("Each order can take one part of the payment.");
      seen.add(p.orderId);
      await tx.$queryRaw`select id from orders where id = ${p.orderId}::uuid for update`;
      const o = await this.orders.load(user, p.orderId, tx);
      if (o.customerId !== customerId) throw new DomainError(`${o.refNo} is another customer's order.`);
      if (o.status === "cancelled") throw new DomainError(`${o.refNo} is cancelled.`);
      if (o.currency !== currency) throw new DomainError(`${o.refNo} is in ${o.currency}: a transfer pays orders in one currency (${currency}).`);
      const pos = settledOf(o, o.payments, fxOf(await this.settings.get(), await this.limits.allows("expenses")));
      const amountMinor = toMinor(p.amount);
      if (amountMinor > pos.dueMinor) throw new DomainError(`${o.refNo}: that is more than is still due (${formatMinor(pos.dueMinor, o.currency)}).`);
      out.push({ order: o, kind: pos.depositOutstandingMinor > 0 ? "deposit" : "balance", amountMinor, bankChargesMinor: 0 });
    }
    // Back in the order they were sent.
    return parts.map((p) => out.find((x) => x.order.id === p.orderId)!);
  }

  /**
   * Saves one arrival: a plain payment when it pays one order exactly; else a
   * customer receipt with a payment per order and the rest as credit. Returns
   * the payment ids (in the order of the parts).
   */
  private async save(tx: Tx, user: SessionUser, customerId: string, a: Arrived, parts: Part[], leftMinor: Minor) {
    const same = a.receivedCurrency === a.currency;
    const split = parts.length !== 1 || leftMinor > 0;
    let receiptId: string | null = null;
    if (split) {
      const r = await tx.customerReceipt.create({
        data: {
          customerId,
          receivedAmount: fromMinor(a.receivedMinor),
          receivedCurrency: a.receivedCurrency,
          currency: a.currency,
          rate: a.rate,
          accountId: a.accountId,
          paidOn: toDbDate(a.paidOn),
          method: a.method,
          reference: a.reference,
          paidByName: a.paidByName,
          note: a.note,
          recordedById: user.id,
        },
      });
      receiptId = r.id;
    }
    const ids: string[] = [];
    let receivedLeft = a.receivedMinor;
    for (const [i, p] of parts.entries()) {
      // What of the transfer this part used, in the received currency (the last part, with no credit, takes the rest).
      const share = !split ? a.receivedMinor : i === parts.length - 1 && leftMinor === 0 ? receivedLeft : Math.min(receivedForMinor(p.amountMinor, a.rate, same), receivedLeft);
      receivedLeft -= share;
      const created = await tx.payment.create({
        data: {
          kind: p.kind,
          orderId: p.order.id,
          customerId,
          amount: fromMinor(p.amountMinor),
          bankCharges: fromMinor(p.bankChargesMinor),
          currency: a.currency,
          receivedAmount: fromMinor(share),
          receivedCurrency: a.receivedCurrency,
          rate: a.rate,
          paidByName: a.paidByName,
          receiptId,
          paidOn: toDbDate(a.paidOn),
          method: a.method,
          reference: a.reference,
          note: a.note,
          accountId: a.accountId,
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
    if (leftMinor > 0) {
      await tx.customerCredit.create({
        data: {
          customerId,
          kind: "in",
          amount: fromMinor(leftMinor),
          currency: a.currency,
          receiptId,
          on: toDbDate(a.paidOn),
          note: `Left over from ${a.receivedCurrency} ${fromMinor(a.receivedMinor)}${a.reference ? ` (${a.reference})` : ""}`,
          recordedById: user.id,
        },
      });
      await this.audit.record(tx, {
        userId: user.id,
        action: "credit_in",
        entityType: "customer",
        entityId: customerId,
        summary: `Credit ${a.currency} ${fromMinor(leftMinor)} left over from ${a.receivedCurrency} ${fromMinor(a.receivedMinor)}`,
      });
    }
    // The ledger: the money in, off each order, the rest to the customer's credit.
    await this.ledger.post(tx, [...parts.map((p) => ({ type: "order_all" as const, id: p.order.id })), ...(receiptId ? [{ type: "receipt" as const, id: receiptId }] : [])], { userId: user.id });
    return ids;
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
      const ids = await this.save(tx, user, o.customerId, a, parts, leftMinor);
      createdId = ids[0] ?? "";
      if (input.bankStep && thisMinor > 0) await this.moneyReachedUs(tx, user, o, createdId, input.paidOn, input.reference);
      return { type: "payment.recorded" as const, orderId, refNo: o.refNo, amount: `${o.currency} ${fromMinor(thisMinor)}`, actorId: user.id, notify: [o.inquiry.assigneeId].filter((v): v is string => !!v) };
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
    if (input.bankStep && thisMinor > 0 && !bankStepsFor(o.paymentRoute as never).includes("bank_paid_us"))
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
    const before = settledOf(o, o.payments, fxOf(await this.settings.get(), await this.limits.allows("expenses")));
    // This order's part: as sent (money v2), else what it counts as up to what is still due.
    const explicit = input.receivedAmount !== null && input.amount !== null ? toMinor(input.amount) : null;
    const thisMinor = explicit ?? Math.min(countsMinor, Math.max(before.dueMinor - chargesMinor, 0));
    if (thisMinor + chargesMinor > before.dueMinor)
      throw new DomainError(`That is more than is still due (${formatMinor(before.dueMinor, o.currency)}). The rest becomes the customer's credit: lower this order's part.`);
    if (thisMinor <= 0 && !input.parts.length)
      throw new DomainError(`Nothing is due on ${o.refNo}. Record the money on the customer's page: it becomes their credit.`);
    const others = await this.otherParts(db, user, o.customerId, o.currency, input.parts, o.id);
    const leftMinor = countsMinor - thisMinor - others.reduce((t, p) => t + p.amountMinor, 0);
    if (leftMinor < 0)
      throw new DomainError(`The parts add up to more than the payment counts as (${formatMinor(countsMinor, o.currency)}).`);
    // What the money pays (the deposit while it is open, else the balance); only "other" is taken as sent.
    const kind: PaymentKind = input.kind === "other" ? "other" : before.depositOutstandingMinor > 0 ? "deposit" : "balance";
    const parts: Part[] = [...(thisMinor > 0 ? [{ order: o, kind, amountMinor: thisMinor, bankChargesMinor: chargesMinor }] : []), ...others];
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
  private async moneyReachedUs(tx: Tx, user: SessionUser, o: { id: string; refNo: string; paymentRoute: string | null }, paymentId: string, on: ISODate, reference: string | null) {
    if (!bankStepsFor(o.paymentRoute as never).includes("bank_paid_us")) throw new DomainError("Money reaches us through the banks only on a bank contract or LC.");
    const data = { doneOn: toDbDate(on), reference, paymentId };
    await tx.orderBankStep.upsert({ where: { orderId_step: { orderId: o.id, step: "bank_paid_us" } }, create: { orderId: o.id, step: "bank_paid_us", ...data }, update: data });
    await this.audit.record(tx, {
      userId: user.id,
      action: "flow.bank_step",
      entityType: "order",
      entityId: o.id,
      summary: `${o.refNo}: Money reached us (${on}${reference ? `, ${reference}` : ""}) with the payment`,
      newValues: { step: "bank_paid_us", doneOn: on, reference, paymentId },
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
      if (leftMinor < 0) throw new DomainError(`The parts add up to more than the payment counts as (${formatMinor(countsMinor, input.currency)}).`);
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

  /** Pays (part of) an order from the customer's credit: a payment "from credit" and a credit "used" row. */
  async useCredit(user: SessionUser, orderId: string, input: UseCreditInput) {
    if (!can(user, "payments.record")) throw new ForbiddenError("Only accounts (managers) can record payments.");
    const on = input.on ?? this.clock.today();
    this.checkDate(on);
    await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`select id from orders where id = ${orderId}::uuid for update`;
      const o = await this.orders.load(user, orderId, tx);
      if (o.status === "cancelled") throw new DomainError("This order is cancelled.");
      await tx.$queryRaw`select id from parties where id = ${o.customerId}::uuid for update`;
      const balance = (await this.creditOf(o.customerId, tx))[o.currency] ?? 0;
      const amountMinor = toMinor(input.amount);
      if (amountMinor > balance) throw new DomainError(`The customer has ${formatMinor(balance, o.currency)} of credit.`);
      const pos = settledOf(o, o.payments, fxOf(await this.settings.get(), await this.limits.allows("expenses")));
      if (amountMinor > pos.dueMinor) throw new DomainError(`That is more than is still due (${formatMinor(pos.dueMinor, o.currency)}).`);
      const p = await tx.payment.create({
        data: {
          kind: pos.depositOutstandingMinor > 0 ? "deposit" : "balance",
          orderId,
          customerId: o.customerId,
          amount: fromMinor(amountMinor),
          currency: o.currency,
          receivedAmount: fromMinor(amountMinor),
          receivedCurrency: o.currency,
          rate: 1,
          paidOn: toDbDate(on),
          method: "credit",
          note: "Paid from the customer's credit",
          recordedById: user.id,
        },
      });
      await tx.customerCredit.create({
        data: { customerId: o.customerId, kind: "used", amount: fromMinor(amountMinor), currency: o.currency, paymentId: p.id, orderId, on: toDbDate(on), note: `Used on ${o.refNo}`, recordedById: user.id },
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
      await this.refundIn(tx, user, customerId, toMinor(input.amount), input.currency, input.on, await checkAccount(tx, input.accountId, input.currency, null, cashBook), input.note, null);
    });
    return this.creditView(user, customerId);
  }

  /** A refund row, after checking the credit covers it (inside the caller's transaction). */
  async refundIn(tx: Tx, user: SessionUser, customerId: string, amountMinor: Minor, currency: string, on: ISODate, accountId: string | null, note: string | null, orderId: string | null) {
    await tx.$queryRaw`select id from parties where id = ${customerId}::uuid for update`;
    const balance = (await this.creditOf(customerId, tx))[currency] ?? 0;
    if (amountMinor > balance) throw new DomainError(`The customer has ${formatMinor(balance, currency)} of credit to refund.`);
    const refund = await tx.customerCredit.create({ data: { customerId, kind: "refund", amount: fromMinor(amountMinor), currency, accountId, orderId, on: toDbDate(on), note, recordedById: user.id } });
    await this.ledger.post(tx, [{ type: "credit", id: refund.id }], { userId: user.id });
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
    const c = await this.prisma.db.customerCredit.findUnique({ where: { id } });
    if (!c) throw new NotFoundError("Credit entry");
    if (c.voidedAt) throw new DomainError("This entry was already removed.");
    if (c.kind !== "refund") throw new DomainError("Only a refund is removed here; remove the payment or the transfer it belongs to.");
    await this.prisma.tx(async (tx) => {
      await tx.customerCredit.update({ where: { id }, data: { voidedAt: new Date(), voidReason: reason } });
      await this.audit.record(tx, { userId: user.id, action: "credit_refund_void", entityType: "customer", entityId: c.customerId, summary: `Removed the refund of ${c.currency} ${c.amount.toFixed(2)}`, reason });
      await this.ledger.post(tx, [{ type: "credit", id }], { userId: user.id, reason });
    });
    return this.creditView(user, c.customerId);
  }

  /** A transfer recorded by mistake (managers): its payments and its credit are removed together. */
  async voidReceipt(user: SessionUser, id: string, reason: string) {
    if (!can(user, "orders.manage")) throw new ForbiddenError("Only a manager can remove a payment.");
    const r = await this.prisma.db.customerReceipt.findUnique({ where: { id }, include: { payments: true, credits: true } });
    if (!r) throw new NotFoundError("Payment");
    if (r.voidedAt) throw new DomainError("This payment was already removed.");
    for (const p of r.payments) await this.orders.load(user, p.orderId);
    await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`select id from parties where id = ${r.customerId}::uuid for update`;
      const now = new Date();
      await tx.customerReceipt.update({ where: { id }, data: { voidedAt: now, voidReason: reason } });
      await tx.payment.updateMany({ where: { receiptId: id, voidedAt: null }, data: { voidedAt: now, voidReason: reason } });
      await tx.customerCredit.updateMany({ where: { receiptId: id, voidedAt: null }, data: { voidedAt: now, voidReason: reason } });
      await tx.orderBankStep.deleteMany({ where: { paymentId: { in: r.payments.map((p) => p.id) } } });
      const left = await this.creditOf(r.customerId, tx);
      if ((left[r.currency] ?? 0) < 0) throw new DomainError("Part of this transfer's credit was already used or refunded. Remove that first.");
      for (const p of r.payments.filter((x) => !x.voidedAt))
        await this.audit.record(tx, { userId: user.id, action: "payment_void", entityType: "order", entityId: p.orderId, summary: `Removed payment of ${p.currency} ${p.amount.toFixed(2)} (one transfer)`, reason });
      await this.ledger.post(tx, [{ type: "receipt", id }, ...r.payments.map((p) => ({ type: "order_all" as const, id: p.orderId }))], { userId: user.id, reason });
    });
    return this.forCustomer(user, r.customerId);
  }

  /* ---------------------------------------------------------------- changing and removing */

  /** A payment typed wrong (amount, date, reference, rate): changed with a reason, kept in the order's history. */
  async edit(user: SessionUser, paymentId: string, input: EditPaymentInput) {
    if (!can(user, "payments.record")) throw new ForbiddenError("Only accounts (managers) can change payments.");
    this.checkDate(input.paidOn);
    const p = await this.prisma.db.payment.findUnique({ where: { id: paymentId } });
    if (!p) throw new NotFoundError("Payment");
    const cashBook = await this.limits.allows("cash_book");
    if (p.voidedAt) throw new DomainError("This payment was removed.");
    if (p.receiptId) throw new DomainError("This payment is part of one transfer over several orders. Remove the transfer and record it again.");
    if (p.method === "credit") throw new DomainError("This payment came from the customer's credit. Remove it and use the credit again.");
    if (input.method === "credit") throw new DomainError("To pay from the customer's credit, use “Use credit”.");
    const reason = requireReason(input.reason, "payment", "a recorded payment changes");
    await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`select id from orders where id = ${p.orderId}::uuid for update`;
      const o = await this.orders.load(user, p.orderId, tx);
      const receivedCurrency = input.receivedCurrency ?? input.currency;
      const same = receivedCurrency === o.currency;
      const receivedMinor = toMinor(input.receivedAmount ?? input.amount);
      if (receivedMinor <= 0) throw new DomainError("Enter the amount received.");
      // The rate stays as recorded while the currency stays, unless a new one is sent.
      const rate = await this.rateFor(receivedCurrency, o.currency, input.rate ?? (receivedCurrency === p.receivedCurrency ? Number(p.rate) : null));
      const amountMinor = countsAsMinor(receivedMinor, rate, same);
      const others = settledOf(o, o.payments.filter((x) => x.id !== p.id), fxOf(await this.settings.get(), await this.limits.allows("expenses")));
      if (amountMinor + toMinor(input.bankCharges) > others.dueMinor) throw new DomainError(`That is more than is still due (${formatMinor(others.dueMinor, o.currency)}).`);
      await tx.payment.update({
        where: { id: p.id },
        data: {
          // What it pays, against the payments before it; "other" only when sent so (or kept so when not sent).
          kind:
            input.kind === "other" || (input.kind === undefined && p.kind === "other")
              ? "other"
              : settledOf(
                    o,
                    o.payments.filter((x) => x.id !== p.id && (fromDbDate(x.paidOn) < input.paidOn || (fromDbDate(x.paidOn) === input.paidOn && x.createdAt < p.createdAt))),
                    fxOf(await this.settings.get(), await this.limits.allows("expenses")),
                  ).depositOutstandingMinor > 0
                ? "deposit"
                : "balance",
          amount: fromMinor(amountMinor),
          bankCharges: input.bankCharges,
          currency: o.currency,
          receivedAmount: fromMinor(receivedMinor),
          receivedCurrency,
          rate,
          paidByName: input.paidByName,
          paidOn: toDbDate(input.paidOn),
          method: input.method,
          reference: input.reference,
          note: input.note,
          accountId: await checkAccount(tx, input.accountId, receivedCurrency, p.accountId, cashBook),
        },
      });
      await tx.orderBankStep.updateMany({ where: { paymentId: p.id }, data: { doneOn: toDbDate(input.paidOn), reference: input.reference } });
      await this.audit.record(tx, {
        userId: user.id,
        action: "payment_edit",
        entityType: "order",
        entityId: o.id,
        summary: `${o.refNo}: changed a payment from the customer`,
        oldValues: { amount: p.amount.toFixed(2), received: `${p.receivedCurrency} ${p.receivedAmount.toFixed(2)}`, rate: Number(p.rate), bankCharges: p.bankCharges.toFixed(2), paidOn: fromDbDate(p.paidOn), reference: p.reference },
        newValues: { amount: fromMinor(amountMinor), received: `${receivedCurrency} ${fromMinor(receivedMinor)}`, rate, bankCharges: fromMinor(toMinor(input.bankCharges)), paidOn: input.paidOn, reference: input.reference },
        reason,
      });
      await this.ledger.post(tx, [{ type: "order_all", id: o.id }], { userId: user.id, reason });
    });
    return this.forOrder(user, p.orderId);
  }

  /** A payment recorded by mistake. It stays visible, crossed out (from credit: the credit comes back; money reached us: the step is open again). */
  async void(user: SessionUser, paymentId: string, reason: string) {
    if (!can(user, "orders.manage")) throw new ForbiddenError("Only a manager can remove a payment.");
    const p = await this.prisma.db.payment.findUnique({ where: { id: paymentId } });
    if (!p) throw new NotFoundError("Payment");
    const o = await this.orders.load(user, p.orderId);
    if (p.voidedAt) throw new DomainError("This payment was already removed.");
    if (p.receiptId) throw new DomainError("This payment is part of one transfer over several orders. Remove the transfer on the customer's page.");
    await this.prisma.tx(async (tx) => {
      await tx.payment.update({ where: { id: paymentId }, data: { voidedAt: new Date(), voidReason: reason } });
      await tx.customerCredit.updateMany({ where: { paymentId, voidedAt: null }, data: { voidedAt: new Date(), voidReason: reason } });
      const steps = await tx.orderBankStep.deleteMany({ where: { paymentId } });
      await this.audit.record(tx, {
        userId: user.id,
        action: "payment_void",
        entityType: "order",
        entityId: o.id,
        summary: `${o.refNo}: removed payment of ${p.currency} ${p.amount.toFixed(2)}${p.method === "credit" ? " (the credit is back)" : ""}${steps.count ? " (Money reached us undone)" : ""}`,
        reason,
      });
      await this.ledger.post(tx, [{ type: "order_all", id: o.id }], { userId: user.id, reason });
    });
    return this.forOrder(user, o.id);
  }
}
