import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";

/** What one person spent (the person's page): by kind and by what for, what their profit after all costs takes off, and what is owed back. */
describe("person spending", () => {
  let app: INestApplication;
  let sana: string;
  let manager: string;
  let sanaId: string;
  let managerId: string;
  let customerId: string;
  let lostDeal: string;
  let ownId: string;
  const tag = Date.now().toString(36);
  // A day of its own in a past year, so other costs in the database (and earlier runs) stay out of the sums.
  const day = new Date(Date.UTC(2015, 0, 1) + (Date.now() % 1800) * 86_400_000).toISOString().slice(0, 10);
  const range = `from=${day}&to=${day}`;
  const spend = (body: Record<string, unknown>) => api(app, manager).post("/expenses", { currency: "USD", spentOn: day, ...body });

  beforeAll(async () => {
    app = await startApp();
    sana = await signIn(app, "sana@example.com");
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    sanaId = (await api(app, sana).get("/auth/me")).body.id;
    managerId = (await api(app, manager).get("/auth/me")).body.id;
    customerId = (
      await api(app, sana)
        .post("/customers", { name: `Quetta Fruits ${tag}`, country: "PK", contacts: [{ name: "Baloch", email: `b-${tag}@qf.test` }] })
        .expect(201)
    ).body.id;
    lostDeal = (await api(app, sana).post("/inquiries", { customerId, category: "Machinery", assigneeId: sanaId, items: [{ description: "Juice press", quantity: 1 }] }).expect(201))
      .body.id;
    await api(app, sana).post(`/inquiries/${lostDeal}/stage`, { to: "lost", lostReason: "price_too_high" }).expect(200);
  });

  afterAll(async () => {
    await app?.close();
  });

  it("adds up what a person paid by kind and by what for; recorded with nobody named counts for who recorded it", async () => {
    ownId = (await spend({ inquiryId: lostDeal, category: "travel", description: `Train to see the press ${tag}`, amount: 100, ownMoney: true, paidById: sanaId }).expect(201)).body.id;
    await spend({ customerId, category: "meals", description: `Dinner ${tag}`, amount: 40, paidById: sanaId }).expect(201);
    await spend({ category: "office", description: `Document ${tag}`, amount: 25 }).expect(201); // nobody named: the manager's

    await api(app, sana).get(`/people/${sanaId}/spending?${range}`).expect(403);
    const s = (await api(app, manager).get(`/people/${sanaId}/spending?${range}`).expect(200)).body;
    expect(s).toMatchObject({ person: { id: sanaId }, currency: "USD", spent: "140.00", count: 2, outside: "140.00" });
    expect(s.byFor).toMatchObject({ orders: "0.00", before: "0.00", lost: "100.00", open: "0.00", customers: "40.00", company: "0.00" });
    expect(s.byKind).toEqual([
      { category: "travel", amount: "100.00" },
      { category: "meals", amount: "40.00" },
    ]);
    expect(s.latest.map((r: { description: string; for: string; paid: string }) => [r.description, r.for, r.paid])).toEqual(
      expect.arrayContaining([
        [`Train to see the press ${tag}`, "lost", "own"],
        [`Dinner ${tag}`, "customers", "account"],
      ]),
    );

    const m = (await api(app, manager).get(`/people/${managerId}/spending?${range}`).expect(200)).body;
    expect(m.byFor.company).toBe("25.00");
    expect(m.outside).toBe("0.00"); // the company's own costs are not taken off anyone's profit
    expect(m.latest[0]).toMatchObject({ description: `Document ${tag}`, recordedOnly: true });
  });

  it("lists what is owed back to them, whenever it was spent, until it is paid back", async () => {
    const before = (await api(app, manager).get(`/people/${sanaId}/spending`).expect(200)).body;
    expect(before.owed.rows.map((r: { id: string }) => r.id)).toContain(ownId);
    expect(before.owed.total.find((t: { currency: string }) => t.currency === "USD").ids).toContain(ownId);
    await api(app, manager).post(`/expenses/${ownId}/repay`, { repaidOn: day }).expect(200);
    const after = (await api(app, manager).get(`/people/${sanaId}/spending`).expect(200)).body;
    expect(after.owed.rows.map((r: { id: string }) => r.id)).not.toContain(ownId);
    const again = (await api(app, manager).get(`/people/${sanaId}/spending?${range}`).expect(200)).body;
    expect(again.latest.find((r: { id: string }) => r.id === ownId).paid).toBe("own_repaid");
  });

  it("Reports › Spending: spent to sell, who spends, lost inquiries by reason, supplier visits, and the company's own costs apart", async () => {
    await api(app, sana).get(`/reports/spending?${range}`).expect(403);
    const r = (await api(app, manager).get(`/reports/spending?${range}`).expect(200)).body;
    // The train on the lost inquiry and the dinner with the customer are spent to sell; the paper is the company's.
    expect(r).toMatchObject({ currency: "USD", toSell: "140.00", company: "25.00", lost: { spent: "100.00", deals: 1 }, onWon: "0.00" });
    expect(r.people.find((p: { person: { id: string } }) => p.person.id === sanaId)).toMatchObject({ spent: "140.00", toSell: "140.00", lost: "100.00" });
    expect(r.people.find((p: { person: { id: string } }) => p.person.id === managerId)).toMatchObject({ spent: "25.00", toSell: "0.00" });
    expect(r.lostReasons).toEqual([{ reason: "price_too_high", deals: 1, spent: "100.00" }]);
    expect(r.customers).toEqual([{ customer: { id: customerId, name: `Quetta Fruits ${tag}` }, spent: "140.00" }]);
    expect(r.months).toEqual([{ month: day.slice(0, 7), toSell: "140.00" }]);
  });

  it("Reports › Spending stops at today, as the cash report does: an end far ahead, or a start after the end", async () => {
    const far = (await api(app, manager).get(`/reports/spending?from=${day}&to=9999-12-31`).expect(200)).body;
    const today = new Date().toISOString().slice(0, 10);
    // Today in the company's time zone: the API's day can be a day either side of UTC's.
    expect(Math.abs(Date.parse(far.to) - Date.parse(today))).toBeLessThanOrEqual(86_400_000);
    expect(far.months.at(-1).month).toBe(far.to.slice(0, 7));
    const backwards = (await api(app, manager).get(`/reports/spending?from=9999-01-01&to=${day}`).expect(200)).body;
    expect(backwards).toMatchObject({ from: day, to: day, toSell: "140.00" });
  });
});
