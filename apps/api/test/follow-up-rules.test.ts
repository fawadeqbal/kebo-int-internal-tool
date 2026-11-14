import type { INestApplication } from "@nestjs/common";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { FIRST_COMPANY_ID } from "@kebo/database";
import { addDays } from "@kebo/utils";
import { api, signIn, startApp } from "./app";
import { PrismaService } from "../src/database/prisma.service";
import { Clock } from "../src/common/time/clock.service";
import { CompanyContext } from "../src/common/company/company-context";
import { toInfo } from "../src/common/company/companies.service";
import { RemindersService } from "../src/modules/notifications/reminders.service";
import { NotificationsService } from "../src/modules/notifications/notifications.service";
import { momentIn } from "../src/modules/notes/follow-ups.service";

type FollowUp = { id: string; title: string; dueOn: string; done: boolean; needsNext: boolean; can: { done: boolean; delete: boolean }; assignee: { id: string }; next?: FollowUp | null };

/**
 * The three rules of reminding (claude/reminders-how-it-works.md): an open inquiry always has a next
 * follow-up; a missed follow-up reminds the person every morning; after two days missed the managers and
 * who gave it are told too, every morning, until it is done.
 */
describe("follow-ups never stop reminding", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let clock: Clock;
  let sana: string;
  let manager: string;
  let admin: string;
  let managerId: string;
  let customerId: string;
  const tag = Date.now().toString(36);
  const password = "Rules@12345678";
  const db = () => prisma.company(FIRST_COMPANY_ID);
  const person = async (name: string) => {
    const role = (await api(app, admin).post("/roles", { name: `${name} ${tag}`, permissions: ["dashboard.view"] }).expect(201)).body;
    const email = `${name.toLowerCase().replace(/\W/g, "")}-${tag}@example.com`;
    await api(app, admin).post("/users", { name: `${name} ${tag}`, email, role: role.key, password }).expect(201);
    const token = await signIn(app, email, password);
    return { token, id: (await api(app, token).get("/auth/me").expect(200)).body.id as string, name: `${name} ${tag}` };
  };
  const alerts = (userId: string, type: string) => db().notification.findMany({ where: { userId, type }, orderBy: { createdAt: "asc" } });

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);
    clock = app.get(Clock);
    sana = await signIn(app, "sana@example.com");
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    admin = await signIn(app, "admin@example.com", "Admin@12345");
    managerId = (await api(app, manager).get("/auth/me")).body.id;
    customerId = (await api(app, sana).post("/customers", { name: `Rules Co ${tag}`, country: "NG", contacts: [{ name: "Ade", email: `ade-${tag}@rules.test` }] }).expect(201)).body.id;
  });

  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await app?.close();
  });

  it("an open inquiry is never left without a next follow-up", async () => {
    const me = (await api(app, sana).get("/auth/me")).body.id as string;
    const inquiry = (await api(app, sana).post("/inquiries", { customerId, category: "Machinery", assigneeId: me, requirements: `Juice line ${tag}` }).expect(201)).body as { id: string };
    const today = clock.today();
    const add = async (title: string, extra: object = { inquiryId: inquiry.id }) => (await api(app, sana).post("/follow-ups", { title, dueOn: today, ...extra }).expect(201)).body as FollowUp;
    const get = async (id: string) => (await api(app, sana).get(`/follow-ups/${id}`).expect(200)).body as FollowUp;

    // Its only open follow-up: finishing it asks for the next one, and it cannot be removed.
    const first = await add("Reply to the customer");
    expect(first).toMatchObject({ needsNext: true, can: { done: true, delete: false } });
    const refused = await api(app, sana).post(`/follow-ups/${first.id}/done`, { note: "Called" }).expect(409);
    expect(refused.body).toMatchObject({ code: "next_follow_up" });
    expect((await api(app, sana).delete(`/follow-ups/${first.id}`).expect(409)).body).toMatchObject({ code: "last_follow_up" });
    expect((await get(first.id)).done).toBe(false);
    // The next one is a day from today on.
    await api(app, sana).post(`/follow-ups/${first.id}/done`, { next: { dueOn: addDays(today, -1) } }).expect(400);
    await api(app, sana).post(`/follow-ups/${first.id}/done`, { next: { dueOn: "soon" } }).expect(422);

    // Finished together with the next one, in one save.
    const nextDay = addDays(today, 3);
    const done = (await api(app, sana).post(`/follow-ups/${first.id}/done`, { note: "Called, no answer", next: { dueOn: nextDay, title: "Call again" } }).expect(200)).body as FollowUp;
    expect(done).toMatchObject({ done: true, needsNext: false });
    expect(done.next).toMatchObject({ title: "Call again", dueOn: nextDay, done: false, needsNext: true, assignee: { id: me } });
    const history = (await api(app, sana).get(`/history?type=deal&id=${inquiry.id}`).expect(200)).body as { summary: string }[];
    expect(history.map((h) => h.summary).join("\n")).toContain("Called, no answer");
    // Without a title the next one keeps the words of the one just done.
    const again = (await api(app, sana).post(`/follow-ups/${done.next!.id}/done`, { next: { dueOn: nextDay } }).expect(200)).body as FollowUp;
    expect(again.next).toMatchObject({ title: "Call again", needsNext: true });

    // With two open on the inquiry, finishing one is plain; the one left is the last again.
    const second = await add("Send the catalogue");
    expect((await get(again.next!.id)).needsNext).toBe(false);
    await api(app, sana).post(`/follow-ups/${second.id}/done`, {}).expect(200);
    expect(await get(again.next!.id)).toMatchObject({ needsNext: true, can: { delete: false } });

    // A follow-up that is not on an inquiry is finished and removed as before.
    const general = await add("Call the bank", { customerId });
    expect(general).toMatchObject({ needsNext: false, can: { delete: true } });
    await api(app, sana).post(`/follow-ups/${general.id}/done`, {}).expect(200);

    // The other way out: the inquiry is closed. Then nothing more is asked.
    await api(app, sana).post(`/inquiries/${inquiry.id}/stage`, { to: "lost", lostReason: "price_too_high", note: "Went elsewhere" }).expect(200);
    expect(await get(again.next!.id)).toMatchObject({ needsNext: false, can: { delete: true } });
    await api(app, sana).post(`/follow-ups/${again.next!.id}/done`, {}).expect(200);
  });

  it("a missed follow-up reminds every morning; after two days the managers and who gave it are told", async () => {
    // A quiet year, long before any other follow-up of the test data: only these are due.
    const day = "2021-03-10";
    const tz = clock.timeZone;
    const company = await prisma.platform.company.findUniqueOrThrow({ where: { id: FIRST_COMPANY_ID } });
    const run = () => CompanyContext.run(toInfo(company), () => app.get(RemindersService).followUps());
    const setNow = (time: string, on = day) => vi.spyOn(clock, "now").mockReturnValue(momentIn(on, time, tz));
    const me = await person("Forgetful");
    const giver = await person("Giver");

    setNow("12:00", addDays(day, -1));
    const f = (await api(app, giver.token).post("/follow-ups", { title: `Call Ade ${tag}`, dueOn: day, assigneeId: me.id }).expect(201)).body as FollowUp;

    // Before the morning hour nothing is sent; from 08:00 the day's reminder.
    setNow("07:30");
    await run();
    expect(await alerts(me.id, "followUp.due")).toHaveLength(0);
    setNow("08:00");
    await run();
    expect((await alerts(me.id, "followUp.due")).map((n) => n.title)).toEqual([`Today: Call Ade ${tag}`]);

    // The next day: not at night, then "missed 1 day" in the morning, once. Nobody else is told yet.
    setNow("03:00", addDays(day, 1));
    await run();
    expect(await alerts(me.id, "followUp.missed")).toHaveLength(0);
    setNow("08:05", addDays(day, 1));
    await run();
    await run();
    expect((await alerts(me.id, "followUp.missed")).map((n) => [n.title, n.link])).toEqual([[`Missed 1 day: Call Ade ${tag}`, "/follow-ups"]]);
    expect(await alerts(giver.id, "followUp.missedTold")).toHaveLength(0);
    expect((await alerts(managerId, "followUp.missedTold")).filter((n) => n.title.includes(tag))).toHaveLength(0);

    // Two days missed: the person again, and now the managers and who gave it. One email each (when email is set up).
    const notifications = app.get(NotificationsService);
    vi.spyOn(notifications, "canEmail").mockResolvedValue(true);
    const mails = vi.spyOn(notifications, "emailUser").mockResolvedValue(true);
    setNow("08:05", addDays(day, 2));
    await run();
    await run();
    expect((await alerts(me.id, "followUp.missed")).map((n) => n.title)).toEqual([`Missed 1 day: Call Ade ${tag}`, `Missed 2 days: Call Ade ${tag}`]);
    const told = `${me.name} missed a follow-up for 2 days: Call Ade ${tag}`;
    expect((await alerts(giver.id, "followUp.missedTold")).map((n) => n.title)).toEqual([told]);
    expect((await alerts(managerId, "followUp.missedTold")).map((n) => n.title)).toContain(told);
    const sentTo = (id: string) => mails.mock.calls.filter((c) => c[0] === id).map((c) => c[1]);
    expect(sentTo(me.id)).toEqual(["Your follow-ups: 1 missed"]);
    expect(sentTo(giver.id)).toEqual(["Missed follow-ups: 1"]);
    expect(sentTo(managerId)).toEqual(["Missed follow-ups: 1"]);
    expect(String(mails.mock.calls.find((c) => c[0] === me.id)![2].body)).toContain(`Call Ade ${tag} — missed 2 days`);

    // Moved to another day: it stops. Missed again after that day: it starts again.
    await api(app, me.token).patch(`/follow-ups/${f.id}`, { dueOn: addDays(day, 5) }).expect(200);
    setNow("08:05", addDays(day, 3));
    await run();
    expect(await alerts(me.id, "followUp.missed")).toHaveLength(2);
    setNow("08:05", addDays(day, 6));
    await run();
    expect((await alerts(me.id, "followUp.missed")).at(-1)!.title).toBe(`Missed 1 day: Call Ade ${tag}`);

    // Done: nothing more, for anyone.
    await api(app, me.token).post(`/follow-ups/${f.id}/done`, { note: "Spoke to Ade" }).expect(200);
    setNow("08:05", addDays(day, 9));
    await run();
    expect(await alerts(me.id, "followUp.missed")).toHaveLength(3);
    expect(await alerts(giver.id, "followUp.missedTold")).toHaveLength(1);
  });

  it("many missed follow-ups come as one summary, not one alert each", async () => {
    const day = "2021-06-10";
    const tz = clock.timeZone;
    const company = await prisma.platform.company.findUniqueOrThrow({ where: { id: FIRST_COMPANY_ID } });
    const run = () => CompanyContext.run(toInfo(company), () => app.get(RemindersService).followUps());
    const me = await person("Buried");
    vi.spyOn(clock, "now").mockReturnValue(momentIn(addDays(day, -1), "12:00", tz));
    for (const n of [1, 2, 3, 4]) await api(app, me.token).post("/follow-ups", { title: `Job ${n} ${tag}`, dueOn: addDays(day, n === 1 ? -1 : 0) }).expect(201);
    vi.spyOn(clock, "now").mockReturnValue(momentIn(addDays(day, 1), "09:00", tz));
    await run();
    const got = await alerts(me.id, "followUp.missed");
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ title: `4 follow-ups missed — the oldest, 2 days: Job 1 ${tag}`, link: "/follow-ups?status=late" });
    expect(got[0]!.body).toContain(`Job 3 ${tag} — missed 1 day`);
  });
});
