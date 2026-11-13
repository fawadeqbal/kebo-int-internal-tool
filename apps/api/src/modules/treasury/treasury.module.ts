import { Module } from "@nestjs/common";
import { OrdersModule } from "../orders/orders.module";
import { TreasuryService } from "./treasury.service";
import { TreasuryController } from "./treasury.controller";
import { CustomerPaymentsService } from "./customer-payments.service";
import { SupplierPaymentsService } from "./supplier-payments.service";
import { CashService } from "./cash.service";
import { CashReportService } from "./cash-report.service";
import { PaymentFilesService } from "./payment-files.service";
import { CreditController, CustomerPaymentsController, OrderPaymentsController } from "./customer-payments.controller";
import { CashController } from "./cash.controller";

/**
 * Treasury owns money accounts, payment entries (money_movements) and what they pay (allocations): every write to
 * them is here (architecture review §7.1). Customer money (in, credit, refunds), supplier payments, moves between
 * accounts, the cash book, proofs, and Treasury › Payments. Other modules use `api.ts` or the services exported here.
 */
@Module({
  imports: [OrdersModule],
  controllers: [TreasuryController, OrderPaymentsController, CustomerPaymentsController, CreditController, CashController],
  providers: [TreasuryService, CustomerPaymentsService, SupplierPaymentsService, CashService, CashReportService, PaymentFilesService],
  exports: [TreasuryService, CustomerPaymentsService, SupplierPaymentsService, CashService, PaymentFilesService],
})
export class TreasuryModule {}
