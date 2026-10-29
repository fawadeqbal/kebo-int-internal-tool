import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { unzipSync } from "fflate";
import bcrypt from "bcryptjs";
import { FIRST_COMPANY_ID } from "@kebo/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { currentStep, sealSecret, totpAt, newTotpSecret } from "../src/common/auth/totp";
import { PrismaService } from "../src/database/prisma.service";
import { LifecycleService } from "../src/platform/lifecycle.service";
import { AuthService } from "../src/modules/auth/auth.service";
import { api, signIn, startApp } from "./app";

/**
 * Companies: one database, every company's rows kept apart by row-level
 * security. Signed in to one company, nothing of another can be seen or
 * changed, by any route. Plus the platform admin's work: making companies and
 * demos, opening a company, plans and limits, read-only and off, deleting.
 */
describe("companies: isolation and the platform", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let platform: string;
  let keboManager: string;
  const tag = Date.now().toString(36);
  const secret = newTotpSecret();
  let step = currentStep() - 2;

  const plat = (token = platform) => {
    const server = app.getHttpServer();
    const auth = (r: request.Test) => r.set("authorization", `Bearer ${token}`);
    return {
      get: (url: string) => auth(request(server).get(`/api/platform${url}`)),
      post: (url: string, body?: object) => auth(request(server).post(`/api/platform${url}`)).send(body ?? {}),
      patch: (url: string, body?: object) => auth(request(server).patch(`/api/platform${url}`)).send(body ?? {}),
      put: (url: string, body?: object) => auth(request(server).put(`/api/platform${url}`)).send(body ?? {}),
      delete: (url: string, body?: object) => auth(request(server).delete(`/api/platform${url}`)).send(body ?? {}),
    };
  };
  /** A company made by the platform admin, its tenant admin's password set from the emailed link. */
  const makeCompany = async (slug: string, opts: { sampleData?: boolean; kind?: "client" | "demo"; planId?: string } = {}) => {
    const email = `boss@${slug}.test`;
    const made = (
      await plat()
        .post("/companies", {
          name: `Company ${slug}`,
          slug,
          adminName: `Boss ${slug}`,
          adminEmail: email,
          sampleData: opts.sampleData ?? true,
          kind: opts.kind ?? "client",
          planId: opts.planId ?? null,
        })
        .expect(201)
    ).body;
    expect(made.link).toContain("/set-password?token=");
    const token = decodeURIComponent(made.link.split("token=")[1]);
    expect(
      (
        await request(app.getHttpServer())
          .get(`/api/platform/public/set-password?token=${encodeURIComponent(token)}`)
          .expect(200)
      ).body,
    ).toMatchObject({ email, company: `Company ${slug}` });
    await request(app.getHttpServer()).post("/api/platform/public/set-password").send({ token, password: "Boss12345678" }).expect(200);
    // The link works once.
    await request(app.getHttpServer()).post("/api/platform/public/set-password").send({ token, password: "Boss12345678" }).expect(400);
    return { id: made.id as string, slug, email, token: await signIn(app, email, "Boss12345678") };
  };

  beforeAll(async () => {
    // Addresses per company are switched on for these tests (rfq.test).
    process.env.BASE_DOMAIN = "rfq.test";
    app = await startApp();
    prisma = app.get(PrismaService);
    const email = `platform-${tag}@example.com`;
    await prisma.platform.platformAdmin.create({
      data: {
        email,
        name: "Fawad Test",
        passwordHash: await bcrypt.hash("Platform12345", 10),
        totpSecret: sealSecret(secret, process.env.AUTH_SECRET!),
        totpEnabledAt: new Date(),
      },
    });
    const login = (
      await request(app.getHttpServer()).post("/api/platform/auth/login").send({ email, password: "Platform12345" }).expect(200)
    ).body;
    expect(login.twoStepRequired).toBe(true);
    // Not usable before the code.
    await plat(login.token).get("/companies").expect(401);
    await request(app.getHttpServer())
      .post("/api/platform/auth/two-step")
      .set("authorization", `Bearer ${login.token}`)
      .send({ code: totpAt(secret, ++step + 2) })
      .expect(200);
    platform = login.token;
    keboManager = await signIn(app, "manager@example.com", "Manager@12345");
  });

  afterAll(async () => {
    delete process.env.BASE_DOMAIN;
    await app?.close();
  });

  it("keeps platform routes for platform admins, and company routes for company sessions", async () => {
    await request(app.getHttpServer()).get("/api/platform/companies").expect(401);
    await plat(keboManager).get("/companies").expect(401);
    await api(app, platform).get("/inquiries").expect(401);
    const me = (await plat().get("/auth/me").expect(200)).body;
    expect(me.twoStepOn).toBe(true);
  });

  it("company B sees only its own data, and nothing of Kebo by any route", async () => {
    const b = await makeCompany(`iso-${tag}`);
    const kebo = api(app, keboManager);
    const mine = api(app, b.token);

    // Lists: B has its own sample data only.
    const bInquiries = (await mine.get("/inquiries?pageSize=100").expect(200)).body.rows as { id: string; refNo: string }[];
    const kInquiries = (await kebo.get("/inquiries?pageSize=100").expect(200)).body.rows as { id: string }[];
    expect(bInquiries.length).toBe(10);
    expect(bInquiries.map((r) => r.id).some((id) => kInquiries.some((k) => k.id === id))).toBe(false);
    // Numbering starts again in each company.
    expect(bInquiries.map((r) => r.refNo)).toContain(`RFQ-${new Date().getFullYear()}-0001`);

    // Kebo's records by id: not found for B, whatever the route.
    const kOrders = (await kebo.get("/orders").expect(200)).body as { id: string }[];
    const kCustomers = (await kebo.get("/customers?pageSize=5").expect(200)).body.rows as { id: string }[];
    const kFactories = (await kebo.get("/factories?pageSize=5").expect(200)).body.rows as { id: string }[];
    const kQuote = (await kebo.get(`/inquiries/${kInquiries[0].id}/quotation`).expect(200)).body;
    const reads = [
      `/inquiries/${kInquiries[0].id}`,
      `/inquiries/${kInquiries[0].id}/sourcing`,
      `/orders/${kOrders[0].id}`,
      `/orders/${kOrders[0].id}/money`,
      `/customers/${kCustomers[0].id}`,
      `/customers/${kCustomers[0].id}/account`,
      `/factories/${kFactories[0].id}`,
      ...(kQuote?.revisions?.[0] ? [`/revisions/${kQuote.revisions[0].id}`] : []),
    ];
    for (const path of reads) {
      const res = await mine.get(path);
      expect(res.status, `${path} → ${res.status}`).toBeGreaterThanOrEqual(400);
      expect(res.status, `${path} → ${res.status}`).toBeLessThan(500);
    }
    // Changes to Kebo's records: refused, and nothing changed.
    const before = (await kebo.get(`/inquiries/${kInquiries[0].id}`).expect(200)).body;
    for (const [method, path, body] of [
      ["post", `/inquiries/${kInquiries[0].id}/notes`, { body: "from B" }],
      ["patch", `/customers/${kCustomers[0].id}`, { name: "Taken over" }],
      ["post", `/orders/${kOrders[0].id}/payments`, { kind: "deposit", amount: "10", paidOn: "2026-01-01" }],
      ["delete", `/inquiries/${kInquiries[0].id}`, undefined],
    ] as const) {
      const res = await (method === "delete" ? mine.delete(path) : mine[method](path, body));
      expect(res.status, `${method} ${path} → ${res.status}`).toBeGreaterThanOrEqual(400);
      expect(res.status, `${method} ${path} → ${res.status}`).toBeLessThan(500);
    }
    // A new inquiry in B for Kebo's customer: refused.
    const res = await mine.post("/inquiries", { customerId: kCustomers[0].id, channel: "email", category: "Machinery", title: "Cross" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    const after = (await kebo.get(`/inquiries/${kInquiries[0].id}`).expect(200)).body;
    expect(after.notes?.length ?? 0).toBe(before.notes?.length ?? 0);

    // A Kebo session used at B's address (B named in the header) is not accepted at all.
    await kebo.get("/inquiries?pageSize=100").set("x-company", b.slug).expect(401);
    await kebo.get("/inquiries?pageSize=5").set("x-company", "kebo").expect(200);
  });

  it("the database itself keeps companies apart, on every company table", async () => {
    const b = await prisma.platform.company.findFirstOrThrow({ where: { slug: `iso-${tag}` } });
    const tables = (
      await prisma.platform.$queryRaw<
        { t: string }[]
      >`select relname as t from pg_class where relrowsecurity and relkind = 'r' and relnamespace = current_schema()::regnamespace`
    ).map((r) => r.t);
    expect(tables.length).toBeGreaterThanOrEqual(36);
    // Every table with a company column is under row-level security, except the platform's own.
    const withCompany = (
      await prisma.platform.$queryRaw<
        { t: string }[]
      >`select table_name as t from information_schema.columns where table_schema = current_schema() and column_name = 'company_id'`
    ).map((r) => r.t);
    expect(withCompany.filter((t) => !tables.includes(t)).sort()).toEqual(["leads", "platform_log", "sign_ups", "subscription_payments"]);
    const db = prisma.company(b.id);
    for (const t of tables) {
      const [row] = await db.$queryRawUnsafe<{ other: bigint }[]>(
        `select count(*) filter (where company_id <> $1::uuid) as other from "${t}"`,
        b.id,
      );
      expect(Number(row.other), t).toBe(0);
    }
    // Writing a row for another company is refused by the database.
    await expect(
      db.$executeRawUnsafe(`insert into counters (company_id, key, value) values ($1::uuid, 'x', 1)`, FIRST_COMPANY_ID),
    ).rejects.toThrow(/row-level security/);
    // A link from one company's row to another company's row is refused too.
    const keboCustomer = (await prisma.company(FIRST_COMPANY_ID).customer.findFirstOrThrow()).id;
    await expect(
      db.$executeRawUnsafe(`update inquiries set customer_id = $1::uuid where id = (select id from inquiries limit 1)`, keboCustomer),
    ).rejects.toThrow(/another company/);
    await expect(
      prisma.platform.$executeRawUnsafe(`update inquiries set customer_id = $1::uuid where company_id = $2::uuid`, keboCustomer, b.id),
    ).rejects.toThrow(/another company/);
    // The platform tables are out of reach.
    await expect(db.$queryRawUnsafe(`select count(*) from companies`)).rejects.toThrow(/permission denied/);
    await expect(db.$queryRawUnsafe(`select count(*) from database_markers`)).rejects.toThrow(/permission denied/);
    // With no company set, nothing at all.
    expect(Number((await prisma.platform.$queryRawUnsafe<{ n: bigint }[]>(`select count(*) as n from inquiries`))[0].n)).toBeGreaterThan(0);
  });

  it("an email in two companies: the password decides, or the person chooses", async () => {
    const b = await prisma.platform.company.findFirstOrThrow({ where: { slug: `iso-${tag}` } });
    const bAdmin = await signIn(app, `boss@iso-${tag}.test`, "Boss12345678");
    await api(app, bAdmin)
      .post("/users", { name: "Same Person", email: "manager@example.com", role: "manager", password: "Manager@12345" })
      .expect(201);
    const both = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: "manager@example.com", password: "Manager@12345" })
      .expect(409);
    expect(both.body.code).toBe("choose_company");
    expect(both.body.companies.map((c: { slug: string }) => c.slug).sort()).toEqual(["kebo", b.slug].sort());
    const inB = (
      await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({ email: "manager@example.com", password: "Manager@12345", company: b.slug })
        .expect(200)
    ).body;
    expect(inB.company.slug).toBe(b.slug);
    const me = (await api(app, inB.token).get("/auth/me").expect(200)).body;
    expect(me.company.slug).toBe(b.slug);
    // A different password in B: only Kebo's fits, so no question.
    const other = (await api(app, bAdmin).get("/users").expect(200)).body.find((u: { email: string }) => u.email === "manager@example.com");
    await api(app, bAdmin)
      .post(`/users/${other.id}/password`, { password: "Different123" })
      .expect((r) => expect(r.status).toBeLessThan(300));
    const kebo = (
      await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({ email: "manager@example.com", password: "Manager@12345" })
        .expect(200)
    ).body;
    expect(kebo.company.slug).toBe("kebo");
    // A wrong password in both: the usual answer, nothing more.
    const wrong = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: "manager@example.com", password: "Nope12345678" })
      .expect(401);
    expect(wrong.body.companies).toBeUndefined();
  });

  it("the platform admin opens a company and works as themself, in its history", async () => {
    const b = await prisma.platform.company.findFirstOrThrow({ where: { slug: `iso-${tag}` } });
    const opened = (await plat().post(`/companies/${b.id}/open`).expect(200)).body;
    const me = (await api(app, opened.token).get("/auth/me").expect(200)).body;
    expect(me).toMatchObject({ viaPlatform: true, name: "Fawad Test (platform admin)", company: { slug: b.slug } });
    const customer = (
      await api(app, opened.token).post("/customers", {
        name: `Opened ${tag}`,
        type: "company",
        country: "PK",
        contacts: [{ name: "X", isPrimary: true, email: "x@opened.test" }],
      })
    ).body;
    expect(customer.id, JSON.stringify(customer)).toBeTruthy();
    const audit = (await api(app, opened.token).get("/audit").expect(200)).body;
    const rows = (audit.rows ?? audit) as { summary: string; user?: { name: string } | null; userName?: string }[];
    expect(JSON.stringify(rows)).toContain("Fawad Test (platform admin)");
    // At the company's own address: a one-time link carries the session over.
    expect(opened.enterUrl).toMatch(new RegExp(`^https://${b.slug}\\.rfq\\.test/enter\\?token=`));
    const entered = (
      await request(app.getHttpServer())
        .post("/api/auth/enter")
        .send({ token: decodeURIComponent(opened.enterUrl.split("token=")[1]) })
        .expect(200)
    ).body;
    expect((await api(app, entered.token).get("/auth/me").expect(200)).body.viaPlatform).toBe(true);
    await request(app.getHttpServer()).post("/api/auth/enter").send({ token: "not-a-token-at-all" }).expect(401);
    // Hidden from the company's people.
    const bAdmin = await signIn(app, `boss@iso-${tag}.test`, "Boss12345678");
    const people = (await api(app, bAdmin).get("/users").expect(200)).body as { name: string }[];
    expect(people.some((p) => p.name.includes("platform admin"))).toBe(false);
    // It cannot be signed in to with a password.
    await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({
        email: `platform-${(await prisma.platform.platformAdmin.findFirstOrThrow({ where: { name: "Fawad Test" } })).id.slice(0, 8)}@platform.invalid`,
        password: "!",
      })
      .expect(401);
  });

  it("only real companies' addresses get a certificate", async () => {
    const check = (domain: string) => request(app.getHttpServer()).get(`/api/platform/public/domain-check?domain=${domain}`);
    await check("rfq.test").expect(200);
    await check("admin.rfq.test").expect(200);
    await check("get.rfq.test").expect(200);
    await check("kebo.rfq.test").expect(200);
    await check("nobody-here.rfq.test").expect(404);
    await check("a.b.rfq.test").expect(404);
    await check("evil.example.com").expect(404);
  });

  it("a company changes its own address: checked, held, sent on, once a month", async () => {
    const c = await makeCompany(`addr-${tag}`, { sampleData: false });
    const mine = api(app, c.token);
    const view = (await mine.get("/company/address").expect(200)).body;
    expect(view).toMatchObject({ canChange: true, slug: c.slug, url: `https://${c.slug}.rfq.test`, nextChangeOn: null, check: null });
    // The live check: taken, reserved, against the rules, free.
    expect((await mine.get("/company/address?slug=kebo").expect(200)).body.check.problem).toContain("taken");
    expect((await mine.get("/company/address?slug=admin").expect(200)).body.check.problem).toContain("kept for the platform");
    expect((await mine.get("/company/address?slug=get").expect(200)).body.check.problem).toContain("kept for the platform");
    expect((await mine.get("/company/address?slug=a").expect(200)).body.check.problem).not.toBeNull();
    const fresh = `moved-${tag}`;
    expect((await mine.get(`/company/address?slug=${fresh}`).expect(200)).body.check).toEqual({
      slug: fresh,
      url: `https://${fresh}.rfq.test`,
      problem: null,
    });
    // Someone who is not a Super Admin cannot.
    await mine.post("/users", { name: "Mgr", email: `mgr@addr-${tag}.test`, role: "manager", password: "Manager12345" }).expect(201);
    const mgr = api(app, await signIn(app, `mgr@addr-${tag}.test`, "Manager12345"));
    await mgr.put("/company/address", { slug: fresh }).expect(403);
    await mine.put("/company/address", { slug: "kebo" }).expect(409);
    // Changed: the new address is theirs, the old one still finds them (and gets a certificate) and is held.
    expect((await mine.put("/company/address", { slug: fresh }).expect(200)).body).toEqual({
      slug: fresh,
      url: `https://${fresh}.rfq.test`,
    });
    const check = (domain: string) => request(app.getHttpServer()).get(`/api/platform/public/domain-check?domain=${domain}`);
    await check(`${fresh}.rfq.test`).expect(200);
    await check(`${c.slug}.rfq.test`).expect(200);
    expect((await request(app.getHttpServer()).get(`/api/platform/public/company?slug=${c.slug}`).expect(200)).body.slug).toBe(fresh);
    // Held for others: a new company cannot take the old address.
    const clash = await plat().post("/companies", {
      name: "Clash",
      slug: c.slug,
      adminName: "Clash",
      adminEmail: `clash@${tag}.test`,
      sampleData: false,
      kind: "demo",
    });
    expect(clash.status).toBe(409);
    // Once a month.
    const again = await mine.get("/company/address").expect(200);
    expect(again.body.nextChangeOn).not.toBeNull();
    expect((await mine.put("/company/address", { slug: `third-${tag}` }).expect(400)).body.error).toContain("changed recently");
    // In the company's log and the platform's.
    const audit = (await mine.get("/audit").expect(200)).body;
    expect(JSON.stringify(audit)).toContain(`from ${c.slug} to ${fresh}`);
    // Every sign-in here comes from one address: start the sign-in limit afresh for the tests after this one.
    (app.get(AuthService) as unknown as { attempts: Map<string, unknown> }).attempts.clear();
  });

  it("plans: limits warn, then block; features switch parts off", async () => {
    const plan = (
      await plat()
        .post("/plans", {
          name: `Small ${tag}`,
          price: 49,
          currency: "USD",
          period: "month",
          maxUsers: 2,
          maxStorageMb: 50,
          features: ["excel"],
        })
        .expect(201)
    ).body;
    const c = await makeCompany(`plan-${tag}`, { sampleData: false, planId: plan.id });
    const mine = api(app, c.token);
    const company = (await mine.get("/company").expect(200)).body;
    expect(company.plan.name).toBe(`Small ${tag}`);
    expect(company.features).toEqual(["excel"]);
    await mine.post("/users", { name: "Two", email: `two@plan-${tag}.test`, role: "staff", password: "Welcome123x" }).expect(201);
    const full = (await mine.get("/company").expect(200)).body;
    expect(full.notices.some((n: { text: string }) => /reached your plan's 2 people/.test(n.text))).toBe(true);
    const third = await mine
      .post("/users", { name: "Three", email: `three@plan-${tag}.test`, role: "staff", password: "Welcome123x" })
      .expect(400);
    expect(third.body.error).toMatch(/allows 2 people/);
    // Insights is not in the plan.
    const insights = await mine.get("/insights").expect(403);
    expect(insights.body.code).toBe("plan_feature");
    // Kebo has no plan: everything.
    await api(app, keboManager).get("/insights").expect(200);
  });

  it("each feature the plan leaves out is refused by the API, not only hidden", async () => {
    const plans = (await plat().get("/plans").expect(200)).body as { id: string; name: string; features: string[] }[];
    const starter = plans.find((p) => p.name === "Starter")!;
    expect(starter.features).toEqual(["excel"]);
    expect(plans.map((p) => p.name)).toEqual(expect.arrayContaining(["Starter", "Team", "Business", "Unlimited"]));
    const c = await makeCompany(`feat-${tag}`, { sampleData: true, planId: starter.id });
    const mine = api(app, c.token);
    const off = async (res: request.Response) => {
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(res.body.code).toBe("plan_feature");
    };
    await off(await mine.get("/expenses"));
    await off(await mine.post("/expenses", {}));
    await off(await mine.get("/audit"));
    await off(await mine.post("/roles", { name: "Extra", permissions: [] }));
    await off(await mine.get("/money/cash-book"));
    await off(await mine.get("/insights"));
    await off(await mine.get("/reports"));
    await off(await mine.get("/reports/leaks"));
    await off(await mine.get("/money/profit-and-loss"));
    const customer = ((await mine.get("/customers?pageSize=1").expect(200)).body.rows as { id: string }[])[0];
    await off(await mine.get(`/customers/${customer.id}/account`));
    // No accounts to choose, and money cannot be put on one.
    expect((await mine.get("/money/accounts").expect(200)).body).toEqual([]);
    await off(await mine.put(`/money/entries/in/${customer.id}/account`, { accountId: customer.id }));
    // The order's money shows no costs.
    const order = ((await mine.get("/orders").expect(200)).body as { id: string }[])[0];
    expect((await mine.get(`/orders/${order.id}/money`).expect(200)).body.expenses).toBeNull();
    // A payment can be recorded; an account sent with it is left off (no cash book).
    const payRes = await mine.post(`/orders/${order.id}/payments`, {
      kind: "deposit",
      amount: "10",
      currency: "USD",
      paidOn: "2026-01-01",
      accountId: customer.id,
    });
    expect(payRes.status, JSON.stringify(payRes.body)).toBe(201);
    const paid = payRes.body as { createdId: string; payments: { id: string; account: unknown }[] };
    expect(paid.payments.find((p) => p.id === paid.createdId)?.account).toBeNull();
    // Roles: only the built-in ones can be given, and a role's permissions stay as they are.
    const before = (await mine.get("/roles/staff").expect(200)).body as { name: string; permissions: string[]; requireTwoStep: boolean };
    await mine.put("/roles/staff", { name: "Renamed", permissions: ["dashboard.view"], requireTwoStep: true }).expect(200);
    const after = (await mine.get("/roles/staff").expect(200)).body as typeof before;
    expect(after.name).toBe(before.name);
    expect([...after.permissions].sort()).toEqual([...before.permissions].sort());
    expect(after.requireTwoStep).toBe(true);
    await off(await mine.post("/users", { name: "Extra Role", email: `extra-${tag}@x.test`, password: "Extra12345678", role: "custom-x" }));
    // The phone app: no sign-in, and existing sessions stop.
    const phone = await request(app.getHttpServer())
      .post("/api/auth/login")
      .set("user-agent", "Dart/3.5 (dart:io)")
      .send({ email: c.email, password: "Boss12345678" });
    expect(phone.status).toBe(403);
    expect(phone.body.code).toBe("plan_feature");
    await off(await mine.get("/customers").set("user-agent", "Dart/3.5 (dart:io)"));
    // The website form.
    const form = await request(app.getHttpServer()).post(`/api/public/inquiries?company=${c.slug}`).send({
      fullName: "Web Buyer",
      email: "buyer@web.test",
      phone: "+92 300 1234567",
      category: "Valves",
      requirements: "100 valves please",
    });
    expect(form.status).toBe(403);
    // Insights without expenses: no expenses and no profit after them.
    const insightsOnly = (
      await plat()
        .post("/plans", { name: `Insights only ${tag}`, price: 10, features: ["insights"] })
        .expect(201)
    ).body;
    await plat().patch(`/companies/${c.id}`, { planId: insightsOnly.id }).expect(200);
    const ins = (await mine.get("/insights").expect(200)).body;
    expect(ins.kpis.netProfit).toBeNull();
    expect(ins.kpis.expenses).toBeNull();
    // A bigger plan switches them on at once.
    const business = plans.find((p) => p.name === "Business")!;
    await plat().patch(`/companies/${c.id}`, { planId: business.id }).expect(200);
    await mine.get("/expenses").expect(200);
    await mine.get("/audit").expect(200);
    expect((await mine.get(`/orders/${order.id}/money`).expect(200)).body.expenses).not.toBeNull();
  });

  it("roles and permissions follow the plan, down and back up, without losing anything", async () => {
    const plans = (await plat().get("/plans").expect(200)).body as { id: string; name: string }[];
    const starter = plans.find((p) => p.name === "Starter")!;
    const business = plans.find((p) => p.name === "Business")!;
    const c = await makeCompany(`perm-${tag}`, { sampleData: false, planId: business.id });
    const mine = api(app, c.token);
    type RoleRow = { key: string; permissions: string[]; frozen: boolean; notInPlan: string[]; givable: boolean };
    const roleOf = async (key: string) => ((await mine.get("/roles").expect(200)).body as RoleRow[]).find((r) => r.key === key)!;
    const perms = async (who = mine) => (await who.get("/auth/me").expect(200)).body.permissions as string[];

    // Business: a role of their own, with someone in it.
    const made = (
      await mine
        .post("/roles", { name: "Accounts", permissions: ["dashboard.view", "expenses.manage", "reports.view"], requireTwoStep: false })
        .expect(201)
    ).body as { key: string };
    await mine.post("/users", { name: "Acc Person", email: `acc@perm-${tag}.test`, role: made.key, password: "Accounts12345" }).expect(201);
    const acc = api(app, await signIn(app, `acc@perm-${tag}.test`, "Accounts12345"));
    expect(await perms(acc)).toEqual(expect.arrayContaining(["expenses.manage", "reports.view"]));
    expect(await perms()).toEqual(expect.arrayContaining(["expenses.manage", "reports.view", "audit.view"]));

    // Down to Starter: nobody has what the plan leaves out (the Super Admin neither); the roles keep it saved.
    await plat().patch(`/companies/${c.id}`, { planId: starter.id }).expect(200);
    for (const p of await perms()) expect(["expenses.manage", "reports.view", "audit.view"]).not.toContain(p);
    expect(await perms(acc)).toEqual(["dashboard.view"]);
    await acc.get("/expenses").expect(403);
    const frozen = await roleOf(made.key);
    expect(frozen.frozen).toBe(true);
    expect(frozen.givable).toBe(false);
    expect(frozen.notInPlan.sort()).toEqual(["expenses.manage", "reports.view"]);
    expect((await roleOf("manager")).notInPlan).toEqual(expect.arrayContaining(["expenses.manage", "reports.view", "audit.view"]));
    expect((await roleOf("manager")).frozen).toBe(false);
    // A frozen role cannot be given; a built-in one can (a Manager has more than the plan, which is not counted).
    const extra = await mine.post("/users", {
      name: "Second",
      email: `second@perm-${tag}.test`,
      role: made.key,
      password: "Second12345678",
    });
    expect(extra.status).toBe(403);
    expect(extra.body.code).toBe("plan_feature");
    await mine
      .post("/users", { name: "Second", email: `second@perm-${tag}.test`, role: "manager", password: "Second12345678" })
      .expect(201);

    // Back up to Business: everything as it was, at once.
    await plat().patch(`/companies/${c.id}`, { planId: business.id }).expect(200);
    expect(await perms(acc)).toEqual(expect.arrayContaining(["expenses.manage", "reports.view"]));
    await acc.get("/expenses").expect(200);
    expect(await perms()).toEqual(expect.arrayContaining(["expenses.manage", "reports.view", "audit.view"]));
    expect((await roleOf(made.key)).frozen).toBe(false);
    expect((await roleOf(made.key)).notInPlan).toEqual([]);

    // A plan with custom roles but not expenses or insights: new roles get only what the plan has, and an edit keeps what it does not.
    const lean = (
      await plat()
        .post("/plans", { name: `Roles only ${tag}`, price: 20, features: ["custom_roles"] })
        .expect(201)
    ).body as { id: string };
    await plat().patch(`/companies/${c.id}`, { planId: lean.id }).expect(200);
    const fresh = (
      await mine.post("/roles", { name: "Lean", permissions: ["dashboard.view", "expenses.manage"], requireTwoStep: false }).expect(201)
    ).body as {
      key: string;
    };
    expect((await roleOf(fresh.key)).permissions).toEqual(["dashboard.view"]);
    await mine
      .put(`/roles/${made.key}`, { name: "Accounts", permissions: ["dashboard.view", "customers.manage"], requireTwoStep: false })
      .expect(200);
    expect((await roleOf(made.key)).permissions.sort()).toEqual(["customers.manage", "dashboard.view", "expenses.manage", "reports.view"]);
    expect(await perms(acc)).toEqual(expect.arrayContaining(["customers.manage", "dashboard.view"]));
    expect(await perms(acc)).not.toContain("expenses.manage");
  });

  it("read-only lets people look but not change; off lets nobody in", async () => {
    const c = await makeCompany(`ro-${tag}`, { sampleData: false });
    await plat().post(`/companies/${c.id}/status`, { status: "read_only" }).expect(200);
    await api(app, c.token).get("/customers").expect(200);
    const refused = await api(app, c.token).post("/customers", { name: "No", type: "company", country: "PK", contacts: [] }).expect(403);
    expect(refused.body.code).toBe("company_read_only");
    await api(app, c.token).post("/auth/logout").expect(200);
    const token = await signIn(app, c.email, "Boss12345678");
    await plat().post(`/companies/${c.id}/status`, { status: "off" }).expect(200);
    expect((await api(app, token).get("/customers").expect(403)).body.code).toBe("company_off");
    expect(
      (await request(app.getHttpServer()).post("/api/auth/login").send({ email: c.email, password: "Boss12345678" }).expect(403)).body.code,
    ).toBe("company_off");
    await plat().post(`/companies/${c.id}/status`, { status: "auto" }).expect(200);
    await api(app, await signIn(app, c.email, "Boss12345678"))
      .get("/customers")
      .expect(200);
  });

  it("the marketing site: edited as a draft, published, visits counted without cookies, leads keep where they came from", async () => {
    const pub = () => request(app.getHttpServer());
    // Its own marker (the other tests find their leads by tag).
    const mk = `mk${Math.random().toString(36).slice(2, 9)}`;
    const live = (await pub().get("/api/platform/public/site").expect(200)).body as {
      content: { hero: { title: string } };
      plans: { id: string; name: string }[];
    };
    expect(live.plans.map((p) => p.name)).toEqual(expect.arrayContaining(["Starter", "Team", "Business", "Unlimited"]));
    // A draft is not live until published.
    const editor = (await plat().get("/site").expect(200)).body;
    const starter = (editor.plans as { id: string; name: string }[]).find((p) => p.name === "Starter")!;
    const draft = {
      ...editor.draft,
      hero: { ...editor.draft.hero, title: `Hello ${tag}` },
      plans: { ...editor.draft.plans, hidden: [starter.id] },
    };
    expect((await plat().put("/site", { draft }).expect(200)).body.unpublished).toBe(true);
    expect((await pub().get("/api/platform/public/site").expect(200)).body.content.hero.title).toBe(live.content.hero.title);
    await plat()
      .put("/site", { draft: { ...draft, hero: { ...draft.hero, title: "" } } })
      .expect(422);
    const done = (await plat().post("/site/publish").expect(200)).body;
    expect(done.unpublished).toBe(false);
    const after = (await pub().get("/api/platform/public/site").expect(200)).body;
    expect(after.content.hero.title).toBe(`Hello ${tag}`);
    expect(after.plans.map((p: { name: string }) => p.name)).not.toContain("Starter");
    // Not for anyone else.
    await pub().put("/api/platform/site").send({ draft }).expect(401);

    // Visits: each visitor once a day per address and browser; bots not at all.
    const browser = "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0";
    const visit = (ua: string, source?: string) =>
      pub()
        .post("/api/platform/public/visit")
        .send({ path: "/", userAgent: ua, origin: source ? { source, campaign: "oct" } : { referrer: "www.google.com" } });
    expect((await visit(browser, `fb${tag}`).expect(200)).body.counted).toBe(true);
    await visit(browser, `fb${tag}`).expect(200);
    expect((await visit("Googlebot/2.1", `fb${tag}`).expect(200)).body.counted).toBe(false);
    await visit(browser).expect(200);

    // Leads keep where they came from.
    await pub()
      .post("/api/platform/public/demo-request")
      .send({
        companyName: `Ad Co ${mk}`,
        name: "Ada",
        email: `ada-${mk}@ad.test`,
        origin: { source: `fb${tag}`, campaign: "oct", cta: "hero" },
      })
      .expect(200);
    await pub()
      .post("/api/platform/public/contact")
      .send({
        name: "Quinn",
        email: `quinn-${mk}@q.test`,
        message: "Do you support CNY?",
        origin: { referrer: "www.google.com", page: "/" },
      })
      .expect(200);
    await pub().post("/api/platform/public/contact").send({ name: "", email: "x", message: "" }).expect(422);
    const leads = (await plat().get(`/leads?q=${mk}`).expect(200)).body as {
      email: string;
      channel: string;
      source: string;
      origin: { campaign?: string };
    }[];
    const ada = leads.find((l) => l.email === `ada-${mk}@ad.test`)!;
    expect(ada).toMatchObject({ channel: `fb${tag}`, source: "form", origin: { campaign: "oct", cta: "hero" } });
    expect(leads.find((l) => l.email === `quinn-${mk}@q.test`)).toMatchObject({ channel: "google.com", source: "contact" });

    // The numbers: visitors and leads per channel.
    const n = (await plat().get("/site/numbers").expect(200)).body;
    const fb = n.now.channels.find((c: { channel: string }) => c.channel === `fb${tag}`);
    expect(fb).toMatchObject({ visitors: 1, views: 2, leads: 1 });
    // Same address and browser: a view from another channel, but not a second visitor that day.
    expect(n.now.channels.find((c: { channel: string }) => c.channel === "google.com").views).toBeGreaterThanOrEqual(1);
    expect(n.last30).toHaveLength(30);
    expect(n.last30.at(-1).visitors).toBeGreaterThanOrEqual(1);

    // "Sign in" by email: always the same answer.
    expect((await pub().post("/api/platform/public/find-company").send({ email: "boss@kebo.test" }).expect(200)).body).toEqual({
      ok: true,
    });
    expect((await pub().post("/api/platform/public/find-company").send({ email: "nobody@nowhere.test" }).expect(200)).body).toEqual({
      ok: true,
    });

    // Back as it was, for the other tests.
    await plat().put("/site", { draft: editor.draft }).expect(200);
    await plat().post("/site/publish").expect(200);
  });

  it("a demo request becomes a lead, the lead a demo; the demo ends, goes read-only, off, and is deleted", async () => {
    await request(app.getHttpServer())
      .post("/api/platform/public/demo-request")
      .send({
        companyName: `Lead Co ${tag}`,
        name: "Lena",
        email: `lena-${tag}@lead.test`,
        phone: "+92 300 0000000",
        teamSize: "6-20",
        message: "Show me",
      })
      .expect(200);
    // A bot (the hidden field filled in) is thanked and forgotten.
    await request(app.getHttpServer())
      .post("/api/platform/public/demo-request")
      .send({ companyName: "Bot", name: "Bot", email: "bot@bot.test", website: "http://spam" })
      .expect(200);
    const leads = (await plat().get(`/leads?q=${tag}`).expect(200)).body as { id: string; status: string; email: string }[];
    expect(leads.map((l) => l.email)).toEqual([`lena-${tag}@lead.test`]);
    const demo = (await plat().post(`/leads/${leads[0].id}/demo`, { sampleData: true }).expect(201)).body;
    expect(demo.slug).toMatch(/-demo$/);
    const lead = (await plat().get(`/leads/${leads[0].id}`).expect(200)).body;
    expect(lead.status).toBe("demo");
    expect(lead.company.slug).toBe(demo.slug);

    const lifecycle = app.get(LifecycleService);
    const ago = (days: number) => new Date(Date.now() - days * 86_400_000);
    await prisma.platform.company.update({ where: { id: demo.id }, data: { endsAt: ago(1) } });
    await lifecycle.run();
    expect((await prisma.platform.company.findUniqueOrThrow({ where: { id: demo.id } })).status).toBe("read_only");
    await plat().post(`/companies/${demo.id}/extend`, { days: 2 }).expect(200);
    expect((await prisma.platform.company.findUniqueOrThrow({ where: { id: demo.id } })).status).toBe("active");
    await prisma.platform.company.update({ where: { id: demo.id }, data: { endsAt: ago(8) } });
    await lifecycle.run();
    expect((await prisma.platform.company.findUniqueOrThrow({ where: { id: demo.id } })).status).toBe("off");
    await prisma.platform.company.update({ where: { id: demo.id }, data: { endsAt: ago(38) } });
    await lifecycle.run();
    const gone = await prisma.platform.company.findUniqueOrThrow({ where: { id: demo.id } });
    expect(gone.status).toBe("deleted");
    expect(await prisma.company(demo.id).inquiry.count()).toBe(0);
    expect(
      Number((await prisma.platform.$queryRaw<{ n: bigint }[]>`select count(*) as n from users where company_id = ${demo.id}::uuid`)[0].n),
    ).toBe(0);
    // Its name stays taken for a while.
    expect((await request(app.getHttpServer()).get(`/api/platform/public/slug?slug=${demo.slug}`).expect(200)).body.free).toBe(false);
  });

  it("a demo becomes a real company, its sample data cleared; payments set paid-until; overdue clients go read-only", async () => {
    const d = await makeCompany(`real-${tag}`, { kind: "demo", sampleData: true });
    expect(await prisma.company(d.id).inquiry.count()).toBe(10);
    await plat().post(`/companies/${d.id}/make-real`, { keepData: false }).expect(200);
    expect(await prisma.company(d.id).inquiry.count()).toBe(0);
    expect(await prisma.company(d.id).user.count({ where: { email: { in: ["bilal@example.com", "sana@example.com"] } } })).toBe(0);
    await api(app, await signIn(app, d.email, "Boss12345678"))
      .get("/inquiries")
      .expect(200);
    const today = new Date().toISOString().slice(0, 10);
    const past = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
    await plat().patch(`/companies/${d.id}`, { renewsOn: past }).expect(200);
    const after = (await plat().get(`/companies/${d.id}`).expect(200)).body;
    expect(after.status).toBe("read_only");
    expect(after.billing).toBe("overdue");
    const paid = (
      await plat()
        .post(`/companies/${d.id}/payments`, {
          amount: 199,
          currency: "USD",
          paidOn: today,
          paidUntil: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
        })
        .expect(201)
    ).body;
    expect(paid.status).toBe("active");
    expect(paid.billing).toBe("active");
    expect(paid.payments).toHaveLength(1);
  });

  it("exports a company, and deletes it with all its data", async () => {
    const c = await prisma.platform.company.findFirstOrThrow({ where: { slug: `iso-${tag}` } });
    const zip = await plat()
      .get(`/companies/${c.id}/export`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (d: Buffer) => chunks.push(d));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const files = unzipSync(new Uint8Array(zip.body as Buffer));
    const inquiries = JSON.parse(new TextDecoder().decode(files["data/inquiries.json"])) as { company_id: string }[];
    expect(inquiries.length).toBe(10);
    expect(inquiries.every((r) => r.company_id === c.id)).toBe(true);
    const users = JSON.parse(new TextDecoder().decode(files["data/users.json"])) as Record<string, unknown>[];
    expect(users.some((u) => "password_hash" in u)).toBe(false);

    await plat().delete(`/companies/${c.id}`, { confirm: "wrong" }).expect(400);
    await plat().delete(`/companies/${c.id}`, { confirm: c.slug }).expect(200);
    const left = await prisma.platform.$queryRawUnsafe<{ n: bigint }[]>(
      `select (select count(*) from inquiries where company_id = $1::uuid) + (select count(*) from users where company_id = $1::uuid) + (select count(*) from settings where company_id = $1::uuid) as n`,
      c.id,
    );
    expect(Number(left[0].n)).toBe(0);
    // Kebo is untouched.
    expect((await api(app, keboManager).get("/inquiries?pageSize=5").expect(200)).body.rows.length).toBeGreaterThan(0);
  });
});
