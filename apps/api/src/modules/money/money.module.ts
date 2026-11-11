import {
  Module,
} from "@nestjs/common";
import { OrdersModule } from "../orders/orders.module";
import { FactsModule } from "../insights/facts/facts.module";
import { MoneyService } from "./money.service";
import { CostsService } from "./costs.service";
import { AccountsService } from "./accounts.service";
import { LeaksService } from "./leaks.service";
import { MoneyController } from "./money.controller";

@Module({ imports: [OrdersModule, FactsModule], controllers: [MoneyController], providers: [MoneyService, CostsService, AccountsService, LeaksService], exports: [MoneyService, AccountsService, LeaksService] })
export class MoneyModule {}
