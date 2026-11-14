import { appendFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { currentStep, newTotpSecret, sealSecret, totpAt } from "../src/common/auth/totp";
import { PrismaService } from "../src/database/prisma.service";
import { buildChecks, fullIn, logLine, readLog, servicesFrom, type ServerStatus } from "../src/platform/dev-tools";
import { signIn, startApp } from "./app";

const NOW = new Date("2026-11-15T02:44:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60000).toISOString();

const status = (patch: Partial<ServerStatus> = {}): ServerStatus => ({
  at: ago(1),
  host: { os: "Ubuntu 24.04", uptimeSec: 86400 * 23, docker: "28.1", cores: 4 },
  cpu: { percent: 18, load5: 0.4 },
  memory: { totalMb: 8192, usedMb: 5222, percent: 64 },
  disk: { totalGb: 100, usedGb: 81, freeGb: 19, percent: 81 },
  services: ["web", "api", "worker", "db", "minio", "backup", "proxy"].map((name) => ({
    name,
    id: `${name}1`,
    state: "running",
    health: name === "api" || name === "db" ? "healthy" : null,
    startedAt: ago(60 * 24 * 6),
    restarts: 0,
    memMb: 100,
    memLimitMb: 512,
  })),
  ports: [22, 80, 443],
  firewall: "on",
  updates: { all: 10, security: 6, reboot: true },
  certificates: [{ host: "rfq.example.com", ok: true, endsAt: "2027-02-02T00:00:00Z" }],
  ...patch,
});

describe("dev tools: the checks", () => {
  const base = (s: ServerStatus | null, extra: Partial<Parameters<typeof buildChecks>[0]> = {}) =>
    buildChecks({
      now: NOW,
      status: s,
      services: servicesFrom(s, [], [], NOW),
      cpu15: 18,
      backup: { at: ago(45), ok: true, lastGoodAt: ago(45), offsite: "ok" },
      database: { ok: true, connections: 23, maxConnections: 200 },
      ownDomains: { connected: 1, lost: 0, waiting: 0 },
      lastDeploy: { at: ago(400), commit: "cccd796", title: "Messages, part 2", ok: true },
      ...extra,
    });
  const by = (checks: ReturnType<typeof buildChecks>, key: string) => checks.find((c) => c.key === key)!;

  it("says what is fine, what needs you this week, and what needs you now", () => {
    const c = base(status());
    expect(by(c, "disk")).toMatchObject({ level: "warn", line: "81% full · 19 GB free", tab: "data" });
    expect(by(c, "updates")).toMatchObject({ level: "warn", line: "6 security updates waiting" });
    expect(by(c, "cpu")).toMatchObject({ level: "ok", line: "18% · 4 cores" });
    expect(by(c, "api")).toMatchObject({ level: "ok", line: "running for 6 days" });
    expect(by(c, "backup")).toMatchObject({ level: "ok", line: "last good 45 min ago" });
    expect(by(c, "certs")).toMatchObject({ level: "ok", line: "1 · first ends 02 Feb 2027" });
    expect(by(c, "ports")).toMatchObject({ level: "ok", line: "only 22, 80, 443 · firewall on" });
    expect(c.find((x) => x.key === "status")).toBeUndefined();
    // Every check that needs you says what to do.
    for (const x of c.filter((x) => x.level === "warn" || x.level === "bad")) expect(x.fix, x.key).toBeTruthy();
  });

  it("is red when a service stopped, the disk is 90% full, or the backup is old", () => {
    const s = status({ disk: { totalGb: 100, usedGb: 92, freeGb: 8, percent: 92 } });
    s.services!.find((x) => x.name === "worker")!.state = "exited";
    const c = base(s, { backup: { at: ago(30 * 60), ok: false, lastGoodAt: ago(30 * 60), offsite: "ok", message: "pg_dump failed" } });
    expect(by(c, "worker")).toMatchObject({ level: "bad", line: "stopped" });
    expect(by(c, "disk").level).toBe("bad");
    expect(by(c, "backup")).toMatchObject({ level: "bad", line: "last good 30 hours ago · last try failed" });
  });

  it("knows when the server's status stopped coming, and when it was never set up", () => {
    expect(by(base(status({ at: ago(12) })), "status")).toMatchObject({ level: "bad", line: "last written 12 min ago" });
    const none = base(null, { backup: null, lastDeploy: null });
    expect(by(none, "status")).toMatchObject({ level: "off", line: "not set up yet" });
    expect(by(none, "web").level).toBe("off");
  });

  it("warns about a port open to the outside and a certificate ending soon", () => {
    const c = base(status({ ports: [22, 80, 443, 5432], certificates: [{ host: "a.example.com", ok: true, endsAt: "2026-11-25T00:00:00Z" }] }));
    expect(by(c, "ports")).toMatchObject({ level: "warn", line: "5432 open to the outside" });
    expect(by(c, "certs").level).toBe("warn");
  });

  it("counts a restart today and says why", () => {
    const s = status();
    const svc = servicesFrom(s, [{ at: ago(300), service: "worker", kind: "restarted", why: "out of memory" }], ["worker"], NOW);
    const w = svc.find((x) => x.key === "worker")!;
    expect(w).toMatchObject({ level: "warn", status: "Restarted 1 time today", restarts24h: 1, lastRestart: { why: "out of memory" }, hasLog: true });
    expect(svc.map((x) => x.label)).toEqual(["Web", "API", "Worker", "Database", "Files", "Backup", "Address server"]);
  });

  it("says when the disk is full at the growth of the last two weeks", () => {
    const days = Array.from({ length: 15 }, (_, k) => ({ day: `2026-11-${String(k + 1).padStart(2, "0")}`, usedGb: 72 + k * 0.6 }));
    expect(fullIn(days, 19)).toEqual({ days: 31, perDay: 0.6 });
    expect(fullIn(days.map((d) => ({ ...d, usedGb: 80 })), 19).days).toBeNull();
  });
});

describe("dev tools: live logs", () => {
  it("reads the end of a log, then only what was written since", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "logs-"));
    const file = path.join(dir, "api.log");
    await writeFile(file, "2026-11-15T02:40:00.123456789Z [Nest] LOG started\n2026-11-15T02:41:00.000000001Z \u001b[31mERROR\u001b[39m cannot read currency\n");
    const first = await readLog(dir, "api", null);
    expect(first.lines).toEqual([
      { at: "2026-11-15T02:40:00.123Z", text: "[Nest] LOG started", level: null },
      { at: "2026-11-15T02:41:00.000Z", text: "ERROR cannot read currency", level: "error" },
    ]);
    expect((await readLog(dir, "api", first.next)).lines).toEqual([]);
    // A line still being written waits for the next read.
    await appendFile(file, "2026-11-15T02:42:00Z WARN slow query\n2026-11-15T02:42:01Z half");
    const second = await readLog(dir, "api", first.next);
    expect(second.lines.map((l) => [l.text, l.level])).toEqual([["WARN slow query", "warn"]]);
    await appendFile(file, " a line\n");
    expect((await readLog(dir, "api", second.next)).lines.map((l) => l.text)).toEqual(["half a line"]);
    expect((await readLog(dir, "nothing", null)).missing).toBe(true);
    expect(logLine('{"level":"error","msg":"tls failed"}').level).toBe("error");
  });
});

