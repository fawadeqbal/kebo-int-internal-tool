import { createHash } from "node:crypto";
import { Injectable, Logger, Module, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { CompanyContext } from "../common/company/company-context";
import { onDelivery, type Delivery } from "../common/notify/delivery";
import { ErrorFilter } from "../common/http/error.filter";
import { PrismaService } from "../database/prisma.service";

/**
 * Dev tools' own records of the API: how fast each route answers (a minute at a time, kept 30
 * days) and each unexpected error once (open until marked fixed). Both stay out of the way: a
 * failure to record is logged and never reaches the person's request.
 */

/** The steps answers are counted in (ms); one more count after them: slower than all. */
export const REQUEST_STEPS_MS = [25, 50, 100, 200, 400, 800, 1600, 3200, 6400];
/** Request minutes are kept this long. */
export const KEEP_DAYS = 30;
/** The outside watcher's check (GitHub Actions, .github/workflows/watch.yml): counted under this name. */
export const OUTSIDE_ROUTE = "outside check";
/** How fast pages showed in the browser (largest contentful paint, sent by the web app): counted as "PAGE /orders/[id]". */
export const PAGE_PREFIX = "PAGE ";

/** "GET /api/orders/:id": the route that answered, never the ids in the address. */
export function routeOf(req: Request): string {
  if (req.path === "/api/health" && req.query?.from === "outside") return OUTSIDE_ROUTE;
  const route = (req as Request & { route?: { path?: string } }).route?.path;
  if (!route) return `${req.method} (no route)`;
  return `${req.method} ${(req.baseUrl ?? "") + (typeof route === "string" ? route : "")}`.slice(0, 160);
}

/** Where an answer time falls among REQUEST_STEPS_MS. */
export const stepOf = (ms: number) => {
  const i = REQUEST_STEPS_MS.findIndex((s) => ms <= s);
  return i === -1 ? REQUEST_STEPS_MS.length : i;
};

/** The time under which a share (0.5: half, 0.95: all but the slowest 5%) of the answers came, from the counts per step. */
export function quantileMs(buckets: number[], q: number): number | null {
  const total = buckets.reduce((a, b) => a + b, 0);
  if (!total) return null;
  const target = q * total;
  let seen = 0;
  for (let i = 0; i < buckets.length; i++) {
    const n = buckets[i] ?? 0;
    if (n && seen + n >= target) {
      const low = i === 0 ? 0 : REQUEST_STEPS_MS[i - 1]!;
      const high = REQUEST_STEPS_MS[i] ?? REQUEST_STEPS_MS.at(-1)! * 2;
      return Math.round(low + ((target - seen) / n) * (high - low));
    }
    seen += n;
  }
  return REQUEST_STEPS_MS.at(-1)! * 2;
}

export const addBuckets = (a: number[], b: number[]) =>
  Array.from({ length: Math.max(a.length, b.length) }, (_, i) => (a[i] ?? 0) + (b[i] ?? 0));

interface Tally {
  count: number;
  errors: number;
  totalMs: number;
  buckets: number[];
}

@Injectable()
export class RequestStats implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("RequestStats");
  private tallies = new Map<string, Tally>();
  private timer?: NodeJS.Timeout;
  private lastPrune = 0;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.flush(), 60_000);
    this.timer.unref();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }

  /** Counts every answer: its route, how long it took, and whether it was a server error. */
  middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      if (req.method === "OPTIONS") return next();
      const start = process.hrtime.bigint();
      res.on("finish", () => {
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        this.add(routeOf(req), ms, res.statusCode >= 500);
      });
      next();
    };
  }

  add(route: string, ms: number, error: boolean, at = new Date()) {
    const minute = new Date(Math.floor(at.getTime() / 60_000) * 60_000).toISOString();
    const key = `${minute}|${route}`;
    const t = this.tallies.get(key) ?? { count: 0, errors: 0, totalMs: 0, buckets: new Array(REQUEST_STEPS_MS.length + 1).fill(0) };
    t.count += 1;
    t.errors += error ? 1 : 0;
    t.totalMs += ms;
    t.buckets[stepOf(ms)]! += 1;
    this.tallies.set(key, t);
  }

  /** Writes what was counted (added to what the minute already has), and once an hour drops what is older than KEEP_DAYS. */
  async flush() {
    if (!this.tallies.size) return;
    const rows = [...this.tallies.entries()];
    this.tallies = new Map();
    try {
      for (const [key, t] of rows) {
        const [minute, route] = [key.slice(0, key.indexOf("|")), key.slice(key.indexOf("|") + 1)];
        await this.prisma.platform.$executeRaw`
          insert into request_minutes (minute, route, count, errors, total_ms, buckets)
          values (${new Date(minute)}, ${route}, ${t.count}, ${t.errors}, ${Math.round(t.totalMs)}, ${t.buckets}::int[])
          on conflict (minute, route) do update set
            count = request_minutes.count + excluded.count,
            errors = request_minutes.errors + excluded.errors,
            total_ms = request_minutes.total_ms + excluded.total_ms,
            buckets = (select array_agg(coalesce(a, 0) + coalesce(b, 0) order by i)
                       from unnest(request_minutes.buckets, excluded.buckets) with ordinality as x(a, b, i))`;
      }
      if (Date.now() - this.lastPrune > 3_600_000) {
        this.lastPrune = Date.now();
        await this.prisma.platform.$executeRaw`delete from request_minutes where minute < now() - make_interval(days => ${KEEP_DAYS})`;
      }
    } catch (e) {
      this.log.warn(`could not record request times: ${(e as Error).message}`);
    }
  }
}

