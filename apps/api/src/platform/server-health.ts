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
  offsite?: "off" | "ok" | "failed";
}

/** backups/status/disk.json, written by deploy/server/docker-cleanup.sh every night. */
export interface DiskStatus {
  at: string;
  percent: number;
  freeGb?: number;
}

export interface ServerWarning {
  /** Stable per kind of problem: the same one is emailed at most once a day. */
  key: "backup_old" | "backup_failed" | "offsite_failed" | "status_unreadable" | "disk_full";
  title: string;
  detail: string;
}

/** A status file: missing, unreadable, or read. */
export type Read<T> = { state: "missing" } | { state: "unreadable"; error: string } | { state: "ok"; value: T };

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
    if (b.offsite === "failed")
      out.push({
        key: "offsite_failed",
        title: "The off-site copy of the backup failed",
        detail: `${b.message ?? "No reason given."} The local backup${b.dump ? ` (${b.dump})` : ""} is on the server only.`,
      });
  }

  if (disk.state === "ok" && disk.value.percent >= DISK_WARN_PERCENT && age(now, disk.value.at) <= 72)
    out.push({
      key: "disk_full",
      title: `The server's disk is ${disk.value.percent}% full`,
      detail: `${disk.value.freeGb ?? "?"} GB free after the nightly Docker cleanup.`,
    });
  return out;
}

/** The warnings not emailed in the last WARNING_REPEAT_HOURS. */
export function warningsToSend(warnings: ServerWarning[], lastSent: Map<string, Date>, now: Date): ServerWarning[] {
  return warnings.filter((w) => {
    const at = lastSent.get(w.key);
    return !at || now.getTime() - at.getTime() >= WARNING_REPEAT_HOURS * HOUR;
  });
}

async function readStatus<T>(file: string): Promise<Read<T>> {
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

  async run(now = new Date()) {
    const dir = this.env.SERVER_STATUS_DIR;
    if (!dir) return [];
    const warnings = serverWarnings({
      now,
      watchingSince: this.startedAt,
      backup: await readStatus<BackupStatus>(path.join(dir, "last-status.json")),
      disk: await readStatus<DiskStatus>(path.join(dir, "disk.json")),
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
        body: `${w.detail}\n\nWhat to do: docs/restore.md (backups) and deploy/server/ (disk). This email comes again once a day until it is fixed.`,
      });
    }
    return due;
  }
}
