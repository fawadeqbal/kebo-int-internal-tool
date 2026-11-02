import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";

/**
 * Home's "Needs attention" picks up the order flow: a factory that has not
 * answered, a production step past its date, the LC's last day to ship, and
 * an open claim. The factory's page shows how it answers and what it is making.
 */
describe("order flow on Home and the factory page", () => {
  let app: INestApplication;
  let sana: string;
  let bilal: string;
  let orderId: string;
  let inquiryId: string;
  let factoryId: string;
  let slowId: string;
  const tag = Date.now().toString(36);
  const titles = async (who: string) => ((await api(app, who).get("/reminders").expect(200)).body.items as { title: string; key: string }[]).map((i) => i.title);

  beforeAll(async () => {
    app = await startApp();
    sana = await signIn(app, "sana@example.com");
    bilal = await signIn(app, "bilal@example.com");
    const me = (await api(app, sana).get("/auth/me")).body.id;
    const customer = (await api(app, sana).post("/customers", { name: `Multan Foods ${tag}`, country: "PK", contacts: [{ name: "Asad", email: `asad-${tag}@mf.test` }] }).expect(201)).body;
    const inquiry = (await api(app, sana).post("/inquiries", { customerId: customer.id, category: "Machinery", assigneeId: me, items: [{ description: "Pouch filler", quantity: 1 }] }).expect(201)).body;
    inquiryId = inquiry.id;
    factoryId = (await api(app, sana).post("/factories", { name: `Ruian Pack ${tag}` }).expect(201)).body.id;
    slowId = (await api(app, sana).post("/factories", { name: `Slow Works ${tag}` }).expect(201)).body.id;
    // Asked a week ago; Ruian answers, Slow Works does not.
    const week = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    await api(app, sana).post(`/inquiries/${inquiryId}/factory-requests`, { factoryIds: [factoryId, slowId], sentOn: week, channel: "wechat" }).expect(201);
    const item = (await api(app, sana).get(`/inquiries/${inquiryId}`)).body.items[0];
    await api(app, sana)
      .post(`/inquiries/${inquiryId}/factory-quotes`, { factoryId, receivedOn: new Date(Date.now() - 4 * 86_400_000).toISOString().slice(0, 10), currency: "CNY", lines: [{ requestedItemId: item.id, description: "Pouch filler", quantity: 1, unitPrice: 90000 }] })
      .expect(201);
  });

  afterAll(async () => {
    await app?.close();
  });

  it("a factory that has not answered for days is on Home; one that answered is not", async () => {
    const t = await titles(sana);
    expect(t.some((x) => x.includes(`Slow Works ${tag} hasn't answered`))).toBe(true);
    expect(t.some((x) => x.includes(`Ruian Pack ${tag} hasn't answered`))).toBe(false);
    // Bilal neither handles the deal nor sees it.
    expect((await titles(bilal)).some((x) => x.includes(`Slow Works ${tag}`))).toBe(false);
  });

  it("late production, the LC's last day to ship and an open claim come up", async () => {
    const draft = (await api(app, sana).get(`/inquiries/${inquiryId}/quotation/draft`)).body;
    const r1 = (await api(app, sana).post(`/inquiries/${inquiryId}/quotation/revisions`, draft).expect(201)).body;
    await api(app, sana).post(`/revisions/${r1.id}/status`, { to: "sent" }).expect(200);
    await api(app, sana).post(`/revisions/${r1.id}/status`, { to: "accepted" }).expect(200);
    orderId = (await api(app, sana).get(`/inquiries/${inquiryId}`)).body.orders[0].id;
    const ago = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    await api(app, sana).put(`/orders/${orderId}/production`, { steps: [{ title: "Machining", factoryId, plannedOn: ago(4) }] }).expect(200);
    await api(app, sana).patch(`/orders/${orderId}/route`, { route: "letter_of_credit" }).expect(200);
    await api(app, sana).put(`/orders/${orderId}/bank-contract`, { number: `LC-${tag}`, status: "opened", latestShipOn: ago(-2) }).expect(200);
    await api(app, sana).post(`/orders/${orderId}/claims`, { title: "Wrong voltage", openedOn: ago(1) }).expect(201);
    const t = await titles(sana);
    expect(t).toEqual(expect.arrayContaining([expect.stringContaining(`"Machining" was planned for ${ago(4)}`), expect.stringContaining(`must ship by ${ago(-2)} under LC LC-${tag}`), expect.stringContaining('claim "Wrong voltage"')]));
  });

  it("the factory page shows how it answers and what it is making", async () => {
    const f = (await api(app, sana).get(`/factories/${factoryId}`).expect(200)).body;
    expect(f.record).toMatchObject({ asked: 1, answered: 1, avgDaysToAnswer: 3, lateSteps: 1 });
    expect(f.record.openOrders.map((o: { id: string }) => o.id)).toContain(orderId);
    const slow = (await api(app, sana).get(`/factories/${slowId}`).expect(200)).body;
    expect(slow.record).toMatchObject({ asked: 1, answered: 0, avgDaysToAnswer: null, openOrders: [] });
    // Someone who does not handle the order does not see it listed.
    const m = await signIn(app, "manager@example.com", "Manager@12345");
    expect((await api(app, m).get(`/factories/${factoryId}`).expect(200)).body.record.openOrders.map((o: { id: string }) => o.id)).toContain(orderId);
  });
});
