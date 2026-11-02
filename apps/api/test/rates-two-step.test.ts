import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";
import { addDays } from "@kebo/utils";
import { PrismaService } from "../src/database/prisma.service";
import { Clock } from "../src/common/time/clock.service";

/** How old each exchange rate is, flagged when old; and asking people to turn on two-step sign-in. */
describe("rate dates and two-step reminders", () => {
  let app: INestApplication;
  let admin: string;
  let prisma: PrismaService;
  let original: Record<string, unknown>;

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);
    admin = await signIn(app, "admin@example.com", "Admin@12345");
    original = (await api(app, admin).get("/settings").expect(200)).body.sales;
  });

  afterAll(async () => {
    if (original) await api(app, admin).put("/settings/sales", { ...original, reason: "restore after test" });
    await app?.close();
  });

  it("a changed rate gets today's date; an unchanged one keeps its date", async () => {
    // The business day (Asia/Shanghai by default), not the UTC one: they differ for eight hours a day.
    const today = app.get(Clock).today();
    const rates = original.exchangeRates as Record<string, number>;
    const cny = Object.keys(rates).find((c) => c === "CNY") ?? Object.keys(rates)[0]!;
    const saved = (await api(app, admin).put("/settings/sales", { ...original, exchangeRates: { ...rates, [cny]: rates[cny]! + 0.01 }, reason: "test" }).expect(200)).body;
    expect(saved.rateDates[cny]).toBe(today);
    // A date sent by the form is ignored; an unchanged rate keeps the date it had.
    const again = (await api(app, admin).put("/settings/sales", { ...saved, rateDates: { [cny]: "2001-01-01" } }).expect(200)).body;
    expect(again.rateDates[cny]).toBe(today);
  });

  it("a rate untouched for over a month is on the settings keeper's Home", async () => {
    // Backdate the stored date (as if saved 40 days ago).
    const s = await prisma.platform.setting.findFirstOrThrow({ where: { key: "sales", company: { slug: "kebo" } } });
    const v = s.value as { rateDates: Record<string, string>; exchangeRates: Record<string, number> };
    const c = Object.keys(v.exchangeRates)[0]!;
    const old = addDays(app.get(Clock).today(), -40);
    await prisma.platform.setting.update({ where: { companyId_key: { companyId: s.companyId, key: "sales" } }, data: { value: { ...v, rateDates: { ...v.rateDates, [c]: old } } } });
    await api(app, admin).put("/settings/notifications", (await api(app, admin).get("/settings")).body.notifications); // clears the settings cache
    const items = (await api(app, admin).get("/reminders").expect(200)).body.items as { title: string }[];
    expect(items.map((i) => i.title)).toContain(`The ${c} rate was last updated 40 days ago`);
    const sana = await signIn(app, "sana@example.com");
    expect(((await api(app, sana).get("/reminders").expect(200)).body.items as { title: string }[]).some((i) => i.title.includes("rate was last updated"))).toBe(false);
  });

  it("asks someone without two-step to turn it on, once a day; not someone who has it", async () => {
    const users = (await api(app, admin).get("/users").expect(200)).body as { id: string; email: string; totpEnabledAt: string | null; isActive: boolean }[];
    const target = users.find((u) => u.email === "bilal@example.com")!;
    expect(target.totpEnabledAt).toBeNull();
    const first = (await api(app, admin).post(`/users/${target.id}/two-step/remind`).expect(200)).body;
    const second = (await api(app, admin).post(`/users/${target.id}/two-step/remind`).expect(200)).body;
    expect(first.sent || second.sent === false).toBe(true);
    expect(second).toEqual({ sent: false });
    const bilal = await signIn(app, "bilal@example.com");
    const notes = (await api(app, bilal).get("/notifications").expect(200)).body;
    expect(JSON.stringify(notes)).toContain("Please turn on two-step sign-in");
    await api(app, bilal).post(`/users/${target.id}/two-step/remind`).expect(403);
  });
});
