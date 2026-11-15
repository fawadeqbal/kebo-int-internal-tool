import path from "node:path";
import { Inject, Injectable } from "@nestjs/common";
import type { DevCheck, DevCompaniesView, DevCompany, DevJob, DevJobsView, DevLevel, DevSecurityView } from "@kebo/shared";
import { ENV, type Env } from "../config/env";
import { PrismaService } from "../database/prisma.service";
import type { ServerStatus } from "./dev-tools";
import {
  BACKUP_MAX_AGE_HOURS,
  CERT_WARN_DAYS,
  DISK_WARN_PERCENT,
  ERRORS_WARN_PER_HOUR,
  JOBS,
  offsiteGoodAt,
  readStatus,
  type BackupStatus,
  type DiskStatus,
  type RestoreStatus,
} from "./server-health";

/** Ports that may be open to the outside: SSH and the web. */
export const OPEN_PORTS = [22, 80, 443];
const HOUR = 3_600_000;
const DAY = 24 * HOUR;


const late = (lastAt: string | null, everyMs: number, now: Date) =>
  !lastAt || now.getTime() - Date.parse(lastAt) > everyMs * 2.5 + 10 * 60_000;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const maskEmail = (e: string) => {
  const [name, domain] = e.split("@");
  return domain ? `${name!.slice(0, 1)}***@${domain}` : `${e.slice(0, 1)}***`;
};
const SIGN_IN_TEXT: Record<string, string> = {
  wrong_password: "Wrong password",
  unknown_email: "Unknown email",
  wrong_code: "Wrong two-step code",
  locked: "Locked after too many tries",
  too_many: "Too many tries: blocked for a while",
  switched_off: "Company switched off",
  code_needed: "Stopped at the two-step code",
};

