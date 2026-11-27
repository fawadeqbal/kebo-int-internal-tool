import { Module } from "@nestjs/common";
import { OrdersModule } from "../orders/orders.module";
import { MoneyModule } from "../money/money.module";
import { ClaimsController, OrderBoardController, SupplierRequestsController, OrderDocumentsController, OrderFlowController, ShipmentsController } from "./flow.controller";
import { FlowService } from "./flow.service";
import { SupplierRequestsService } from "./supplier-requests.service";
import { TermsFillService } from "./terms-fill.service";

/** The order flow after the quotation, and asking suppliers for prices (see @kebo/shared workflows/flow). */
@Module({
  imports: [OrdersModule, MoneyModule],
  controllers: [OrderFlowController, OrderBoardController, ShipmentsController, OrderDocumentsController, ClaimsController, SupplierRequestsController],
  providers: [FlowService, SupplierRequestsService, TermsFillService],
  exports: [FlowService, TermsFillService],
})
export class FlowModule {}
