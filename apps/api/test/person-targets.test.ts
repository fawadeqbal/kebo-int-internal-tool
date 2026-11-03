import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";
import { PrismaService } from "../src/database/prisma.service";

/** Monthly targets per person: managers set them; each person sees their own on Home; Insights shows everyone's. */
describe("targets per person", () => {
  let app: INestApplication;
  let manager: string;
  let sana: string;
  let sanaId: string;
  let month: string;

  beforeAll(async () => {
    app = await startApp();
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    sana = await signIn(app, "sana@example.com");
    sanaId = (await api(app, sana).get("/auth/me")).body.id;
    month = new Date().toISOString().slice(0, 7);
  });

  afterAll(async () => {
    await app?.get(PrismaService).platform.$executeRawUnsafe(`delete from person_targets where user_id = $1::uuid and month = $2`, sanaId, month);
    await app?.close();
  });

  it("only managers set them; people are checked; zero removes", async () => {
    await api(app, sana).put(`/insights/targets/${month}/people/${sanaId}`, { amount: 1000 }).expect(403);
    await api(app, manager).put(`/insights/targets/${month}/people/6b65626f-0000-4000-8000-00000000abcd`, { amount: 1000 }).expect(400);
    await api(app, manager).put(`/insights/targets/2026-13/people/${sanaId}`, { amount: 1000 }).expect(422);
    const set = (await api(app, manager).put(`/insights/targets/${month}/people/${sanaId}`, { amount: 25000 }).expect(200)).body;
    expect(set).toMatchObject({ month, userId: sanaId, amount: "25000.00" });
    const year = (await api(app, manager).get(`/insights/targets/people?year=${month.slice(0, 4)}`).expect(200)).body;
    expect(year.people.map((p: { id: string }) => p.id)).toContain(sanaId);
    expect(year.targets).toEqual(expect.arrayContaining([expect.objectContaining({ month, userId: sanaId, amount: "25000.00" })]));
  });

  it("each person sees their own on Home, and Insights shows it per person", async () => {
    const mine = (await api(app, sana).get("/me/target").expect(200)).body;
    expect(mine).toMatchObject({ month, target: "25000.00", percent: expect.any(Number), daysLeft: expect.any(Number) });
    expect(Number(mine.sold)).toBeGreaterThanOrEqual(0);
    // Someone without a target gets nothing to show.
    expect((await api(app, manager).get("/me/target").expect(200)).body).toMatchObject({ target: null });
    // Insights › People reads everyone's targets.
    const year = (await api(app, manager).get(`/insights/targets/people?year=${month.slice(0, 4)}`).expect(200)).body;
    expect(year.targets).toEqual(expect.arrayContaining([expect.objectContaining({ month, userId: sanaId, amount: "25000.00" })]));
    // Removing it.
    await api(app, manager).put(`/insights/targets/${month}/people/${sanaId}`, { amount: 0 }).expect(200);
    expect((await api(app, sana).get("/me/target").expect(200)).body.target).toBeNull();
  });
});
