import { Module } from "@nestjs/common";
import { EnvModule } from "./config/env";
import { PrismaModule } from "./database/prisma.service";
import { CommonModule } from "./common/common.module";
import { AuthCoreModule } from "./common/auth/auth-core.module";
import { AuthModule } from "./modules/auth/auth.module";
import { HealthModule } from "./modules/health/health.module";
import { SettingsModule } from "./modules/settings/settings.module";
import { OrdersModule } from "./modules/orders/orders.module";

/**
 * Feature modules (one per business area) sit on four global ones:
 * Env (validated settings), Prisma (database), Common (audit, clock) and
 * AuthCore (the guard every route passes through).
 */
@Module({
  imports: [EnvModule, PrismaModule, CommonModule, AuthCoreModule, HealthModule, AuthModule, SettingsModule, OrdersModule],
})
export class AppModule {}
