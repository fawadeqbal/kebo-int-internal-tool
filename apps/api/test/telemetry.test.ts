import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startApp } from "./app";
import { PrismaService } from "../src/database/prisma.service";
import { pageRoute } from "../src/platform/telemetry.controller";
import { RequestStats } from "../src/platform/watch";

/** What browsers saw (POST /api/telemetry): errors to Dev tools' error list, page speed to its page timings. */
describe("browser reports", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tag = Date.now().toString(36);
  const send = (body: object) => request(app.getHttpServer()).post("/api/telemetry").send(body);

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
  });

  it("names the page, never its ids", () => {
    expect(pageRoute("/orders/6f1e2d3c-1111-4222-8333-944455556666/payment?tab=x")).toBe("/orders/[id]/payment");
    expect(pageRoute("/inquiries/12345")).toBe("/inquiries/[id]");
    expect(pageRoute("/")).toBe("/");
    expect(pageRoute("/<script>")).toBe("(other page)");
  });

  it("an error on a page is counted once per kind, as from the browser", async () => {
    const body = {
      kind: "error",
      page: "/orders/6f1e2d3c-1111-4222-8333-944455556666/payment",
      name: "TypeError",
      message: `Cannot read properties of undefined (reading 'total') ${tag}`,
      stack: `TypeError: Cannot read properties of undefined\n    at PaymentPanel (https://rfq.test/_next/static/chunks/a.js:1:200)`,
    };
    await send(body).expect(204);
    await send(body).expect(204);
    const rows = await prisma.platform.appError.findMany({ where: { message: { contains: tag } } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "web", where: "/orders/[id]/payment", name: "TypeError", count: 2, companyName: null });
    expect(rows[0]!.path).toBe("/orders/6f1e2d3c-1111-4222-8333-944455556666/payment");
  });

  it("how fast a page showed goes to the page timings", async () => {
    await send({ kind: "speed", page: `/speed-${tag}/42424`, ms: 1234 }).expect(204);
    await app.get(RequestStats).flush();
    const rows = await prisma.platform.requestMinute.findMany({ where: { route: `PAGE /speed-${tag}/[id]` } });
    expect(rows.reduce((a, r) => a + r.count, 0)).toBe(1);
  });

  it("refuses what is not a report", async () => {
    await send({ kind: "speed", page: "/x", ms: -5 }).expect(422);
    await send({ kind: "other", page: "/x" }).expect(422);
    await send({ kind: "error", page: "/x", message: "x".repeat(3000) }).expect(422);
  });

  it("at most 30 reports a minute from one address: the rest are dropped", async () => {
    for (let k = 0; k < 30; k++) await send({ kind: "speed", page: "/flood", ms: 100 });
    await send({ kind: "error", page: "/flood", message: `dropped ${tag}` }).expect(204);
    expect(await prisma.platform.appError.count({ where: { message: `dropped ${tag}` } })).toBe(0);
  });
});
