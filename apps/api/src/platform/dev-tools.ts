import { open, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { BadRequestException, Controller, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type {
  DevCheck,
  DevDataView,
  DevDeploy,
  DevError,
  DevEvent,
  DevLevel,
  DevLogLine,
  DevLogs,
  DevOverview,
  DevService,
  DevServicesView,
  DevSpeedView,
} from "@kebo/shared";
import { ENV, type Env } from "../config/env";
import { PrismaService } from "../database/prisma.service";
import { PlatformRoute } from "./platform-auth";
import { BACKUP_MAX_AGE_HOURS, offsiteGoodAt, readStatus, type BackupStatus, type RestoreStatus } from "./server-health";
import { OUTSIDE_ROUTE, PAGE_PREFIX, quantileMs, REQUEST_STEPS_MS } from "./watch";
import { DevToolsMoreService, OPEN_PORTS } from "./dev-tools-more";

export { OPEN_PORTS };

/* ---------------------------------------------------------------- what deploy/server writes */

/** server.json, written every minute by deploy/server/kebo-status.py. */
export interface ServerStatus {
  at: string;
  host?: { os?: string; uptimeSec?: number | null; docker?: string | null; cores?: number | null };
  cpu?: { percent: number | null; load1?: number; load5?: number; load15?: number };
  memory?: { totalMb: number; usedMb: number; percent: number } | null;
  disk?: { totalGb: number; usedGb: number; freeGb: number; percent: number };
  services?: {
    name: string;
    id: string;
    state: string;
    health?: string | null;
    startedAt?: string | null;
    restarts?: number;
    oomKilled?: boolean;
    exitCode?: number | null;
    cpu?: number | null;
    memMb?: number | null;
    memLimitMb?: number | null;
  }[];
  /** The API answered the server's own check this minute. */
  api?: { ok: boolean; ms: number } | null;
  ports?: number[];
  firewall?: "on" | "off" | null;
  sshPassword?: boolean | null;
  updates?: { all: number; security: number; reboot: boolean | null } | null;
  space?: { at: string; parts: { key: string; label: string; gb: number }[] } | null;
  certificates?: { host: string; ok: boolean; endsAt?: string; error?: string }[] | null;
}
export interface ServerEvent {
  at: string;
  service: string;
  kind: "restarted" | "replaced" | "stopped";
  why?: string;
}

/** Each container in plain words. */
export const SERVICE_INFO: Record<string, { label: string; role: string; order: number }> = {
  web: { label: "Web", role: "the pages people open", order: 1 },
  api: { label: "API", role: "does the work behind every page", order: 2 },
  worker: { label: "Worker", role: "reminders, emails and checks", order: 3 },
  db: { label: "Database", role: "all the companies' records", order: 4 },
  minio: { label: "Files", role: "uploaded files and PDFs", order: 5 },
  backup: { label: "Backup", role: "copies the database every night", order: 6 },
  proxy: { label: "Address server", role: "addresses and certificates (Caddy)", order: 7 },
};
const infoOf = (name: string) => SERVICE_INFO[name] ?? { label: name, role: "", order: 99 };

/** The status is late after this long (the timer writes it every minute). */
export const STALE_MINUTES = 5;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const pct = (n: number) => `${Math.round(n)}%`;
const gb = (n: number) => `${n >= 10 ? Math.round(n) : Math.round(n * 10) / 10} GB`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const dayText = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

async function readJsonl<T>(file: string, last = 5000): Promise<T[]> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return [];
  }
  const out: T[] = [];
  for (const line of text.split("\n").slice(-last)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      // a half-written line: skipped
    }
  }
  return out;
}

/* ---------------------------------------------------------------- the services */

export function servicesFrom(status: ServerStatus | null, events: ServerEvent[], logs: string[], now: Date): DevService[] {
  const since = now.getTime() - DAY;
  return (status?.services ?? [])
    .map((s) => {
      const info = infoOf(s.name);
      const restarts = events.filter((e) => e.service === s.name && e.kind === "restarted");
      const recent = restarts.filter((e) => Date.parse(e.at) >= since);
      const last = restarts.at(-1);
      const running = s.state === "running";
      const memPct = s.memMb && s.memLimitMb ? (100 * s.memMb) / s.memLimitMb : null;
      let level: DevLevel = "ok";
      let text = "Running";
      if (!running) [level, text] = ["bad", s.state === "restarting" ? "Restarting" : "Stopped"];
      else if (s.health === "unhealthy") [level, text] = ["bad", "Not answering"];
      else if (s.health === "starting") [level, text] = ["warn", "Starting"];
      else if (recent.length) [level, text] = ["warn", `Restarted ${plural(recent.length, "time")} today`];
      else if (memPct !== null && memPct >= 90) [level, text] = ["warn", "Memory almost full"];
      return {
        key: s.name,
        label: info.label,
        role: info.role,
        state: s.state,
        level,
        status: text,
        startedAt: s.startedAt ?? null,
        restarts: s.restarts ?? 0,
        restarts24h: recent.length,
        lastRestart: last ? { at: last.at, why: last.why ?? "restarted" } : null,
        cpu: s.cpu ?? null,
        memMb: s.memMb ?? null,
        memLimitMb: s.memLimitMb ?? null,
        hasLog: logs.includes(s.name),
        order: info.order,
      };
    })
    .sort((a, b) => a.order - b.order)
    .map(({ order: _o, ...s }) => s);
}

/* ---------------------------------------------------------------- the checks (the map) */

