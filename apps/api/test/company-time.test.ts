import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayIn } from "@kebo/utils";
import { api, signIn, startApp } from "./app";

/**
 * Time and dates per company (Company settings › Time and dates): the company's zone and formats are kept on the
 * company, every session says them, and the company's "today" follows the zone. A person has no zone of their own.
 */
describe("company time", () => {
  let app: INestApplication;
  let admin: string;
  let staff: string;
  let before: { timeZone: string; dateFormat: string; timeFormat: string };

  beforeAll(async () => {
    app = await startApp();
    admin = await signIn(app, "admin@example.com", "Admin@12345");
    staff = await signIn(app, "sana@example.com");
    const c = (await api(app, admin).get("/settings").expect(200)).body.company;
    before = { timeZone: c.timeZone, dateFormat: c.dateFormat, timeFormat: c.timeFormat };
  });

  afterAll(async () => {
    // Back as it was, for the other tests.
    if (admin) await api(app, admin).put("/settings/company", { ...(await api(app, admin).get("/settings")).body.company, ...before }).expect(200);
    await app?.close();
  });

  it("is kept on the company and every session says it", async () => {
    const company = (await api(app, admin).get("/settings").expect(200)).body.company;
    // A zone far from the server's, so "today" can differ.
    const zone = before.timeZone === "Pacific/Kiritimati" ? "Pacific/Pago_Pago" : "Pacific/Kiritimati";
    await api(app, admin).put("/settings/company", { ...company, timeZone: "Mars/Olympus" }).expect(422);
    await api(app, admin).put("/settings/company", { ...company, timeZone: zone, dateFormat: "dd_mm_yyyy", timeFormat: "12h" }).expect(200);
    const s = (await api(app, admin).get("/settings").expect(200)).body.company;
    expect(s).toMatchObject({ timeZone: zone, dateFormat: "dd_mm_yyyy", timeFormat: "12h" });
    // Every person in the company, whoever they are, gets the company's time.
    for (const token of [admin, staff]) expect((await api(app, token).get("/auth/me").expect(200)).body).toMatchObject({ timeZone: zone, dateFormat: "dd_mm_yyyy", timeFormat: "12h" });
    // The other company details are kept as they were.
    expect(s.name).toBe(company.name);
  });

  it("makes the company's today the zone's today", async () => {
    const zone = (await api(app, admin).get("/auth/me").expect(200)).body.timeZone as string;
    // My follow-ups for today: "today" is the company's, whatever the server's zone says.
    const mine = (await api(app, staff).get("/me/today").expect(200)).body;
    expect(mine.today).toBe(todayIn(zone));
  });
});
