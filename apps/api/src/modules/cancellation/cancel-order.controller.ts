import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { cancelOrderInput, type CancelOrderInput } from "@kebo/shared";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser, RequirePermissions } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { CancelOrderService } from "./cancel-order.service";

@ApiTags("orders")
@Controller("orders")
export class CancelOrderController {
  constructor(private readonly cancelling: CancelOrderService) {}

  /**
   * { reason, customerMoney?: credit | refund | fee, refundNow?, refundAccountId?, refundOn?, factoryMoney?: refund_due | loss }
   * — managers only; the deal becomes lost (customer cancelled) and can be reopened. Money received is kept as
   * credit unless told otherwise; money paid to the factory must be said (refund expected or a loss).
   */
  @Post(":id/cancel")
  @HttpCode(200)
  @RequirePermissions("orders.manage")
  cancel(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(Validate(cancelOrderInput)) body: CancelOrderInput,
  ) {
    return this.cancelling.cancel(user, id, body.reason, body);
  }
}
