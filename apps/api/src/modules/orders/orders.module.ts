import { Module } from "@nestjs/common";
import { InquiriesModule } from "../inquiries/inquiries.module";
import { MeController, OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";

@Module({ imports: [InquiriesModule], controllers: [OrdersController, MeController], providers: [OrdersService], exports: [OrdersService] })
export class OrdersModule {}
