import { readFile } from "node:fs/promises";
import path from "node:path";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ENV, type Env } from "../config/env";
import { PrismaService } from "../database/prisma.service";
import { PlatformMail } from "./platform-mail";

/** A backup older than this is a problem (nightly, with some slack). */
export const BACKUP_MAX_AGE_HOURS = 26;
/** Disk use from this percentage up is a problem. */
export const DISK_WARN_PERCENT = 80;
/** The same problem is emailed again after this long while it lasts. */
export const WARNING_REPEAT_HOURS = 24;
const HOUR = 3_600_000;

/** backups/status/last-status.json, written by docker/backup.sh after every run. */
export interface BackupStatus {
  at: string;
  ok: boolean;
  message?: string | null;
  lastGoodAt?: string | null;
  dump?: string | null;
  /** off: not set up; pending: set up, but this run did not get to it (it failed before). */
  offsite?: "off" | "ok" | "failed" | "pending";
  /** When the off-site copy last worked (older status files: none; then `at` when offsite is ok). */
  offsiteAt?: string | null;
}

/** When the off-site copy last worked, as far as the status says. */
export const offsiteGoodAt = (b: BackupStatus): string | null => b.offsiteAt ?? (b.offsite === "ok" ? b.at : null);

/** backups/status/disk.json, written by deploy/server/docker-cleanup.sh every night. */
export interface DiskStatus {
  at: string;
  percent: number;
  freeGb?: number;
}

export interface ServerWarning {
  /** Stable per kind of problem: the same one is emailed at most once a day. */
  key:
    | "backup_old"
    | "backup_failed"
    | "offsite_failed"
    | "offsite_off"
    | "offsite_old"
    | "status_unreadable"
    | "disk_full"
    | "service_down"
    | "errors"
    | "certificate"
    | "restore_failed"
    | "offsite_restore_failed"
    | "job_slow";
  title: string;
  detail: string;
}

/** backups/status/restore-status.json, written by docker/backup.sh after its monthly restore test. */
export interface RestoreStatus {
  at: string;
  ok: boolean;
  message?: string | null;
  dump?: string | null;
  tookSec?: number | null;
  tables?: number | null;
  companies?: number | null;
  orders?: number | null;
}

/** What Dev tools' server status adds to the checks (server.json, written every minute by deploy/server). */
export interface ServerFacts {
  at: string;
  services?: { name: string; state: string }[];
  certificates?: { host: string; ok: boolean; endsAt?: string; error?: string }[] | null;
}

/** Server errors in an hour from this many: emailed. */
export const ERRORS_WARN_PER_HOUR = 10;
/** A certificate ending within this many days: emailed. */
export const CERT_WARN_DAYS = 14;

/** A status file: missing, unreadable, or read. */
export type Read<T> = { state: "missing" } | { state: "unreadable"; error: string } | { state: "ok"; value: T };

const DAY = 24 * HOUR;

/** The jobs that run by themselves: the worker's (job_runs) and the server's (status files). */
export const JOBS: { key: string; label: string; by: "worker" | "server"; schedule: string; everyMs: number }[] = [
  { key: "reminders", label: "Reminders and the morning email", by: "worker", schedule: "every hour", everyMs: HOUR },
  { key: "company-rules", label: "Company rules: demos ending, payments due", by: "worker", schedule: "every hour", everyMs: HOUR },
  { key: "follow-ups", label: "Follow-up reminders", by: "worker", schedule: "every 5 minutes", everyMs: 5 * 60_000 },
  { key: "own-domains", label: "Companies' own domains", by: "worker", schedule: "every 5 minutes", everyMs: 5 * 60_000 },
  { key: "server-check", label: "Server checks and warning emails", by: "worker", schedule: "every 5 minutes", everyMs: 5 * 60_000 },
  { key: "insights-nightly", label: "Insights tables, checked in full", by: "worker", schedule: "once a day", everyMs: DAY },
  { key: "ledger-nightly", label: "Ledger, checked against the figures", by: "worker", schedule: "once a day", everyMs: DAY },
  { key: "backup", label: "Database backup", by: "server", schedule: "every night", everyMs: DAY },
  { key: "offsite", label: "Off-site copy of the backup", by: "server", schedule: "after each backup", everyMs: DAY },
  { key: "restore-test", label: "Restore test", by: "server", schedule: "once a month", everyMs: 31 * DAY },
  { key: "offsite-restore", label: "Rebuild from the off-site copy", by: "server", schedule: "once a quarter", everyMs: 92 * DAY },
  { key: "cleanup", label: "Disk clean-up", by: "server", schedule: "every night, 03:30", everyMs: DAY },
  { key: "status", label: "Server status (this page's figures)", by: "server", schedule: "every minute", everyMs: 60_000 },
];

