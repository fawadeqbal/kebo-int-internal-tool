import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import { CompanyContext } from "../../common/company/company-context";
import { toInfo } from "../../common/company/companies.service";
import { agreedView } from "./orders.service";
import { copyOfOffer, offerTermsSelect } from "../flow/factory-terms";

/**
 * Old records, filled once (design "RFQ Desk — terms that travel", step 4): an order made before it kept its own
 * copy of what was agreed takes its quotation's as its own — exactly what it already showed and printed, so nothing
 * on a screen or a paper changes, but one without a port of discharge of its own takes the quotation's — and the
 * ship-by date typed on it stays typed; a purchase order sent (or its order sent to the factory) before it kept
 * what was agreed with the factory takes its offer's. Run when the API starts; what has its copy is left alone.
 */
@Injectable()
export class TermsFillService {
  private readonly logger = new Logger("TermsFill");

  constructor(private readonly prisma: PrismaService) {}

  async fillAll() {
    const companies = await this.prisma.platform.company.findMany({ where: { status: { not: "deleted" } }, orderBy: { createdAt: "asc" } });
    let orders = 0;
    let purchaseOrders = 0;
    for (const company of companies)
      await CompanyContext.run(toInfo(company), async () => {
        const r = await this.fillCompany();
        orders += r.orders;
        purchaseOrders += r.purchaseOrders;
      }).catch((e) => this.logger.error(`terms for ${company.slug}: ${(e as Error).message}`));
    if (orders || purchaseOrders) this.logger.log(`${orders} order(s) and ${purchaseOrders} purchase order(s) took the terms they were agreed on`);
    return { orders, purchaseOrders };
  }

  /** The signed-in company's old orders and sent purchase orders (inside its CompanyContext). */
  async fillCompany() {
    const db = this.prisma.db;
    let orders = 0;
    let purchaseOrders = 0;
    const old = await db.order.findMany({
      where: { termsCopied: false },
      select: {
        id: true,
        shipBy: true,
        orderedOn: true,
        portOfDischarge: true,
        revision: {
          select: {
            portOfDischarge: true,
            warranty: true,
            warrantyMonths: true,
            warrantyFrom: true,
            deliveryTerms: true,
            paymentTerms: true,
            notes: true,
            options: { where: { status: "accepted" }, select: { status: true, leadTime: true, leadDays: true, leadFrom: true } },
          },
        },
      },
    });
    for (const o of old) {
      // What it shows now (its quotation's, with its own port of discharge when it has one), as its own.
      const a = agreedView({
        termsCopied: false,
        shipByTyped: false,
        orderedOn: o.orderedOn,
        portOfDischarge: o.portOfDischarge,
        leadDays: null,
        leadFrom: null,
        warrantyMonths: null,
        warrantyFrom: null,
        warrantyWords: null,
        deliveryConditions: null,
        paymentConditions: null,
        conditionsNotes: null,
        revision: o.revision,
      });
      const r = await db.order.updateMany({
        where: { id: o.id, termsCopied: false },
        data: {
          termsCopied: true,
          portOfDischarge: a.portOfDischarge,
          leadDays: a.leadDays,
          leadFrom: a.leadDays === null ? null : (a.leadFrom ?? "after_payment"),
          warrantyMonths: a.warrantyMonths,
          warrantyFrom: a.warrantyMonths === null ? null : (a.warrantyFrom ?? "shipment"),
          warrantyWords: a.warranty,
          deliveryConditions: a.deliveryConditions,
          paymentConditions: a.paymentConditions,
          conditionsNotes: a.notes,
          // Typed by hand before ship by was worked out: it stays as it is.
          shipByTyped: o.shipBy !== null,
        },
      });
      orders += r.count;
    }
    // Sent: on its own day, or (before purchase orders were sent one by one) the day the order went to the factory.
    const sent = await db.purchaseOrder.findMany({
      where: { termsCopied: false, OR: [{ sentOn: { not: null } }, { order: { factoryOrderedOn: { not: null } } }] },
      select: { id: true, orderId: true, supplierId: true },
    });
    for (const po of sent) {
      const line = await db.orderLine.findFirst({
        where: { orderId: po.orderId, factoryId: po.supplierId, quoteLine: { factoryQuoteLine: { isNot: null } } },
        orderBy: { sortOrder: "asc" },
        select: { quoteLine: { select: { factoryQuoteLine: { select: { factoryQuote: { select: offerTermsSelect } } } } } },
      });
      const r = await db.purchaseOrder.updateMany({ where: { id: po.id, termsCopied: false }, data: copyOfOffer(line?.quoteLine?.factoryQuoteLine?.factoryQuote ?? null) });
      purchaseOrders += r.count;
    }
    return { orders, purchaseOrders };
  }
}
