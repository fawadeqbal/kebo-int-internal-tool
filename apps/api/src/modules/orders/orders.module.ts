import { Module } from "@nestjs/common";
import { InquiriesModule } from "../inquiries/inquiries.module";
import { MeController, OrderLinesController, OrdersController } from "./orders.controller";
import { DocumentsService } from "./documents.service";
import { OrdersService } from "./orders.service";

@Module({
  imports: [InquiriesModule],
  controllers: [OrdersController, OrderLinesController, MeController],
  providers: [OrdersService, DocumentsService],
  exports: [OrdersService],
})
export class OrdersModule {}
