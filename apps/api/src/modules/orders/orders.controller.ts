import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  cancelOrderInput,
  creditRefundInput,
  customerReceiptInput,
  editPaymentInput,
  useCreditInput,
  type CancelOrderInput,
  type CreditRefundInput,
  type CustomerReceiptInput,
  type UseCreditInput,
  moveStageInput,
  ORDER_STAGES,
  orderDetailsInput,
  orderLineInput,
  packingInput,
  paymentInput,
  receiptInput,
  voidPaymentInput,
  type EditPaymentInput,
  type MoveStageInput,
  type OrderDetailsInput,
  type OrderLineInput,
  type PackingInput,
  type PaymentInput,
  type ReceiptInput,
} from "@kebo/shared";
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
  /** The most recently moved first (the board's Done column), and at most this many. */
  recent: flag,
  limit: z.coerce.number().int().min(1).max(300).optional(),
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
    return this.orders.list(user, { mine: q.mine, status: q.status, stage: q.stage, lateOnly: q.late, recent: q.recent, limit: q.limit });
  }

  /** How many orders: ?status=open|closed|cancelled&mine=true → { count }. */
  @Get("count")
  count(@CurrentUser() user: SessionUser, @Query(Validate(listQuery)) q: z.infer<typeof listQuery>) {
    return this.orders.count(user, { mine: q.mine, status: q.status });
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

  /** { on?, lines: [{ lineId, receivedQty }] } — how many of each goods line came in from the factory so far. */
  @Put(":id/receipt")
  receipt(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(receiptInput)) body: ReceiptInput) {
    return this.orders.recordReceipt(user, id, body);
  }

  /** { containerNo?, shippingMarks?, lines: [{ lineId, packages, packageType, netWeightKg, grossWeightKg, cbm }] } — the packing list. */
  @Put(":id/packing")
  packing(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(packingInput)) body: PackingInput) {
    return this.orders.savePacking(user, id, body);
  }

  /** Gives the proforma its number (KEB260916TN07), dated today. Once issued it does not change. */
  @Post(":id/proforma")
  @HttpCode(200)
  issueProforma(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.orders.issueProforma(user, id);
  }

  /**
   * { reason, customerMoney?: credit | refund | fee, refundNow?, refundAccountId?, refundOn?, factoryMoney?: refund_due | loss }
   * — managers only; the deal becomes lost (customer cancelled) and can be reopened. Money received is kept as
   * credit unless told otherwise; money paid to the factory must be said (refund expected or a loss).
   */
  @Post(":id/cancel")
  @HttpCode(200)
  @RequirePermissions("orders.manage")
  cancel(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(cancelOrderInput)) body: CancelOrderInput) {
    return this.orders.cancel(user, id, body.reason, body);
  }

  /** Money in from the customer, and the position (received, still due). */
  @Get(":id/payments")
  listPayments(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.payments.forOrder(user, id);
  }

  /**
   * Money in. Older clients: { kind, amount, currency (the order's), … }. Money v2 adds receivedAmount,
   * receivedCurrency, rate, paidByName, parts [{ orderId, amount }] (other orders of the customer) and
   * bankStep: "bank_paid_us" (Money reached us). What is more than is due becomes the customer's credit.
   */
  @Post(":id/payments")
  @RequirePermissions("payments.record")
  pay(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(paymentInput)) body: PaymentInput) {
    return this.payments.record(user, id, body);
  }

  /** { amount, on? } — pays (part of) the order from the customer's credit. */
  @Post(":id/use-credit")
  @RequirePermissions("payments.record")
  useCredit(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(useCreditInput)) body: UseCreditInput) {
    return this.payments.useCredit(user, id, body);
  }

  /** proforma | invoice | packing-list — the data to print (the web turns it into a page and a PDF). */
  @Get(":id/documents/:kind")
  document(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Param("kind", Validate(z.enum(ORDER_DOCUMENTS))) kind: OrderDocumentKind) {
    return this.documents.get(user, id, kind);
  }
}

/**
 * One line of an order, in a step's line table. Lines are added and removed on
 * the order (the accepted quotation); here only what each step adds changes.
 */
@ApiTags("orders")
@Controller("order-lines")
export class OrderLinesController {
  constructor(private readonly orders: OrdersService) {}

  /**
   * { set: "received", receivedQty?, receivedOn? } (orders.update) ·
   * { set: "packing", packages?, packageType?, netWeightKg?, grossWeightKg?, cbm? } (orders.update) ·
   * { set: "delivered", deliveredQty?, condition?, note? } (delivery.manage, Delivery & SAT on).
   * Only the fields sent change. Answers { line, goods }.
   */
  @Patch(":id")
  edit(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(orderLineInput)) body: OrderLineInput) {
    return this.orders.editLine(user, id, body);
  }
}

@ApiTags("orders")
@Controller("payments")
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** ?customerId= — that customer's orders with what was received and is due, totals per currency, and every payment. */
  @Get()
  forCustomer(@CurrentUser() user: SessionUser, @Query(Validate(z.object({ customerId: z.uuid() }))) q: { customerId: string }) {
    return this.payments.forCustomer(user, q.customerId);
  }

  /** The payment's fields plus { reason } (always asked): a recorded payment changed. */
  @Patch(":id")
  edit(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(editPaymentInput)) body: EditPaymentInput) {
    return this.payments.edit(user, id, body);
  }

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

@ApiTags("orders")
@Controller()
export class CreditController {
  constructor(private readonly payments: PaymentsService) {}

  /** The customer's credit: balances per currency and every entry. */
  @Get("customers/:id/credit")
  credit(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.payments.creditView(user, id);
  }

  /** One transfer over several of the customer's orders: { receivedAmount, receivedCurrency, currency, rate?, parts, … }; the rest is credit. */
  @Post("customers/:id/receipts")
  @RequirePermissions("payments.record")
  receive(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(customerReceiptInput)) body: CustomerReceiptInput) {
    return this.payments.receive(user, id, body);
  }

  /** { amount, currency, on, accountId?, note? } — pays the customer's credit back. */
  @Post("customers/:id/credit/refund")
  @RequirePermissions("payments.record")
  refund(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(creditRefundInput)) body: CreditRefundInput) {
    return this.payments.refundCredit(user, id, body);
  }

  /** { reason } — managers only: a refund recorded by mistake. */
  @Post("customer-credits/:id/void")
  @HttpCode(200)
  @RequirePermissions("orders.manage")
  voidCredit(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(voidPaymentInput)) body: z.infer<typeof voidPaymentInput>) {
    return this.payments.voidCredit(user, id, body.reason);
  }

  /** { reason } — managers only: a transfer recorded by mistake (its payments and credit go with it). */
  @Post("customer-receipts/:id/void")
  @HttpCode(200)
  @RequirePermissions("orders.manage")
  voidReceipt(@CurrentUser() user: SessionUser, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(voidPaymentInput)) body: z.infer<typeof voidPaymentInput>) {
    return this.payments.voidReceipt(user, id, body.reason);
  }
}
