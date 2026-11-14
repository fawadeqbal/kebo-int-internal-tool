import { Injectable } from "@nestjs/common";
import { fromDbDate, fromDbDateOrNull, readyByOf, readySelect, wordFactsOf } from "@kebo/database";
import { fromMinor } from "@kebo/money";
import { can, orderWord, orderWordColumn, type ShipmentStatus } from "@kebo/shared";
import { ForbiddenError, type ISODate } from "@kebo/utils";
import { PrismaService } from "../../database/prisma.service";
import { orderAccess } from "../../common/auth/order-access";
import type { SessionUser } from "../../common/auth/session-user";
import { LimitsService } from "../../common/company/limits.service";
import { SettingsService } from "../settings/settings.service";
import { Clock } from "../../common/time/clock.service";
import { factoryBorneExpenses, factoryPositionOf, fxOf, supplierPaidRelation } from "../billing/api";

/** Shipments still on the way: not yet arrived (or cleared). */
const UNDER_WAY: ShipmentStatus[] = ["planned", "booked", "loaded", "departed"];

/**
 * Operations & trading lists across orders (step 5, review §6.6 "one list per document"): every shipment
 * (Fulfillment & logistics) and every purchase order, one per supplier on an order. Read-only: each row opens
 * the order's step where it is changed.
 */
@Injectable()
export class OperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly limits: LimitsService,
    private readonly clock: Clock,
  ) {}

  /** Shipments of the orders the person sees: under way (default) or all; the next to arrive first. */
  async shipments(user: SessionUser, all: boolean) {
    const rows = await this.prisma.db.shipment.findMany({
      where: {
        order: { ...orderAccess(user), status: { not: "cancelled" } },
        ...(all ? {} : { status: { in: UNDER_WAY } }),
      },
      include: {
        order: {
          select: {
            id: true,
            refNo: true,
            customer: { select: { id: true, name: true } },
            inquiry: { select: { title: true } },
            // The papers the order's set still misses (board: "Papers missing · SO-2026-0032 · CO").
            documents: { where: { status: "missing" }, select: { kind: true } },
          },
        },
      },
      orderBy: [{ eta: { sort: "asc", nulls: "last" } }, { etd: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      take: 500,
    });
    const today = this.clock.today();
    return rows.map((s) => {
      const eta = fromDbDateOrNull(s.eta);
      return {
        what: s.order.inquiry.title,
        papersMissing: s.order.documents.map((d) => d.kind),
        id: s.id,
        order: { id: s.order.id, refNo: s.order.refNo },
        customer: s.order.customer,
        mode: s.mode,
        status: s.status,
        forwarder: s.forwarder,
        vessel: s.vessel,
        blNo: s.blNo,
        containerNo: s.containerNo,
        portOfLoading: s.portOfLoading,
        portOfDischarge: s.portOfDischarge,
        etd: fromDbDateOrNull(s.etd),
        eta,
        departedOn: fromDbDateOrNull(s.departedOn),
        arrivedOn: fromDbDateOrNull(s.arrivedOn),
        /** Past its ETA and not arrived. */
        overdue: !!eta && eta < today && UNDER_WAY.includes(s.status),
      };
    });
  }

  /**
   * One purchase order per supplier on each order not cancelled (people who see costs): ordered on and their
   * order number (the factory step), that supplier's ready date, and what we owe and paid it (Billing's rule).
   * `open`: only those with something still to pay or not ready yet.
   */
  async purchaseOrders(user: SessionUser, open: boolean, withCancelled = false, orderId?: string) {
    if (!can(user, "sourcing.manage")) throw new ForbiddenError("You cannot see factory costs.");
    const fx = fxOf(await this.settings.get(), await this.limits.allows("expenses"));
    const orders = await this.prisma.db.order.findMany({
      where: { ...orderAccess(user), ...(orderId ? { id: orderId } : {}), ...(withCancelled ? {} : { status: { not: "cancelled" } }), lines: { some: { factoryId: { not: null } } } },
      select: {
        id: true,
        refNo: true,
        stage: true,
        status: true,
        factoryOrderedOn: true,
        factoryOrderNo: true,
        customer: { select: { id: true, name: true } },
        purchaseOrders: { select: { id: true, number: true, supplierId: true, sentOn: true, sentEarlyReason: true, supplierRef: true } },
        // What the order's one status word reads: "shipped" here is that word, not the stored stage.
        shipments: { select: { status: true, departedOn: true } },
        delivery: { select: { deliveredOn: true } },
        lines: {
          select: {
            receivedOn: true,
            factoryId: true,
            factoryUnitPrice: true,
            factoryCurrency: true,
            factoryTaxRate: true,
            factoryTaxIncluded: true,
            quantity: true,
            factory: { select: { id: true, name: true } },
          },
        },
        supplierPaid: supplierPaidRelation,
        expenses: factoryBorneExpenses,
        ...readySelect,
      },
      orderBy: { orderedOn: "desc" },
      take: 500,
    });
    const today = this.clock.today();
    const features = await this.limits.features();
    const rows = orders.flatMap((o) => {
      const names = new Map(o.lines.flatMap((l) => (l.factory ? [[l.factory.id, l.factory.name] as const] : [])));
      const ready = new Map(readyByOf(o).map((r) => [r.factoryId, r.readyOn] as const));
      // Where the order stands, by its one worked-out word: still with the factory, or shipped and after.
      const at = orderWordColumn(orderWord(wordFactsOf(o), features));
      const beforeShipping = at === "confirmed" || at === "in_production";
      return factoryPositionOf(o, fx)
        .filter((f) => f.lines > 0)
        .map((f) => {
          const readyOn: ISODate | null = ready.get(f.factoryId) ?? null;
          const po = o.purchaseOrders.find((p) => p.supplierId === f.factoryId) ?? null;
          const sentOn = po?.sentOn ? fromDbDate(po.sentOn) : o.factoryOrderedOn ? fromDbDate(o.factoryOrderedOn) : null;
          const mine = o.lines.filter((l) => l.factoryId === f.factoryId);
          const status =
            o.status === "cancelled"
              ? "cancelled"
              : !beforeShipping
                ? "shipped"
                : mine.length > 0 && mine.every((l) => l.receivedOn)
                  ? "ready"
                  : !sentOn
                    ? "not_sent"
                    : readyOn && readyOn < today
                      ? "late"
                      : "in_production";
          return {
            key: `${o.id}:${f.key}`,
            /** The purchase order: PO-2026-0044 (null only for a supplier the database has not numbered yet). */
            po: po ? { id: po.id, number: po.number } : null,
            /** not_sent · in_production · late (ready date passed) · ready · shipped · cancelled */
            status,
            sentEarlyReason: po?.sentEarlyReason ?? null,
            order: { id: o.id, refNo: o.refNo, stage: o.stage, closed: o.status === "closed", beforeShipping },
            customer: o.customer,
            supplier: { id: f.factoryId, name: names.get(f.factoryId) ?? "Supplier" },
            orderedOn: sentOn,
            supplierRef: po?.supplierRef ?? o.factoryOrderNo,
            readyOn,
            /** Ready date passed and the order not shipped yet. */
            late: !!readyOn && readyOn < today && beforeShipping,
            currency: f.currency,
            owed: fromMinor(f.owedMinor),
            paid: fromMinor(f.settledMinor),
            toPay: fromMinor(f.toPayMinor),
          };
        });
    });
    return open ? rows.filter((r) => r.status !== "cancelled" && (Number(r.toPay) > 0 || r.order.beforeShipping)) : rows;
  }
}
