import { Module } from "@nestjs/common";
import { InquiriesModule } from "../inquiries/inquiries.module";
import { CreditController, MeController, OrderLinesController, OrdersController, PaymentsController } from "./orders.controller";
import { DocumentsService } from "./documents.service";
import { OrdersService } from "./orders.service";
import { PaymentsService } from "./payments.service";

@Module({
  imports: [InquiriesModule],
  controllers: [OrdersController, OrderLinesController, PaymentsController, CreditController, MeController],
  providers: [OrdersService, PaymentsService, DocumentsService],
  exports: [OrdersService, PaymentsService],
})
export class OrdersModule {}
