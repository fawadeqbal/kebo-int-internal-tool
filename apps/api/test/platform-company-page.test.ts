import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { currentStep, newTotpSecret, sealSecret, totpAt } from "../src/common/auth/totp";
import { PrismaService } from "../src/database/prisma.service";
import { modulesOffSince } from "../src/platform/companies.platform";
import { api, signIn, startApp } from "./app";

/**
 * The platform admin's company page (record frame with sections): the data it
 * needs that the API did not give before — the people's two-step sign-in, who
 * signed in this week, open orders, customers and factories, the plan's price,
 * the company's own details (read-only), its address, when each module was
 * switched off, the main contact's phone, and the whole history by kind. Only
 * for platform admins.
 */
describe("platform: the company page's data", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let platform: string;
  let companyId: string;
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
    const email = `platform-page-${tag}@example.com`;
    await prisma.platform.platformAdmin.create({
      data: {
        email,
        name: "Page Tester",
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
    const made = (
      await plat()
        .post("/companies", {
          name: `Page Co ${tag}`,
          slug: `page-${tag}`,
          adminName: "Boss Page",
          adminEmail: `boss@page-${tag}.test`,
          sampleData: true,
          kind: "client",
        })
        .expect(201)
    ).body;
    companyId = made.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("gives the page what it shows: people with two-step, activity, plan price, own details, address", async () => {
    const plans = (await plat().get("/plans").expect(200)).body as { id: string; name: string; priceMinor: number }[];
    const team = plans.find((p) => p.name === "Team")!;
    await plat().patch(`/companies/${companyId}`, { planId: team.id, contactPhone: "+92 300 1234567" }).expect(200);
    const c = (await plat().get(`/companies/${companyId}`).expect(200)).body;

    expect(c.plan).toMatchObject({ name: "Team", priceMinor: team.priceMinor, currency: expect.any(String), period: expect.any(String) });
    expect(c.contactPhone).toBe("+92 300 1234567");
    expect(c.address).toMatch(/^https?:\/\//);
    // Its own details (Settings → Company): the name it was made with.
    expect(c.profile).toMatchObject({ legalName: `Page Co ${tag}` });

    const a = c.activity;
    expect(a).toMatchObject({
      signInsLast30Days: expect.any(Number),
      signedInThisWeek: expect.any(Number),
      openOrders: expect.any(Number),
      customers: expect.any(Number),
      factories: expect.any(Number),
      twoStepOff: expect.any(Number),
    });
    // The sample data has customers, factories and open orders.
    expect(a.customers).toBeGreaterThan(0);
    expect(a.factories).toBeGreaterThan(0);
    expect(a.openOrders).toBeGreaterThan(0);
    expect(a.openOrders).toBeLessThanOrEqual(a.orders);
    // Every person says whether two-step sign-in is on; nobody has it yet in a new company.
    expect(a.people.length).toBeGreaterThan(0);
    for (const p of a.people) expect(p).toMatchObject({ twoStep: false, locked: false });
    expect(a.twoStepOff).toBe(a.people.filter((p: { active: boolean }) => p.active).length);
    expect(a.people.find((p: { tenantAdmin: boolean }) => p.tenantAdmin)?.email).toBe(`boss@page-${tag}.test`);

    // Two-step on for the tenant admin: counted.
    const boss = a.people.find((p: { tenantAdmin: boolean }) => p.tenantAdmin);
    await prisma.platform
      .$executeRaw`update users set totp_enabled_at = now() where id = ${boss.id}::uuid and company_id = ${companyId}::uuid`;
    const again = (await plat().get(`/companies/${companyId}`).expect(200)).body.activity;
    expect(again.people.find((p: { id: string }) => p.id === boss.id).twoStep).toBe(true);
    expect(again.twoStepOff).toBe(a.twoStepOff - 1);

    // A sign-in of a person counts for the week and names the last person active.
    await prisma.platform
      .$executeRaw`insert into sign_ins (id, company_id, user_id, email, result, ip) values (gen_random_uuid(), ${companyId}::uuid, ${boss.id}::uuid, ${boss.email}, 'signed_in', '127.0.0.1')`;
    const week = (await plat().get(`/companies/${companyId}`).expect(200)).body.activity;
    expect(week.signedInThisWeek).toBe(1);
    expect(week.lastSignIn).toMatchObject({ email: boss.email, name: boss.name });
  });

  it("says when and by whom each module now off was switched off", async () => {
    await plat()
      .patch(`/companies/${companyId}`, { featuresOff: ["shipping"] })
      .expect(200);
    await plat()
      .patch(`/companies/${companyId}`, { featuresOff: ["shipping", "delivery_sat"] })
      .expect(200);
    const c = (await plat().get(`/companies/${companyId}`).expect(200)).body;
    const by = Object.fromEntries((c.modulesOff as { feature: string; at: string; by: string }[]).map((m) => [m.feature, m]));
    expect(by.shipping.by).toBe("Page Tester");
    expect(by.delivery_sat.by).toBe("Page Tester");
    // Shipping went off first.
    expect(new Date(by.shipping.at).getTime()).toBeLessThanOrEqual(new Date(by.delivery_sat.at).getTime());
    await plat().patch(`/companies/${companyId}`, { featuresOff: [] }).expect(200);
    expect((await plat().get(`/companies/${companyId}`).expect(200)).body.modulesOff).toEqual([]);
  });

  it("reads older log entries (no details) for module dates too", () => {
    const at = (d: string) => new Date(d);
    const log = [
      {
        at: at("2026-11-03"),
        adminName: "B",
        summary: "Changed X: modules switched off: excel templates, uploads and exports, shipping",
        details: null,
      },
      { at: at("2026-11-02"), adminName: "A", summary: "Changed X: modules switched off: shipping", details: null },
      { at: at("2026-11-01"), adminName: "A", summary: "Changed X: every module of the plan switched on", details: null },
      { at: at("2026-10-01"), adminName: "Z", summary: "Changed X: modules switched off: shipping", details: null },
    ];
    expect(modulesOffSince(["shipping", "excel"], log)).toEqual([
      { feature: "shipping", at: at("2026-11-02"), by: "A" },
      { feature: "excel", at: at("2026-11-03"), by: "B" },
    ]);
  });

  it("gives the whole history, by kind, with counts", async () => {
    await plat()
      .post(`/companies/${companyId}/payments`, { amount: 99, currency: "USD", paidOn: "2026-11-01", paidUntil: "2026-12-01" })
      .expect(201);
    const all = (await plat().get(`/companies/${companyId}/history`).expect(200)).body;
    expect(all.kind).toBeNull();
    expect(all.counts.all).toBe(all.rows.length);
    expect(all.counts.payments).toBe(1);
    expect(all.counts.changes).toBeGreaterThanOrEqual(1);
    const pays = (await plat().get(`/companies/${companyId}/history?kind=payments`).expect(200)).body;
    expect(pays.kind).toBe("payments");
    expect(pays.rows.map((r: { action: string }) => r.action)).toEqual(["payment"]);
    expect(pays.counts).toEqual(all.counts);
    // The detail page's count matches.
    expect((await plat().get(`/companies/${companyId}`).expect(200)).body.logCount).toBe(all.counts.all);
    await plat().get(`/companies/00000000-0000-4000-8000-000000000000/history`).expect(404);
  });

  it("is for platform admins only", async () => {
    const server = app.getHttpServer();
    await request(server).get(`/api/platform/companies/${companyId}/history`).expect(401);
    await request(server).get(`/api/platform/companies/${companyId}`).expect(401);
    const manager = await signIn(app, "manager@example.com", "Manager@12345");
    await request(server).get(`/api/platform/companies/${companyId}/history`).set("authorization", `Bearer ${manager}`).expect(401);
    await request(server)
      .patch(`/api/platform/companies/${companyId}`)
      .set("authorization", `Bearer ${manager}`)
      .send({ contactPhone: "1" })
      .expect(401);
    // And a company session cannot reach the platform tables through the company API either.
    expect((await api(app, manager).get(`/platform/companies/${companyId}`)).status).toBe(401);
  });
});
