import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays } from "@kebo/utils";
import { api, signIn, startApp } from "./app";
import { Clock } from "../src/common/time/clock.service";

type FollowUp = { id: string; title: string; dueOn: string; done: boolean; doneNote: string | null; needsNext: boolean; assignee: { id: string }; next?: FollowUp | null };

/**
 * Step 2 of reminding (claude/reminders-how-it-works.md): the system sets the first follow-ups itself — a new
 * inquiry: reply within a day; a quotation sent: follow up after 3, then 7, then 14 days — and closes its own
 * when what they wait for happens.
 */
describe("the system sets the first follow-ups itself", () => {
  let app: INestApplication;
  let sana: string;
  let manager: string;
  let me: string;
  let bilalId: string;
  let customerId: string;
  let today: string;
  const tag = Date.now().toString(36);

  beforeAll(async () => {
    app = await startApp();
    sana = await signIn(app, "sana@example.com");
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    me = (await api(app, sana).get("/auth/me")).body.id;
    bilalId = (await api(app, await signIn(app, "bilal@example.com")).get("/auth/me")).body.id;
    today = app.get(Clock).today();
    customerId = (await api(app, sana).post("/customers", { name: `Auto Co ${tag}`, country: "NG", contacts: [{ name: "Ade", email: `ade-${tag}@auto.test` }] }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  const all = async (inquiryId: string) => (await api(app, manager).get(`/follow-ups?inquiryId=${inquiryId}`).expect(200)).body.rows as FollowUp[];
  const open = async (inquiryId: string) => (await all(inquiryId)).filter((f) => !f.done);
  const inquiry = async (as: string, assigneeId?: string) =>
    (
      await api(app, as)
        .post("/inquiries", { customerId, category: "Machinery", ...(assigneeId ? { assigneeId } : {}), items: [{ description: `Filler ${tag}`, quantity: 1, unit: "set" }] })
        .expect(201)
    ).body as { id: string; refNo: string };
  /** A quotation from one factory offer, sent to the customer. */
  const quote = async (inquiryId: string) => {
    const items = (await api(app, sana).get(`/inquiries/${inquiryId}`).expect(200)).body.items as { id: string; description: string; quantity: string }[];
    await api(app, sana)
      .post(`/inquiries/${inquiryId}/factory-quotes`, {
        newFactoryName: `Auto Works ${tag} ${Math.random().toString(36).slice(2, 6)}`,
        receivedOn: today,
        currency: "CNY",
        lines: items.map((i) => ({ requestedItemId: i.id, description: i.description, quantity: Number(i.quantity), unitPrice: "1000" })),
      })
      .expect(201);
    const draft = (await api(app, sana).get(`/inquiries/${inquiryId}/quotation/draft`).expect(200)).body;
    const made = await api(app, sana).post(`/inquiries/${inquiryId}/quotation/revisions`, draft);
    if (made.status !== 201) throw new Error(`revision: ${made.status} ${JSON.stringify(made.body).slice(0, 300)}`);
    const r = made.body as { id: string; number: number };
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "sent" }).expect(200);
    return r;
  };

  it("a new inquiry gets 'Reply to the customer' a day on, for who handles it", async () => {
    const i = await inquiry(sana, me);
    const rows = await open(i.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: "Reply to the customer", dueOn: addDays(today, 1), assignee: { id: me }, needsNext: true });
    // It is in the inquiry's history.
    const history = (await api(app, sana).get(`/history?type=deal&id=${i.id}`).expect(200)).body as { summary: string }[];
    expect(history.some((h) => h.summary.includes("follow-up set for Sana") && h.summary.includes("Reply to the customer"))).toBe(true);
  });

  it("an inquiry nobody handles yet gets it when someone is given it, once", async () => {
    const i = await inquiry(manager);
    expect(await all(i.id)).toHaveLength(0);
    await api(app, manager).post(`/inquiries/${i.id}/assign`, { assigneeId: me }).expect(200);
    expect(await open(i.id)).toMatchObject([{ title: "Reply to the customer", assignee: { id: me } }]);
    // Given to someone else: no second one.
    await api(app, manager).post(`/inquiries/${i.id}/assign`, { assigneeId: bilalId, reason: "Workload" }).expect(200);
    expect(await all(i.id)).toHaveLength(1);
  });

  it("a quotation sent: the reply is done, and the follow-ups come 3, 7 and 14 days after", async () => {
    const i = await inquiry(sana, me);
    const mine = (await api(app, sana).post("/follow-ups", { title: `Send the catalogue ${tag}`, dueOn: today, inquiryId: i.id }).expect(201)).body as FollowUp;
    const r = await quote(i.id);
    const rows = await all(i.id);
    // The system closed its own; the person's own stays.
    expect(rows.find((f) => f.title === "Reply to the customer")).toMatchObject({ done: true, doneNote: expect.stringContaining("sent") });
    expect(rows.find((f) => f.id === mine.id)).toMatchObject({ done: false });
    await api(app, sana).post(`/follow-ups/${mine.id}/done`, {}).expect(200);
    const first = (await open(i.id))[0]!;
    expect(first.title).toMatch(new RegExp(`^Follow up quotation QUO-.* R${r.number}$`));
    expect(first).toMatchObject({ dueOn: addDays(today, 3), assignee: { id: me }, needsNext: false });

    // Done with one click: the system sets the next, 7 days after it was sent; then 14.
    const second = ((await api(app, sana).post(`/follow-ups/${first.id}/done`, { note: "No answer yet" }).expect(200)).body as FollowUp).next!;
    expect(second).toMatchObject({ title: first.title, dueOn: addDays(today, 7), needsNext: false, assignee: { id: me } });
    const third = ((await api(app, sana).post(`/follow-ups/${second.id}/done`, {}).expect(200)).body as FollowUp).next!;
    expect(third).toMatchObject({ dueOn: addDays(today, 14), needsNext: true });
    // After the third the person says when (rule 1).
    expect((await api(app, sana).post(`/follow-ups/${third.id}/done`, {}).expect(409)).body).toMatchObject({ code: "next_follow_up" });
    expect(await open(i.id)).toHaveLength(1);
  });

  it("the customer answers, or the inquiry is lost: the system's follow-ups end; people's own stay", async () => {
    const i = await inquiry(sana, me);
    const r = await quote(i.id);
    expect(await open(i.id)).toHaveLength(1);
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "rejected", reason: "Too expensive" }).expect(200);
    const rows = await all(i.id);
    expect(rows.filter((f) => !f.done)).toHaveLength(0);
    expect(rows.find((f) => f.title.startsWith("Follow up quotation"))).toMatchObject({ done: true, doneNote: expect.stringContaining("rejected") });

    const j = await inquiry(sana, me);
    const own = (await api(app, sana).post("/follow-ups", { title: `Visit them ${tag}`, dueOn: today, inquiryId: j.id }).expect(201)).body as FollowUp;
    await api(app, sana).post(`/inquiries/${j.id}/stage`, { to: "lost", lostReason: "price_too_high", note: "Went elsewhere" }).expect(200);
    const after = await all(j.id);
    expect(after.find((f) => f.title === "Reply to the customer")).toMatchObject({ done: true, doneNote: "Inquiry lost" });
    expect(after.find((f) => f.id === own.id)).toMatchObject({ done: false });
  });
});
