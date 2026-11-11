import { Module } from "@nestjs/common";
import { OrdersModule } from "../orders/orders.module";
import { ReportsService } from "./reports.service";
import { FactsModule } from "../insights/facts/facts.module";
import { ReportsController } from "./reports.controller";

@Module({ imports: [OrdersModule, FactsModule], controllers: [ReportsController], providers: [ReportsService] })
export class ReportsModule {}
