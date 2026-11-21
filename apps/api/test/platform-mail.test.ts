import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { currentStep, newTotpSecret, sealSecret, totpAt } from "../src/common/auth/totp";
import { PrismaService } from "../src/database/prisma.service";
import { PlatformMail } from "../src/platform/platform-mail";
import { signIn, startApp } from "./app";

/**
 * Platform settings › Emails: the platform's own sending email (like a company's, set here instead of the
 * server's .env) and the addresses its emails go to. Platform admins only; the key is never sent back.
 */
describe("platform: its own email", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let platform: string;
  const tag = Date.now().toString(36);
  const secret = newTotpSecret();
  const KEY = "re_platform_key_never_sent_back";

  const plat = (token = platform) => {
    const server = app.getHttpServer();
    const auth = (r: request.Test) => r.set("authorization", `Bearer ${token}`);
    return {
      get: (url: string) => auth(request(server).get(`/api/platform${url}`)),
      put: (url: string, body?: object) => auth(request(server).put(`/api/platform${url}`)).send(body ?? {}),
      post: (url: string, body?: object) => auth(request(server).post(`/api/platform${url}`)).send(body ?? {}),
      delete: (url: string) => auth(request(server).delete(`/api/platform${url}`)),
    };
  };

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);
    await prisma.platform.platformSetting.deleteMany({});
    const email = `platform-mail-${tag}@example.com`;
    await prisma.platform.platformAdmin.create({
      data: {
        email,
        name: "Mail Tester",
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
    await prisma?.platform.platformSetting.deleteMany({});
    await app?.close();
  });

  it("is the platform admins': a company's admin cannot reach it", async () => {
    const admin = await signIn(app, "admin@example.com", "Admin@12345");
    await plat(admin).get("/mail").expect(401);
    await plat("").put("/mail", { provider: "resend", fromEmail: "a@b.test", secret: "x" }).expect(401);
  });

  it("starts on the server's own, sending to every platform admin", async () => {
    const v = (await plat().get("/mail").expect(200)).body;
    expect(v).toMatchObject({ provider: null, hasSecret: false, inbox: [] });
    expect(v.enabled).toBe(v.serverDefault);
    expect(["server", "admins"]).toContain(v.inboxFrom);
    if (v.inboxFrom === "admins") expect(v.inboxNow).toContain(`platform-mail-${tag}@example.com`);
  });

  it("sets its own sending email, never gives the key back, and logs it", async () => {
    await plat().put("/mail", { provider: "resend", fromEmail: "a@b.test" }).expect(400);
    await plat().put("/mail", { provider: "smtp", fromEmail: "a@b.test", host: "127.0.0.1", port: 587, secret: "x" }).expect(400);
    const v = (
      await plat().put("/mail", { provider: "resend", fromName: "RFQ Desk", fromEmail: "Hello@RFQ.test", secret: KEY }).expect(200)
    ).body;
    expect(v).toMatchObject({ provider: "resend", fromName: "RFQ Desk", fromEmail: "hello@rfq.test", hasSecret: true, enabled: true });
    expect(JSON.stringify(v)).not.toContain(KEY);
    expect(JSON.stringify((await plat().get("/mail").expect(200)).body)).not.toContain(KEY);
    // Kept when no key is typed for the same account.
    expect(
      (await plat().put("/mail", { provider: "resend", fromName: "RFQ", fromEmail: "hello@rfq.test" }).expect(200)).body.fromName,
    ).toBe("RFQ");
    // Sealed in the table, not as typed.
    const row = await prisma.platform.platformSetting.findUnique({ where: { key: "mail" } });
    expect(JSON.stringify(row?.value)).not.toContain(KEY);
    expect(row?.updatedBy).toBe("Mail Tester");
    // The platform's emails now go out through it.
    expect(app.get(PlatformMail).enabled).toBe(true);
    const log = await prisma.platform.platformLog.findFirst({
      where: { adminName: "Mail Tester", summary: { contains: "Platform email: Resend" } },
    });
    expect(log).toBeTruthy();
    expect(JSON.stringify(log)).not.toContain(KEY);
  });

  it("sets where its emails go, and goes back to the default when emptied", async () => {
    await plat()
      .put("/mail/inbox", { emails: ["not an address"] })
      .expect(422);
    const v = (
      await plat()
        .put("/mail/inbox", { emails: ["Ops@RFQ.test", "ops@rfq.test", "boss@rfq.test"] })
        .expect(200)
    ).body;
    expect(v).toMatchObject({ inbox: ["ops@rfq.test", "boss@rfq.test"], inboxNow: ["ops@rfq.test", "boss@rfq.test"], inboxFrom: "here" });
    expect(await app.get(PlatformMail).admins()).toEqual(["ops@rfq.test", "boss@rfq.test"]);
    const back = (await plat().put("/mail/inbox", { emails: [] }).expect(200)).body;
    expect(back.inbox).toEqual([]);
    expect(back.inboxFrom).not.toBe("here");
  });

  it("goes back to the server's own email", async () => {
    const v = (await plat().delete("/mail").expect(200)).body;
    expect(v).toMatchObject({ provider: null, hasSecret: false });
    expect(await prisma.platform.platformSetting.findUnique({ where: { key: "mail" } })).toBeNull();
  });
});
