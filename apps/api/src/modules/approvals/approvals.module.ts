import {
  Module,
} from "@nestjs/common";
import { OrdersModule } from "../orders/orders.module";
import { TreasuryModule } from "../treasury/treasury.module";
import { MoneyModule } from "../money/money.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { ApprovalsService } from "./approvals.service";
import { SubmissionsController } from "./submissions.controller";

@Module({ imports: [OrdersModule, MoneyModule, TreasuryModule, NotificationsModule], controllers: [SubmissionsController], providers: [ApprovalsService] })
export class ApprovalsModule {}
