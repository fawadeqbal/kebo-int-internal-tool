import { Injectable } from "@nestjs/common";
import { decimalToMinor, toDbDate } from "@kebo/database";
import { formatMinor, fxRate } from "@kebo/money";
import { SHIP_MODE_LABEL, type ShipMode } from "@kebo/shared";
import { DomainError } from "@kebo/utils";
import { AuditService } from "../../common/audit/audit.service";
import type { SessionUser } from "../../common/auth/session-user";
import { LimitsService } from "../../common/company/limits.service";
import { Clock } from "../../common/time/clock.service";
import type { Tx } from "../../database/prisma.service";
import { LedgerPosting } from "../ledger/posting.service";
import { SettingsService } from "../settings/settings.service";

/** The cost a shipment makes by itself: `shipment:<id>:freight`, `shipment:<id>:insurance`. */
export const shipmentSource = (shipmentId: string, what: "freight" | "insurance") => `shipment:${shipmentId}:${what}`;

interface Wanted {
  source: string;
  category: "freight" | "insurance";
  description: string;
  amount: string;
  currency: string;
  payee: string | null;
}

/**
 * Freight and insurance are costs of the order by themselves (money, step 2): what a shipment says we pay
 * (freight unless it is "collect", and the insurance premium) is kept as a cost of the order, known and not
 * paid yet, owed to the forwarder or the insurer. It follows the shipment until it is paid: a new amount
 * changes it, a cleared one removes it. Once paid it is what was paid, and the shipment no longer moves it.
 */
@Injectable()
export class ShipmentCosts {
  constructor(
    private readonly settings: SettingsService,
    private readonly ledger: LedgerPosting,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly limits: LimitsService,
  ) {}

  /** Brings the order's freight and insurance costs in step with its shipments, inside the caller's transaction. */
  async sync(tx: Tx, user: SessionUser, order: { id: string; refNo: string; currency: string; customerId: string; inquiryId: string }) {
    if (!(await this.limits.allows("expenses"))) return;
    const shipments = await tx.shipment.findMany({ where: { orderId: order.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    const wanted: Wanted[] = [];
    shipments.forEach((s, i) => {
      const which = shipments.length > 1 ? ` (shipment ${i + 1})` : "";
      if (s.freightAmount && decimalToMinor(s.freightAmount) > 0 && s.freightTerms !== "collect")
        wanted.push({
          source: shipmentSource(s.id, "freight"),
          category: "freight",
          description: `${SHIP_MODE_LABEL[s.mode as ShipMode] ?? "Sea"} freight${which}`,
          amount: s.freightAmount.toFixed(2),
          currency: s.freightCurrency ?? order.currency,
          payee: s.forwarder,
        });
      if (s.insurancePremium && decimalToMinor(s.insurancePremium) > 0)
        wanted.push({
          source: shipmentSource(s.id, "insurance"),
          category: "insurance",
          description: `Cargo insurance${which}`,
          amount: s.insurancePremium.toFixed(2),
          currency: s.insuranceCurrency ?? order.currency,
          payee: s.insurer,
        });
    });
    const kept = await tx.expense.findMany({ where: { orderId: order.id, voidedAt: null, source: { startsWith: "shipment:" } } });
    const { sales } = await this.settings.get();
    const rateOf = (currency: string) => {
      const r = fxRate(currency, sales.currency, sales.currency, sales.exchangeRates);
      if (r === null) throw new DomainError(`There is no exchange rate for ${currency} in Settings: add it, so this cost can be counted.`);
      return r;
    };
    const log = (id: string, summary: string, action: string) =>
      this.audit.record(tx, { userId: user.id, action, entityType: "order", entityId: order.id, summary: `${order.refNo}: ${summary}`, newValues: { step: "shipping", expenseId: id } });
    const touched: string[] = [];

    for (const e of kept) {
      if (wanted.some((w) => w.source === e.source)) continue;
      if (e.repaidOn) {
        // Paid already: it stays as what was paid, and no longer follows a shipment that dropped it.
        await tx.expense.update({ where: { id: e.id }, data: { source: null } });
        continue;
      }
      await tx.expense.update({ where: { id: e.id }, data: { voidedAt: new Date(), voidReason: "The shipment no longer has it" } });
      await log(e.id, `removed the cost "${e.description}" (${e.currency} ${e.amount.toFixed(2)}): the shipment no longer has it`, "expense_void");
      touched.push(e.id);
    }
    for (const w of wanted) {
      const e = kept.find((x) => x.source === w.source);
      if (e) {
        if (e.repaidOn) continue;
        const same = e.amount.toFixed(2) === w.amount && e.currency === w.currency;
        if (same && e.payee === w.payee && e.description === w.description) continue;
        await tx.expense.update({
          where: { id: e.id },
          data: { amount: w.amount, currency: w.currency, payee: w.payee, description: w.description, ...(e.currency === w.currency ? {} : { rate: rateOf(w.currency) }) },
        });
        if (!same) await log(e.id, `the cost "${w.description}" is now ${formatMinor(decimalToMinor(w.amount), w.currency)} (was ${e.currency} ${e.amount.toFixed(2)})`, "expense_edit");
        touched.push(e.id);
        continue;
      }
      // Typed by hand before (the same kind and amount, not yet tied to a shipment): that one is this cost.
      const typed = await tx.expense.findFirst({
        where: { orderId: order.id, voidedAt: null, source: null, category: w.category, amount: w.amount, currency: w.currency },
        orderBy: { createdAt: "asc" },
      });
      if (typed) {
        await tx.expense.update({ where: { id: typed.id }, data: { source: w.source, ...(typed.payee ? {} : { payee: w.payee }) } });
        continue;
      }
      const row = await tx.expense.create({
        data: {
          orderId: order.id,
          customerId: order.customerId,
          inquiryId: order.inquiryId,
          category: w.category,
          description: w.description,
          amount: w.amount,
          currency: w.currency,
          rate: rateOf(w.currency),
          spentOn: toDbDate(this.clock.today()),
          step: "shipping",
          borneBy: "us",
          payLater: true,
          payee: w.payee,
          source: w.source,
          recordedById: user.id,
        },
      });
      await log(row.id, `added the cost ${w.description} ${formatMinor(decimalToMinor(w.amount), w.currency)} from the shipment`, "expense");
      touched.push(row.id);
    }
    if (touched.length) await this.ledger.post(tx, touched.map((id) => ({ type: "expense" as const, id })), { userId: user.id });
  }
}
