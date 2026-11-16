import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { COLOUR_SETS, readSettings } from "@kebo/shared";
import { api, signIn, startApp } from "./app";

/**
 * The app's colours (Company settings › The app's colours): one of four sets, chosen for the whole company and
 * kept with the company's other details; Green until it is chosen. Who may change company settings may choose.
 */
describe("the app's colours", () => {
  let app: INestApplication;
  let admin: string;
  let staff: string;
  let before: string;

  beforeAll(async () => {
    app = await startApp();
    admin = await signIn(app, "admin@example.com", "Admin@12345");
    staff = await signIn(app, "sana@example.com");
    before = (await api(app, admin).get("/settings").expect(200)).body.company.colours;
  });

  afterAll(async () => {
    // Back as it was, for the other tests.
    if (admin && before) await api(app, admin).put("/settings/company", { ...(await api(app, admin).get("/settings")).body.company, colours: before }).expect(200);
    await app?.close();
  });

  it("are one of the four sets, and one choice is everyone's", async () => {
    expect(COLOUR_SETS).toContain(before);
    const company = (await api(app, admin).get("/settings").expect(200)).body.company;
    const next = before === "graphite" ? "midnight" : "graphite";
    await api(app, admin).put("/settings/company", { ...company, colours: next }).expect(200);
    // Everyone in the company sees it, not only who chose it.
    for (const token of [admin, staff]) expect((await api(app, token).get("/settings").expect(200)).body.company.colours).toBe(next);
    // The company's other details stay as they were.
    const after = (await api(app, admin).get("/settings").expect(200)).body.company;
    expect({ ...after, colours: company.colours }).toEqual(company);
  });

  it("only the sets offered, and only by who may change company settings", async () => {
    const company = (await api(app, admin).get("/settings").expect(200)).body.company;
    await api(app, admin).put("/settings/company", { ...company, colours: "pink" }).expect(422);
    await api(app, staff).put("/settings/company", { ...company, colours: "warm" }).expect(403);
    expect((await api(app, admin).get("/settings").expect(200)).body.company.colours).toBe(company.colours);
  });

  it("start as Green, and a set no longer offered reads as Green without losing the rest", () => {
    expect(readSettings({}).company.colours).toBe("green");
    const kept = readSettings({ company: { name: "Kebo", phone: "+86 532 1234", colours: "pink" } }).company;
    expect(kept).toMatchObject({ name: "Kebo", phone: "+86 532 1234", colours: "green" });
    expect(readSettings({ company: { name: "Kebo", colours: "warm" } }).company.colours).toBe("warm");
  });
});
