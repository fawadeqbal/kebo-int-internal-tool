import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { currentStep, newTotpSecret, sealSecret, totpAt } from "../src/common/auth/totp";
import { PrismaService } from "../src/database/prisma.service";
import { addDays, todayIn } from "@kebo/utils";
import { signIn, startApp } from "./app";

/**
 * The platform's other pages (approved page 30, items 2–6): the overview's
 * figures, the menu's counts, Platform settings, the platform log as a list
 * (search, kinds with counts, pages), and the client inquiry's changes (only
 * the fields sent change) and its demo's sign-ins. Platform admins only.
 */
describe("platform: overview, settings, log and client inquiries", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let platform: string;
  const tag = Date.now().toString(36);
  const secret = newTotpSecret();

  const plat = (token = platform) => {
    const server = app.getHttpServer();
    const auth = (r: request.Test) => r.set("authorization", `Bearer ${token}`);
    return {
      get: (url: string) => auth(request(server).get(`/api/platform${url}`)),
      post: (url: string, body?: object) => auth(request(server).post(`/api/platform${url}`)).send(body ?? {}),
      patch: (url: string, body?: object) => auth(request(server).patch(`/api/platform${url}`)).send(body ?? {}),
    };
  };

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);
    const email = `platform-rest-${tag}@example.com`;
    await prisma.platform.platformAdmin.create({
      data: {
        email,
        name: "Rest Tester",
        passwordHash: await bcrypt.hash("Platform12345", 10),
        totpSecret: sealSecret(secret, process.env.AUTH_SECRET!),
        totpEnabledAt: new Date(),
      },
    });
    const login = (
      await request(app.getHttpServer()).post("/api/platform/auth/login").send({ email, password: "Platform12345" }).expect(200)
    ).body;
    await request(app.getHttpServer())
      .post("/api/platform/auth/two-step")
      .set("authorization", `Bearer ${login.token}`)
      .send({ code: totpAt(secret, currentStep()) })
      .expect(200);
    platform = login.token;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("the overview's figures: paying companies, income, renewals, demos, new inquiries, what to watch", async () => {
    const plans = (await plat().get("/plans").expect(200)).body as { id: string; name: string; priceMinor: number; currency: string }[];
    const team = plans.find((p) => p.name === "Team")!;
    // The platform's days are in the business time zone.
    const today = todayIn(process.env.APP_TIME_ZONE ?? "Asia/Shanghai");
    const inDays = (n: number) => addDays(today, n);
    const before = (await plat().get("/overview").expect(200)).body.dashboard;
    const c = (
      await plat()
        .post("/companies", {
          name: `Dash ${tag}`,
          slug: `dash-${tag}`,
          adminName: "Boss",
          adminEmail: `boss@dash-${tag}.test`,
          sampleData: false,
          kind: "client",
          planId: team.id,
        })
        .expect(201)
    ).body;
    await plat()
      .post(`/companies/${c.id}/payments`, { amount: 99, currency: "USD", paidOn: today, paidUntil: inDays(10) })
      .expect(201);
    const d = (await plat().get("/overview").expect(200)).body.dashboard;
    expect(d.paying).toBe(before.paying + 1);
    expect(d.payingNewThisMonth).toBe(before.payingNewThisMonth + 1);
    const usd = (m: { currency: string; amountMinor: number }[]) => m.find((x) => x.currency === "USD")?.amountMinor ?? 0;
    expect(usd(d.incomeThisMonth)).toBe(usd(before.incomeThisMonth) + 9900);
    expect(d.renewals).toBe(before.renewals + 1);
    expect(usd(d.renewalsDue)).toBe(usd(before.renewalsDue) + team.priceMinor);
    expect(d.watch).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: c.id, reason: "renews", plan: "Team", date: inDays(10) })]),
    );
    // Overdue: on the watch list first, and in the overdue list with its days.
    await plat()
      .patch(`/companies/${c.id}`, { renewsOn: inDays(-3) })
      .expect(200);
    const o = (await plat().get("/overview").expect(200)).body.dashboard;
    expect(o.overdue).toEqual(expect.arrayContaining([{ id: c.id, name: `Dash ${tag}`, days: 3 }]));
    expect(o.watch.find((w: { id: string }) => w.id === c.id).reason).toBe("overdue");
    expect(o).toMatchObject({
      trials: expect.any(Number),
      trialsEndingThisWeek: expect.any(Number),
      newLeads: expect.any(Number),
      leadsThisWeek: expect.any(Number),
      serverWarnings: expect.any(Array),
    });
  });

  it("the menu's counts and the settings page's data", async () => {
    const counts = (await plat().get("/counts").expect(200)).body;
    expect(counts).toEqual({ companies: expect.any(Number), newLeads: expect.any(Number), plans: expect.any(Number) });
    expect(counts.plans).toBeGreaterThanOrEqual(4);
    const s = (await plat().get("/settings").expect(200)).body;
    expect(s).toMatchObject({
      signUpOpen: expect.any(Boolean),
      emailOn: expect.any(Boolean),
      botCheck: expect.any(Boolean),
      inquiriesPerHour: expect.any(Number),
      timeZone: expect.any(String),
    });
    const me = s.admins.find((a: { email: string }) => a.email === `platform-rest-${tag}@example.com`);
    expect(me).toMatchObject({ name: "Rest Tester", active: true, twoStepOn: true });
    // Never a secret.
    expect(JSON.stringify(s)).not.toMatch(/passwordHash|totpSecret|password_hash/);
  });

  it("the platform log: newest first, 25 a page, search, kinds with counts", async () => {
    const lead = (
      await plat()
        .post("/leads", { companyName: `Log Co ${tag}`, name: "Logger", email: `log-${tag}@example.com` })
        .expect(201)
    ).body;
    const all = (await plat().get("/log").expect(200)).body;
    expect(all).toMatchObject({ page: 1, pageSize: 25, kind: null });
    expect(all.rows.length).toBeLessThanOrEqual(25);
    expect(all.counts.all).toBe(all.total);
    const found = (
      await plat()
        .get(`/log?q=${encodeURIComponent(`Log Co ${tag}`)}`)
        .expect(200)
    ).body;
    expect(found.total).toBe(1);
    expect(found.rows[0]).toMatchObject({ leadId: lead.id, action: "lead" });
    const inquiries = (await plat().get(`/log?kind=inquiries&q=${tag}`).expect(200)).body;
    expect(inquiries.kind).toBe("inquiries");
    expect(inquiries.rows.every((r: { action: string }) => r.action.startsWith("lead"))).toBe(true);
    expect(inquiries.counts.inquiries).toBe(inquiries.total);
    const companies = (await plat().get(`/log?kind=companies&q=${tag}`).expect(200)).body;
    expect(companies.rows.every((r: { action: string }) => !r.action.startsWith("lead"))).toBe(true);
    // One company's entries, as before.
    const two = (await plat().get("/log?page=2").expect(200)).body;
    expect(two.page).toBe(2);
    if (all.total > 25) expect(two.rows[0].id).not.toBe(all.rows[0].id);
  });

  it("a client inquiry changes only the fields sent (a status change keeps the phone and the follow-up)", async () => {
    const lead = (
      await plat()
        .post("/leads", {
          companyName: `Keep ${tag}`,
          name: "Keeper",
          email: `keep-${tag}@example.com`,
          phone: "+92 300 1",
          country: "Pakistan",
          teamSize: "6-20",
          message: "Quotes",
        })
        .expect(201)
    ).body;
    await plat().patch(`/leads/${lead.id}`, { followUpOn: "2026-12-01" }).expect(200);
    const moved = (await plat().patch(`/leads/${lead.id}`, { status: "contacted" }).expect(200)).body;
    expect(moved).toMatchObject({
      status: "contacted",
      phone: "+92 300 1",
      country: "Pakistan",
      followUpOn: "2026-12-01",
      teamSize: "6-20",
      message: "Quotes",
    });
    // Who and what they need, from their panels; empty clears.
    const who = (
      await plat()
        .patch(`/leads/${lead.id}`, {
          companyName: `Kept ${tag}`,
          name: "Keeper Two",
          email: `kept-${tag}@example.com`,
          phone: "",
          country: "UAE",
          teamSize: "",
        })
        .expect(200)
    ).body;
    expect(who).toMatchObject({
      companyName: `Kept ${tag}`,
      name: "Keeper Two",
      phone: null,
      country: "UAE",
      teamSize: null,
      followUpOn: "2026-12-01",
      status: "contacted",
    });
    const need = (await plat().patch(`/leads/${lead.id}`, { message: "Quotes and LC papers" }).expect(200)).body;
    expect(need.message).toBe("Quotes and LC papers");
    // Lost needs a reason.
    await plat().patch(`/leads/${lead.id}`, { status: "lost" }).expect(400);
    expect((await plat().patch(`/leads/${lead.id}`, { status: "lost", lostReason: "Too dear" }).expect(200)).body).toMatchObject({
      status: "lost",
      lostReason: "Too dear",
    });
    // Their demo, and how often its people signed in.
    await plat().patch(`/leads/${lead.id}`, { status: "contacted" }).expect(200);
    await plat()
      .post(`/leads/${lead.id}/demo`, { days: 2, sampleData: false, slug: `keep-${tag}-demo` })
      .expect(201);
    const withDemo = (await plat().get(`/leads/${lead.id}`).expect(200)).body;
    expect(withDemo.company).toMatchObject({ slug: `keep-${tag}-demo`, kind: "demo", signIns: 0 });
  });

  it("is for platform admins only", async () => {
    const server = app.getHttpServer();
    for (const path of ["/overview", "/counts", "/settings", "/log", "/log?kind=server"])
      await request(server).get(`/api/platform${path}`).expect(401);
    const manager = await signIn(app, "manager@example.com", "Manager@12345");
    for (const path of ["/counts", "/settings"])
      await request(server).get(`/api/platform${path}`).set("authorization", `Bearer ${manager}`).expect(401);
  });
});
