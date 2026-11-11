import { Module } from "@nestjs/common";
import { BillingController } from "./billing.controller";
import { BillingService } from "./billing.service";

/** Billing: the invoices of each order, both sides (claude/billing-4-design.md). Asked by the others; asks nobody. */
@Module({ controllers: [BillingController], providers: [BillingService], exports: [BillingService] })
export class BillingModule {}
