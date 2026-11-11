import { Module } from "@nestjs/common";
import { InquiriesModule } from "../inquiries/inquiries.module";
import { OrdersModule } from "../orders/orders.module";
import { QuotationsService } from "./quotations.service";
import { QuotationsController } from "./quotations.controller";

@Module({
  imports: [InquiriesModule, OrdersModule],
  controllers: [QuotationsController],
  providers: [QuotationsService],
  exports: [QuotationsService],
})
export class QuotationsModule {}
