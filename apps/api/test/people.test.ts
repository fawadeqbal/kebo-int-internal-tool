import { FIRST_COMPANY_ID } from "@kebo/database";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { currentStep, totpAt } from "../src/common/auth/totp";
import { PrismaService } from "../src/database/prisma.service";
import { api, signIn, startApp } from "./app";

describe("people: users, two-step sign-in, customers, factories", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: string;
  let staff: string;
  const tag = Date.now().toString(36);
  const phone = `+234 80${String(Date.now()).slice(-8)}`;

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);
    admin = await signIn(app, "admin@example.com", "Admin@12345");
    staff = await signIn(app, "bilal@example.com");
  });

  afterAll(async () => {
    await app?.close();
  });

  it("lets an admin add a person, who can then sign in; staff cannot manage users", async () => {
    const email = `new-${tag}@example.com`;
    await api(app, staff).post("/users", { name: "X", email, role: "staff", password: "Welcome123x" }).expect(403);
    const weak = await api(app, admin).post("/users", { name: "Nadia", email, role: "staff", password: "short" }).expect(422);
    expect(weak.body.fieldErrors.password[0]).toBe("Use at least 10 characters");
    const created = await api(app, admin).post("/users", { name: "Nadia", email, role: "staff", password: "Welcome123x" }).expect(201);
    expect(created.body).not.toHaveProperty("passwordHash");
    await signIn(app, email, "Welcome123x");
    await api(app, admin).post("/users", { name: "Again", email, role: "staff", password: "Welcome123x" }).expect(409);
  });

  it("people change their own name (not their email or role) on My account", async () => {
    const email = `name-${tag}@example.com`;
    await api(app, admin).post("/users", { name: "Old Name", email, role: "staff", password: "Welcome123x" }).expect(201);
    const token = await signIn(app, email, "Welcome123x");
    const r = await api(app, token).patch("/me", { name: "  New Name ", email: "other@example.com", role: "admin" }).expect(200);
    expect(r.body).toMatchObject({ name: "New Name", email });
    expect((await api(app, token).get("/auth/me").expect(200)).body).toMatchObject({ name: "New Name", email, role: "staff" });
    await api(app, token).patch("/me", { name: " " }).expect(422);
  });

  it("switching someone off ends their sessions at once", async () => {
    const email = `off-${tag}@example.com`;
    const u = await api(app, admin).post("/users", { name: "Temp", email, role: "staff", password: "Welcome123x" }).expect(201);
    const token = await signIn(app, email, "Welcome123x");
    await api(app, token).get("/auth/me").expect(200);
    await api(app, admin).patch(`/users/${u.body.id}/active`, { active: false }).expect(200);
    await api(app, token).get("/auth/me").expect(401);
  });

  it("runs two-step sign-in end to end: setup, sign-in with a code, no replay, recovery code", async () => {
    const email = `totp-${tag}@example.com`;
    await api(app, admin).post("/users", { name: "Two Step", email, role: "manager", password: "Welcome123x" }).expect(201);
    const token = await signIn(app, email, "Welcome123x");
    const setup = await api(app, token).post("/me/two-step/setup").expect(200);
    expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\/RFQ%20Desk%20\(Kebo\)/);
    await api(app, token).post("/me/two-step/confirm", { code: "000000" }).expect(400);
    const confirmed = await api(app, token).post("/me/two-step/confirm", { code: totpAt(setup.body.secret, currentStep() - 1) }).expect(200);
    expect(confirmed.body.recoveryCodes).toHaveLength(10);

    // A password alone now gives a session that cannot be used until the code is given.
    const login = await api(app).post("/auth/login", { email, password: "Welcome123x" }).expect(200);
    expect(login.body).toMatchObject({ twoStepRequired: true, user: null });
    await api(app, login.body.token).get("/auth/me").expect(401);
    const code = totpAt(setup.body.secret, currentStep());
    const done = await api(app, login.body.token).post("/auth/two-step", { code }).expect(200);
    expect(done.body.user.email).toBe(email);
    await api(app, login.body.token).get("/auth/me").expect(200);

    // The same code cannot be used again (a fresh login, same code).
    const again = await api(app).post("/auth/login", { email, password: "Welcome123x" }).expect(200);
    await api(app, again.body.token).post("/auth/two-step", { code }).expect(401);
    const rec = await api(app, again.body.token).post("/auth/two-step", { code: confirmed.body.recoveryCodes[0] }).expect(200);
    expect(rec.body).toMatchObject({ usedRecoveryCode: true, recoveryCodesLeft: 9 });
    await prisma.company(FIRST_COMPANY_ID).user.update({ where: { companyId_email: { companyId: FIRST_COMPANY_ID, email } }, data: { failedLogins: 0, lockedUntil: null } });
  });

  it("warns about duplicate customers and saves anyway when asked", async () => {
    const body = {
      name: `Lagos Med ${tag}`,
      country: "ng",
      contacts: [{ name: "Ade", phone, email: `ade-${tag}@lagosmed.test` }],
    };
    const first = await api(app, staff).post("/customers", body).expect(201);
    expect(first.body.country).toBe("NG");
    expect(first.body.contacts[0]).toMatchObject({ isPrimary: true, phone: phone.replace(/ /g, "") });
    const dup = await api(app, staff).post("/customers", { ...body, name: "Lagos Medical" }).expect(409);
    expect(dup.body).toMatchObject({ code: "duplicate" });
    expect(dup.body.matches.map((m: { id: string }) => m.id)).toContain(first.body.id);
    await api(app, staff).post("/customers", { ...body, name: "Lagos Medical", allowDuplicate: true }).expect(201);
    const missing = await api(app, staff).post("/customers", { name: "x", country: "NG", contacts: [{ name: "No way to reach" }] }).expect(422);
    expect(missing.body.error).toBe("Give at least one way to reach this contact");
  });

  it("keeps contact ids when a customer is edited, and shows staff only their customers", async () => {
    const c = await api(app, staff).post("/customers", { name: `Keep ${tag}`, country: "AE", contacts: [{ name: "Omar", email: `omar-${tag}@x.test` }] }).expect(201);
    const contactId = c.body.contacts[0].id;
    const edited = await api(app, staff)
      .put(`/customers/${c.body.id}`, { name: `Keep ${tag}`, country: "AE", contacts: [{ id: contactId, name: "Omar H.", email: `omar-${tag}@x.test` }, { name: "Sara", whatsapp: `+97150${String(Date.now()).slice(-7)}`, isPrimary: true }] })
      .expect(200);
    const omar = edited.body.contacts.find((x: { id: string }) => x.id === contactId);
    expect(omar).toMatchObject({ name: "Omar H.", isPrimary: false });
    const other = await signIn(app, "sana@example.com");
    await api(app, other).get(`/customers/${c.body.id}`).expect(404);
  });

  it("customers list: tax no. search, currency, status, only these ids, and the Archived chip with Restore", async () => {
    const taxNo = `TX${tag}`;
    const c = await api(app, admin).post("/customers", { name: `Herat ${tag}`, country: "AF", defaultCurrency: "CNY", taxNo, contacts: [{ name: "Naveed", email: `naveed-${tag}@x.test` }] }).expect(201);
    const ids = async (qs: string) => ((await api(app, admin).get(`/customers?pageSize=100&${qs}`).expect(200)).body.rows as { id: string }[]).map((r) => r.id);
    expect(await ids(`q=${taxNo}`)).toEqual([c.body.id]);
    expect(await ids(`q=${taxNo}&currency=USD`)).toEqual([]);
    expect(await ids(`q=${taxNo}&currency=CNY&status=none`)).toEqual([c.body.id]);
    expect(await ids(`q=${taxNo}&status=order`)).toEqual([]);
    expect(await ids(`ids=${c.body.id}`)).toEqual([c.body.id]);
    await api(app, admin).get("/customers?ids=nope").expect(422);
    // Removed: gone from the list, in Archived; restored: back.
    await api(app, admin).delete(`/customers/${c.body.id}`).expect(200);
    expect(await ids(`q=${taxNo}`)).toEqual([]);
    expect(await ids(`q=${taxNo}&archived=true`)).toEqual([c.body.id]);
    await api(app, staff).post(`/customers/${c.body.id}/restore`).expect(403);
    await api(app, admin).post(`/customers/${c.body.id}/restore`).expect(200);
    expect(await ids(`q=${taxNo}`)).toEqual([c.body.id]);
    await api(app, admin).post(`/customers/${c.body.id}/restore`).expect(404);
  });

  it("suppliers list: owner, city (the end of the address), offers or none; the cities and offers waiting", async () => {
    const f = await api(app, admin).post("/factories", { name: `Xiaolun ${tag}`, address: `Ruian, Wenzhou${tag}` }).expect(201);
    const list = (await api(app, admin).get(`/factories?q=Xiaolun ${tag}`).expect(200)).body;
    expect(list.rows[0]).toMatchObject({ id: f.body.id, city: `Wenzhou${tag}` });
    expect(list.cities).toContain(`Wenzhou${tag}`);
    expect(typeof list.waiting).toBe("number");
    const ids = async (qs: string) => ((await api(app, admin).get(`/factories?pageSize=100&${qs}`).expect(200)).body.rows as { id: string }[]).map((r) => r.id);
    expect(await ids(`city=Wenzhou${tag}`)).toEqual([f.body.id]);
    expect(await ids(`city=Wenzhou${tag}&owner=none`)).toEqual([f.body.id]);
    expect(await ids(`city=Wenzhou${tag}&status=offers`)).toEqual([]);
    expect(await ids(`city=Wenzhou${tag}&status=none`)).toEqual([f.body.id]);
  });

  it("manages factories with unique names", async () => {
    const f = await api(app, staff).post("/factories", { name: `Ningbo Pumps ${tag}` }).expect(201);
    expect(f.body).not.toHaveProperty("vatRate"); // no tax setting on a factory
    await api(app, staff).post("/factories", { name: `ningbo pumps ${tag}` }).expect(409);
    await api(app, staff).delete(`/factories/${f.body.id}`).expect(403);
  });
});
