import { Module } from "@nestjs/common";
import { InquiriesModule } from "../inquiries/inquiries.module";
import { OrdersModule } from "../orders/orders.module";
import { CancelOrderController } from "./cancel-order.controller";
import { CancelOrderService } from "./cancel-order.service";

/** Cancelling an order: the order and its money together (orders and Treasury, neither depending on the other's writer). */
@Module({ imports: [OrdersModule, InquiriesModule], controllers: [CancelOrderController], providers: [CancelOrderService] })
export class CancellationModule {}
