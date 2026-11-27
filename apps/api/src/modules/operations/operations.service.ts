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
import { supplierBorneExpenses, supplierPositionOf, fxOf, supplierPaidRelation } from "../billing/api";

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
   * order number (the supplier step), that supplier's ready date, and what we owe and paid it (Billing's rule).
   * `open`: only those with something still to pay or not ready yet.
   */
  async purchaseOrders(user: SessionUser, open: boolean, withCancelled = false, orderId?: string) {
    if (!can(user, "sourcing.manage")) throw new ForbiddenError("You cannot see supplier costs.");
    const fx = fxOf(await this.settings.get(), await this.limits.allows("expenses"));
    const orders = await this.prisma.db.order.findMany({
      where: { ...orderAccess(user), ...(orderId ? { id: orderId } : {}), ...(withCancelled ? {} : { status: { not: "cancelled" } }), lines: { some: { supplierId: { not: null } } } },
      select: {
        id: true,
        refNo: true,
        stage: true,
        status: true,
        supplierOrderedOn: true,
        supplierOrderNo: true,
        customer: { select: { id: true, name: true } },
        purchaseOrders: { select: { id: true, number: true, supplierId: true, sentOn: true, sentEarlyReason: true, supplierRef: true } },
        // What the order's one status word reads: "shipped" here is that word, not the stored stage.
        shipments: { select: { status: true, departedOn: true } },
        delivery: { select: { deliveredOn: true } },
        lines: {
          select: {
            receivedOn: true,
            supplierId: true,
            supplierUnitPrice: true,
            supplierCurrency: true,
            supplierTaxRate: true,
            supplierTaxIncluded: true,
            quantity: true,
            supplier: { select: { id: true, name: true } },
          },
        },
        supplierPaid: supplierPaidRelation,
        expenses: supplierBorneExpenses,
        ...readySelect,
      },
      orderBy: { orderedOn: "desc" },
      take: 500,
    });
    const today = this.clock.today();
    const features = await this.limits.features();
    const rows = orders.flatMap((o) => {
      const names = new Map(o.lines.flatMap((l) => (l.supplier ? [[l.supplier.id, l.supplier.name] as const] : [])));
      const ready = new Map(readyByOf(o).map((r) => [r.supplierId, r.readyOn] as const));
      // Where the order stands, by its one worked-out word: still with the supplier, or shipped and after.
      const at = orderWordColumn(orderWord(wordFactsOf(o), features));
      const beforeShipping = at === "confirmed" || at === "in_production";
      return supplierPositionOf(o, fx)
        .filter((f) => f.lines > 0)
        .map((f) => {
          const readyOn: ISODate | null = ready.get(f.supplierId) ?? null;
          const po = o.purchaseOrders.find((p) => p.supplierId === f.supplierId) ?? null;
          const sentOn = po?.sentOn ? fromDbDate(po.sentOn) : o.supplierOrderedOn ? fromDbDate(o.supplierOrderedOn) : null;
          const mine = o.lines.filter((l) => l.supplierId === f.supplierId);
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
            supplier: { id: f.supplierId, name: names.get(f.supplierId) ?? "Supplier" },
            orderedOn: sentOn,
            supplierRef: po?.supplierRef ?? o.supplierOrderNo,
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

  /**
   * The Purchase orders list, a page at a time: the rows of one tab after the search and filters, each tab's
   * count (the same search and filters, so a tab's count is exactly what it lists), the tiles over the list and
   * the suppliers for its filter. A purchase order's status is worked out, not stored, so the rows are worked
   * out here and only the page asked for leaves the server.
   */
  async purchaseOrderPage(user: SessionUser, q: PurchaseOrderPageQuery) {
    const all = await this.purchaseOrders(user, false, true);
    const month = this.clock.today().slice(0, 7);
    const text = q.q?.trim().toLowerCase() ?? "";
    const inTab = (r: (typeof all)[number], tab: PurchaseOrderTab) => tab === "all" || r.status === tab || (tab === "in_production" && r.status === "late");
    const searched = all
      .filter((r) => !text || [r.po?.number, r.supplier.name, r.order.refNo, r.customer.name, r.supplierRef].filter(Boolean).join(" ").toLowerCase().includes(text))
      .filter((r) => !q.supplier || r.supplier.id === q.supplier)
      .filter((r) => !q.ready || (q.ready === "month" ? !!r.readyOn?.startsWith(month) : q.ready === "late" ? r.status === "late" : !r.readyOn));
    const counts = Object.fromEntries(PURCHASE_ORDER_TABS.map((t) => [t, searched.filter((r) => inTab(r, t)).length])) as Record<PurchaseOrderTab, number>;
    const listed = searched.filter((r) => inTab(r, q.status));
    const late = all.filter((r) => r.status === "late");
    // What we still owe suppliers, in each currency, largest first.
    const owe = new Map<string, number>();
    for (const r of all) if (r.status !== "cancelled" && Number(r.toPay) > 0) owe.set(r.currency, (owe.get(r.currency) ?? 0) + Number(r.toPay));
    return {
      rows: listed.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
      total: listed.length,
      page: q.page,
      pageSize: q.pageSize,
      counts,
      tiles: {
        open: all.filter((r) => r.status !== "cancelled" && r.status !== "shipped").length,
        late: late.length,
        lateRefs: late.slice(0, 2).map((r) => r.po?.number ?? r.order.refNo),
        readyThisMonth: all.filter((r) => r.status !== "cancelled" && !!r.readyOn?.startsWith(month)).length,
        owe: [...owe.entries()].sort((a, b) => b[1] - a[1]).map(([currency, amount]) => ({ currency, amount })),
      },
      suppliers: [...new Map(all.map((r) => [r.supplier.id, r.supplier.name])).entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }
}

export const PURCHASE_ORDER_TABS = ["all", "not_sent", "in_production", "ready", "shipped", "cancelled"] as const;
export type PurchaseOrderTab = (typeof PURCHASE_ORDER_TABS)[number];
export interface PurchaseOrderPageQuery {
  status: PurchaseOrderTab;
  q?: string;
  supplier?: string;
  ready?: "month" | "late" | "none";
  page: number;
  pageSize: number;
}
