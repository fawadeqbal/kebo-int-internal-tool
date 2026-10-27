import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { currentStep, totpAt } from "../src/common/auth/totp";
import { PrismaService } from "../src/database/prisma.service";
import { api, signIn, startApp } from "./app";

/**
 * Step 4, Security: roles made and changed by the Super Admin, two-step
 * sign-in required per role, signed-in devices and the sign-in history.
 */
describe("security: roles, two-step per role, sessions, sign-ins", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: string;
  const tag = Date.now().toString(36);
  const password = "Welcome123x";

  const person = async (name: string, role: string) => {
    const email = `${name.toLowerCase().replace(/\W+/g, "-")}-${tag}@example.com`;
    const u = (await api(app, admin).post("/users", { name, email, role, password }).expect(201)).body;
    return { id: u.id as string, email, token: await signIn(app, email, password) };
  };

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);
    admin = await signIn(app, "admin@example.com", "Admin@12345");
  });

  afterAll(async () => {
    await app?.close();
  });

  it("makes a role from chosen permissions, and its people can do exactly that", async () => {
    const made = await api(app, admin)
      .post("/roles", {
        name: `Accounts ${tag}`,
        description: "Payments only",
        permissions: ["dashboard.view", "payments.record", "orders.update"],
      })
      .expect(201);
    expect(made.body.key).toBe(`accounts-${tag}`);
    await api(app, admin)
      .post("/roles", { name: `accounts ${tag}`, permissions: [] })
      .expect(409);
    await api(app, admin)
      .post("/roles", { name: `Bad ${tag}`, permissions: ["launch.rockets"] })
      .expect(422);

    const amina = await person("Amina", made.body.key);
    const me = (await api(app, amina.token).get("/auth/me").expect(200)).body;
    expect(me).toMatchObject({
      role: made.body.key,
      roleName: `Accounts ${tag}`,
      permissions: ["dashboard.view", "orders.update", "payments.record"],
      twoStepSetupRequired: false,
    });
    await api(app, amina.token).get("/users").expect(403);

    // A change takes effect on the next request, without signing in again.
    await api(app, admin)
      .put(`/roles/${made.body.key}`, {
        name: `Accounts ${tag}`,
        permissions: ["dashboard.view", "payments.record", "orders.update", "reports.view"],
      })
      .expect(200);
    expect((await api(app, amina.token).get("/auth/me").expect(200)).body.permissions).toContain("reports.view");

    const roles = (await api(app, admin).get("/roles").expect(200)).body;
    expect(roles.find((r: { key: string }) => r.key === "admin")).toMatchObject({ superAdmin: true, preset: true, givable: true });
    expect(roles.find((r: { key: string }) => r.key === made.body.key)).toMatchObject({ people: 1, preset: false });

    // In use or built in: cannot be removed.
    expect((await api(app, admin).delete(`/roles/${made.body.key}`).expect(409)).body.error).toMatch(/^1 person has this role/);
    await api(app, admin).delete("/roles/staff").expect(400);
    // The Super Admin keeps every permission whatever is sent.
    await api(app, admin).put("/roles/admin", { name: "Boss", permissions: [] }).expect(200);
    expect((await api(app, admin).get("/auth/me").expect(200)).body).toMatchObject({
      roleName: "Super Admin",
      permissions: expect.arrayContaining(["security.manage", "users.manage"]),
    });
  });

  it("never lets People give or manage more than the giver's own role allows", async () => {
    const lead = await api(app, admin)
      .post("/roles", {
        name: `People lead ${tag}`,
        permissions: ["dashboard.view", "users.manage", "inquiries.create", "inquiries.viewAll"],
      })
      .expect(201);
    const omar = await person("Omar", lead.body.key);
    const email = `n-${tag}@example.com`;
    expect((await api(app, omar.token).post("/users", { name: "N", email, role: "admin", password }).expect(403)).body.error).toBe(
      "Only a Super Admin can give the Super Admin role.",
    );
    expect((await api(app, omar.token).post("/users", { name: "N", email, role: "manager", password }).expect(403)).body.error).toMatch(
      /^You cannot give the Manager role: that role allows more than yours \(Reports, /,
    );
    const sam = await api(app, admin)
      .post("/roles", { name: `Starter ${tag}`, permissions: ["dashboard.view", "inquiries.create"] })
      .expect(201);
    await api(app, omar.token).post("/users", { name: "N", email, role: sam.body.key, password }).expect(201);
    // Nor take over a Super Admin's account.
    const adminId = (await api(app, admin).get("/auth/me")).body.id;
    await api(app, omar.token).post(`/users/${adminId}/password`, { password: "Takeover12345" }).expect(403);
    // Security itself is closed to them.
    await api(app, omar.token)
      .post("/roles", { name: `Sneaky ${tag}`, permissions: ["security.manage"] })
      .expect(403);
    await api(app, omar.token).get("/security/sign-ins").expect(403);
  });

  it("keeps Security in one's own role", async () => {
    const sec = await api(app, admin)
      .post("/roles", { name: `Security desk ${tag}`, permissions: ["dashboard.view", "security.manage"] })
      .expect(201);
    const lina = await person("Lina", sec.body.key);
    expect(
      (
        await api(app, lina.token)
          .put(`/roles/${sec.body.key}`, { name: `Security desk ${tag}`, permissions: ["dashboard.view"] })
          .expect(400)
      ).body.error,
    ).toMatch(/^This is your own role/);
    // Nor give what they do not have themselves.
    expect(
      (
        await api(app, lina.token)
          .put(`/roles/${sec.body.key}`, {
            name: `Security desk ${tag}`,
            permissions: ["dashboard.view", "security.manage", "expenses.manage"],
          })
          .expect(403)
      ).body.error,
    ).toBe("You can only give what your own role allows. Not yours: Expenses, factory payments and profit & loss.");
  });

  it("makes everyone in a role set up two-step sign-in before anything else", async () => {
    const r = await api(app, admin)
      .post("/roles", { name: `Buyers ${tag}`, permissions: ["dashboard.view", "inquiries.create"] })
      .expect(201);
    const zara = await person("Zara", r.body.key);
    await api(app, zara.token).get("/inquiries").expect(200);
    await api(app, admin)
      .put(`/roles/${r.body.key}`, { name: `Buyers ${tag}`, permissions: ["dashboard.view", "inquiries.create"], requireTwoStep: "on" })
      .expect(200);

    // The same session: only the setup is open now.
    const blocked = await api(app, zara.token).get("/inquiries").expect(403);
    expect(blocked.body).toMatchObject({
      code: "two_step_setup",
      error: `Your role (Buyers ${tag}) needs two-step sign-in. Set it up to carry on.`,
    });
    expect((await api(app, zara.token).get("/auth/me").expect(200)).body.twoStepSetupRequired).toBe(true);
    expect((await api(app).post("/auth/login", { email: zara.email, password }).expect(200)).body).toMatchObject({
      twoStepRequired: false,
      twoStepSetupRequired: true,
    });
    const overview = (await api(app, admin).get("/security/overview").expect(200)).body;
    expect(overview.mustSetUp).toContainEqual({ id: zara.id, name: "Zara", role: `Buyers ${tag}` });

    const setup = await api(app, zara.token).post("/me/two-step/setup").expect(200);
    await api(app, zara.token)
      .post("/me/two-step/confirm", { code: totpAt(setup.body.secret, currentStep()) })
      .expect(200);
    await api(app, zara.token).get("/inquiries").expect(200);
    expect((await api(app, zara.token).get("/me/two-step").expect(200)).body).toMatchObject({ on: true, required: true });
    expect((await api(app, zara.token).post("/me/two-step/off", { code: "123456" }).expect(400)).body.error).toBe(
      `Your role (Buyers ${tag}) needs two-step sign-in, so it stays on.`,
    );
  });

  it("keeps a sign-in history, right and wrong", async () => {
    const r = await api(app, admin)
      .post("/roles", { name: `History ${tag}`, permissions: ["dashboard.view"] })
      .expect(201);
    const kim = await person("Kim", r.body.key);
    await api(app)
      .post("/auth/login", { email: kim.email, password: "not-it" })
      .set("user-agent", "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36")
      .expect(401);
    await api(app)
      .post("/auth/login", { email: `nobody-${tag}@example.com`, password: "x" })
      .expect(401);

    const mine = (await api(app, kim.token).get("/me/sign-ins").expect(200)).body;
    expect(mine.map((s: { result: string }) => s.result)).toEqual(["wrong_password", "signed_in"]);
    expect(mine[0]).toMatchObject({ device: "Chrome on Windows", email: kim.email });

    const failed = (await api(app, admin).get(`/security/sign-ins?failed=true&q=${tag}`).expect(200)).body;
    expect(failed.rows.map((s: { email: string; result: string }) => `${s.result} ${s.email}`)).toEqual(
      expect.arrayContaining([`wrong_password ${kim.email}`, `unknown_email nobody-${tag}@example.com`]),
    );
    expect(failed.rows.every((s: { result: string }) => s.result !== "signed_in")).toBe(true);
    await api(app, kim.token).get("/security/sign-ins").expect(403);
    await prisma.db.user.update({ where: { email: kim.email }, data: { failedLogins: 0 } });
  });

  it("lists signed-in devices and signs them out", async () => {
    const r = await api(app, admin)
      .post("/roles", { name: `Devices ${tag}`, permissions: ["dashboard.view"] })
      .expect(201);
    const ali = await person("Ali", r.body.key);
    const phone = (await api(app).post("/auth/login", { email: ali.email, password }).set("user-agent", "Dart/3.5 (dart:io)").expect(200))
      .body.token;
    const laptop = await signIn(app, ali.email, password);

    const mine = (await api(app, laptop).get("/me/sessions").expect(200)).body;
    expect(mine).toHaveLength(3);
    expect(mine.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    expect(mine.map((s: { device: string }) => s.device)).toContain("Kebo app");

    // Super Admin ends the phone's session.
    const phoneSession = mine.find((s: { device: string }) => s.device === "Kebo app").id;
    await api(app, admin).delete(`/security/sessions/${phoneSession}`).expect(200);
    await api(app, phone).get("/auth/me").expect(401);
    // Someone else's session cannot be ended from My account.
    const adminSession = (await api(app, admin).get("/me/sessions").expect(200)).body[0].id;
    await api(app, laptop).delete(`/me/sessions/${adminSession}`).expect(404);

    // Everywhere but here.
    expect((await api(app, laptop).post("/me/sessions/sign-out-others").expect(200)).body).toEqual({ ended: 1 });
    await api(app, ali.token).get("/auth/me").expect(401);
    await api(app, laptop).get("/auth/me").expect(200);

    // And everywhere, by the Super Admin.
    const all = (await api(app, admin).get(`/security/sessions?userId=${ali.id}`).expect(200)).body;
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ user: { id: ali.id, name: "Ali" }, current: false });
    await api(app, admin).post(`/security/users/${ali.id}/sign-out`).expect(200);
    await api(app, laptop).get("/auth/me").expect(401);
  });
});
