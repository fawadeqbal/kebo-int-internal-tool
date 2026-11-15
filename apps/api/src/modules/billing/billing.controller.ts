import { Controller, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { invoicesQuery, isoDate, type InvoicesQuery } from "@kebo/shared";
import type { ISODate } from "@kebo/utils";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser, SignedIn } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { BillingService } from "./billing.service";

/** Billing: what customers and suppliers have invoiced. Plans are changed on the order (PUT /orders/:id/payment-plan…). */
@ApiTags("billing")
@Controller()
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  /** What we still owe each factory on orders not cancelled. ?mine=true: the factories I look after; ?factory=: one supplier. */
  @SignedIn("checked inside: sourcing.manage")
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
          /** Only this supplier's (its own page). */
          factory: z.string().uuid().optional(),
        }),
      ),
    )
    q: { mine: boolean; factory?: string },
  ) {
    return this.billing.payables(user, q.mine, q.factory);
  }

  /** One payment request of an order (`ref`: its plan row): what it asks for, where it stands, the copies kept when sent, its payments. */
  @SignedIn("checked inside: documents.manage, orders.update, payments.record")
  @Get("orders/:id/requests/:ref")
  request(@CurrentUser() user: SessionUser, @Param("id", new ParseUUIDPipe()) id: string, @Param("ref", new ParseUUIDPipe()) ref: string) {
    return this.billing.request(user, id, ref);
  }

  /** Payment requests across the orders I may see that still have money due, each with where it stands. ?mine=true: the orders I handle. */
  @SignedIn("checked inside: documents.manage, orders.update, payments.record")
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
  @SignedIn("anyone signed in to the company")
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
  @SignedIn("anyone signed in to the company")
  @Get("billing/customer-invoices/:orderId")
  customerInvoice(@CurrentUser() user: SessionUser, @Param("orderId", new ParseUUIDPipe()) orderId: string) {
    return this.billing.customerInvoice(user, orderId);
  }

  /** Payments › To pay: the open parts of every supplier's plan, with the order's route and the customer's money. ?mine=true: the suppliers I look after. */
  @SignedIn("checked inside: payments.record, sourcing.manage")
  @Get("billing/to-pay")
  toPay(
    @CurrentUser() user: SessionUser,
    @Query(
      Validate(
        z.object({
          mine: z
            .enum(["true", "false"])
            .optional()
            .transform((v) => v === "true"),
          /** Only the parts late or due by this day. */
          dueBy: isoDate().optional(),
        }),
      ),
    )
    q: { mine: boolean; dueBy?: string },
  ) {
    return this.billing.toPay(user, q.mine, q.dueBy as ISODate | undefined);
  }

  /** The open invoices of one side, instalment by instalment (late first). ?side=receivable|payable, ?mine=true. */
  @SignedIn("checked inside: expenses.manage, payments.record, sourcing.manage")
  @Get("billing/invoices")
  invoices(@CurrentUser() user: SessionUser, @Query(Validate(invoicesQuery)) q: InvoicesQuery) {
    return this.billing.openInvoices(user, q.side, q.mine);
  }
}
