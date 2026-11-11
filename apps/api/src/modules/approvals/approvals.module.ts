import {
  Module,
} from "@nestjs/common";
import { OrdersModule } from "../orders/orders.module";
import { MoneyModule } from "../money/money.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { ApprovalsService } from "./approvals.service";
import { SubmissionsController } from "./submissions.controller";

@Module({ imports: [OrdersModule, MoneyModule, NotificationsModule], controllers: [SubmissionsController], providers: [ApprovalsService] })
export class ApprovalsModule {}