describe("dev tools: the pages' data", () => {
  let app: INestApplication;
  let token: string;
  let company: string;
  const tag = Date.now().toString(36);
  const secret = newTotpSecret();
  const get = (url: string, t = token) => request(app.getHttpServer()).get(`/api/platform/dev-tools${url}`).set("authorization", `Bearer ${t}`);

  beforeAll(async () => {
    const statusDir = await mkdtemp(path.join(tmpdir(), "status-"));
    const logsDir = await mkdtemp(path.join(tmpdir(), "live-"));
    await writeFile(path.join(statusDir, "server.json"), JSON.stringify(status({ at: new Date().toISOString() })));
    await writeFile(path.join(statusDir, "deploys.jsonl"), `${JSON.stringify({ at: new Date().toISOString(), commit: "abc1234", title: "Dev tools", ok: true })}\n`);
    await writeFile(path.join(statusDir, "last-status.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, lastGoodAt: new Date().toISOString(), offsite: "off" }));
    await writeFile(path.join(logsDir, "api.log"), `${new Date().toISOString()} hello from the api\n`);
    process.env.SERVER_STATUS_DIR = statusDir;
    process.env.LIVE_LOGS_DIR = logsDir;
    app = await startApp();
    const prisma = app.get(PrismaService);
    const email = `dev-tools-${tag}@example.com`;
    await prisma.platform.platformAdmin.create({
      data: { email, name: "Dev Tester", passwordHash: await bcrypt.hash("Platform12345", 10), totpSecret: sealSecret(secret, process.env.AUTH_SECRET!), totpEnabledAt: new Date() },
    });
    const login = (await request(app.getHttpServer()).post("/api/platform/auth/login").send({ email, password: "Platform12345" }).expect(200)).body;
    await request(app.getHttpServer()).post("/api/platform/auth/two-step").set("authorization", `Bearer ${login.token}`).send({ code: totpAt(secret, currentStep()) }).expect(200);
    token = login.token;
    company = await signIn(app, "admin@example.com", "Admin@12345");
  });

  afterAll(async () => {
    delete process.env.SERVER_STATUS_DIR;
    delete process.env.LIVE_LOGS_DIR;
    await app?.close();
  });

  it("shows the big picture, the services, the data and a live log to platform admins only", async () => {
    const o = (await get("/overview").expect(200)).body;
    expect(o.stale).toBe(false);
    expect(o.checks.find((c: { key: string }) => c.key === "offsite")).toMatchObject({ level: "warn" });
    expect(o.checks.find((c: { key: string }) => c.key === "db")).toMatchObject({ level: "ok" });
    expect(o.deploys[0]).toMatchObject({ commit: "abc1234" });
    expect(o.events.some((e: { kind: string }) => e.kind === "deploy")).toBe(true);
    const s = (await get("/services").expect(200)).body;
    expect(s.services.find((x: { key: string }) => x.key === "api")).toMatchObject({ label: "API", hasLog: true });
    expect(s.logs).toEqual(["api"]);
    const d = (await get("/data").expect(200)).body;
    expect(d.database.ok).toBe(true);
    expect(d.database.tables.length).toBeGreaterThan(0);
    expect(d.backup.offsite).toBe("off");
    const l = (await get("/logs?service=api").expect(200)).body;
    expect(l.lines[0].text).toBe("hello from the api");
    await get("/logs?service=../etc").expect(400);
    // A company's user, or nobody: not allowed.
    await get("/overview", company).expect(401);
  });
});
