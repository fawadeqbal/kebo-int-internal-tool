import { Module } from "@nestjs/common";
import { InquiriesModule } from "../inquiries/inquiries.module";
import { OrdersModule } from "../orders/orders.module";
import { PapersModule } from "../papers/papers.module";
import { ChecklistModule } from "../checklist/checklist.module";
import { FlowModule } from "../flow/flow.module";
import { MoneyModule } from "../money/money.module";
import { OrderFilesController } from "./order-files.controller";
import { OrderFilesService } from "./order-files.service";

/** Documents v3: every file of an order in one list, with the same tools everywhere. */
@Module({
  imports: [InquiriesModule, OrdersModule, PapersModule, ChecklistModule, FlowModule, MoneyModule],
  controllers: [OrderFilesController],
  providers: [OrderFilesService],
})
export class OrderFilesModule {}
