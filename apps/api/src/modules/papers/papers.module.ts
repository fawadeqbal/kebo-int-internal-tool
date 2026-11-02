import { Module } from "@nestjs/common";
import { FlowModule } from "../flow/flow.module";
import { OrdersModule } from "../orders/orders.module";
import { PapersController } from "./papers.controller";
import { PapersService } from "./papers.service";

/** Order flow v3: the papers the app makes from an order, in the one document template (see @kebo/shared workflows/papers). */
@Module({
  imports: [OrdersModule, FlowModule],
  controllers: [PapersController],
  providers: [PapersService],
  exports: [PapersService],
})
export class PapersModule {}