/** A worker job's last run (job_runs) and how often it runs. */
export interface JobLastRun {
  job: string;
  label: string;
  startedAt: string;
  tookMs: number;
  beatMs: number;
}

const minutesOf = (ms: number) => (ms < 90_000 ? `${Math.round(ms / 1000)} s` : ms < 2 * HOUR ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / HOUR)} h`);

const age = (now: Date, iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? (now.getTime() - t) / HOUR : Infinity;
};

/**
 * What is wrong on the server, from the status files. `watchingSince` is when
 * this worker started: with no status file at all, that is only a problem once
 * a backup should have run.
 */
export function serverWarnings(input: {
  now: Date;
  watchingSince: Date;
  backup: Read<BackupStatus>;
  disk: Read<DiskStatus>;
  server?: Read<ServerFacts>;
  restore?: Read<RestoreStatus>;
  /** The quarterly rebuild from the off-site copy (offsite-restore-status.json). */
  offsiteRestore?: Read<RestoreStatus>;
  errorsLastHour?: number;
  /** Each worker job's last run in the last day, with its beat: how often it runs (JOBS). */
  jobs?: JobLastRun[];
}): ServerWarning[] {
  const { now, backup, disk } = input;
  const out: ServerWarning[] = [];
  const hours = (h: number) => (h === Infinity ? "never" : h < 48 ? `${Math.floor(h)} hours ago` : `${Math.floor(h / 24)} days ago`);

  if (backup.state === "unreadable") {
    out.push({
      key: "status_unreadable",
      title: "The backup status cannot be read",
      detail: `backups/status/last-status.json: ${backup.error}`,
    });
  } else if (backup.state === "missing") {
    if (age(now, input.watchingSince.toISOString()) > BACKUP_MAX_AGE_HOURS)
      out.push({
        key: "backup_old",
        title: "No backup has been recorded",
        detail: `There is no backups/status/last-status.json. Is the backup container running? (docker compose ps backup)`,
      });
  } else {
    const b = backup.value;
    const good = age(now, b.lastGoodAt);
    if (good > BACKUP_MAX_AGE_HOURS)
      out.push({
        key: "backup_old",
        title: "The last good backup is more than a day old",
        detail: `Last good database backup: ${hours(good)}. Last try: ${hours(age(now, b.at))}${b.ok ? "" : `, failed: ${b.message ?? "no reason given"}`}.`,
      });
    else if (!b.ok && b.offsite !== "failed")
      out.push({
        key: "backup_failed",
        title: "The last backup failed",
        detail: b.message ?? "No reason given; see docker compose logs backup.",
      });
    const offsiteAge = age(now, offsiteGoodAt(b));
    if (b.offsite === "failed")
      out.push({
        key: "offsite_failed",
        title: "The off-site copy of the backup failed",
        detail: `${b.message ?? "No reason given."} The local backup${b.dump ? ` (${b.dump})` : ""} is on the server only. Last good off-site copy: ${hours(offsiteAge)}.`,
      });
    else if (b.offsite === "off" || b.offsite === undefined)
      out.push({
        key: "offsite_off",
        title: "The backups have no off-site copy",
        detail:
          "They are kept on this server only: if the server is lost, the backups go with it. Set up the off-site copy: deploy/server/enable-offsite.sh (docs/restore.md).",
      });
    else if (offsiteAge > BACKUP_MAX_AGE_HOURS)
      out.push({
        key: "offsite_old",
        title: "The last off-site copy is more than a day old",
        detail: `Last good off-site copy: ${hours(offsiteAge)}. Last backup run: ${hours(age(now, b.at))}${b.ok ? "" : `, failed: ${b.message ?? "no reason given"}`}.`,
      });
  }

  if (disk.state === "ok" && disk.value.percent >= DISK_WARN_PERCENT && age(now, disk.value.at) <= 72)
    out.push({
      key: "disk_full",
      title: `The server's disk is ${disk.value.percent}% full`,
      detail: `${disk.value.freeGb ?? "?"} GB free after the nightly Docker cleanup.`,
    });

  const server = input.server?.state === "ok" ? input.server.value : null;
  if (server && age(now, server.at) <= 0.25) {
    const down = (server.services ?? []).filter((x) => x.state !== "running");
    if (down.length)
      out.push({
        key: "service_down",
        title: `${down.map((x) => x.name).join(", ")} ${down.length === 1 ? "is" : "are"} not running`,
        detail: `See Dev tools › Services and the live log. On the server: sudo docker compose ps`,
      });
    const ends = (server.certificates ?? []).filter((c) => !c.ok || (c.endsAt && (Date.parse(c.endsAt) - now.getTime()) / 86_400_000 < CERT_WARN_DAYS));
    if (ends.length)
      out.push({
        key: "certificate",
        title: `A certificate needs a look: ${ends[0]!.host}`,
        detail: ends[0]!.ok ? `It ends on ${ends[0]!.endsAt!.slice(0, 10)}. Caddy renews it by itself; see the Address server's live log if it does not.` : `It could not be checked: ${ends[0]!.error ?? "no answer"}.`,
      });
  }
  if ((input.errorsLastHour ?? 0) >= ERRORS_WARN_PER_HOUR)
    out.push({
      key: "errors",
      title: `${input.errorsLastHour} server errors in the last hour`,
      detail: "See Dev tools › Speed and errors: each error with its stack, and Copy for Claude.",
    });
  // A run longer than its beat: while it runs the next one is skipped (follow-up reminders, these checks).
  const slow = (input.jobs ?? []).filter((j) => j.tookMs > j.beatMs && age(now, j.startedAt) <= 24);
  if (slow.length) {
    const words = slow.map((j) => `${j.label} took ${minutesOf(j.tookMs)} (it runs every ${minutesOf(j.beatMs)})`);
    out.push({
      key: "job_slow",
      title: slow.length === 1 ? `A background job is slower than its beat: ${slow[0]!.label}` : `${slow.length} background jobs are slower than their beat`,
      detail: `${words.join("; ")}. While a run goes on, the next is skipped, so reminders and these checks come late. See Dev tools › Jobs and emails.`,
    });
  }
  if (input.restore?.state === "ok" && !input.restore.value.ok && age(now, input.restore.value.at) <= 24 * 7)
    out.push({
      key: "restore_failed",
      title: "The monthly restore test failed",
      detail: `${input.restore.value.message ?? "No reason given"}. A backup that cannot be put back is no backup: see docs/restore.md.`,
    });
  if (input.offsiteRestore?.state === "ok" && !input.offsiteRestore.value.ok && age(now, input.offsiteRestore.value.at) <= 24 * 7)
    out.push({
      key: "offsite_restore_failed",
      title: "The rebuild from the off-site copy failed",
      detail: `${input.offsiteRestore.value.message ?? "No reason given"}. If the server is lost, this copy is what the business is rebuilt from: see docs/restore.md.`,
    });
  return out;
}

