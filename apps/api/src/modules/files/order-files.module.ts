import { Module } from "@nestjs/common";
import { InquiriesModule } from "../inquiries/inquiries.module";
import { OrdersModule } from "../orders/orders.module";
import { PapersModule } from "../papers/papers.module";
import { ChecklistModule } from "../checklist/checklist.module";
import { FlowModule } from "../flow/flow.module";
import { MoneyModule } from "../money/money.module";
import { TreasuryModule } from "../treasury/treasury.module";
import { ApprovalsModule } from "../approvals/approvals.module";
import { FilesController } from "./files.controller";
import { FilesService } from "./files.service";
import { OrderFilesController } from "./order-files.controller";
import { OrderFilesService } from "./order-files.service";

/** Documents v3: every file of an order in one list, with the same tools everywhere; any stored file opened by its id. */
@Module({
  imports: [InquiriesModule, OrdersModule, PapersModule, ChecklistModule, FlowModule, MoneyModule, TreasuryModule, ApprovalsModule],
  controllers: [OrderFilesController, FilesController],
  providers: [OrderFilesService, FilesService],
})
export class OrderFilesModule {}
