import { FIRST_COMPANY_ID } from "@kebo/database";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../src/database/prisma.service";
import { api, startApp } from "./app";

describe("sign-in protection", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const email = "staff@example.com";

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);
    await prisma.company(FIRST_COMPANY_ID).user.update({ where: { companyId_email: { companyId: FIRST_COMPANY_ID, email } }, data: { failedLogins: 0, lockedUntil: null } });
  });

  afterAll(async () => {
    await prisma?.company(FIRST_COMPANY_ID).user.update({ where: { companyId_email: { companyId: FIRST_COMPANY_ID, email } }, data: { failedLogins: 0, lockedUntil: null } });
    await app?.close();
  });

  it("treats a mangled session cookie as signed out, not an error", async () => {
    await api(app).get("/orders").set("cookie", "kebo_session=%E0%A4%A").expect(401);
  });

  it("counts parallel wrong passwords and locks the account", async () => {
    await Promise.all(Array.from({ length: 6 }, () => api(app).post("/auth/login", { email, password: "wrong" })));
    const right = await api(app).post("/auth/login", { email, password: "Staff@12345" });
    expect(right.status).toBe(429);
    expect(right.body.error).toMatch(/locked/);
  });

  it("does not trust a client's own X-Forwarded-For when no proxy is configured", async () => {
    const tries = await Promise.all(
      Array.from({ length: 25 }, (_, i) => api(app).post("/auth/login", { email: "nobody@example.com", password: "x" }).set("x-forwarded-for", `10.0.0.${i}`)),
    );
    expect(tries.filter((r) => r.status === 429).length).toBeGreaterThan(0);
  });
});