/** The worker finished no job for this long: it is stopped or stuck (its own checks cannot say so). */
export const WORKER_SILENT_MINUTES = 60;

/**
 * For the outside watcher (GET /api/health?from=outside): why the worker looks stopped, or null. `lastDone` is
 * when its last job finished (job_runs); none at all is a new server, not a problem.
 */
export function workerSilence(lastDone: Date | null, now: Date): string | null {
  if (!lastDone) return null;
  const minutes = Math.floor((now.getTime() - lastDone.getTime()) / 60_000);
  if (minutes < WORKER_SILENT_MINUTES) return null;
  return `The background worker has finished no job for ${minutes} minutes: reminders and the server's checks are stopped. On the server: sudo docker compose ps worker; sudo docker compose logs --tail 200 worker`;
}

/** The warnings not emailed in the last WARNING_REPEAT_HOURS. */
export function warningsToSend(warnings: ServerWarning[], lastSent: Map<string, Date>, now: Date): ServerWarning[] {
  return warnings.filter((w) => {
    const at = lastSent.get(w.key);
    return !at || now.getTime() - at.getTime() >= WARNING_REPEAT_HOURS * HOUR;
  });
}

export async function readStatus<T>(file: string): Promise<Read<T>> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { state: "missing" };
    return { state: "unreadable", error: (e as Error).message };
  }
  try {
    return { state: "ok", value: JSON.parse(text) as T };
  } catch (e) {
    return { state: "unreadable", error: (e as Error).message };
  }
}

