import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Put } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  documentsReleasedInput,
  factoryOrderConfirmInput,
  factoryOrderInput,
  factoryVatInvoiceInput,
  invoiceInput,
  optionalDate,
  paymentInput,
  shipmentInput,
  shipmentStatusInput,
  voidInvoiceInput,
  voidPaymentInput,
  type FactoryOrderInput,
  type InvoiceInput,
  type PaymentInput,
  type ShipmentInput,
} from "@kebo/shared";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser, RequirePermissions } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { OrdersModule } from "../orders/orders.module";
import { FactoryOrdersService } from "./factory-orders.service";
import { InvoicesService } from "./invoices.service";
import { PaymentsService } from "./payments.service";
import { ShipmentsService } from "./shipments.service";

const onInput = z.object({ on: optionalDate });
const reasonInput = z.object({ reason: z.string().trim().min(1, "Give a reason").max(2000) });
type U = SessionUser;

@ApiTags("factory orders")
@Controller()
class FactoryOrdersController {
  constructor(private readonly s: FactoryOrdersService) {}

  @Get("orders/:id/factory-orders")
  list(@CurrentUser() u: U, @Param("id", ParseUUIDPipe) id: string) {
    return this.s.forOrder(u, id);
  }

  /** Starting values: goods lines grouped by the factory they were quoted from. */
  @Get("orders/:id/factory-orders/drafts")
  drafts(@CurrentUser() u: U, @Param("id", ParseUUIDPipe) id: string) {
    return this.s.drafts(u, id);
  }

  @Post("orders/:id/factory-orders")
  @RequirePermissions("factoryOrders.manage")
  create(@CurrentUser() u: U, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(factoryOrderInput)) b: FactoryOrderInput) {
    return this.s.create(u, id, b);
  }

  @Get("factory-orders/:id")
  one(@CurrentUser() u: U, @Param("id", ParseUUIDPipe) id: string) {
    return this.s.one(u, id);
  }

  @Put("factory-orders/:id")
  @RequirePermissions("factoryOrders.manage")
  update(@CurrentUser() u: U, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(factoryOrderInput)) b: FactoryOrderInput) {
    return this.s.update(u, id, b);
  }

  @Post("factory-orders/:id/send")
  @HttpCode(200)
  send(@CurrentUser() u: U, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(onInput)) b: z.infer<typeof onInput>) {
    return this.s.send(u, id, b.on);
  }

  /** { readyOn, on? } */
  @Post("factory-orders/:id/confirm")
  @HttpCode(200)
  confirm(@CurrentUser() u: U, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(factoryOrderConfirmInput)) b: z.infer<typeof factoryOrderConfirmInput>) {
    return this.s.confirm(u, id, b.readyOn, b.on);
  }

  @Post("factory-orders/:id/vat-invoice")
  @HttpCode(200)
  vat(@CurrentUser() u: U, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(factoryVatInvoiceInput)) b: z.infer<typeof factoryVatInvoiceInput>) {
    return this.s.vatInvoice(u, id, b.number, b.on);
  }

  @Post("factory-orders/:id/cancel")
  @HttpCode(200)
  cancel(@CurrentUser() u: U, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(reasonInput)) b: z.infer<typeof reasonInput>) {
    return this.s.cancel(u, id, b.reason);
  }
}

@ApiTags("payments")
@Controller()
class PaymentsController {
  constructor(private readonly s: PaymentsService) {}

  @Get("orders/:id/payments")
  list(@CurrentUser() u: U, @Param("id", ParseUUIDPipe) id: string) {
    return this.s.forOrder(u, id);
  }

  /** From the customer; ticks "Deposit received" / "Balance received" when covered. */
  @Post("orders/:id/payments/in")
  @RequirePermissions("payments.record")
  in(@CurrentUser() u: U, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(paymentInput)) b: PaymentInput) {
    return this.s.recordIn(u, id, b);
  }

  /** To a factory (factoryOrderId required); a factory deposit before the customer's needs a manager's note. */
  @Post("orders/:id/payments/out")
  @RequirePermissions("payments.record")
  out(@CurrentUser() u: U, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(paymentInput)) b: PaymentInput) {
    return this.s.recordOut(u, id, b);
  }

  @Post("payments/:id/void")
  @HttpCode(200)
  void(@CurrentUser() u: U, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(voidPaymentInput)) b: z.infer<typeof voidPaymentInput>) {
    return this.s.void(u, id, b.reason);
  }
}

