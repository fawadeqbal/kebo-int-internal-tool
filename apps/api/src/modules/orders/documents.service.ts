import { Injectable } from "@nestjs/common";
import { decimalToMinor, fromDbDate, fromDbDateOrNull } from "@kebo/database";
import { documentTotals, fromMinor, settle, splitDeposit } from "@kebo/money";
import { BALANCE_TERMS_LABEL, type BalanceTerms } from "@kebo/shared";
import { NotFoundError } from "@kebo/utils";
import { PrismaService } from "../../database/prisma.service";
import { Clock } from "../../common/time/clock.service";
import type { SessionUser } from "../../common/auth/session-user";
import { SettingsService } from "../settings/settings.service";
import { companySnapshot, customerSnapshot } from "../quotations/quotations.service";
import { OrdersService } from "./orders.service";

export const ORDER_DOCUMENTS = ["proforma", "invoice", "packing-list"] as const;
export type OrderDocumentKind = (typeof ORDER_DOCUMENTS)[number];

const TITLE: Record<OrderDocumentKind, string> = { proforma: "Proforma invoice", invoice: "Commercial invoice", "packing-list": "Packing list" };
const PREFIX: Record<OrderDocumentKind, string> = { proforma: "PI", invoice: "INV", "packing-list": "PL" };

/** "30% deposit, balance against B/L copy": only the first letter of the terms is lowered, so "B/L" stays as written. */
export function paymentTermsOf(depositPercent: number, balanceTerms: BalanceTerms): string {
  const terms = BALANCE_TERMS_LABEL[balanceTerms];
  return `${depositPercent > 0 ? `${depositPercent}% deposit, ` : ""}${depositPercent > 0 ? terms.charAt(0).toLowerCase() + terms.slice(1) : terms}`;
}

/** "Our usual payment is made by 30% Advance deposit and 70% before shipment." */
export function paymentSentenceOf(depositPercent: number, balanceTerms: BalanceTerms): string {
  const rest = BALANCE_TERMS_LABEL[balanceTerms];
  const lower = rest.charAt(0).toLowerCase() + rest.slice(1);
  if (depositPercent <= 0) return `Payment: ${rest}.`;
  if (depositPercent >= 100) return "Our usual payment is made by 100% Advance payment.";
  return `Our usual payment is made by ${depositPercent}% Advance deposit and ${100 - depositPercent}% ${lower.replace(/^balance /, "")}.`;
}

/**
 * The documents of an order, made from the order itself whenever they are
 * opened: nothing to create, issue or keep in step. Their numbers follow the
 * order's (SO-2026-0005 → PI-2026-0005, INV-2026-0005, PL-2026-0005).
 *  - Proforma invoice: the whole order, asking for the deposit (dated the order day).
 *  - Commercial invoice: the whole order, with what was received and what is due (dated the ship date).
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
        lines: { orderBy: { sortOrder: "asc" } },
        revision: { include: { quotation: { select: { refNo: true } } } },
        payments: { where: { voidedAt: null }, orderBy: { paidOn: "asc" } },
        inquiry: { select: { contactId: true } },
      },
    });
    const settings = await this.settings.get();
    const rev = o.revision;
    const vat = { rate: Number(rev.vatRate), pricesIncludeVat: rev.pricesIncludeVat };
    const t = documentTotals(o.lines.map((l) => ({ quantity: l.quantity.toString(), unitPrice: l.unitPrice.toString() })), rev.discount.toString(), vat);
    const ins = o.payments.filter((p) => p.currency === o.currency).map((p) => ({ amountMinor: decimalToMinor(p.amount), bankChargesMinor: decimalToMinor(p.bankCharges) }));
    const position = settle(t.total, ins, Number(o.depositPercent));
    const shippedOn = fromDbDateOrNull(o.shippedOn);
    const goodsOnly = kind === "packing-list";
    const lines = o.lines.filter((l) => !goodsOnly || l.type === "goods");

    return {
      kind,
      title: TITLE[kind],
      number: o.refNo.replace(/^[A-Z]+-/, `${PREFIX[kind]}-`),
      date: kind === "proforma" ? fromDbDate(o.orderedOn) : (shippedOn ?? this.clock.today()),
      company: companySnapshot(settings),
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
      lines: lines.map((l) => ({
        type: l.type,
        description: l.description,
        model: l.model,
        hsCode: l.hsCode,
        quantity: l.quantity.toString(),
        unit: l.unit,
        unitPrice: goodsOnly ? null : l.unitPrice.toFixed(2),
        lineTotal: goodsOnly ? null : l.lineTotal.toFixed(2),
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
            vatRate: t.vatRate,
            pricesIncludeVat: t.pricesIncludeVat,
            vat: fromMinor(t.vat),
            total: fromMinor(t.total),
            deposit: fromMinor(splitDeposit(t.total, Number(o.depositPercent)).deposit),
            depositPercent: Number(o.depositPercent),
            received: fromMinor(position.settledMinor),
            due: fromMinor(position.outstandingMinor),
          },
      terms: kind === "packing-list" ? null : rev.terms,
      bankDetails: kind === "packing-list" ? null : settings.company.bankDetails || null,
      footer: settings.company.invoiceFooter || null,
    };
  }
}
