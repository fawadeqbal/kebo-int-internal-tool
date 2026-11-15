import { Module } from "@nestjs/common";
import { TreasuryModule } from "../treasury/treasury.module";
import { SearchController } from "./search.controller";
import { SearchService } from "./search.service";

/** Search everything: one box over customers, suppliers, inquiries, quotations, orders, purchase orders and payments. */
@Module({
  imports: [TreasuryModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
