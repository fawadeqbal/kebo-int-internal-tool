import { Module } from "@nestjs/common";
import { OrdersModule } from "../orders/orders.module";
import { MoneyModule } from "../money/money.module";
import { TreasuryModule } from "../treasury/treasury.module";
import { ChecklistModule } from "../checklist/checklist.module";
import { InsightsService } from "./insights.service";
import { RemindersListService } from "./reminders-list.service";
import { FactsModule } from "./facts/facts.module";
import { InsightsController } from "./insights.controller";

@Module({ imports: [OrdersModule, MoneyModule, TreasuryModule, ChecklistModule, FactsModule], controllers: [InsightsController], providers: [InsightsService, RemindersListService], exports: [InsightsService, FactsModule] })
export class InsightsModule {}
