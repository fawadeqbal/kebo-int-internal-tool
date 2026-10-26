import { Module } from "@nestjs/common";
import { EnvModule } from "./config/env";
import { PrismaModule } from "./database/prisma.service";
import { CommonModule } from "./common/common.module";
import { AuthCoreModule } from "./common/auth/auth-core.module";
import { AuthModule } from "./modules/auth/auth.module";
import { HealthModule } from "./modules/health/health.module";
import { SettingsModule } from "./modules/settings/settings.module";
import { OrdersModule } from "./modules/orders/orders.module";
import { UsersModule } from "./modules/users/users.module";
import { PartiesModule } from "./modules/parties/parties.module";
import { InquiriesModule } from "./modules/inquiries/inquiries.module";
import { SourcingModule } from "./modules/sourcing/sourcing.module";
import { QuotationsModule } from "./modules/quotations/quotations.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { ReportsModule } from "./modules/reports/reports.module";
import { StorageModule } from "./common/storage/storage.service";
import { EventsModule } from "./common/events/event-bus";

/**
 * Feature modules (one per business area) sit on four global ones:
 * Env (validated settings), Prisma (database), Common (audit, clock) and
 * AuthCore (the guard every route passes through).
 */
@Module({
  imports: [EnvModule, PrismaModule, CommonModule, StorageModule, EventsModule, AuthCoreModule, HealthModule, AuthModule, SettingsModule, UsersModule, PartiesModule, InquiriesModule, SourcingModule, QuotationsModule, OrdersModule, NotificationsModule, ReportsModule],
})
export class AppModule {}
