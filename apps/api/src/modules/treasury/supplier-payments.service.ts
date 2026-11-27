import { Injectable } from "@nestjs/common";
import { asSupplierPayment, createSupplierPayment, fromDbDate, isSupplier, liveFile, purchasePart, supplierPayment, toDbDate } from "@kebo/database";
import { formatMinor, fxRate, toMinor } from "@kebo/money";
import { can, type SupplierPaymentInput } from "@kebo/shared";
import { DomainError, ForbiddenError, NotFoundError } from "@kebo/utils";
import type { Prisma } from "@kebo/database";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { Clock } from "../../common/time/clock.service";
import { LimitsService } from "../../common/company/limits.service";
import { requireReason } from "../../common/audit/reason";
import type { SessionUser } from "../../common/auth/session-user";
import { LedgerPosting } from "../ledger/posting.service";
import { OrdersService } from "../orders/orders.service";
import { SettingsService } from "../settings/settings.service";
import { checkAccount } from "./account-check";

/**
 * Money out to a supplier on an order: a payment entry (out, the supplier) with one allocation paying the order's
 * purchase. Treasury records, changes and removes it; the routes answer with the order's money view (Money
 * composes it: Treasury does not depend on Money).
 */
@Injectable()
export class SupplierPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly limits: LimitsService,
    private readonly ledger: LedgerPosting,
    private readonly orders: OrdersService,
    private readonly settings: SettingsService,
  ) {}

  /** Units of `from` per one unit of `to`: 1 for the same currency, else the rate given, or Settings. Never 1:1 by default. */
  private async rateFor(from: string, to: string, given: number | null | undefined) {
    if (from === to) return 1;
    if (given) return given;
    const { sales } = await this.settings.get();
    const r = fxRate(from, to, sales.currency, sales.exchangeRates);
    if (r === null) throw new DomainError(`There is no exchange rate for ${from} in Settings. Enter the rate (${from} per 1 ${to}).`);
    return r;
  }

  /** On a change: the rate sent; else the one used before while the currency stays; else Settings. */
  private keptRate(input: { currency: string; rate?: number | null }, before: { currency: string; rate: Prisma.Decimal }) {
    return input.rate ?? (input.currency === before.currency ? Number(before.rate) : null);
  }

  /** Someone active on the team (who paid), or none. */
  private async activePerson(id: string | null | undefined) {
    if (!id) return null;
    const u = await this.prisma.db.user.findFirst({ where: { id, isActive: true } });
    if (!u) throw new DomainError("Choose an active person from the team.");
    return id;
  }


  /**
   * The currencies we owe a supplier in on this order (its offers' currencies).
   * A payment only counts against what we owe in the same currency, so a
   * payment in another one would leave the debt standing: refused.
   */
  private async checkSupplierCurrency(orderId: string, supplier: { id: string; name: string }, currency: string, keep?: string) {
    if (keep && keep === currency) return;
    const lines = await this.prisma.db.orderLine.findMany({ where: { orderId, supplierId: supplier.id }, select: { supplierCurrency: true } });
    const owedIn = [...new Set(lines.map((l) => l.supplierCurrency).filter((c): c is string => !!c))];
    if (owedIn.length && !owedIn.includes(currency)) {
      throw new DomainError(
        `We owe ${supplier.name} in ${owedIn.join(" and ")}. Record the payment in ${owedIn[0]}: a payment in ${currency} would not count against what we owe. If you sent ${currency}, enter the ${owedIn[0]} amount the supplier received.`,
      );
    }
  }

  private async supplierPaymentData(
    o: { id: string; currency: string },
    input: SupplierPaymentInput,
    keepCurrency?: string,
    keepAccount?: string | null,
  ) {
    if (input.paidOn > this.clock.today()) throw new DomainError("The payment date cannot be in the future.");
    const f = await this.prisma.db.party.findFirst({ where: { ...isSupplier, id: input.supplierId, deletedAt: null } });
    if (!f) throw new DomainError("That supplier was removed. Choose another one.");
    await this.checkSupplierCurrency(o.id, f, input.currency, keepCurrency);
    return {
      supplierId: f.id,
      kind: input.kind,
      amount: input.amount,
      currency: input.currency,
      rate: await this.rateFor(input.currency, o.currency, input.rate),
      paidOn: toDbDate(input.paidOn),
      method: input.method,
      // The person who looks after the supplier pays it, unless someone else is named.
      paidById: (await this.activePerson(input.paidById)) ?? f.ownerId,
      reference: input.reference,
      note: input.note,
      accountId: await checkAccount(this.prisma.db, input.accountId, input.currency, keepAccount, await this.limits.allows("cash_book")),
      supplierName: f.name,
    };
  }

  async recordSupplierPayment(user: SessionUser, orderId: string, input: SupplierPaymentInput) {
    if (!can(user, "payments.record")) throw new ForbiddenError("Only accounts (managers) can record payments.");
    const o = await this.orders.load(user, orderId);
    if (o.status === "cancelled") throw new DomainError("This order is cancelled.");
    const { supplierName, ...data } = await this.supplierPaymentData(o, input);
    const createdId = await this.prisma.tx(async (tx) => {
      const { supplierId, paidOn, ...rest } = data;
      const created = await createSupplierPayment(tx, { ...rest, orderId, orderCurrency: o.currency, supplierId: supplierId, paidOn, recordedById: user.id });
      await this.audit.record(tx, {
        userId: user.id,
        action: "payment_out",
        entityType: "order",
        entityId: orderId,
        summary: `${o.refNo}: paid ${supplierName} ${input.currency} ${data.amount}${input.reference ? ` (${input.reference})` : ""}`,
      });
      await this.ledger.post(tx, [{ type: "movement", id: created.movementId }, { type: "order", id: orderId }], { userId: user.id });
      // Our bank's charge for sending it: the order's own cost, paid from the same account on the same day.
      const charges = Number(input.bankCharges ?? 0);
      if (charges > 0) {
        const { sales } = await this.settings.get();
        const rate = fxRate(input.currency, sales.currency, sales.currency, sales.exchangeRates);
        if (rate === null) throw new DomainError(`There is no exchange rate for ${input.currency} in Settings: add it, so the bank charges can be counted.`);
        const fee = await tx.expense.create({
          data: {
            orderId,
            customerId: o.customerId,
            inquiryId: o.inquiryId,
            category: "bank_charges",
            description: `Bank charges on paying ${supplierName}`,
            amount: charges.toFixed(2),
            currency: input.currency,
            rate,
            spentOn: paidOn,
            borneBy: "us",
            accountId: data.accountId ?? null,
            payee: "Bank",
            reference: input.reference ?? null,
            recordedById: user.id,
          },
        });
        await this.ledger.post(tx, [{ type: "expense", id: fee.id }], { userId: user.id });
      }
      return created.id;
    });
    /** `createdId`: the new payment, so its proof can follow. */
    return { orderId, createdId };
  }

  private async findSupplierPayment(user: SessionUser, id: string) {
    if (!can(user, "payments.record")) throw new ForbiddenError("Only accounts (managers) can change payments.");
    // The payment on the order (its part), or its entry.
    const part = await this.prisma.db.allocation.findFirst({
      where: { ...purchasePart, OR: [{ id }, { movementId: id }] },
      include: { movement: { include: { party: { select: { name: true } }, files: liveFile } } },
    });
    if (!part) throw new NotFoundError("Payment");
    const p = { ...asSupplierPayment(part), factory: part.movement.party! };
    const o = await this.orders.load(user, p.orderId);
    if (p.voidedAt) throw new DomainError("This payment was removed.");
    return { p, o };
  }

  /** Changing a recorded supplier payment always says why. */
  async editSupplierPayment(user: SessionUser, id: string, input: SupplierPaymentInput) {
    const { p, o } = await this.findSupplierPayment(user, id);
    const reason = requireReason(input.reason, "payment", "a recorded payment changes");
    // A payment already recorded in another currency (before this rule) may keep it.
    const { supplierName, ...data } = await this.supplierPaymentData(
      o,
      { ...input, rate: this.keptRate(input, p) },
      p.supplierId === input.supplierId ? p.currency : undefined,
      p.accountId,
    );
    await this.prisma.tx(async (tx) => {
      const counts = supplierPayment({ ...data, supplierId: data.supplierId, orderId: o.id, orderCurrency: o.currency, recordedById: user.id });
      await tx.moneyMovement.update({
        where: { id: p.movementId },
        data: {
          partyId: data.supplierId,
          amount: data.amount,
          currency: data.currency,
          rate: data.rate,
          allocatable: counts.allocatable,
          valueDate: data.paidOn,
          method: data.method,
          paidById: data.paidById,
          reference: data.reference,
          note: data.note,
          accountId: data.accountId,
        },
      });
      await tx.allocation.update({ where: { id: p.id }, data: { kind: data.kind, amount: counts.allocatable, share: data.amount, on: data.paidOn } });
      await this.audit.record(tx, {
        userId: user.id,
        action: "payment_out_edit",
        entityType: "order",
        entityId: o.id,
        summary: `${o.refNo}: changed the payment to ${supplierName}`,
        oldValues: {
          factory: p.factory.name,
          amount: `${formatMinor(toMinor(p.amount), p.currency)}`,
          paidOn: fromDbDate(p.paidOn),
          rate: Number(p.rate),
          reference: p.reference,
        },
        newValues: {
          // Its page reads its own changes by this (the order's history keeps them too).
          paymentId: p.id,
          factory: supplierName,
          amount: `${formatMinor(toMinor(data.amount), data.currency)}`,
          paidOn: input.paidOn,
          rate: data.rate,
          reference: data.reference,
        },
        reason,
      });
      await this.ledger.post(tx, [{ type: "movement", id: p.movementId }, { type: "order", id: o.id }], { userId: user.id, reason });
    });
    return { orderId: o.id };
  }

  /** A payment recorded by mistake: it stays listed, crossed out. */
  async voidSupplierPayment(user: SessionUser, id: string, reason: string) {
    const { p, o } = await this.findSupplierPayment(user, id);
    await this.prisma.tx(async (tx) => {
      const now = new Date();
      await tx.moneyMovement.update({ where: { id: p.movementId }, data: { voidedAt: now, voidReason: reason } });
      await tx.allocation.update({ where: { id: p.id }, data: { voidedAt: now, voidReason: reason } });
      await this.audit.record(tx, {
        userId: user.id,
        action: "payment_out_void",
        entityType: "order",
        entityId: o.id,
        summary: `${o.refNo}: removed the payment of ${formatMinor(toMinor(p.amount), p.currency)} to ${p.factory.name}`,
        reason,
      });
      await this.ledger.post(tx, [{ type: "movement", id: p.movementId }, { type: "order", id: o.id }], { userId: user.id, reason });
    });
    return { orderId: o.id };
  }
}
