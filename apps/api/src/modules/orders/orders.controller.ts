import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { cancelOrderInput, moveStageInput, ORDER_STAGES, orderDetailsInput, paymentInput, voidPaymentInput, type MoveStageInput, type OrderDetailsInput, type PaymentInput } from "@kebo/shared";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser, RequirePermissions } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { OrdersService } from "./orders.service";
import { DocumentsService, ORDER_DOCUMENTS, type OrderDocumentKind } from "./documents.service";
import { PaymentsService } from "./payments.service";

const flag = z.enum(["true", "false"]).optional().transform((v) => v === "true");
const listQuery = z.object({
  mine: flag,
  late: flag,
  status: z.enum(["open", "closed", "cancelled"]).optional(),
  stage: z.enum(ORDER_STAGES).optional(),
});

@ApiTags("orders")
@Controller("orders")
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
    private readonly documents: DocumentsService,
  ) {}

  /** Orders with their stage, money due and what each needs now. ?status=open|closed|cancelled&stage=&mine=true&late=true */
  @Get()
  list(@CurrentUser() user: SessionUser, @Query(Validate(listQuery)) q: z.infer<typeof listQuery>) {
    return this.orders.list(user, { mine: q.mine, status: q.status, stage: q.stage, lateOnly: q.late });
  }

  /** The order: stage, the next button, money, what it needs, history, documents. */
  @Get(":id")
  get(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.orders.get(user, id);
  }

  /**
   * { to, confirm?, note?, readyOn?, shippedOn?, blNo? } — one stage forward or back.
   * A move with warnings answers 409 { code: "confirm", error: the warnings }; send it again with confirm: true.
   */
  @Post(":id/stage")
  @HttpCode(200)
  move(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(moveStageInput)) body: MoveStageInput) {
    return this.orders.moveStage(user, id, body);
  }

  /** { shipBy, readyOn, shippedOn, blNo } */
  @Patch(":id/details")
  details(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(orderDetailsInput)) body: OrderDetailsInput) {
    return this.orders.setDetails(user, id, body);
  }

  /** { reason } — managers only; the deal becomes lost (customer cancelled) and can be reopened. */
  @Post(":id/cancel")
  @HttpCode(200)
  cancel(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(cancelOrderInput)) body: z.infer<typeof cancelOrderInput>) {
    return this.orders.cancel(user, id, body.reason);
  }

  /** Money in from the customer, and the position (received, still due). */
  @Get(":id/payments")
  listPayments(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.payments.forOrder(user, id);
  }

  @Post(":id/payments")
  @RequirePermissions("payments.record")
  pay(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(paymentInput)) body: PaymentInput) {
    return this.payments.record(user, id, body);
  }

  /** proforma | invoice | packing-list — the data to print (the web turns it into a page and a PDF). */
  @Get(":id/documents/:kind")
  document(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Param("kind", Validate(z.enum(ORDER_DOCUMENTS))) kind: OrderDocumentKind) {
    return this.documents.get(user, id, kind);
  }
}

@ApiTags("orders")
@Controller("payments")
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** { reason } — managers only; the payment stays visible, crossed out. */
  @Post(":id/void")
  @HttpCode(200)
  void(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(voidPaymentInput)) body: z.infer<typeof voidPaymentInput>) {
    return this.payments.void(user, id, body.reason);
  }
}

@ApiTags("me")
@Controller("me")
export class MeController {
  constructor(private readonly orders: OrdersService) {}

  /** My to-do: what each open order I handle needs now, late ones first. */
  @Get("todo")
  todo(@CurrentUser() user: SessionUser) {
    return this.orders.todo(user);
  }
}
