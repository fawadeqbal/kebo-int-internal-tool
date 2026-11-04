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
import { InsightsModule } from "./modules/insights/insights.module";
import { NotesModule } from "./modules/notes/notes.module";
import { PlatformJobsModule } from "./platform/platform-jobs.module";
import { LifecycleService } from "./platform/lifecycle.service";
import { ServerHealthService } from "./platform/server-health";
import { FactsService } from "./modules/insights/facts/facts.service";
import { Clock } from "./common/time/clock.service";

/**
 * The background worker, on a schedule (REMINDER_INTERVAL_MINUTES, default 60):
 * the automatic rules for companies (demos and trials ending, overdue payments),
 * the server check (backups, disk: emails the platform admins), then each active
 * company's reminders, one company at a time and each inside its own company; and Insights' calculated tables:
 * caught up on every tick, and once a day (the first tick of the day, so at start too) worked out again in
 * full, compared, and every difference logged and fixed. Follow-ups' reminders (the day's, and 30 minutes
 * before a set time) also run on their own, shorter schedule (FOLLOW_UP_INTERVAL_MINUTES, default 5).
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
    // The figures in the morning and monthly emails (RemindersService reads them from InsightsService).
    InsightsModule,
    // Follow-ups' reminders (RemindersService reads them from FollowUpsService).
    NotesModule,
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
  const facts = app.get(FactsService);
  const clock = app.get(Clock);
  let checkedOn: string | null = null;
  const minutes = Math.max(Number(process.env.REMINDER_INTERVAL_MINUTES) || 60, 1);
  const log = new Logger("Worker");
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await lifecycle.run().catch((e) => log.error(`company rules failed: ${(e as Error).stack ?? e}`));
      await server.run().catch((e) => log.error(`server check failed: ${(e as Error).stack ?? e}`));
      // Insights' tables: the full check once a day (nightly), otherwise catching up on what was queued.
      const today = clock.today();
      if (checkedOn !== today) {
        await facts.nightly().catch((e) => log.error(`Insights check failed: ${(e as Error).stack ?? e}`));
        checkedOn = today;
      } else await facts.eachCompany("catching up the Insights tables", () => facts.drain());
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
  // Follow-ups due at a time: their "in 30 minutes" reminder needs a shorter beat than the hourly one.
  const followUpMinutes = Math.max(Number(process.env.FOLLOW_UP_INTERVAL_MINUTES) || 5, 1);
  let followingUp = false;
  const followUpTick = async () => {
    if (followingUp || running) return;
    followingUp = true;
    try {
      const companies = await prisma.platform.company.findMany({ where: { status: "active" }, orderBy: { createdAt: "asc" } });
      for (const c of companies) await CompanyContext.run(toInfo(c), () => reminders.followUps());
    } catch (e) {
      log.error(`follow-up reminders failed: ${(e as Error).stack ?? e}`);
    } finally {
      followingUp = false;
    }
  };
  log.log(`company rules and reminders every ${minutes} minute(s), follow-ups every ${followUpMinutes}`);
  await tick();
  setInterval(() => void tick(), minutes * 60_000);
  setInterval(() => void followUpTick(), followUpMinutes * 60_000);
}

void main();
