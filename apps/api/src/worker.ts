import "./load-env";
import "reflect-metadata";
import { Logger, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { EnvModule } from "./config/env";
import { PrismaModule } from "./database/prisma.service";
import { CommonModule } from "./common/common.module";
import { EventsModule } from "./common/events/event-bus";
import { SettingsModule } from "./modules/settings/settings.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { RemindersService } from "./modules/notifications/reminders.service";

/** The background worker: the reminder job on a schedule (REMINDER_INTERVAL_MINUTES, default 60). */
@Module({ imports: [EnvModule, PrismaModule, CommonModule, EventsModule, SettingsModule, NotificationsModule] })
class WorkerModule {}

async function main() {
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ["log", "warn", "error"] });
  app.enableShutdownHooks();
  const reminders = app.get(RemindersService);
  const minutes = Math.max(Number(process.env.REMINDER_INTERVAL_MINUTES) || 60, 1);
  const log = new Logger("Worker");
  const tick = () => reminders.run().catch((e) => log.error(`reminders failed: ${(e as Error).stack ?? e}`));
  log.log(`reminders every ${minutes} minute(s)`);
  await tick();
  setInterval(tick, minutes * 60_000);
}

void main();