export interface CheckInput {
  now: Date;
  status: ServerStatus | null;
  services: DevService[];
  /** CPU over the last 15 minutes, on average. */
  cpu15: number | null;
  backup: BackupStatus | null;
  database: { ok: boolean; connections: number | null; maxConnections: number | null };
  ownDomains: { connected: number; lost: number; waiting: number };
  lastDeploy: DevDeploy | null;
  /** The last 15 minutes. */
  speed?: { requests: number; slowMs: number | null; typicalMs: number | null };
  /** Server errors in the last hour; open errors seen in the last 24 hours. */
  errors?: { lastHour: number; open24h: number };
  /** The outside watcher's last check (null: never). */
  outsideAt?: string | null;
  /** Emails and phone notifications today. */
  deliveries?: { email: { sent: number; failed: number }; push: { sent: number; failed: number } };
  /** The monthly restore test (null: not run yet). */
  restore?: RestoreStatus | null;
  /** The Security tab's checks, shown as one. */
  security?: DevCheck[];
}

/** No check from outside for this long: the watcher stopped, or the site could not be reached. */
export const OUTSIDE_LATE_MINUTES = 45;

/**
 * Everything watched, each fine (ok), for this week (warn), for now (bad), or not set up (off),
 * with one line on what it is now and what to do when it needs you.
 */
