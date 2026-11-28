import { Module } from "@nestjs/common";
import { OrdersModule } from "../orders/orders.module";
import { SectionsModule } from "../sections/sections.module";
import { FlowModule } from "../flow/flow.module";
import { OrderFilesModule } from "../files/order-files.module";
import { MoneyModule } from "../money/money.module";
import { PapersModule } from "../papers/papers.module";
import { NotesModule } from "../notes/notes.module";
import { UsersModule } from "../users/users.module";
import { PartiesModule } from "../parties/parties.module";
import { OrderPageController } from "./order-page.controller";
import { OrderPageService } from "./order-page.service";

/** An order's frame in one read (a screen's read model: it only reads, through the modules that own each part). */
@Module({
  imports: [OrdersModule, SectionsModule, FlowModule, OrderFilesModule, MoneyModule, PapersModule, NotesModule, UsersModule, PartiesModule],
  controllers: [OrderPageController],
  providers: [OrderPageService],
})
export class OrderPageModule {}
