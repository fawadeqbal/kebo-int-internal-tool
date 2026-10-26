import { Module } from "@nestjs/common";
import { MeController, OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";

@Module({ controllers: [OrdersController, MeController], providers: [OrdersService], exports: [OrdersService] })
export class OrdersModule {}
