import { Module } from "@nestjs/common";
import { InquiriesModule } from "../inquiries/inquiries.module";
import { MeController, OrdersController, PaymentsController } from "./orders.controller";
import { DocumentsService } from "./documents.service";
import { OrdersService } from "./orders.service";
import { PaymentsService } from "./payments.service";

@Module({
  imports: [InquiriesModule],
  controllers: [OrdersController, PaymentsController, MeController],
  providers: [OrdersService, PaymentsService, DocumentsService],
  exports: [OrdersService, PaymentsService],
})
export class OrdersModule {}