export function buildChecks(i: CheckInput): DevCheck[] {
  const out: DevCheck[] = [];
  const s = i.status;
  const age = s ? (i.now.getTime() - Date.parse(s.at)) / 60000 : Infinity;
  const svc = (key: string) => i.services.find((x) => x.key === key);
  const service = (lane: DevCheck["lane"], key: string, name: string): DevCheck => {
    const x = svc(key);
    if (!x) return { key, lane, name, line: s ? "not found on the server" : "not checked yet", level: s ? "bad" : "off", tab: "services" };
    return {
      key,
      lane,
      name,
      line: x.status === "Running" ? `running for ${upFor(x.startedAt, i.now)}` : x.status.toLowerCase(),
      level: x.level,
      tab: "services",
      fix: x.level === "ok" ? undefined : `See ${name} in Services: its live log says why.`,
    };
  };

  // Addresses
  out.push(service("addresses", "proxy", "Address server"));
  const certs = s?.certificates ?? null;
  if (!certs?.length)
    out.push({ key: "certs", lane: "addresses", name: "Certificates", line: "not checked yet", level: "off", tab: "picture" });
  else {
    const bad = certs.filter((c) => !c.ok);
    const ends = certs
      .filter((c) => c.ok && c.endsAt)
      .map((c) => c.endsAt!)
      .sort();
    const days = ends.length ? Math.floor((Date.parse(ends[0]!) - i.now.getTime()) / DAY) : null;
    out.push({
      key: "certs",
      lane: "addresses",
      name: "Certificates",
      line: bad.length ? `${bad[0]!.host}: could not check` : `${certs.length} · first ends ${dayText(ends[0]!)}`,
      level: bad.length || (days !== null && days < 3) ? "bad" : days !== null && days < 14 ? "warn" : "ok",
      tab: "picture",
      fix: bad.length
        ? "Open the address in a browser; if it fails, see the Address server's live log."
        : days !== null && days < 14
          ? "Caddy renews them by itself: see the Address server's log if it does not."
          : undefined,
    });
  }
  const d = i.ownDomains;
  out.push({
    key: "domains",
    lane: "addresses",
    name: "Companies' own domains",
    line:
      d.connected + d.lost + d.waiting === 0
        ? "none yet"
        : `${d.connected} connected${d.lost ? ` · ${d.lost} lost` : ""}${d.waiting ? ` · ${d.waiting} waiting` : ""}`,
    level: d.lost ? "warn" : d.connected ? "ok" : "off",
    tab: "picture",
    fix: d.lost ? "A company's domain no longer points here: see its company page, Address." : undefined,
  });

  // Server
  if (i.security?.length) {
    const needs = i.security.filter((c) => c.level === "warn" || c.level === "bad");
    out.push({
      key: "security",
      lane: "server",
      name: "Security",
      line: needs.length ? needs.map((c) => c.name.toLowerCase()).join(", ") : "nothing to look at",
      level: needs.some((c) => c.level === "bad") ? "bad" : needs.length ? "warn" : "ok",
      tab: "security",
      fix: needs.length ? "See Security." : undefined,
    });
  }
  if (!s)
    out.push({
      key: "status",
      lane: "server",
      name: "Server status",
      line: "not set up yet",
      level: "off",
      tab: "picture",
      fix: "The next deploy installs it (deploy/server/install.sh).",
    });
  else if (age > STALE_MINUTES)
    out.push({
      key: "status",
      lane: "server",
      name: "Server status",
      line: `last written ${Math.round(age)} min ago`,
      level: "bad",
      tab: "picture",
      fix: "On the server: sudo systemctl status kebo-status.timer",
    });
  if (s) {
    const cpu = i.cpu15 ?? s.cpu?.percent ?? null;
    out.push({
      key: "cpu",
      lane: "server",
      name: "CPU",
      line: cpu === null ? "not known" : `${pct(cpu)} · ${plural(s.host?.cores ?? 0, "core")}`,
      level: cpu === null ? "off" : cpu >= 90 ? "bad" : cpu >= 75 ? "warn" : "ok",
      tab: "picture",
      fix: cpu !== null && cpu >= 75 ? "Busy for 15 minutes: see which service uses it in Services." : undefined,
    });
    const m = s.memory;
    out.push({
      key: "memory",
      lane: "server",
      name: "Memory",
      line: m ? `${gb(m.usedMb / 1024)} of ${gb(m.totalMb / 1024)}` : "not known",
      level: !m ? "off" : m.percent >= 95 ? "bad" : m.percent >= 85 ? "warn" : "ok",
      tab: "services",
      fix: m && m.percent >= 85 ? "Almost full: see which service uses it in Services." : undefined,
    });
    const k = s.disk;
    out.push({
      key: "disk",
      lane: "server",
      name: "Disk",
      line: k ? `${pct(k.percent)} full · ${gb(k.freeGb)} free` : "not known",
      level: !k ? "off" : k.percent >= 90 ? "bad" : k.percent >= 80 ? "warn" : "ok",
      tab: "data",
      fix: k && k.percent >= 80 ? "See what uses the space in Disk, database and backups." : undefined,
    });
    const u = s.updates;
    if (!i.security?.length)
      out.push({
        key: "updates",
        lane: "server",
        name: "Updates",
        line: !u
          ? "not checked yet"
          : u.security
            ? `${plural(u.security, "security update")} waiting`
            : u.reboot
              ? "a restart is needed"
              : "up to date",
        level: !u ? "off" : u.security || u.reboot ? "warn" : "ok",
        tab: "picture",
        fix:
          u && (u.security || u.reboot)
            ? "On the server, at a quiet hour: sudo apt upgrade (or dnf upgrade), then sudo reboot."
            : undefined,
      });
    const extra = (s.ports ?? []).filter((p) => !OPEN_PORTS.includes(p));
    if (!i.security?.length)
      out.push({
        key: "ports",
        lane: "server",
        name: "Open ports",
        line: extra.length
          ? `${extra.join(", ")} open to the outside`
          : `only ${(s.ports ?? OPEN_PORTS).join(", ") || "none"}${s.firewall === "on" ? " · firewall on" : ""}`,
        level: extra.length ? "warn" : "ok",
        tab: "picture",
        fix: extra.length ? "Close what should not be reachable from the internet (firewall, or bind it to 127.0.0.1)." : undefined,
      });
  }

  // App
  out.push(service("app", "web", "Web"));
  const api = service("app", "api", "API");
  if (s?.api && !s.api.ok && age <= STALE_MINUTES)
    Object.assign(api, { line: "does not answer", level: "bad", fix: "See the API's live log in Services." });
  out.push(api);
  out.push(service("app", "worker", "Worker"));
  if (i.speed) {
    const sp = i.speed;
    out.push({
      key: "speed",
      lane: "app",
      name: "Speed",
      line:
        !sp.requests || sp.slowMs === null
          ? "no requests in the last 15 min"
          : `typical ${sp.typicalMs} ms · slowest 5% ${msText(sp.slowMs)}`,
      level: sp.slowMs === null ? "ok" : sp.slowMs >= 5000 ? "bad" : sp.slowMs >= 2000 ? "warn" : "ok",
      tab: "speed",
      fix: sp.slowMs !== null && sp.slowMs >= 2000 ? "Slow for 15 minutes: see the slowest pages in Speed and errors." : undefined,
    });
  }
  if (i.errors) {
    const e = i.errors;
    out.push({
      key: "errors",
      lane: "app",
      name: "Errors",
      line: e.lastHour
        ? `${plural(e.lastHour, "error")} in the last hour`
        : e.open24h
          ? `${plural(e.open24h, "kind")} open, seen today`
          : "none in 24 hours",
      level: e.lastHour >= 10 ? "bad" : e.lastHour || e.open24h ? "warn" : "ok",
      tab: "speed",
      fix: e.lastHour || e.open24h ? "See them in Speed and errors; Copy for Claude to get them fixed." : undefined,
    });
  }

  // Data
  const db = svc("db");
  const conn = i.database;
  const busy = conn.connections !== null && conn.maxConnections ? conn.connections / conn.maxConnections : 0;
  out.push({
    key: "db",
    lane: "data",
    name: "Database",
    line: !conn.ok
      ? "not answering"
      : conn.connections !== null
        ? `${conn.connections} of ${conn.maxConnections} connections`
        : "answering",
    level: !conn.ok ? "bad" : (db && db.level !== "ok") || busy >= 0.8 ? "warn" : "ok",
    tab: "data",
    fix: !conn.ok
      ? "See the Database's live log in Services."
      : busy >= 0.8
        ? "Almost every connection is in use: see the API's log."
        : undefined,
  });
  out.push(service("data", "minio", "Files"));
  if (i.restore !== undefined) {
    const r = i.restore;
    out.push({
      key: "restore",
      lane: "data",
      name: "Restore test",
      line: !r ? "not run yet: once a month" : r.ok ? `worked ${dayText(r.at)}` : "failed",
      level: !r ? "off" : r.ok ? "ok" : "bad",
      tab: "jobs",
      fix: r && !r.ok ? `${r.message ?? "See the Backup's live log"}. A backup that cannot be put back is no backup.` : undefined,
    });
  }
  const b = i.backup;
  const goodAge = b?.lastGoodAt ? (i.now.getTime() - Date.parse(b.lastGoodAt)) / HOUR : Infinity;
  out.push({
    key: "backup",
    lane: "data",
    name: "Backup",
    line: !b
      ? "none recorded yet"
      : b.lastGoodAt
        ? `last good ${agoShort(b.lastGoodAt, i.now)}${b.ok ? "" : " · last try failed"}`
        : "never worked",
    level: !b ? (s ? "warn" : "off") : goodAge > BACKUP_MAX_AGE_HOURS ? "bad" : b.ok ? "ok" : "warn",
    tab: "data",
    fix: !b || goodAge > BACKUP_MAX_AGE_HOURS || !b.ok ? "See the Backup's live log in Services, and docs/restore.md." : undefined,
  });
  const off = b?.offsite ?? null;
  const offAt = b ? offsiteGoodAt(b) : null;
  out.push({
    key: "offsite",
    lane: "data",
    name: "Off-site copy",
    line:
      off === "ok"
        ? "made with the last backup"
        : off === "failed"
          ? "failed"
          : off === "pending"
            ? `not made by the last backup run${offAt ? ` · last made ${agoShort(offAt, i.now)}` : ""}`
            : off === "off"
              ? "off: backups are on this server only"
              : "not known yet",
    level: off === "ok" ? "ok" : off === "failed" ? "bad" : off === "off" || off === "pending" ? "warn" : "off",
    tab: "data",
    fix:
      off === "off"
        ? "Set it up: deploy/server/enable-offsite.sh (docs/restore.md)."
        : off === "failed"
          ? "See the Backup's live log in Services."
          : undefined,
  });

  // Outside services
  if (i.outsideAt !== undefined) {
    const late = i.outsideAt ? (i.now.getTime() - Date.parse(i.outsideAt)) / 60000 : null;
    out.push({
      key: "outside",
      lane: "outside",
      name: "Outside watcher",
      line: late === null ? "no check from outside yet" : `checked ${agoShort(i.outsideAt!, i.now)} from GitHub`,
      level: late === null ? "off" : late > OUTSIDE_LATE_MINUTES ? "warn" : "ok",
      tab: "speed",
      fix:
        late === null
          ? "GitHub Actions › Watch the site checks every 5 minutes once it runs on main."
          : late > OUTSIDE_LATE_MINUTES
            ? "No check from outside lately: see GitHub Actions › Watch the site (it emails you when the site is down)."
            : undefined,
    });
  }
  if (i.deliveries) {
    for (const [key, name, d] of [
      ["email", "Email sending", i.deliveries.email],
      ["push", "Phone notifications", i.deliveries.push],
    ] as const) {
      const all = d.sent + d.failed;
      out.push({
        key,
        lane: "outside",
        name,
        line: all ? `${d.sent} today${d.failed ? ` · ${d.failed} not delivered` : ""}` : "none sent today",
        // One mailbox full now and then is normal: warn from 5 not delivered or 5% of them.
        level: all >= 5 && d.failed / all >= 0.2 ? "bad" : d.failed >= 5 || (all && d.failed / all >= 0.05) ? "warn" : "ok",
        tab: "jobs",
        fix: d.failed >= 5 || (all && d.failed / all >= 0.05) ? "See why in Jobs and emails." : undefined,
      });
    }
  }
  const dep = i.lastDeploy;
  out.push({
    key: "deploys",
    lane: "outside",
    name: "Deploys",
    line: dep ? `${dep.ok ? "last" : "failed"}: ${dep.commit} · ${agoShort(dep.at, i.now)}` : "none recorded yet",
    level: !dep ? "off" : dep.ok ? "ok" : "warn",
    tab: "picture",
    fix: dep && !dep.ok ? "The previous version still runs. See the deploy's log in GitHub Actions." : undefined,
  });
  return out;
}

