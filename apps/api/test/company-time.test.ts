import type { INestApplication } from "@nestjs/common";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { FIRST_COMPANY_ID } from "@kebo/database";
import { addDays, todayIn } from "@kebo/utils";
import { api, signIn, startApp } from "./app";
import { PrismaService } from "../src/database/prisma.service";
import { Clock } from "../src/common/time/clock.service";
import { CompanyContext } from "../src/common/company/company-context";
import { toInfo } from "../src/common/company/companies.service";
import { RemindersService } from "../src/modules/notifications/reminders.service";
import { momentIn } from "../src/modules/notes/follow-ups.service";

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

  afterEach(() => vi.restoreAllMocks());
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

  it("the morning reminder comes at 08:00 company time, with the time written the company's way", async () => {
    const company = (await api(app, admin).get("/settings").expect(200)).body.company;
    // Karachi is three hours behind the server's Shanghai: 07:30 there is already 10:30 on the server.
    await api(app, admin).put("/settings/company", { ...company, timeZone: "Asia/Karachi", dateFormat: "dd_mm_yyyy", timeFormat: "12h" }).expect(200);
    const clock = app.get(Clock);
    const prisma = app.get(PrismaService);
    const row = await prisma.platform.company.findUniqueOrThrow({ where: { id: FIRST_COMPANY_ID } });
    const run = () => CompanyContext.run(toInfo(row), () => app.get(RemindersService).followUps());
    const day = "2021-06-15";
    const at = (time: string, on = day) => vi.spyOn(clock, "now").mockReturnValue(momentIn(on, time, "Asia/Karachi"));
    const tag = Date.now().toString(36);
    const me = (await api(app, staff).get("/auth/me").expect(200)).body.id as string;
    at("12:00", addDays(day, -1));
    await api(app, staff).post("/follow-ups", { title: `Call Ade ${tag}`, dueOn: day, dueAt: "15:30", assigneeId: me }).expect(201);
    const due = async () =>
      (await prisma.company(FIRST_COMPANY_ID).notification.findMany({ where: { userId: me, type: "followUp.due" } })).filter((n) => n.title.includes(tag)).map((n) => n.title);

    at("07:30");
    await run();
    expect(await due()).toEqual([]);
    at("08:00");
    await run();
    expect(await due()).toEqual([`Today at 3:30 PM: Call Ade ${tag}`]);
  });
});
