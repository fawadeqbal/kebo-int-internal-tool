import { Module } from "@nestjs/common";
import { OrdersModule } from "../orders/orders.module";
import { ClaimsController, OrderBoardController, FactoryRequestsController, OrderDocumentsController, OrderFlowController, ShipmentsController } from "./flow.controller";
import { FlowService } from "./flow.service";
import { FactoryRequestsService } from "./factory-requests.service";

/** The order flow after the quotation, and asking factories for prices (see @kebo/shared workflows/flow). */
@Module({
  imports: [OrdersModule],
  controllers: [OrderFlowController, OrderBoardController, ShipmentsController, OrderDocumentsController, ClaimsController, FactoryRequestsController],
  providers: [FlowService, FactoryRequestsService],
  exports: [FlowService],
})
export class FlowModule {}
