import { Injectable } from "@nestjs/common";
import { decimalToMinor, fromDbDate, fromDbDateOrNull } from "@kebo/database";
import { documentTotals, fromMinor, settle, splitDeposit } from "@kebo/money";
import { BALANCE_TERMS_LABEL, can, paymentSentenceOf, type BalanceTerms } from "@kebo/shared";
import { NotFoundError } from "@kebo/utils";
import { PrismaService } from "../../database/prisma.service";
import { Clock } from "../../common/time/clock.service";
import type { SessionUser } from "../../common/auth/session-user";
import { SettingsService } from "../settings/settings.service";
import { companySnapshot, customerSnapshot } from "../quotations/quotations.service";
import { orderLineNumbers, OrdersService } from "./orders.service";

export const ORDER_DOCUMENTS = ["proforma", "packing-list"] as const;
export type OrderDocumentKind = (typeof ORDER_DOCUMENTS)[number];

const TITLE: Record<OrderDocumentKind, string> = { proforma: "Proforma invoice", "packing-list": "Packing list" };
const PREFIX: Record<OrderDocumentKind, string> = { proforma: "PI", "packing-list": "PL" };

/** "30% deposit, balance against B/L copy": only the first letter of the terms is lowered, so "B/L" stays as written. */
export function paymentTermsOf(depositPercent: number, balanceTerms: BalanceTerms): string {
  const terms = BALANCE_TERMS_LABEL[balanceTerms];
  return `${depositPercent > 0 ? `${depositPercent}% deposit, ` : ""}${depositPercent > 0 ? terms.charAt(0).toLowerCase() + terms.slice(1) : terms}`;
}

/** Kebo's payment sentence (shared with the web for quotations). */
export { paymentSentenceOf };