const msText = (ms: number) => (ms >= 1000 ? `${Math.round(ms / 100) / 10} s` : `${ms} ms`);

function upFor(startedAt: string | null, now: Date) {
  if (!startedAt) return "—";
  const s = (now.getTime() - Date.parse(startedAt)) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  if (s < 48 * 3600) return `${Math.round(s / 3600)} hours`;
  return `${Math.round(s / 86400)} days`;
}
function agoShort(iso: string, now: Date) {
  const h = (now.getTime() - Date.parse(iso)) / HOUR;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min ago`;
  if (h < 48) return `${Math.round(h)} hour${Math.round(h) === 1 ? "" : "s"} ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** When the disk is full at the growth of the last 14 days (null: not growing). */
export function fullIn(days: { day: string; usedGb: number }[], freeGb: number | null): { days: number | null; perDay: number | null } {
  const last = days.slice(-15);
  if (last.length < 3 || freeGb === null) return { days: null, perDay: null };
  const first = last[0]!;
  const end = last.at(-1)!;
  const span = (Date.parse(end.day) - Date.parse(first.day)) / DAY;
  const perDay = span > 0 ? (end.usedGb - first.usedGb) / span : 0;
  if (perDay <= 0.05) return { days: null, perDay: Math.round(perDay * 100) / 100 };
  return { days: Math.max(0, Math.floor(freeGb / perDay)), perDay: Math.round(perDay * 100) / 100 };
}

/* ---------------------------------------------------------------- live logs */

const TS = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z) ?/;
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const ERR = /\b(error|fatal|exception|panic|unhandled)\b|"level":\s*(50|60|"error"|"fatal")|exited with code [1-9]|out of memory/i;
const WARN = /\bwarn(ing)?\b|"level":\s*(40|"warn")/i;

export function logLine(raw: string): DevLogLine {
  const clean = raw.replace(ANSI, "");
  const m = TS.exec(clean);
  const text = m ? clean.slice(m[0].length) : clean;
  return {
    at: m ? m[1]!.replace(/\.(\d{3})\d*Z$/, ".$1Z") : null,
    text,
    level: ERR.test(text) ? "error" : WARN.test(text) ? "warn" : null,
  };
}

/** The first read: the end of the file. Later reads: what was written since `after` (at most this much). */
const FIRST_BYTES = 64 * 1024;
const MAX_BYTES = 256 * 1024;

export async function readLog(dir: string, service: string, after: number | null): Promise<DevLogs> {
  const file = path.join(dir, `${service}.log`);
  let size: number;
  try {
    size = (await stat(file)).size;
  } catch {
    return { service, lines: [], next: 0, missing: true };
  }
  // Moved to .log.1 since (over 5 MB): start again from the new file's end.
  let start = after !== null && after <= size ? after : Math.max(0, size - FIRST_BYTES);
  if (size - start > MAX_BYTES) start = size - MAX_BYTES;
  if (start === size) return { service, lines: [], next: size, missing: false };
  const fh = await open(file, "r");
  try {
    const buf = Buffer.alloc(size - start);
    await fh.read(buf, 0, buf.length, start);
    let text = buf.toString("utf8");
    // Started in the middle of a line (the first read, or more than MAX_BYTES since): skip to the next.
    if (start > 0 && start !== after) text = text.slice(text.indexOf("\n") + 1);
    // Keep a line still being written for the next read.
    const cut = text.lastIndexOf("\n");
    const whole = cut >= 0 ? text.slice(0, cut) : "";
    const next = size - Buffer.byteLength(text.slice(cut + 1), "utf8");
    return { service, lines: whole ? whole.split("\n").map(logLine) : [], next, missing: false };
  } finally {
    await fh.close();
  }
}

