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
import { HistoryModule } from "./modules/history/history.module";
import { MoneyModule } from "./modules/money/money.module";
import { SecurityModule } from "./modules/security/security.module";
import { StorageModule } from "./common/storage/storage.service";
import { EventsModule } from "./common/events/event-bus";
import { CompaniesModule } from "./common/company/companies.service";
import { LimitsModule } from "./common/company/limits.service";
import { CompanyModule } from "./modules/company/company.module";
import { PlatformModule } from "./platform/platform.module";

/**
 * Feature modules (one per business area) sit on four global ones:
 * Env (validated settings), Prisma (database), Common (audit, clock) and
 * AuthCore (the guard every route passes through).
 */import { InsightsModule } from "./modules/insights/insights.module";

@Module({
  imports: [EnvModule, PrismaModule, CompaniesModule, LimitsModule, CommonModule, StorageModule, EventsModule, AuthCoreModule, HealthModule, AuthModule, SettingsModule, UsersModule, PartiesModule, InquiriesModule, SourcingModule, QuotationsModule, OrdersModule, NotificationsModule, ReportsModule, HistoryModule, MoneyModule, SecurityModule, InsightsModule, CompanyModule, PlatformModule],
})
export class AppModule {}
