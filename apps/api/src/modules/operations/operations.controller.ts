import { Controller, Get, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser, SignedIn } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { OperationsService, PURCHASE_ORDER_TABS, type PurchaseOrderPageQuery } from "./operations.service";

const pageQuery = z.object({
  status: z.enum(PURCHASE_ORDER_TABS).default("all"),
  q: z.string().trim().max(100).optional(),
  supplier: z.string().uuid().optional(),
  ready: z.enum(["month", "late", "none"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** Operations & trading lists across orders: shipments and purchase orders. */
@ApiTags("operations")
@Controller("operations")
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  /** ?all=true: arrived ones too (default: under way). */
  @SignedIn("anyone signed in to the company")
  @Get("shipments")
  shipments(
    @CurrentUser() user: SessionUser,
    @Query(Validate(z.object({ all: z.enum(["true", "false"]).optional() }))) q: { all?: string },
  ) {
    return this.operations.shipments(user, q.all === "true");
  }

  /**
   * The Purchase orders list, a page at a time, with each tab's count, the tiles and the suppliers for the
   * filter: ?status=all|not_sent|in_production|ready|shipped|cancelled&q&supplier&ready=month|late|none&page&pageSize.
   * People who see costs.
   */
  @SignedIn("checked inside: sourcing.manage")
  @Get("purchase-orders/page")
  purchaseOrderPage(@CurrentUser() user: SessionUser, @Query(Validate(pageQuery)) q: PurchaseOrderPageQuery) {
    return this.operations.purchaseOrderPage(user, q);
  }

  /**
   * ?all=true: every purchase order (default: those still to pay or not shipped). ?order=: one sales order's
   * (the purchase order's own page). People who see costs.
   */
  @SignedIn("checked inside: sourcing.manage")
  @Get("purchase-orders")
  purchaseOrders(
    @CurrentUser() user: SessionUser,
    @Query(Validate(z.object({ all: z.enum(["true", "false"]).optional(), order: z.string().uuid().optional() }))) q: { all?: string; order?: string },
  ) {
    return this.operations.purchaseOrders(user, q.all !== "true", q.all === "true", q.order);
  }
}