/**
 * The worker's check of the server (every run, when SERVER_STATUS_DIR is set):
 * backups recent and complete, the off-site copy made, disk not full. Each
 * problem is written to the platform log and emailed to the platform admins
 * (PLATFORM_EMAIL, else every platform admin), at most once a day while it lasts.
 */
@Injectable()
export class ServerHealthService {
  private readonly log = new Logger("ServerHealth");
  private readonly startedAt = new Date();

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: PlatformMail,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private async errorsLastHour(now: Date) {
    try {
      const [r] = await this.prisma.platform.$queryRaw<{ n: bigint }[]>`
        select coalesce(sum(errors), 0)::bigint as n from request_minutes where minute >= ${new Date(now.getTime() - HOUR)}`;
      return Number(r?.n ?? 0);
    } catch {
      return 0;
    }
  }

  /** Each worker job's last run in the last day, with the beat it must fit in (the hourly round or the 5-minute one). */
  private async jobRuns(now: Date): Promise<JobLastRun[]> {
    try {
      const rows = await this.prisma.platform.$queryRaw<{ job: string; started_at: Date; took_ms: number }[]>`
        select distinct on (job) job, started_at, took_ms from job_runs
         where started_at >= ${new Date(now.getTime() - DAY)} order by job, started_at desc`;
      return rows.flatMap((r) => {
        const j = JOBS.find((x) => x.key === r.job && x.by === "worker");
        return j ? [{ job: r.job, label: j.label, startedAt: r.started_at.toISOString(), tookMs: r.took_ms, beatMs: Math.min(j.everyMs, HOUR) }] : [];
      });
    } catch {
      return [];
    }
  }

  async run(now = new Date()) {
    const dir = this.env.SERVER_STATUS_DIR;
    if (!dir) return [];
    const warnings = serverWarnings({
      now,
      watchingSince: this.startedAt,
      backup: await readStatus<BackupStatus>(path.join(dir, "last-status.json")),
      disk: await readStatus<DiskStatus>(path.join(dir, "disk.json")),
      server: await readStatus<ServerFacts>(path.join(dir, "server.json")),
      restore: await readStatus<RestoreStatus>(path.join(dir, "restore-status.json")),
      offsiteRestore: await readStatus<RestoreStatus>(path.join(dir, "offsite-restore-status.json")),
      errorsLastHour: await this.errorsLastHour(now),
      jobs: await this.jobRuns(now),
    });
    if (!warnings.length) return [];
    const since = new Date(now.getTime() - WARNING_REPEAT_HOURS * HOUR);
    const recent = await this.prisma.platform.platformLog.findMany({
      where: { action: "server_warning", at: { gte: since } },
      select: { at: true, details: true },
    });
    const lastSent = new Map<string, Date>();
    for (const r of recent) {
      const key = (r.details as { key?: string } | null)?.key;
      if (key && (!lastSent.has(key) || lastSent.get(key)! < r.at)) lastSent.set(key, r.at);
    }
    const due = warningsToSend(warnings, lastSent, now);
    for (const w of due) {
      this.log.warn(`${w.title}: ${w.detail}`);
      await this.prisma.platform.platformLog.create({
        data: { action: "server_warning", summary: `Server: ${w.title}`, details: { key: w.key, detail: w.detail }, at: now },
      });
      await this.mail.toAdmins({
        subject: `RFQ Desk server: ${w.title}`,
        heading: w.title,
        rows: [
          ["Server", this.env.APP_URL],
          ["Checked", this.mail.when(now)],
        ],
        body: `${w.detail}\n\nMore in Platform admin › Dev tools. This email comes again once a day until it is fixed.`,
      });
    }
    return due;
  }
}
