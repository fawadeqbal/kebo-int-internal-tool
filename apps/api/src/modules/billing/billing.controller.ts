import { Controller, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { invoicesQuery, type InvoicesQuery } from "@kebo/shared";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { BillingService } from "./billing.service";

/** Billing: what customers and suppliers have invoiced. Plans are changed on the order (PUT /orders/:id/payment-plan…). */
@ApiTags("billing")
@Controller()
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  /** What we still owe each factory on orders not cancelled. ?mine=true: the factories I look after. */
  @Get("money/payables")
  payables(
    @CurrentUser() user: SessionUser,
    @Query(
      Validate(
        z.object({
          mine: z
            .enum(["true", "false"])
            .optional()
            .transform((v) => v === "true"),
        }),
      ),
    )
    q: { mine: boolean },
  ) {
    return this.billing.payables(user, q.mine);
  }

  /** One payment request of an order (`ref`: its plan row): what it asks for, where it stands, the copies kept when sent, its payments. */
  @Get("orders/:id/requests/:ref")
  request(@CurrentUser() user: SessionUser, @Param("id", new ParseUUIDPipe()) id: string, @Param("ref", new ParseUUIDPipe()) ref: string) {
    return this.billing.request(user, id, ref);
  }

  /** Payment requests across the orders I may see that still have money due, each with where it stands. ?mine=true: the orders I handle. */
  @Get("billing/requests")
  requests(
    @CurrentUser() user: SessionUser,
    @Query(
      Validate(
        z.object({
          mine: z
            .enum(["true", "false"])
            .optional()
            .transform((v) => v === "true"),
        }),
      ),
    )
    q: { mine: boolean },
  ) {
    return this.billing.requests(user, q.mine);
  }

  /** Invoices to customers: each order's invoice (the commercial invoice once made, else the proforma) with what was paid. ?mine=true. */
  @Get("billing/customer-invoices")
  customerInvoices(
    @CurrentUser() user: SessionUser,
    @Query(
      Validate(
        z.object({
          mine: z
            .enum(["true", "false"])
            .optional()
            .transform((v) => v === "true"),
        }),
      ),
    )
    q: { mine: boolean },
  ) {
    return this.billing.customerInvoices(user, q.mine);
  }

  /** One order's invoice, its own view: what it bills, how it is paid, its terms. */
  @Get("billing/customer-invoices/:orderId")
  customerInvoice(@CurrentUser() user: SessionUser, @Param("orderId", new ParseUUIDPipe()) orderId: string) {
    return this.billing.customerInvoice(user, orderId);
  }

  /** The open invoices of one side, instalment by instalment (late first). ?side=receivable|payable, ?mine=true. */
  @Get("billing/invoices")
  invoices(@CurrentUser() user: SessionUser, @Query(Validate(invoicesQuery)) q: InvoicesQuery) {
    return this.billing.openInvoices(user, q.side, q.mine);
  }
}
