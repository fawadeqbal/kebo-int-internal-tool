import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  creditRefundInput,
  customerReceiptInput,
  editPaymentInput,
  paymentInput,
  useCreditInput,
  voidPaymentInput,
  type CreditRefundInput,
  type CustomerReceiptInput,
  type EditPaymentInput,
  type PaymentInput,
  type UseCreditInput,
} from "@kebo/shared";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser, RequirePermissions } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { CustomerPaymentsService } from "./customer-payments.service";

/** Money in from a customer on an order (the routes stay under /orders/:id). */
@ApiTags("treasury")
@Controller("orders")
class OrderPaymentsController {
  constructor(private readonly payments: CustomerPaymentsService) {}

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
}

@ApiTags("treasury")
@Controller("payments")
class CustomerPaymentsController {
  constructor(private readonly payments: CustomerPaymentsService) {}

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

@ApiTags("treasury")
@Controller()
class CreditController {
  constructor(private readonly payments: CustomerPaymentsService) {}

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

export { CreditController, CustomerPaymentsController, OrderPaymentsController };
