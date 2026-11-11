import { Controller, Get, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { OperationsService } from "./operations.service";

/** Operations & trading lists across orders: shipments and purchase orders. */
@ApiTags("operations")
@Controller("operations")
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  /** ?all=true: arrived ones too (default: under way). */
  @Get("shipments")
  shipments(
    @CurrentUser() user: SessionUser,
    @Query(Validate(z.object({ all: z.enum(["true", "false"]).optional() }))) q: { all?: string },
  ) {
    return this.operations.shipments(user, q.all === "true");
  }

  /** ?all=true: every purchase order (default: those still to pay or not shipped). People who see costs. */
  @Get("purchase-orders")
  purchaseOrders(
    @CurrentUser() user: SessionUser,
    @Query(Validate(z.object({ all: z.enum(["true", "false"]).optional() }))) q: { all?: string },
  ) {
    return this.operations.purchaseOrders(user, q.all !== "true");
  }
}