/** Dev tools' Jobs and emails, Security and Companies tabs. */
@Injectable()
export class DevToolsMoreService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private async read<T>(name: string): Promise<T | null> {
    const dir = this.env.SERVER_STATUS_DIR;
    if (!dir) return null;
    const r = await readStatus<T>(path.join(dir, name));
    return r.state === "ok" ? r.value : null;
  }

  async jobs(now = new Date()): Promise<DevJobsView> {
    const db = this.prisma.platform;
    const since7 = new Date(now.getTime() - 7 * DAY);
    const [last, fails, server, backup, disk, restore, offsiteRestore, days, failures, phones, errorsHour] = await Promise.all([
      db.$queryRaw<{ job: string; started_at: Date; took_ms: number; ok: boolean; result: string | null }[]>`
        select distinct on (job) job, started_at, took_ms, ok, result from job_runs order by job, started_at desc`,
      db.jobRun.groupBy({ by: ["job"], where: { ok: false, startedAt: { gte: since7 } }, _count: true }),
      this.read<ServerStatus>("server.json"),
      this.read<BackupStatus>("last-status.json"),
      this.read<DiskStatus>("disk.json"),
      this.read<RestoreStatus>("restore-status.json"),
      this.read<RestoreStatus>("offsite-restore-status.json"),
      db.deliveryDay.findMany({ where: { day: { gte: new Date(dayKey(new Date(now.getTime() - 6 * DAY))) } }, orderBy: { day: "asc" } }),
      db.deliveryFailure.findMany({ where: { at: { gte: since7 } }, orderBy: { at: "desc" }, take: 30 }),
      db.deviceToken.count(),
      db.$queryRaw<
        { n: bigint }[]
      >`select coalesce(sum(errors), 0)::bigint as n from request_minutes where minute >= ${new Date(now.getTime() - HOUR)}`,
    ]);
    const failed = new Map(fails.map((f) => [f.job, f._count]));
    const fromServer: Record<string, { lastAt: string | null; ok: boolean | null; result: string | null; tookMs: number | null }> = {
      backup: {
        lastAt: backup?.at ?? null,
        ok: backup ? backup.ok : null,
        result: backup ? (backup.ok ? (backup.dump ?? "made") : (backup.message ?? "failed")) : null,
        tookMs: null,
      },
      offsite: {
        lastAt: backup && backup.offsite !== "off" ? (backup.offsite === "failed" ? backup.at : (offsiteGoodAt(backup) ?? backup.at)) : null,
        ok: backup?.offsite === "ok" ? true : backup?.offsite === "failed" ? false : null,
        result:
          backup?.offsite === "off"
            ? "off: backups stay on this server"
            : backup?.offsite === "failed"
              ? (backup.message ?? "failed")
              : backup?.offsite === "pending"
                ? "not made by the last backup run"
                : backup
                  ? "copied"
                  : null,
        tookMs: null,
      },
      "restore-test": {
        lastAt: restore?.at ?? null,
        ok: restore ? restore.ok : null,
        result: restore
          ? restore.ok
            ? `worked: ${restore.tables} tables, ${restore.companies} companies, ${restore.orders} orders`
            : (restore.message ?? "failed")
          : null,
        tookMs: restore?.tookSec != null ? restore.tookSec * 1000 : null,
      },
      "offsite-restore": {
        lastAt: offsiteRestore?.at ?? null,
        ok: offsiteRestore ? offsiteRestore.ok : null,
        result: offsiteRestore
          ? offsiteRestore.ok
            ? `worked: ${offsiteRestore.tables} tables, ${offsiteRestore.companies} companies, ${offsiteRestore.orders} orders`
            : (offsiteRestore.message ?? "failed")
          : backup?.offsite === "off"
            ? "off: no off-site copy"
            : null,
        tookMs: offsiteRestore?.tookSec != null ? offsiteRestore.tookSec * 1000 : null,
      },
      cleanup: { lastAt: disk?.at ?? null, ok: disk ? true : null, result: disk ? `disk ${disk.percent}% after it` : null, tookMs: null },
      status: { lastAt: server?.at ?? null, ok: server ? true : null, result: server ? "written" : null, tookMs: null },
    };
    const jobs: DevJob[] = JOBS.map((j) => {
      const w = last.find((r) => r.job === j.key);
      const r =
        j.by === "worker"
          ? { lastAt: w?.started_at.toISOString() ?? null, ok: w ? w.ok : null, result: w?.result ?? null, tookMs: w?.took_ms ?? null }
          : fromServer[j.key]!;
      const isLate = late(r.lastAt, j.everyMs, now);
      let level: DevLevel = "ok";
      if (r.ok === false) level = j.key === "backup" || j.key === "restore-test" || j.key === "offsite-restore" ? "bad" : "warn";
      else if (!r.lastAt) level = "off";
      else if (isLate) level = "warn";
      if (j.key === "offsite" && r.result?.startsWith("off")) level = "warn";
      return {
        key: j.key,
        label: j.label,
        by: j.by,
        schedule: j.schedule,
        ...r,
        result: isLate && r.lastAt && r.ok !== false ? `late: ${r.result ?? "no run lately"}` : r.result,
        level,
        failed7d: failed.get(j.key) ?? 0,
      };
    });

    const today = dayKey(now);
    const channel = (c: string) => {
      const rows = days.filter((d) => d.channel === c).map((d) => ({ day: dayKey(d.day), sent: d.sent, failed: d.failed }));
      const out: { day: string; sent: number; failed: number }[] = [];
      for (let k = 6; k >= 0; k--) {
        const day = dayKey(new Date(now.getTime() - k * DAY));
        out.push(rows.find((r) => r.day === day) ?? { day, sent: 0, failed: 0 });
      }
      return { today: out.find((r) => r.day === today) ?? { sent: 0, failed: 0 }, days: out };
    };

    const down = (server?.services ?? []).filter((x) => x.state !== "running");
    const certDays = (server?.certificates ?? [])
      .filter((c) => c.ok && c.endsAt)
      .map((c) => Math.floor((Date.parse(c.endsAt!) - now.getTime()) / DAY))
      .sort((a, b) => a - b)[0];
    const goodAge = backup?.lastGoodAt ? (now.getTime() - Date.parse(backup.lastGoodAt)) / HOUR : null;
    const errorsNow = Number(errorsHour[0]?.n ?? 0);
    const diskNow = server?.disk?.percent ?? disk?.percent ?? null;
    const limits: DevJobsView["limits"] = [
      {
        label: `The disk is ${DISK_WARN_PERCENT}% full or more`,
        now: diskNow === null ? "not known" : `${Math.round(diskNow)}%`,
        level: diskNow === null ? "off" : diskNow >= DISK_WARN_PERCENT ? "warn" : "ok",
      },
      {
        label: "A service stops",
        now: !server ? "not known" : down.length ? `${down.map((d) => d.name).join(", ")} stopped` : "all running",
        level: !server ? "off" : down.length ? "bad" : "ok",
      },
      {
        label: `${ERRORS_WARN_PER_HOUR} server errors or more in an hour`,
        now: `${errorsNow} in the last hour`,
        level: errorsNow >= ERRORS_WARN_PER_HOUR ? "bad" : "ok",
      },
      {
        label: `The last good backup is over ${BACKUP_MAX_AGE_HOURS} hours old, or a backup failed`,
        now: goodAge === null ? "none yet" : `${goodAge < 1 ? `${Math.round(goodAge * 60)} min` : Math.round(goodAge) === 1 ? "1 hour" : `${Math.round(goodAge)} hours`} old`,
        level: goodAge === null ? "off" : goodAge > BACKUP_MAX_AGE_HOURS || backup?.ok === false ? "bad" : "ok",
      },
      {
        label: "The off-site copy failed",
        now: backup?.offsite ?? "not known",
        level: backup?.offsite === "failed" ? "bad" : backup?.offsite === "ok" ? "ok" : "off",
      },
      {
        label: "The monthly restore test failed",
        now: restore ? (restore.ok ? "worked" : "failed") : "not run yet",
        level: restore ? (restore.ok ? "ok" : "bad") : "off",
      },
      {
        label: `A certificate ends in under ${CERT_WARN_DAYS} days`,
        now: certDays === undefined ? "not checked" : `first ends in ${certDays} days`,
        level: certDays === undefined ? "off" : certDays < CERT_WARN_DAYS ? "warn" : "ok",
      },
      { label: "The site does not answer from outside (GitHub emails you)", now: "checked every 5 minutes", level: "ok" },
    ];
    return {
      jobs,
      email: channel("email"),
      push: { ...channel("push"), phones },
      failures: failures.map((f) => ({
        at: f.at.toISOString(),
        channel: f.channel,
        what: f.what,
        to: f.to,
        companyName: f.companyName,
        reason: f.reason,
      })),
      limits,
    };
  }

  async security(now = new Date()): Promise<DevSecurityView> {
    const db = this.prisma.platform;
    const since = new Date(now.getTime() - DAY);
    const [rows, counts, admins, users, server] = await Promise.all([
      db.$queryRaw<{ result: string; email: string; ip: string; company: string | null; times: bigint; last: Date }[]>`
        select s.result::text as result, s.email, s.ip, c.name as company, count(*)::bigint as times, max(s.at) as last
        from sign_ins s left join companies c on c.id = s.company_id
        where s.at >= ${since} and s.result <> 'signed_in'
        group by 1, 2, 3, 4 order by count(*) desc, max(s.at) desc limit 20`,
      db.$queryRaw<{ ok: bigint; failed: bigint; blocked: bigint }[]>`
        select count(*) filter (where result = 'signed_in')::bigint as ok,
               count(*) filter (where result in ('wrong_password', 'unknown_email', 'wrong_code'))::bigint as failed,
               count(*) filter (where result in ('locked', 'too_many'))::bigint as blocked
        from sign_ins where at >= ${since}`,
      db.platformAdmin.findMany({ where: { isActive: true }, select: { totpEnabledAt: true, lockedUntil: true } }),
      db.$queryRaw<{ company: string; users: bigint; without: bigint; managers: bigint }[]>`
        select c.name as company, count(*)::bigint as users,
               count(*) filter (where u.totp_enabled_at is null)::bigint as without,
               count(*) filter (where u.totp_enabled_at is null and u.role in ('admin', 'manager'))::bigint as managers
        from users u join companies c on c.id = u.company_id
        where u.is_active and c.status <> 'deleted'
        group by c.name order by 4 desc, 3 desc`,
      this.read<ServerStatus>("server.json"),
    ]);
    const c = counts[0];
    const all = users.reduce((a, r) => a + Number(r.users), 0);
    const without = users.reduce((a, r) => a + Number(r.without), 0);
    const managersWithout = users.reduce((a, r) => a + Number(r.managers), 0);
    const failed24h = Number(c?.failed ?? 0);
    const blocked24h = Number(c?.blocked ?? 0);
    const withTwoStep = admins.filter((a) => a.totpEnabledAt).length;
    const locked = admins.filter((a) => a.lockedUntil && a.lockedUntil > now).length;
    const u = server?.updates ?? null;
    const extra = (server?.ports ?? []).filter((p) => !OPEN_PORTS.includes(p));
    const checks: DevCheck[] = [
      {
        key: "sec-signins",
        lane: "server",
        name: "Failed sign-ins, 24 hours",
        line: `${failed24h} failed · ${blocked24h} blocked`,
        level: failed24h >= 50 || blocked24h >= 5 ? "warn" : "ok",
        tab: "security",
        fix: failed24h >= 50 ? "Many failed sign-ins: see which address they come from below." : undefined,
      },
      {
        key: "sec-admins",
        lane: "server",
        name: "Platform admins with two-step",
        line: `${withTwoStep} of ${admins.length}`,
        level: withTwoStep < admins.length ? "bad" : "ok",
        tab: "security",
        fix: withTwoStep < admins.length ? "Every platform admin needs two-step sign-in." : undefined,
      },
      {
        key: "sec-managers",
        lane: "server",
        name: "Managers without two-step",
        line: managersWithout ? `${managersWithout} of them` : "none",
        level: managersWithout ? "warn" : "ok",
        tab: "security",
        fix: managersWithout ? "Ask them to turn it on in My account (they see money and costs)." : undefined,
      },
      {
        key: "sec-updates",
        lane: "server",
        name: "Server updates",
        line: !u
          ? "not checked yet"
          : u.security
            ? `${u.security} security updates waiting`
            : u.reboot
              ? "a restart is needed"
              : "up to date",
        level: !u ? "off" : u.security || u.reboot ? "warn" : "ok",
        tab: "security",
        fix:
          u && (u.security || u.reboot)
            ? "On the server, at a quiet hour: sudo apt upgrade (or dnf upgrade), then sudo reboot."
            : undefined,
      },
      {
        key: "sec-ports",
        lane: "server",
        name: "Open to the internet",
        line: !server
          ? "not checked yet"
          : extra.length
            ? `also ${extra.join(", ")}`
            : `only ${(server.ports ?? []).join(", ") || "nothing"}`,
        level: !server ? "off" : extra.length ? "warn" : "ok",
        tab: "security",
        fix: extra.length ? "Close what should not be reachable (firewall, or bind it to 127.0.0.1)." : undefined,
      },
      {
        key: "sec-ssh",
        lane: "server",
        name: "SSH with a password",
        line: server?.sshPassword === false ? "off: keys only" : server?.sshPassword ? "on" : "not checked",
        level: server?.sshPassword ? "warn" : server?.sshPassword === false ? "ok" : "off",
        tab: "security",
        fix: server?.sshPassword ? "Turn it off (PasswordAuthentication no) so only SSH keys can sign in." : undefined,
      },
    ];
    return {
      signIns: {
        ok24h: Number(c?.ok ?? 0),
        failed24h,
        blocked24h,
        rows: rows.map((r) => ({
          result: SIGN_IN_TEXT[r.result] ?? r.result,
          who: maskEmail(r.email),
          company: r.company,
          ip: r.ip,
          times: Number(r.times),
          lastAt: r.last.toISOString(),
          level: r.result === "locked" || r.result === "too_many" ? "bad" : Number(r.times) >= 5 ? "warn" : "ok",
        })),
      },
      platformAdmins: { all: admins.length, withTwoStep, locked },
      users: { all, withoutTwoStep: without, managersWithout },
      withoutTwoStep: users
        .filter((r) => Number(r.without) > 0)
        .map((r) => ({ company: r.company, users: Number(r.without), of: Number(r.users), managers: Number(r.managers) })),
      server: {
        checkedAt: server?.at ?? null,
        updates: u,
        ports: server?.ports ?? null,
        firewall: server?.firewall ?? null,
        sshPassword: server?.sshPassword ?? null,
        certificates: server?.certificates ?? [],
      },
      checks,
    };
  }

  async companies(now = new Date()): Promise<DevCompaniesView> {
    const db = this.prisma.platform;
    const week = new Date(now.getTime() - 7 * DAY);
    const [companies, people, files, orders, errors, hours] = await Promise.all([
      db.company.findMany({
        where: { status: { not: "deleted" } },
        select: {
          id: true,
          name: true,
          slug: true,
          kind: true,
          status: true,
          endsAt: true,
          lastActiveAt: true,
          plan: { select: { name: true } },
        },
      }),
      db.$queryRaw<{ company_id: string; users: bigint; week: bigint; last: Date | null }[]>`
        select u.company_id, count(distinct u.id)::bigint as users,
               count(distinct u.id) filter (where s.last_seen_at >= ${week})::bigint as week,
               max(s.last_seen_at) as last
        from users u left join sessions s on s.user_id = u.id
        where u.is_active group by u.company_id`,
      db.$queryRaw<
        { company_id: string; bytes: bigint }[]
      >`select company_id, coalesce(sum(size), 0)::bigint as bytes from attachments where deleted_at is null group by company_id`,
      db.$queryRaw<{ company_id: string; n: bigint }[]>`select company_id, count(*)::bigint as n from orders group by company_id`,
      db.appError.groupBy({ by: ["companyName"], where: { lastAt: { gte: week } }, _sum: { count: true } }),
      db.$queryRaw<{ h: number; n: bigint }[]>`
        select extract(hour from minute at time zone ${this.env.APP_TIME_ZONE})::int as h, sum(count)::bigint as n
        from request_minutes where minute >= ${week} and route <> 'outside check' and route not like 'PAGE %' group by 1`,
    ]);
    const list: DevCompany[] = companies.map((c) => {
      const p = people.find((x) => x.company_id === c.id);
      const errs = errors.find((e) => e.companyName === c.name)?._sum.count ?? 0;
      const last = p?.last ?? c.lastActiveAt ?? null;
      const idle = !last || now.getTime() - last.getTime() > 7 * DAY;
      const ending = c.endsAt && c.endsAt.getTime() - now.getTime() < 7 * DAY && c.endsAt > now;
      let level: DevLevel = "ok";
      let note = "Fine";
      if (c.status === "off") [level, note] = ["off", "Switched off"];
      else if (errs) [level, note] = ["bad", `${errs} errors this week`];
      else if (idle) [level, note] = ["warn", last ? "Not used for a week" : "Never used"];
      else if (ending) [level, note] = ["warn", `${c.kind === "client" ? "Ends" : "Demo ends"} ${c.endsAt!.toISOString().slice(0, 10)}`];
      else if (c.status === "read_only") [level, note] = ["warn", "Read-only"];
      return {
        id: c.id,
        name: c.name,
        slug: c.slug,
        kind: c.kind,
        status: c.status,
        plan: c.plan?.name ?? null,
        endsAt: c.endsAt?.toISOString() ?? null,
        users: Number(p?.users ?? 0),
        usedThisWeek: Number(p?.week ?? 0),
        lastUsedAt: last?.toISOString() ?? null,
        errors7d: errs,
        filesMb: Math.round((Number(files.find((f) => f.company_id === c.id)?.bytes ?? 0) / 1048576) * 10) / 10,
        orders: Number(orders.find((o) => o.company_id === c.id)?.n ?? 0),
        level,
        note,
      };
    });
    const rank: Record<DevLevel, number> = { bad: 0, warn: 1, ok: 2, off: 3 };
    list.sort((a, b) => rank[a.level] - rank[b.level] || a.name.localeCompare(b.name));
    const busy = new Array(24).fill(0) as number[];
    for (const h of hours) busy[h.h] = Number(h.n);
    return { companies: list, busyHours: busy };
  }
}
