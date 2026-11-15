import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "@kebo/database";
import type { Env } from "../src/config/env";
import type { PrismaService } from "../src/database/prisma.service";
import type { PlatformMail } from "../src/platform/platform-mail";
import {
  serverWarnings,
  ServerHealthService,
  warningsToSend,
  workerSilence,
  type BackupStatus,
  type Read,
} from "../src/platform/server-health";

const now = new Date("2026-11-20T08:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
const ok = <T>(value: T): Read<T> => ({ state: "ok", value });
const missing = { state: "missing" } as const;
const keys = (input: Partial<Parameters<typeof serverWarnings>[0]>) =>
  serverWarnings({ now, watchingSince: new Date(hoursAgo(1)), backup: missing, disk: missing, ...input }).map((w) => w.key);
const backup = (b: Partial<BackupStatus>) =>
  ok<BackupStatus>({ at: hoursAgo(5), ok: true, lastGoodAt: hoursAgo(5), offsite: "ok", offsiteAt: hoursAgo(5), ...b });

describe("server check: what is a problem", () => {
  it("a good backup from last night is fine", () => {
    expect(keys({ backup: backup({}) })).toEqual([]);
    expect(keys({ backup: backup({ offsite: "ok", lastGoodAt: hoursAgo(25) }) })).toEqual([]);
  });

  it("the last good backup more than 26 hours old", () => {
    expect(keys({ backup: backup({ lastGoodAt: hoursAgo(27) }) })).toEqual(["backup_old"]);
    expect(
      keys({ backup: backup({ ok: false, at: hoursAgo(1), lastGoodAt: hoursAgo(50), message: "Could not dump the database" }) }),
    ).toEqual(["backup_old"]);
    // Never a good one.
    expect(keys({ backup: backup({ ok: false, lastGoodAt: null }) })).toEqual(["backup_old"]);
  });

  it("the last run failed, even with an older good one still recent", () => {
    expect(
      keys({ backup: backup({ ok: false, at: hoursAgo(1), lastGoodAt: hoursAgo(20), message: "Could not check the database dump" }) }),
    ).toEqual(["backup_failed"]);
  });

  it("the off-site copy failed (the local dump was made)", () => {
    const w = serverWarnings({
      now,
      watchingSince: now,
      disk: missing,
      backup: backup({ ok: false, offsite: "failed", dump: "db-x.sql.gz", message: "Could not copy the backup off-site" }),
    });
    expect(w.map((x) => x.key)).toEqual(["offsite_failed"]);
    expect(w[0].detail).toContain("db-x.sql.gz");
  });

  it("no off-site copy set up: the backups are on the server only", () => {
    const w = serverWarnings({ now, watchingSince: now, disk: missing, backup: backup({ offsite: "off", offsiteAt: null }) });
    expect(w.map((x) => x.key)).toEqual(["offsite_off"]);
    expect(w[0]!.detail).toContain("deploy/server/enable-offsite.sh");
  });

  it("the off-site copy more than a day old; a failed one says when it last worked", () => {
    // Set up, but the last runs did not get to it (they failed before).
    expect(keys({ backup: backup({ offsite: "pending", offsiteAt: hoursAgo(30) }) })).toEqual(["offsite_old"]);
    expect(keys({ backup: backup({ offsite: "pending", offsiteAt: hoursAgo(20) }) })).toEqual([]);
    // A status from before offsiteAt was written: the run that made it "ok" is when.
    expect(keys({ backup: backup({ offsite: "ok", offsiteAt: undefined, at: hoursAgo(3) }) })).toEqual([]);
    const failed = serverWarnings({
      now,
      watchingSince: now,
      disk: missing,
      backup: backup({ ok: false, offsite: "failed", offsiteAt: hoursAgo(60) }),
    });
    expect(failed.map((x) => x.key)).toEqual(["offsite_failed"]);
    expect(failed[0]!.detail).toContain("Last good off-site copy: 2 days ago");
  });

  it("a background job slower than its beat (its last run, in the last day)", () => {
    const run = (job: string, tookMs: number, beatMs: number, startedHoursAgo = 1) => ({
      job,
      label: job,
      startedAt: hoursAgo(startedHoursAgo),
      tookMs,
      beatMs,
    });
    expect(keys({ backup: backup({}), jobs: [run("Follow-up reminders", 40_000, 300_000)] })).toEqual([]);
    const w = serverWarnings({
      now,
      watchingSince: now,
      disk: missing,
      backup: backup({}),
      jobs: [run("Follow-up reminders", 420_000, 300_000)],
    });
    expect(w.map((x) => x.key)).toEqual(["job_slow"]);
    expect(w[0]!.title).toBe("A background job is slower than its beat: Follow-up reminders");
    expect(w[0]!.detail).toContain("Follow-up reminders took 7 min (it runs every 5 min)");
    expect(keys({ backup: backup({}), jobs: [run("Reminders", 4 * 3_600_000, 3_600_000, 30)] })).toEqual([]);
  });

  it("the quarterly rebuild from the off-site copy failed (within the week)", () => {
    const restore = (worked: boolean, at: string) =>
      ok<{ at: string; ok: boolean; message: string }>({ at, ok: worked, message: "Could not fetch db-x.sql.gz from the off-site store." });
    expect(keys({ backup: backup({}), offsiteRestore: restore(false, hoursAgo(10)) })).toEqual(["offsite_restore_failed"]);
    expect(keys({ backup: backup({}), offsiteRestore: restore(false, hoursAgo(24 * 8)) })).toEqual([]);
    expect(keys({ backup: backup({}), offsiteRestore: restore(true, hoursAgo(10)) })).toEqual([]);
  });

  it("the outside watcher: a worker that finished no job for an hour is stopped", () => {
    expect(workerSilence(null, now)).toBeNull();
    expect(workerSilence(new Date(now.getTime() - 59 * 60_000), now)).toBeNull();
    expect(workerSilence(new Date(now.getTime() - 75 * 60_000), now)).toMatch(/^The background worker has finished no job for 75 minutes/);
  });

  it("no status file: only once a backup should have run since the worker started", () => {
    expect(keys({ watchingSince: new Date(hoursAgo(2)) })).toEqual([]);
    expect(keys({ watchingSince: new Date(hoursAgo(30)) })).toEqual(["backup_old"]);
    expect(keys({ backup: { state: "unreadable", error: "Unexpected end of JSON input" } })).toEqual(["status_unreadable"]);
  });

  it("the disk 80% full or more (from a recent check)", () => {
    expect(keys({ backup: backup({}), disk: ok({ at: hoursAgo(4), percent: 79, freeGb: 20 }) })).toEqual([]);
    expect(keys({ backup: backup({}), disk: ok({ at: hoursAgo(4), percent: 85, freeGb: 9 }) })).toEqual(["disk_full"]);
    expect(keys({ backup: backup({}), disk: ok({ at: hoursAgo(100), percent: 85 }) })).toEqual([]);
  });

  it("each problem is emailed at most once a day", () => {
    const w = serverWarnings({
      now,
      watchingSince: now,
      disk: ok({ at: hoursAgo(1), percent: 90 }),
      backup: backup({ lastGoodAt: hoursAgo(40) }),
    });
    expect(warningsToSend(w, new Map(), now).map((x) => x.key)).toEqual(["backup_old", "disk_full"]);
    const sent = new Map([["backup_old", new Date(hoursAgo(3))]]);
    expect(warningsToSend(w, sent, now).map((x) => x.key)).toEqual(["disk_full"]);
    sent.set("backup_old", new Date(hoursAgo(24)));
    expect(warningsToSend(w, sent, now).map((x) => x.key)).toEqual(["backup_old", "disk_full"]);
  });
});

describe("server check: the worker's run", () => {
  const db = createPrismaClient({ url: process.env.DATABASE_URL!, poolSize: 1 });
  const sent: { subject: string; body?: string | null }[] = [];
  const mail = {
    toAdmins: async (e: { subject: string; body?: string | null }) => void sent.push(e),
    when: (d: Date) => d.toISOString(),
  } as unknown as PlatformMail;
  let dir: string;
  const service = (statusDir?: string) =>
    new ServerHealthService({ platform: db } as unknown as PrismaService, mail, {
      APP_URL: "https://rfq.test",
      SERVER_STATUS_DIR: statusDir,
    } as Env);
  const clear = () => db.platformLog.deleteMany({ where: { action: "server_warning" } });

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "kebo-status-"));
    await clear();
  });
  afterAll(async () => {
    await clear();
    await db.$disconnect();
    await rm(dir, { recursive: true, force: true });
  });

  it("does nothing without SERVER_STATUS_DIR", async () => {
    expect(await service(undefined).run(now)).toEqual([]);
  });

  it("emails a failed off-site copy once, notes it in the platform log, and again a day later", async () => {
    await writeFile(
      path.join(dir, "last-status.json"),
      JSON.stringify({
        at: hoursAgo(1),
        ok: false,
        message: "Could not copy the backup off-site (exit code 1).",
        lastGoodAt: hoursAgo(1),
        dump: "db-1.sql.gz",
        offsite: "failed",
      }),
    );
    await writeFile(path.join(dir, "disk.json"), JSON.stringify({ at: hoursAgo(2), percent: 42, freeGb: 60 }));
    const s = service(dir);
    expect((await s.run(now)).map((w) => w.key)).toEqual(["offsite_failed"]);
    expect(sent.map((e) => e.subject)).toEqual(["RFQ Desk server: The off-site copy of the backup failed"]);
    expect(sent[0].body).toContain("Could not copy the backup off-site");
    const logged = await db.platformLog.findMany({ where: { action: "server_warning" } });
    expect(logged.map((l) => l.summary)).toEqual(["Server: The off-site copy of the backup failed"]);
    // An hour later: already told.
    expect(await s.run(new Date(now.getTime() + 3_600_000))).toEqual([]);
    expect(sent).toHaveLength(1);
  });

  it("a good backup again: nothing to send", async () => {
    await writeFile(
      path.join(dir, "last-status.json"),
      JSON.stringify({ at: hoursAgo(1), ok: true, lastGoodAt: hoursAgo(1), offsite: "ok" }),
    );
    expect(await service(dir).run(now)).toEqual([]);
  });

  it("a broken status file is a problem too", async () => {
    await writeFile(path.join(dir, "last-status.json"), "{");
    expect((await service(dir).run(now)).map((w) => w.key)).toEqual(["status_unreadable"]);
  });
});