/** The same error, whatever the ids, numbers or names in its message. */
export function fingerprintOf(source: string, where: string, error: { name?: string; message?: string; stack?: string }) {
  const message = (error.message ?? "")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/"[^"]*"|'[^']*'/g, "<text>")
    .replace(/\d+/g, "<n>");
  // The first line of the stack in the app's own code (not node_modules).
  const frame =
    (error.stack ?? "")
      .split("\n")
      .slice(1)
      .find((l) => /at /.test(l) && !l.includes("node_modules") && !l.includes("node:"))
      ?.trim()
      .replace(/:\d+:\d+\)?$/, "") ?? "";
  return createHash("sha256")
    .update([source, where, error.name ?? "Error", message, frame].join("|"))
    .digest("hex")
    .slice(0, 64);
}

@Injectable()
export class AppErrors implements OnModuleInit {
  private readonly log = new Logger("AppErrors");

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    ErrorFilter.report = (error, req) => void this.fromRequest(error, req);
  }

  fromRequest(error: unknown, req: Request) {
    const user = (req as Request & { user?: { name?: string } }).user;
    return this.record("api", routeOf(req), error, {
      company: CompanyContext.current()?.name ?? null,
      user: user?.name ?? null,
      path: req.path,
    });
  }

  /** Counts an unexpected error once per kind; one marked fixed opens again when it comes back. */
  async record(
    source: string,
    where: string,
    error: unknown,
    ctx: { company?: string | null; user?: string | null; path?: string | null } = {},
  ) {
    try {
      const e = error instanceof Error ? error : new Error(String(error));
      const fingerprint = fingerprintOf(source, where, e);
      const message = (e.message || "(no message)").slice(0, 2000);
      const stack = e.stack?.slice(0, 8000) ?? null;
      await this.prisma.platform.$executeRaw`
        insert into app_errors (id, fingerprint, source, name, message, "where", stack, company_name, user_name, path)
        values (gen_random_uuid(), ${fingerprint}, ${source}, ${(e.name || "Error").slice(0, 120)}, ${message}, ${where.slice(0, 200)}, ${stack},
                ${ctx.company?.slice(0, 120) ?? null}, ${ctx.user?.slice(0, 120) ?? null}, ${ctx.path?.slice(0, 300) ?? null})
        on conflict (fingerprint) do update set
          count = app_errors.count + 1, last_at = now(), message = excluded.message, stack = excluded.stack,
          company_name = excluded.company_name, user_name = excluded.user_name, path = excluded.path,
          status = 'open', fixed_at = null`;
    } catch (e) {
      this.log.warn(`could not record an error: ${(e as Error).message}`);
    }
  }
}

/* ---------------------------------------------------------------- emails and phone notifications */

