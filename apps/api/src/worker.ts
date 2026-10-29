import "./load-env";
import "reflect-metadata";
import { Logger, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { EnvModule } from "./config/env";
import { PrismaModule, PrismaService } from "./database/prisma.service";
import { CommonModule } from "./common/common.module";
import { EventsModule } from "./common/events/event-bus";
import { CompaniesModule } from "./common/company/companies.service";
import { LimitsModule } from "./common/company/limits.service";
import { toInfo } from "./common/company/companies.service";
import { CompanyContext } from "./common/company/company-context";
import { SettingsModule } from "./modules/settings/settings.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { RemindersService } from "./modules/notifications/reminders.service";
import { PlatformJobsModule } from "./platform/platform-jobs.module";
import { LifecycleService } from "./platform/lifecycle.service";
import { ServerHealthService } from "./platform/server-health";

/**
 * The background worker, on a schedule (REMINDER_INTERVAL_MINUTES, default 60):
 * the automatic rules for companies (demos and trials ending, overdue payments),
 * the server check (backups, disk: emails the platform admins), then each active
 * company's reminders, one company at a time and each inside its own company.
 */
@Module({
  imports: [
    EnvModule,
    PrismaModule,
    CompaniesModule,
    LimitsModule,
    CommonModule,
    EventsModule,
    SettingsModule,
    NotificationsModule,
    PlatformJobsModule,
  ],
})
class WorkerModule {}

async function main() {
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ["log", "warn", "error"] });
  app.enableShutdownHooks();
  const prisma = app.get(PrismaService);
  const reminders = app.get(RemindersService);
  const lifecycle = app.get(LifecycleService);
  const server = app.get(ServerHealthService);
  const minutes = Math.max(Number(process.env.REMINDER_INTERVAL_MINUTES) || 60, 1);
  const log = new Logger("Worker");
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await lifecycle.run().catch((e) => log.error(`company rules failed: ${(e as Error).stack ?? e}`));
      await server.run().catch((e) => log.error(`server check failed: ${(e as Error).stack ?? e}`));
      const companies = await prisma.platform.company.findMany({ where: { status: "active" }, orderBy: { createdAt: "asc" } });
      for (const c of companies) {
        await CompanyContext.run(toInfo(c), () => reminders.run()).catch((e) =>
          log.error(`reminders for ${c.slug} failed: ${(e as Error).stack ?? e}`),
        );
      }
    } finally {
      running = false;
    }
  };
  log.log(`company rules and reminders every ${minutes} minute(s)`);
  await tick();
  setInterval(() => void tick(), minutes * 60_000);
}

void main();
