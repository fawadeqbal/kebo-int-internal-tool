import { createPrismaClient } from "@kebo/database";
import { afterAll, describe, expect, it } from "vitest";

/** The facts a backup must carry (docs/restore.md): the time zone fix is recorded as a row, which pg_dump keeps. */
describe("database markers", () => {
  const db = createPrismaClient({ url: process.env.DATABASE_URL!, poolSize: 1 });
  afterAll(() => db.$disconnect());

  it("record that stored times are UTC", async () => {
    const m = await db.databaseMarker.findUnique({ where: { key: "utc_timestamps" } });
    expect(m?.note).toMatch(/UTC/);
  });

  it("leave no starting role made in the future", async () => {
    const roles = await db.role.findMany({ select: { key: true, createdAt: true, updatedAt: true } });
    expect(roles.length).toBeGreaterThan(0);
    const now = Date.now() + 60_000;
    expect(roles.filter((r) => r.createdAt.getTime() > now || r.updatedAt.getTime() > now)).toEqual([]);
  });
});
