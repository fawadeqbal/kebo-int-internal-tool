import { Module } from "@nestjs/common";
import { OrdersModule } from "../orders/orders.module";
import { MoneyModule } from "../money/money.module";
import { TreasuryModule } from "../treasury/treasury.module";
import { InsightsService } from "./insights.service";
import { RemindersListService } from "./reminders-list.service";
import { FactsModule } from "./facts/facts.module";
import { InsightsController } from "./insights.controller";
import { HomeService } from "./home.service";

@Module({ imports: [OrdersModule, MoneyModule, TreasuryModule, FactsModule], controllers: [InsightsController], providers: [InsightsService, RemindersListService, HomeService], exports: [InsightsService, FactsModule] })
export class InsightsModule {}