@Injectable()
export class Deliveries implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("Deliveries");
  private days = new Map<string, { sent: number; failed: number }>();
  private failures: { at: Date; channel: string; what: string; to: string | null; company: string | null; reason: string }[] = [];
  private timer?: NodeJS.Timeout;
  private lastPrune = 0;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    onDelivery((d) => this.add(d));
    this.timer = setInterval(() => void this.flush(), 60_000);
    this.timer.unref();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    onDelivery(null);
    await this.flush();
  }

  add(d: Delivery, at = new Date()) {
    const key = `${at.toISOString().slice(0, 10)}|${d.channel}`;
    const t = this.days.get(key) ?? { sent: 0, failed: 0 };
    if (d.ok) t.sent += 1;
    else t.failed += 1;
    this.days.set(key, t);
    if (!d.ok && this.failures.length < 500)
      this.failures.push({
        at,
        channel: d.channel,
        what: d.what.slice(0, 200),
        to: d.to?.slice(0, 120) ?? null,
        company: CompanyContext.current()?.name ?? null,
        reason: (d.reason ?? "no reason given").slice(0, 300),
      });
  }

  async flush() {
    const days = [...this.days.entries()];
    const failures = this.failures;
    this.days = new Map();
    this.failures = [];
    try {
      for (const [key, t] of days) {
        const [day, channel] = key.split("|") as [string, string];
        await this.prisma.platform.$executeRaw`
          insert into delivery_days (day, channel, sent, failed) values (${day}::date, ${channel}, ${t.sent}, ${t.failed})
          on conflict (day, channel) do update set sent = delivery_days.sent + excluded.sent, failed = delivery_days.failed + excluded.failed`;
      }
      if (failures.length)
        await this.prisma.platform.deliveryFailure.createMany({
          data: failures.map((f) => ({ at: f.at, channel: f.channel, what: f.what, to: f.to, companyName: f.company, reason: f.reason })),
        });
      if (Date.now() - this.lastPrune > 3_600_000) {
        this.lastPrune = Date.now();
        const old = new Date(Date.now() - KEEP_DAYS * 86_400_000);
        await this.prisma.platform.deliveryFailure.deleteMany({ where: { at: { lt: old } } });
        await this.prisma.platform.jobRun.deleteMany({ where: { startedAt: { lt: old } } });
        await this.prisma.platform.deliveryDay.deleteMany({ where: { day: { lt: new Date(Date.now() - 90 * 86_400_000) } } });
      }
    } catch (e) {
      this.log.warn(`could not record deliveries: ${(e as Error).message}`);
    }
  }
}

/* ---------------------------------------------------------------- the worker's jobs */

@Injectable()
export class JobRuns {
  private readonly log = new Logger("Worker");

  constructor(
    private readonly prisma: PrismaService,
    private readonly errors: AppErrors,
  ) {}

  /**
   * Runs one job and writes down how it went (how long, what it did, or why it failed). A failure is
   * logged and counted in Dev tools' errors, never thrown: the other jobs still run.
   */
  async track<T>(job: string, fn: () => Promise<T>, describe?: (result: T) => string | null | undefined): Promise<T | undefined> {
    const started = new Date();
    let ok = true;
    let result: string | null;
    let value: T | undefined;
    try {
      value = await fn();
      result = describe ? (describe(value) ?? null) : null;
    } catch (e) {
      ok = false;
      result = ((e as Error).message ?? String(e)).slice(0, 300);
      this.log.error(`${job} failed: ${(e as Error).stack ?? e}`);
      await this.errors.record("worker", job, e);
    }
    try {
      await this.prisma.platform.jobRun.create({
        data: { job, startedAt: started, tookMs: Date.now() - started.getTime(), ok, result: result?.slice(0, 300) ?? null },
      });
    } catch (e) {
      this.log.warn(`could not record the run of ${job}: ${(e as Error).message}`);
    }
    return value;
  }
}

/** Dev tools' recorders, one of each for the API and the worker. */
@Module({
  providers: [RequestStats, AppErrors, Deliveries, JobRuns],
  exports: [RequestStats, AppErrors, Deliveries, JobRuns],
})
export class WatchModule {}
