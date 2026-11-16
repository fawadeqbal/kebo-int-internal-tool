import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../src/database/prisma.service";
import { startApp } from "./app";

/**
 * White label: the company's own look for its sign-in page, before anyone signs in (name, colour set, logo).
 * Only while it is on or read-only; never one that is off, deleted or unknown.
 */
describe("platform: a company's look for its sign-in page", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let slug: string;

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);
    slug = (await prisma.platform.company.findFirstOrThrow({ where: { status: "active" }, orderBy: { createdAt: "asc" } })).slug;
  });
  afterAll(async () => {
    await app?.close();
  });

  const get = (path: string) => request(app.getHttpServer()).get(`/api/platform/public/${path}`);

  it("gives its name, colours and whether it has a logo, without signing in", async () => {
    const body = (await get(`company-look?slug=${slug}`).expect(200)).body;
    expect(typeof body.name).toBe("string");
    expect(["green", "graphite", "midnight", "warm"]).toContain(body.colours);
    expect(body.logo === null || /^[0-9a-f]{12}$/.test(body.logo)).toBe(true);
    expect(Object.keys(body).sort()).toEqual(["colours", "logo", "name"]);
  });

  it("gives its logo as stored, or null", async () => {
    const body = (await get(`company-logo?slug=${slug}`).expect(200)).body;
    expect(body.logo === null || /^data:image\//.test(body.logo)).toBe(true);
  });

  it("knows no company that does not exist", async () => {
    await get("company-look?slug=no-such-company-here").expect(404);
    await get("company-logo?slug=no-such-company-here").expect(404);
  });
});