/**
 * The documents of an order, made from the order itself whenever they are
 * opened. The proforma gets its own number when it is issued (KEB260916TN07:
 * prefix, issue date, customer letters, the handler's count this year); the
 * packing list's follows the order's (SO-2026-0005 → PL-2026-0005).
 *  - Proforma invoice: the whole order, the one invoice Kebo sends (dated the day it is issued).
 *  - Packing list: the goods, without prices (dated the ship date).
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly settings: SettingsService,
    private readonly orders: OrdersService,
  ) {}

  /** The customer as sent on the quotation; details missing there (e.g. a registration number added later) come from the customer now. */
  private async customerOf(customerId: string, contactId: string | null, sent: Partial<Awaited<ReturnType<typeof customerSnapshot>>> | null) {
    const now = await customerSnapshot(this.prisma.db, customerId, contactId);
    if (!sent) return now;
    const filled = Object.fromEntries(Object.entries(sent).filter(([, v]) => v !== null && v !== undefined && v !== ""));
    return { ...now, ...filled };
  }

  async get(user: SessionUser, orderId: string, kind: OrderDocumentKind) {
    if (!ORDER_DOCUMENTS.includes(kind)) throw new NotFoundError("Document");
    await this.orders.load(user, orderId);
    const o = await this.prisma.db.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        lines: { orderBy: { sortOrder: "asc" }, include: { quoteLine: { select: { requestedItemId: true, requestedItem: { select: { parentId: true } }, factoryQuoteLineId: true, factoryQuoteLine: { select: { parentId: true } } } } } },
        revision: { include: { quotation: { select: { refNo: true } } } },
        payments: { where: { voidedAt: null }, orderBy: { paidOn: "asc" } },
        inquiry: { select: { contactId: true } },
      },
    });
    const settings = await this.settings.get();
    const rev = o.revision;
    const t = documentTotals(o.lines.map((l) => ({ quantity: l.quantity.toString(), unitPrice: l.unitPrice.toString() })), rev.discount.toString());
    const ins = o.payments.filter((p) => p.currency === o.currency).map((p) => ({ amountMinor: decimalToMinor(p.amount), bankChargesMinor: decimalToMinor(p.bankCharges) }));
    const position = settle(t.total, ins, Number(o.depositPercent));
    const shippedOn = fromDbDateOrNull(o.shippedOn);
    const goodsOnly = kind === "packing-list";
    const lines = o.lines.filter((l) => !goodsOnly || l.type === "goods");
    const numbers = orderLineNumbers(lines);
    const seeCosts = can(user.role, "sourcing.manage");

    return {
      kind,
      title: TITLE[kind],
      // The proforma has its own number once issued (KEB260916TN07); before that it is a draft without one.
      number: kind === "proforma" ? o.proformaNo : o.refNo.replace(/^[A-Z]+-/, `${PREFIX[kind]}-`),
      /** The proforma is not issued yet: printed as a draft, without a number. */
      draft: kind === "proforma" && !o.proformaNo,
      date: kind === "proforma" ? (fromDbDateOrNull(o.proformaIssuedOn) ?? this.clock.today()) : (shippedOn ?? this.clock.today()),
      company: { ...companySnapshot(settings), stamp: settings.company.stamp || null },
      customer: await this.customerOf(o.customerId, o.inquiry.contactId, rev.customerSnapshot as Partial<Awaited<ReturnType<typeof customerSnapshot>>> | null),
      order: {
        id: o.id,
        refNo: o.refNo,
        stage: o.stage,
        status: o.status,
        orderedOn: fromDbDate(o.orderedOn),
        shipBy: fromDbDateOrNull(o.shipBy),
        readyOn: fromDbDateOrNull(o.readyOn),
        shippedOn,
        blNo: o.blNo,
        incoterm: o.incoterm,
        incotermPlace: o.incotermPlace,
        quotation: `${rev.quotation.refNo} R${rev.number}`,
        /** Heading over the lines, e.g. "COMPLETE AUTOMATIC LIQUID SYRUP FILLING LINE". */
        documentTitle: o.documentTitle,
        portOfDischarge: o.portOfDischarge,
        /** e.g. "90 days after receiving advance payment". */
        leadTime: rev.leadTime,
      },
      paymentTerms: paymentTermsOf(Number(o.depositPercent), o.balanceTerms),
      /** The payment terms as Kebo writes them on a proforma, e.g. "Our usual payment is made by 30% Advance deposit and 70% before shipment." */
      paymentSentence: paymentSentenceOf(Number(o.depositPercent), o.balanceTerms),
      currency: o.currency,
      showPrices: !goodsOnly,
      lines: lines.map((l, i) => ({
        /** "1", "2", "2.1" (a part of item 2). */
        no: numbers[i],
        type: l.type,
        description: l.description,
        model: l.model,
        quantity: l.quantity.toString(),
        unit: l.unit,
        unitPrice: goodsOnly ? null : l.unitPrice.toFixed(2),
        lineTotal: goodsOnly ? null : l.lineTotal.toFixed(2),
        /** The internal copy only, for people who may see factory costs (sales currency, per unit). */
        unitCost: goodsOnly || !seeCosts ? null : (l.unitCost?.toFixed(2) ?? null),
        // Packing list only: what the packing list form recorded (null until filled in).
        packing: goodsOnly ? { packages: l.packages, packageType: l.packageType, netWeightKg: l.netWeightKg?.toFixed(2) ?? null, grossWeightKg: l.grossWeightKg?.toFixed(2) ?? null, cbm: l.cbm?.toFixed(3) ?? null } : null,
      })),
      packing: goodsOnly
        ? {
            done: o.packedAt !== null,
            containerNo: o.containerNo,
            shippingMarks: o.shippingMarks,
            totals: {
              packages: lines.reduce((t, l) => t + (l.packages ?? 0), 0),
              netWeightKg: lines.reduce((t, l) => t + Number(l.netWeightKg ?? 0), 0).toFixed(2),
              grossWeightKg: lines.reduce((t, l) => t + Number(l.grossWeightKg ?? 0), 0).toFixed(2),
              cbm: lines.reduce((t, l) => t + Number(l.cbm ?? 0), 0).toFixed(3),
            },
          }
        : null,
      totals: goodsOnly
        ? null
        : {
            subtotal: fromMinor(t.subtotal),
            discount: fromMinor(t.discount),
            total: fromMinor(t.total),
            deposit: fromMinor(splitDeposit(t.total, Number(o.depositPercent)).deposit),
            depositPercent: Number(o.depositPercent),
            received: fromMinor(position.settledMinor),
            due: fromMinor(position.outstandingMinor),
          },
      /** The quotation's own payment and delivery terms (free text, printed as bullets). */
      paymentTermsText: kind === "packing-list" ? null : rev.paymentTerms,
      deliveryTermsText: kind === "packing-list" ? null : rev.deliveryTerms,
      bankDetails: kind === "packing-list" ? null : settings.company.bankDetails || null,
      /** The internal copy: every payment received (the customer's copy shows only the total). */
      payments: goodsOnly
        ? []
        : o.payments.map((p) => ({ paidOn: fromDbDate(p.paidOn), kind: p.kind, amount: p.amount.toFixed(2), bankCharges: p.bankCharges.toFixed(2), currency: p.currency, reference: p.reference })),
      notes: kind === "packing-list" ? null : rev.notes,
      footer: settings.company.invoiceFooter || null,
    };
  }
}