/* ---------------------------------------------------------------- the service */

@Injectable()
export class DevToolsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
    private readonly more: DevToolsMoreService,
  ) {}

  private file(name: string) {
    return this.env.SERVER_STATUS_DIR ? path.join(this.env.SERVER_STATUS_DIR, name) : null;
  }

  private async status(): Promise<ServerStatus | null> {
    const f = this.file("server.json");
    if (!f) return null;
    const r = await readStatus<ServerStatus>(f);
    return r.state === "ok" ? r.value : null;
  }

  private async jsonl<T>(name: string, last?: number) {
    const f = this.file(name);
    return f ? readJsonl<T>(f, last) : [];
  }

  private async backup(): Promise<BackupStatus | null> {
    const f = this.file("last-status.json");
    if (!f) return null;
    const r = await readStatus<BackupStatus>(f);
    return r.state === "ok" ? r.value : null;
  }

  async logNames(): Promise<string[]> {
    const dir = this.env.LIVE_LOGS_DIR;
    if (!dir) return [];
    try {
      return (await readdir(dir)).filter((f) => /^[A-Za-z0-9_.-]+\.log$/.test(f)).map((f) => f.slice(0, -4));
    } catch {
      return [];
    }
  }

  private async database() {
    const db = this.prisma.platform;
    try {
      const [row] = await db.$queryRaw<
        { size: bigint; conns: number; max: number; hit: number | null; longest: number | null; version: string }[]
      >`select pg_database_size(current_database())::bigint as size,
               (select count(*)::int from pg_stat_activity where datname = current_database()) as conns,
               current_setting('max_connections')::int as max,
               (select round(100.0 * sum(blks_hit) / nullif(sum(blks_hit) + sum(blks_read), 0), 1)::float8 from pg_stat_database where datname = current_database()) as hit,
               (select coalesce(max(extract(epoch from now() - query_start)), 0)::float8 from pg_stat_activity
                 where state = 'active' and pid <> pg_backend_pid() and datname = current_database()) as longest,
               current_setting('server_version') as version`;
      const tables = await db.$queryRaw<{ name: string; rows: bigint; bytes: bigint }[]>`
        select s.relname as name, greatest(s.n_live_tup, c.reltuples::bigint, 0)::bigint as rows, pg_total_relation_size(s.relid)::bigint as bytes
        from pg_stat_user_tables s join pg_class c on c.oid = s.relid
        order by pg_total_relation_size(s.relid) desc limit 8`;
      return {
        ok: true,
        version: row!.version.split(" ")[0] ?? null,
        sizeMb: Math.round(Number(row!.size) / 1048576),
        connections: row!.conns,
        maxConnections: row!.max,
        cacheHit: row!.hit,
        longestQuerySec: row!.longest === null ? null : Math.round(row!.longest * 10) / 10,
        tables: tables.map((t) => ({ name: t.name, rows: Number(t.rows), mb: Math.round((Number(t.bytes) / 1048576) * 10) / 10 })),
      };
    } catch {
      return {
        ok: false,
        version: null,
        sizeMb: null,
        connections: null,
        maxConnections: null,
        cacheHit: null,
        longestQuerySec: null,
        tables: [],
      };
    }
  }

  private async ownDomains() {
    const rows = await this.prisma.platform.company.groupBy({ by: ["ownDomainStatus"], where: { ownDomain: { not: null } }, _count: true });
    const n = (s: string) => rows.find((r) => r.ownDomainStatus === s)?._count ?? 0;
    return { connected: n("connected"), lost: n("lost"), waiting: n("waiting") };
  }

  /** Each route's requests, server errors and answer times since a moment (the outside check apart). */
  async routeStats(since: Date) {
    const db = this.prisma.platform;
    const [counts, steps] = await Promise.all([
      db.$queryRaw<{ route: string; count: bigint; errors: bigint }[]>`
        select route, sum(count)::bigint as count, sum(errors)::bigint as errors from request_minutes where minute >= ${since} group by route`,
      db.$queryRaw<{ route: string; i: bigint; n: bigint }[]>`
        select route, u.i, sum(u.b)::bigint as n from request_minutes, unnest(buckets) with ordinality as u(b, i)
        where minute >= ${since} group by route, u.i`,
    ]);
    const buckets = new Map<string, number[]>();
    for (const r of steps) {
      const b = buckets.get(r.route) ?? new Array(REQUEST_STEPS_MS.length + 1).fill(0);
      b[Number(r.i) - 1] = Number(r.n);
      buckets.set(r.route, b);
    }
    const counted = counts.map((r) => ({ route: r.route, count: Number(r.count), errors: Number(r.errors), buckets: buckets.get(r.route) ?? [] }));
    // The API's answers; pages (how fast they showed in the browser) are counted apart.
    const routes = counted.filter((r) => r.route !== OUTSIDE_ROUTE && !r.route.startsWith(PAGE_PREFIX));
    const pages = counted.filter((r) => r.route.startsWith(PAGE_PREFIX)).map((r) => ({ ...r, route: r.route.slice(PAGE_PREFIX.length) }));
    const all = routes.reduce(
      (acc, r) => acc.map((v, k) => v + (r.buckets[k] ?? 0)),
      new Array(REQUEST_STEPS_MS.length + 1).fill(0) as number[],
    );
    return {
      routes,
      pages,
      requests: routes.reduce((a, r) => a + r.count, 0),
      errors: routes.reduce((a, r) => a + r.errors, 0),
      typicalMs: quantileMs(all, 0.5),
      slowMs: quantileMs(all, 0.95),
    };
  }

  private async outside() {
    const [row] = await this.prisma.platform.$queryRaw<{ last: Date | null; n: bigint }[]>`
      select max(minute) as last, coalesce(sum(count) filter (where minute >= now() - interval '24 hours'), 0)::bigint as n
      from request_minutes where route = ${OUTSIDE_ROUTE}`;
    return { lastAt: row?.last ? row.last.toISOString() : null, checks24h: Number(row?.n ?? 0) };
  }

  private async up(): Promise<{ percent: number | null; lastDown: string | null }> {
    const h = await this.jsonl<{ t: string; up?: boolean }>("history.jsonl", 7 * 1440);
    const seen = h.filter((x) => typeof x.up === "boolean");
    if (!seen.length) return { percent: null, lastDown: null };
    const down = seen.filter((x) => !x.up);
    return { percent: Math.round((1000 * (seen.length - down.length)) / seen.length) / 10, lastDown: down.at(-1)?.t ?? null };
  }

  async overview(now = new Date()): Promise<DevOverview> {
    const [status, events, history, backup, database, ownDomains, deploys, logs, warnings] = await Promise.all([
      this.status(),
      this.jsonl<ServerEvent>("events.jsonl", 2000),
      this.jsonl<{ t: string; cpu: number | null; mem: number | null }>("history.jsonl", 1440),
      this.backup(),
      this.database(),
      this.ownDomains(),
      this.jsonl<DevDeploy>("deploys.jsonl", 200),
      this.logNames(),
      this.prisma.platform.platformLog.findMany({
        where: { action: "server_warning", at: { gte: new Date(now.getTime() - 7 * DAY) } },
        orderBy: { at: "desc" },
        take: 50,
        select: { at: true, summary: true },
      }),
    ]);
    const today = new Date(now.toISOString().slice(0, 10));
    const [last24, quarter, lastHour, openErrors, outside, up, newErrors, deliveryRows, restore, security] = await Promise.all([
      this.routeStats(new Date(now.getTime() - DAY)),
      this.routeStats(new Date(now.getTime() - 15 * 60000)),
      this.prisma.platform.$queryRaw<
        { n: bigint }[]
      >`select coalesce(sum(errors), 0)::bigint as n from request_minutes where minute >= ${new Date(now.getTime() - HOUR)}`,
      this.prisma.platform.appError.count({ where: { status: "open", lastAt: { gte: new Date(now.getTime() - DAY) } } }),
      this.outside(),
      this.up(),
      this.prisma.platform.appError.findMany({
        where: { firstAt: { gte: new Date(now.getTime() - 7 * DAY) } },
        orderBy: { firstAt: "desc" },
        take: 20,
        select: { firstAt: true, message: true, where: true },
      }),
      this.prisma.platform.deliveryDay.findMany({ where: { day: today } }),
      (async () => {
        const f = this.file("restore-status.json");
        if (!f) return null;
        const r = await readStatus<RestoreStatus>(f);
        return r.state === "ok" ? r.value : null;
      })(),
      this.more
        .security(now)
        .then((v) => v.checks)
        .catch(() => []),
    ]);
    const dd = (c: string) => {
      const r = deliveryRows.find((x) => x.channel === c);
      return { sent: r?.sent ?? 0, failed: r?.failed ?? 0 };
    };
    const services = servicesFrom(status, events, logs, now);
    const recent = history.filter((h) => Date.parse(h.t) >= now.getTime() - 15 * 60000 && h.cpu !== null);
    const cpu15 = recent.length ? recent.reduce((a, h) => a + (h.cpu ?? 0), 0) / recent.length : null;
    const lastDeploy = deploys.at(-1) ?? null;
    const checks = buildChecks({
      now,
      status,
      services,
      cpu15,
      backup,
      database,
      ownDomains,
      lastDeploy,
      speed: { requests: quarter.requests, slowMs: quarter.slowMs, typicalMs: quarter.typicalMs },
      errors: { lastHour: Number(lastHour[0]?.n ?? 0), open24h: openErrors },
      outsideAt: outside.lastAt,
      deliveries: { email: dd("email"), push: dd("push") },
      restore,
      security,
    });

    const week = now.getTime() - 7 * DAY;
    const timeline: DevEvent[] = [
      ...deploys
        .filter((d) => Date.parse(d.at) >= week)
        .map((d): DevEvent => ({
          at: d.at,
          kind: d.ok ? "deploy" : "deployFailed",
          level: d.ok ? "ok" : "warn",
          text: d.ok ? `Deployed ${d.commit}: ${d.title}` : `Deploy of ${d.commit} failed; the previous version kept running`,
        })),
      ...events
        .filter((e) => e.kind !== "replaced" && Date.parse(e.at) >= week)
        .map((e): DevEvent => ({
          at: e.at,
          kind: e.kind === "stopped" ? "stopped" : "restart",
          level: e.kind === "stopped" ? "bad" : "warn",
          text: `${infoOf(e.service).label} ${e.kind === "stopped" ? "stopped" : "restarted"}${e.why ? `: ${e.why}` : ""}`,
        })),
      ...warnings.map((w): DevEvent => ({
        at: w.at.toISOString(),
        kind: "warning",
        level: "warn",
        text: `${w.summary}: emailed to the platform admins`,
      })),
      ...newErrors.map((e): DevEvent => ({
        at: e.firstAt.toISOString(),
        kind: "error",
        level: "bad",
        text: `New error on ${e.where}: ${e.message.slice(0, 120)}`,
      })),
    ];
    if (backup?.at && Date.parse(backup.at) >= week)
      timeline.push({
        at: backup.at,
        kind: backup.ok ? "backup" : "backupFailed",
        level: backup.ok ? "ok" : "bad",
        text: backup.ok
          ? `Database backup made${backup.offsite === "ok" ? ", and copied off the server" : ""}`
          : `Backup failed: ${backup.message ?? "no reason given"}`,
      });
    timeline.sort((a, b) => b.at.localeCompare(a.at));

    // CPU and memory, the last 24 hours, every 15 minutes.
    const chart: DevOverview["chart"] = [];
    const day = history.filter((h) => Date.parse(h.t) >= now.getTime() - DAY);
    for (let k = 0; k < day.length; k += 15) {
      const slice = day.slice(k, k + 15);
      const avg = (f: (h: (typeof slice)[number]) => number | null) => {
        const v = slice.map(f).filter((x): x is number => x !== null);
        return v.length ? Math.round((v.reduce((a, x) => a + x, 0) / v.length) * 10) / 10 : null;
      };
      chart.push({ t: slice[0]!.t, cpu: avg((h) => h.cpu), mem: avg((h) => h.mem) });
    }

    const backupCheck = checks.find((c) => c.key === "backup");
    return {
      now: now.toISOString(),
      checkedAt: status?.at ?? null,
      stale: !status || (now.getTime() - Date.parse(status.at)) / 60000 > STALE_MINUTES,
      checks,
      tiles: {
        cpu: cpu15 ?? status?.cpu?.percent ?? null,
        load: status?.cpu?.load5 ?? null,
        cores: status?.host?.cores ?? null,
        memory: status?.memory ?? null,
        disk: status?.disk ?? null,
        backupAt: backup?.lastGoodAt ?? null,
        backupLevel: backupCheck?.level ?? "off",
        services: { running: services.filter((s) => s.state === "running").length, all: services.length },
        typicalMs: last24.typicalMs,
        slowMs: last24.slowMs,
        requests24h: last24.requests,
        errors24h: last24.errors,
        upPercent: up.percent,
        lastDown: up.lastDown,
      },
      host: status?.host
        ? { os: status.host.os ?? null, uptimeSec: status.host.uptimeSec ?? null, docker: status.host.docker ?? null }
        : null,
      deploys: deploys.slice(-5).reverse(),
      events: timeline.slice(0, 60),
      chart,
    };
  }

  async services(now = new Date()): Promise<DevServicesView> {
    const [status, events, logs] = await Promise.all([this.status(), this.jsonl<ServerEvent>("events.jsonl", 2000), this.logNames()]);
    const services = servicesFrom(status, events, logs, now);
    // A log of a service not in the status (yet): still readable.
    for (const name of logs)
      if (!services.some((s) => s.key === name)) {
        const info = infoOf(name);
        services.push({
          key: name,
          label: info.label,
          role: info.role,
          state: "unknown",
          level: "off",
          status: "Not checked",
          startedAt: null,
          restarts: 0,
          restarts24h: 0,
          lastRestart: null,
          cpu: null,
          memMb: null,
          memLimitMb: null,
          hasLog: true,
        });
      }
    return { checkedAt: status?.at ?? null, services, logs, logsOn: !!this.env.LIVE_LOGS_DIR };
  }

  async data(): Promise<DevDataView> {
    const [status, days, backup, database] = await Promise.all([
      this.status(),
      this.jsonl<{ day: string; usedGb: number; percent: number }>("disk-days.jsonl", 120),
      this.backup(),
      this.database(),
    ]);
    const disk = status?.disk ?? null;
    const f = fullIn(days, disk?.freeGb ?? null);
    const goodAge = backup?.lastGoodAt ? (Date.now() - Date.parse(backup.lastGoodAt)) / HOUR : Infinity;
    return {
      checkedAt: status?.at ?? null,
      disk,
      fullInDays: f.days,
      growthGbPerDay: f.perDay,
      space: status?.space?.parts ?? [],
      spaceAt: status?.space?.at ?? null,
      days: days.slice(-30),
      backup: {
        level: !backup
          ? "off"
          : goodAge > BACKUP_MAX_AGE_HOURS || backup.offsite === "failed"
            ? "bad"
            : !backup.ok || backup.offsite === "off" || backup.offsite === "pending"
              ? "warn"
              : "ok",
        lastGoodAt: backup?.lastGoodAt ?? null,
        lastTryAt: backup?.at ?? null,
        ok: backup?.ok ?? null,
        message: backup?.message ?? null,
        dump: backup?.dump ?? null,
        offsite: backup?.offsite ?? null,
        offsiteAt: backup ? offsiteGoodAt(backup) : null,
      },
      database,
    };
  }

  async speed(range: "24h" | "7d", status: "open" | "fixed" = "open", now = new Date()): Promise<DevSpeedView> {
    const span = range === "7d" ? 7 * DAY : DAY;
    const since = new Date(now.getTime() - span);
    const stepMs = range === "7d" ? 6 * HOUR : HOUR;
    const [stats, rows, errors, fixedCount, outside, up, deploys] = await Promise.all([
      this.routeStats(since),
      this.prisma.platform.$queryRaw<{ t: Date; i: bigint; n: bigint; c: bigint }[]>`
        select date_bin(${`${stepMs / 1000} seconds`}::interval, minute, timestamptz '2000-01-01') as t, u.i, sum(u.b)::bigint as n, 0::bigint as c
        from request_minutes, unnest(buckets) with ordinality as u(b, i)
        where minute >= ${since} and route <> ${OUTSIDE_ROUTE} and route not like ${`${PAGE_PREFIX}%`} group by 1, u.i order by 1`,
      this.prisma.platform.appError.findMany({ where: { status }, orderBy: { lastAt: "desc" }, take: 50 }),
      this.prisma.platform.appError.count({ where: { status: "fixed" } }),
      this.outside(),
      this.up(),
      this.jsonl<DevDeploy>("deploys.jsonl", 200),
    ]);
    const steps = new Map<number, number[]>();
    for (const r of rows) {
      const k = r.t.getTime();
      const b = steps.get(k) ?? new Array(REQUEST_STEPS_MS.length + 1).fill(0);
      b[Number(r.i) - 1] = Number(r.n);
      steps.set(k, b);
    }
    const chart: DevSpeedView["chart"] = [];
    const origin = Date.parse("2000-01-01T00:00:00Z");
    for (let t = origin + Math.floor((since.getTime() - origin) / stepMs) * stepMs; t <= now.getTime(); t += stepMs) {
      const b = steps.get(t);
      chart.push({
        t: new Date(t).toISOString(),
        count: b ? b.reduce((a, x) => a + x, 0) : 0,
        typicalMs: b ? quantileMs(b, 0.5) : null,
        slowMs: b ? quantileMs(b, 0.95) : null,
      });
    }
    const afterDeploy = (at: Date) => [...deploys].reverse().find((d) => d.ok && Date.parse(d.at) <= at.getTime())?.commit ?? null;
    return {
      range,
      requests: stats.requests,
      errors: stats.errors,
      typicalMs: stats.typicalMs,
      slowMs: stats.slowMs,
      upPercent: up.percent,
      chart,
      slowest: stats.routes
        .filter((r) => r.count >= 5)
        .map((r) => ({
          route: r.route,
          count: r.count,
          errors: r.errors,
          typicalMs: quantileMs(r.buckets, 0.5),
          slowMs: quantileMs(r.buckets, 0.95),
        }))
        .sort((a, b) => (b.slowMs ?? 0) - (a.slowMs ?? 0))
        .slice(0, 10),
      // How fast pages showed their main part in the browser: typical, and 3 in 4 within (the usual measure).
      pages: stats.pages
        .filter((p) => p.count >= 3)
        .map((p) => ({ page: p.route, count: p.count, typicalMs: quantileMs(p.buckets, 0.5), slowMs: quantileMs(p.buckets, 0.75) }))
        .sort((a, b) => (b.slowMs ?? 0) - (a.slowMs ?? 0))
        .slice(0, 10),
      errorsList: errors.map((e): DevError => ({
        id: e.id,
        source: e.source,
        name: e.name,
        message: e.message,
        where: e.where,
        stack: e.stack,
        count: e.count,
        companyName: e.companyName,
        userName: e.userName,
        path: e.path,
        firstAt: e.firstAt.toISOString(),
        lastAt: e.lastAt.toISOString(),
        status: e.status === "fixed" ? "fixed" : "open",
        afterDeploy: afterDeploy(e.firstAt),
      })),
      fixedCount,
      outside,
    };
  }

  /** Marks an error fixed (it opens again if it comes back), or open again. */
  async markError(id: string, status: "open" | "fixed") {
    await this.prisma.platform.appError.update({ where: { id }, data: { status, fixedAt: status === "fixed" ? new Date() : null } });
    return { ok: true };
  }

  async logs(service: string, after: number | null): Promise<DevLogs> {
    if (!/^[A-Za-z0-9_.-]{1,40}$/.test(service)) throw new BadRequestException("Unknown service");
    const dir = this.env.LIVE_LOGS_DIR;
    if (!dir) return { service, lines: [], next: 0, missing: true };
    return readLog(dir, service, after);
  }
}

