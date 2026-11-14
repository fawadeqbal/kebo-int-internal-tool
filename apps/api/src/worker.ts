import "./load-env";
import "reflect-metadata";
import { Logger, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { EnvModule } from "./config/env";
import { PrismaModule, PrismaService } from "./database/prisma.service";
import { CommonModule } from "./common/common.module";
import { EventsModule } from "./common/events/event-bus";
import { CompaniesModule } from "./common/company/companies.service";
import { OwnDomainModule, OwnDomainService } from "./common/company/own-domain.service";
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
import { JobRuns } from "./platform/watch";
import { FactsService } from "./modules/insights/facts/facts.service";
import { Clock } from "./common/time/clock.service";
import { LedgerPostingModule } from "./modules/ledger/posting.service";
import { LedgerJobsModule } from "./modules/ledger/ledger.module";
import { LedgerService } from "./modules/ledger/ledger.service";

/**
 * The background worker, on a schedule (REMINDER_INTERVAL_MINUTES, default 60):
 * the automatic rules for companies (demos and trials ending, overdue payments),
 * the server check (backups, disk: emails the platform admins), then each active
 * company's reminders, one company at a time and each inside its own company; and Insights' calculated tables:
 * caught up on every tick, and once a day (the first tick of the day, so at start too) worked out again in
 * full, compared, and every difference logged and fixed; and the ledger (once a day: what a save did not post is posted, then
 * it is checked against today's figures; a difference goes to the platform log). Follow-ups' reminders (the day's, and 30 minutes
 * before a set time) also run on their own, shorter schedule (FOLLOW_UP_INTERVAL_MINUTES, default 5); on that
 * beat companies' own domains that are due are looked up again too (OwnDomainService.sweep).
 */
@Module({
  imports: [
    EnvModule,
    PrismaModule,
    CompaniesModule,
    OwnDomainModule,
    LimitsModule,
    CommonModule,
    EventsModule,
    LedgerPostingModule,
    SettingsModule,
    NotificationsModule,
    // The figures in the morning and monthly emails (RemindersService reads them from InsightsService).
    InsightsModule,
    // Follow-ups' reminders (RemindersService reads them from FollowUpsService).
    NotesModule,
    PlatformJobsModule,
    // The ledger's nightly run: post what a save did not, then check it against today's figures.
    LedgerJobsModule,
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
  const ledger = app.get(LedgerService);
  const domains = app.get(OwnDomainService);
  // Each job's run is written down for Dev tools (Jobs and emails); a failure is logged there and never stops the others.
  const jobs = app.get(JobRuns);
  let checkedOn: string | null = null;
  const minutes = Math.max(Number(process.env.REMINDER_INTERVAL_MINUTES) || 60, 1);
  const log = new Logger("Worker");
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await jobs.track("company-rules", () => lifecycle.run());
      const today = clock.today();
      if (checkedOn !== today) {
        await jobs.track("insights-nightly", () => facts.nightly());
        await jobs.track("ledger-nightly", () => ledger.nightly());
        checkedOn = today;
      } else await facts.eachCompany("catching up the Insights tables", () => facts.drain());
      const companies = await prisma.platform.company.findMany({ where: { status: "active" }, orderBy: { createdAt: "asc" } });
      let failed = 0;
      await jobs.track(
        "reminders",
        async () => {
          for (const c of companies)
            await CompanyContext.run(toInfo(c), () => reminders.run()).catch((e) => {
              failed += 1;
              log.error(`reminders for ${c.slug} failed: ${(e as Error).stack ?? e}`);
            });
          if (failed) throw new Error(`failed for ${failed} of ${companies.length} companies (see the worker's log)`);
        },
        () => `${companies.length} companies`,
      );
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
      await jobs.track(
        "follow-ups",
        async () => {
          const companies = await prisma.platform.company.findMany({ where: { status: "active" }, orderBy: { createdAt: "asc" } });
          for (const c of companies) await CompanyContext.run(toInfo(c), () => reminders.followUps());
          return companies.length;
        },
        (n) => `${n} companies`,
      );
    } finally {
      await jobs.track("own-domains", () => domains.sweep());
      // The server's checks (backups, disk, services, errors, certificates): every few minutes, each problem emailed once a day.
      await jobs.track(
        "server-check",
        () => server.run(),
        (w) => (w.length ? `${w.length} warnings emailed` : "all fine"),
      );
      followingUp = false;
    }
  };
  log.log(`company rules and reminders every ${minutes} minute(s), follow-ups every ${followUpMinutes}`);
  await tick();
  setInterval(() => void tick(), minutes * 60_000);
  setInterval(() => void followUpTick(), followUpMinutes * 60_000);
}

void main();
