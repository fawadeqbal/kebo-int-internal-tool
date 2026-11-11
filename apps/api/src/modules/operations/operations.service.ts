import { Injectable } from "@nestjs/common";
import { fromDbDate, fromDbDateOrNull, readyByOf, readySelect } from "@kebo/database";
import { fromMinor } from "@kebo/money";
import { can, type ShipmentStatus } from "@kebo/shared";
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
      include: { order: { select: { id: true, refNo: true, customer: { select: { id: true, name: true } } } } },
      orderBy: [{ eta: { sort: "asc", nulls: "last" } }, { etd: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      take: 500,
    });
    const today = this.clock.today();
    return rows.map((s) => {
      const eta = fromDbDateOrNull(s.eta);
      return {
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
  async purchaseOrders(user: SessionUser, open: boolean) {
    if (!can(user, "sourcing.manage")) throw new ForbiddenError("You cannot see factory costs.");
    const fx = fxOf(await this.settings.get(), await this.limits.allows("expenses"));
    const orders = await this.prisma.db.order.findMany({
      where: { ...orderAccess(user), status: { not: "cancelled" }, lines: { some: { factoryId: { not: null } } } },
      select: {
        id: true,
        refNo: true,
        stage: true,
        status: true,
        factoryOrderedOn: true,
        factoryOrderNo: true,
        customer: { select: { id: true, name: true } },
        lines: {
          select: {
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
    const rows = orders.flatMap((o) => {
      const names = new Map(o.lines.flatMap((l) => (l.factory ? [[l.factory.id, l.factory.name] as const] : [])));
      const ready = new Map(readyByOf(o).map((r) => [r.factoryId, r.readyOn] as const));
      return factoryPositionOf(o, fx)
        .filter((f) => f.lines > 0)
        .map((f) => {
          const readyOn: ISODate | null = ready.get(f.factoryId) ?? null;
          return {
            key: `${o.id}:${f.key}`,
            order: { id: o.id, refNo: o.refNo, stage: o.stage, closed: o.status === "closed" },
            customer: o.customer,
            supplier: { id: f.factoryId, name: names.get(f.factoryId) ?? "Supplier" },
            orderedOn: o.factoryOrderedOn ? fromDbDate(o.factoryOrderedOn) : null,
            supplierRef: o.factoryOrderNo,
            readyOn,
            /** Ready date passed and the order not shipped yet. */
            late: !!readyOn && readyOn < today && (o.stage === "confirmed" || o.stage === "in_production"),
            currency: f.currency,
            owed: fromMinor(f.owedMinor),
            paid: fromMinor(f.settledMinor),
            toPay: fromMinor(f.toPayMinor),
          };
        });
    });
    return open ? rows.filter((r) => Number(r.toPay) > 0 || r.order.stage === "confirmed" || r.order.stage === "in_production") : rows;
  }
}