@ApiTags("invoices")
@Controller()
class InvoicesController {
  constructor(private readonly s: InvoicesService) {}

  @Get("orders/:id/invoices")
  list(@CurrentUser() u: U, @Param("id", ParseUUIDPipe) id: string) {
    return this.s.forOrder(u, id);
  }

  /** { type: proforma|commercial, shipmentId? (commercial), issueDate?, dueDate?, notes? } — a draft. */
  @Post("orders/:id/invoices")
  @RequirePermissions("invoices.manage")
  create(@CurrentUser() u: U, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(invoiceInput)) b: InvoiceInput) {
    return this.s.create(u, id, b);
  }

  @Get("invoices/:id")
  one(@CurrentUser() u: U, @Param("id", ParseUUIDPipe) id: string) {
    return this.s.one(u, id);
  }

  @Put("invoices/:id")
  @RequirePermissions("invoices.manage")
  update(@CurrentUser() u: U, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(invoiceInput.pick({ issueDate: true, dueDate: true, notes: true }))) b: Pick<InvoiceInput, "issueDate" | "dueDate" | "notes">) {
    return this.s.update(u, id, b);
  }

  @Post("invoices/:id/issue")
  @HttpCode(200)
  @RequirePermissions("invoices.manage")
  issue(@CurrentUser() u: U, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(onInput)) b: z.infer<typeof onInput>) {
    return this.s.issue(u, id, b.on);
  }

  @Post("invoices/:id/void")
  @HttpCode(200)
  void(@CurrentUser() u: U, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(voidInvoiceInput)) b: z.infer<typeof voidInvoiceInput>) {
    return this.s.void(u, id, b.reason);
  }
}

@ApiTags("shipments")
@Controller()
class ShipmentsController {
  constructor(private readonly s: ShipmentsService) {}

  @Get("orders/:id/shipments")
  list(@CurrentUser() u: U, @Param("id", ParseUUIDPipe) id: string) {
    return this.s.forOrder(u, id);
  }

  @Get("orders/:id/shipments/draft")
  draft(@CurrentUser() u: U, @Param("id", ParseUUIDPipe) id: string) {
    return this.s.draft(u, id);
  }

  @Post("orders/:id/shipments")
  @RequirePermissions("shipments.manage")
  create(@CurrentUser() u: U, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(shipmentInput)) b: ShipmentInput) {
    return this.s.create(u, id, b);
  }

  @Get("shipments/:id")
  one(@CurrentUser() u: U, @Param("id", ParseUUIDPipe) id: string) {
    return this.s.one(u, id);
  }

  @Put("shipments/:id")
  @RequirePermissions("shipments.manage")
  update(@CurrentUser() u: U, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(shipmentInput)) b: ShipmentInput) {
    return this.s.update(u, id, b);
  }

  /** { to: booked|departed|arrived, on?, note? } — departing the last goods ticks "Shipped". */
  @Post("shipments/:id/status")
  @HttpCode(200)
  status(@CurrentUser() u: U, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(shipmentStatusInput)) b: z.infer<typeof shipmentStatusInput>) {
    return this.s.setStatus(u, id, b.to, b.on, b.note);
  }

  @Post("shipments/:id/documents-released")
  @HttpCode(200)
  released(@CurrentUser() u: U, @Param("id", ParseUUIDPipe) id: string, @Body(Validate(documentsReleasedInput)) b: z.infer<typeof documentsReleasedInput>) {
    return this.s.releaseDocuments(u, id, b.on, b.note);
  }
}

@Module({
  imports: [OrdersModule],
  controllers: [FactoryOrdersController, PaymentsController, InvoicesController, ShipmentsController],
  providers: [FactoryOrdersService, PaymentsService, InvoicesService, ShipmentsService],
  exports: [FactoryOrdersService, PaymentsService, InvoicesService, ShipmentsService],
})
export class FulfilmentModule {}
