import { Module } from "@nestjs/common";
import { InquiriesModule } from "../inquiries/inquiries.module";
import { OrdersModule } from "../orders/orders.module";
import { PapersModule } from "../papers/papers.module";
import { FlowModule } from "../flow/flow.module";
import { MoneyModule } from "../money/money.module";
import { TreasuryModule } from "../treasury/treasury.module";
import { ApprovalsModule } from "../approvals/approvals.module";
import { FilesController } from "./files.controller";
import { FilesService } from "./files.service";
import { OrderFilesController } from "./order-files.controller";
import { OrderFilesService } from "./order-files.service";
import { MailOutController } from "./mail-out.controller";
import { MailOutService } from "./mail-out.service";

/** Documents v3: every file of an order in one list, with the same tools everywhere; any stored file opened by its id. */
@Module({
  imports: [InquiriesModule, OrdersModule, PapersModule, FlowModule, MoneyModule, TreasuryModule, ApprovalsModule],
  controllers: [OrderFilesController, FilesController, MailOutController],
  providers: [OrderFilesService, FilesService, MailOutService],
})
export class OrderFilesModule {}