/** Dev tools (platform admin): how the server and the app are doing. */
@ApiTags("platform")
@Controller("platform/dev-tools")
export class DevToolsController {
  constructor(
    private readonly dev: DevToolsService,
    private readonly more: DevToolsMoreService,
  ) {}

  @PlatformRoute()
  @Get("jobs")
  jobs() {
    return this.more.jobs();
  }

  @PlatformRoute()
  @Get("security")
  security() {
    return this.more.security();
  }

  @PlatformRoute()
  @Get("companies")
  companies() {
    return this.more.companies();
  }

  @PlatformRoute()
  @Get("overview")
  overview() {
    return this.dev.overview();
  }

  @PlatformRoute()
  @Get("services")
  services() {
    return this.dev.services();
  }

  @PlatformRoute()
  @Get("data")
  data() {
    return this.dev.data();
  }

  /** Speed and errors: the last 24 hours (or 7 days), the slowest routes, and the errors (open, or fixed). */
  @PlatformRoute()
  @Get("speed")
  speed(@Query("range") range?: string, @Query("errors") errors?: string) {
    return this.dev.speed(range === "7d" ? "7d" : "24h", errors === "fixed" ? "fixed" : "open");
  }

  @PlatformRoute()
  @Post("errors/:id/fixed")
  @HttpCode(200)
  fixed(@Param("id", ParseUUIDPipe) id: string) {
    return this.dev.markError(id, "fixed");
  }

  @PlatformRoute()
  @Post("errors/:id/open")
  @HttpCode(200)
  reopen(@Param("id", ParseUUIDPipe) id: string) {
    return this.dev.markError(id, "open");
  }

  /** A service's live log: the end of it, or (after=) what was written since. */
  @PlatformRoute()
  @Get("logs")
  logs(@Query("service") service: string, @Query("after") after?: string) {
    const n = after === undefined || after === "" ? null : Number(after);
    if (n !== null && (!Number.isInteger(n) || n < 0)) throw new BadRequestException("after must be a byte offset");
    return this.dev.logs(service ?? "", n);
  }
}
