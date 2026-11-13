import { Module } from "@nestjs/common";
import { MoneyModule } from "../money/money.module";
import { SectionsController } from "./sections.controller";
import { SectionsService } from "./sections.service";

/** The order without checklists: each stage's word and line, read from the order's data (see @kebo/shared workflows/order-sections). */
@Module({
  imports: [MoneyModule],
  controllers: [SectionsController],
  providers: [SectionsService],
  exports: [SectionsService],
})
export class SectionsModule {}
