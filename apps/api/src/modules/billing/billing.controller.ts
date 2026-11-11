import { Controller, Get, Query } from "@nestjs/common";
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

  /** The open invoices of one side, instalment by instalment (late first). ?side=receivable|payable, ?mine=true. */
  @Get("billing/invoices")
  invoices(@CurrentUser() user: SessionUser, @Query(Validate(invoicesQuery)) q: InvoicesQuery) {
    return this.billing.openInvoices(user, q.side, q.mine);
  }
}
