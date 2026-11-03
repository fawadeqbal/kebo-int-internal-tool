import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIRST_COMPANY_ID } from "@kebo/database";
import { api, signIn, startApp } from "./app";
import { PrismaService } from "../src/database/prisma.service";
import { CompaniesService } from "../src/common/company/companies.service";

type Row = { key: string; label: string; planned: string | null; spent: string; difference: string; status: string };
type Costs = {
  currency: string;
  totals: { planned: string; spent: string; notPlanned: string; receiptsMissing: number; chargedToCustomer: string; takenOffFactory: string };
  planned: Row[];
  steps: Record<string, { count: number; spent: string }>;
  expenses: { id: string; step: string | null; borneBy: string; ownMoney: boolean; repaid: { on: string } | null }[];
  profit: { sale: string; factory: string; planned: string; notPlanned: string; expected: string; onQuote: string; margin: number | null };
  toRepay: { person: { id: string }; currency: string; amount: string; items: { id: string }[] }[];
};

/**
 * Order flow v3, Costs: expenses on an order belong to a step and are borne by
 * us, the customer or the factory; planned costs from the quote against spent;
 * the profit now expected; paying back people who used their own money.
 */
describe("order costs", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sana: string;
  let manager: string;
  let sanaId: string;
  let orderId: string;
  let factoryId: string;
  let otherFactoryId: string;
  const tag = Date.now().toString(36);
  const today = new Date().toISOString().slice(0, 10);
  // Two days on: in the future whatever the business time zone.
  const later = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const costs = async (who = manager) => (await api(app, who).get(`/orders/${orderId}/costs`).expect(200)).body as Costs;
  const money = async (who = manager) => (await api(app, who).get(`/orders/${orderId}/money`).expect(200)).body;
  const add = (body: object, who = manager) =>
    api(app, who).post("/expenses", { orderId, currency: "USD", spentOn: today, ...body });
  const modulesOff = async (off: string[]) => {
    await prisma.platform.company.update({ where: { id: FIRST_COMPANY_ID }, data: { featuresOff: off } });
    app.get(CompaniesService).forget(FIRST_COMPANY_ID);
  };

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);
    sana = await signIn(app, "sana@example.com");
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    sanaId = (await api(app, sana).get("/auth/me")).body.id;
    // 10 pumps from an EXW factory at CNY 1,000 + 13% tax, sold CFR at USD 200 with USD 100 to the port and USD 300 freight planned.
    const customer = (
      await api(app, sana)
        .post("/customers", { name: `Costs Co ${tag}`, country: "GH", contacts: [{ name: "Ama", email: `ama-${tag}@costs.test` }] })
        .expect(201)
    ).body;
    const inquiry = (
      await api(app, sana)
        .post("/inquiries", { customerId: customer.id, category: "Machinery", assigneeId: sanaId, items: [{ description: "Pump", quantity: 10 }] })
        .expect(201)
    ).body;
    const item = (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.items[0];
    await api(app, sana)
      .post(`/inquiries/${inquiry.id}/factory-quotes`, {
        newFactoryName: `Costs Pumps ${tag}`,
        receivedOn: "2026-10-01",
        currency: "CNY",
        taxRate: 13,
        basis: "EXW",
        lines: [{ requestedItemId: item.id, description: "Pump", quantity: 10, unitPrice: 1000 }],
      })
      .expect(201);
    const draft = (await api(app, sana).get(`/inquiries/${inquiry.id}/quotation/draft`)).body;
    const options = [
      {
        ...draft.options[0],
        prices: draft.options[0].prices.map((p: Record<string, unknown>) => ({ ...p, unitPrice: 200 })),
        costs: [
          { step: "to_port", amount: 100, currency: "USD" },
          { step: "freight", amount: 300, currency: "USD" },
        ],
      },
    ];
    const r1 = (
      await api(app, sana)
        .post(`/inquiries/${inquiry.id}/quotation/revisions`, { ...draft, incoterm: "CFR", incotermPlace: "Tema", options })
        .expect(201)
    ).body;
    await api(app, sana).post(`/revisions/${r1.id}/status`, { to: "sent" }).expect(200);
    await api(app, sana).post(`/revisions/${r1.id}/status`, { to: "accepted" }).expect(200);
    orderId = (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.orders[0].id;
    factoryId = (await api(app, sana).get(`/factories?q=Costs Pumps ${tag}`)).body.rows[0].id;
    otherFactoryId = (await api(app, sana).post("/factories", { name: `Not on it ${tag}` }).expect(201)).body.id;
  });

  afterAll(async () => {
    await modulesOff([]).catch(() => undefined);
    await app?.close();
  });

  it("shows the planned costs against what was spent, and what was not planned", async () => {
    let c = await costs();
    expect(c.totals).toMatchObject({ planned: "400.00", spent: "0.00", notPlanned: "0.00" });
    expect(c.planned.map((r) => [r.key, r.planned, r.spent, r.status])).toEqual([
      ["plan:to_port", "100.00", "0.00", "not_spent"],
      ["plan:freight", "300.00", "0.00", "not_spent"],
    ]);
    const onQuote = Number(c.profit.onQuote);
    expect(onQuote).toBeCloseTo(Number(c.profit.sale) - Number(c.profit.factory) - 400, 2);
    expect(c.profit.expected).toBe(c.profit.onQuote);

    // Freight within the plan: no change to the expected profit. It lands on Shipping by its kind.
    const freight = (await add({ category: "freight", description: `Sea freight ${tag}`, amount: 250 }).expect(201)).body;
    expect(freight).toMatchObject({ step: "shipping", borneBy: "us", ownMoney: false });
    // A courier nobody planned, on the Documents step as sent.
    await add({ category: "courier", description: `DHL drawings ${tag}`, amount: 20, step: "production" }).expect(201);
    c = await costs();
    expect(c.planned.find((r) => r.key === "plan:freight")).toMatchObject({ spent: "250.00", difference: "50.00", status: "within" });
    expect(c.planned.find((r) => r.key === "other:courier")).toMatchObject({ planned: null, spent: "20.00", status: "not_planned" });
    expect(c.totals).toMatchObject({ spent: "270.00", notPlanned: "20.00", receiptsMissing: 2 });
    expect(c.steps.shipping).toEqual({ count: 1, spent: "250.00" });
    expect(c.steps.production).toEqual({ count: 1, spent: "20.00" });
    expect(Number(c.profit.expected)).toBeCloseTo(onQuote - 20, 2);

    // Over the planned freight, but still within the whole plan (to the port is not spent yet): the profit holds.
    await add({ category: "freight", description: `Freight surcharge ${tag}`, amount: 100 }).expect(201);
    c = await costs();
    expect(c.planned.find((r) => r.key === "plan:freight")).toMatchObject({ spent: "350.00", difference: "-50.00", status: "over" });
    expect(c.totals.notPlanned).toBe("20.00");
    // Beyond the whole plan, the extra cuts the profit.
    await add({ category: "inland_transport", description: `Truck to the port ${tag}`, amount: 100 }).expect(201);
    c = await costs();
    expect(c.planned.find((r) => r.key === "plan:to_port")).toMatchObject({ spent: "100.00", difference: "0.00", status: "spent" });
    expect(c.totals.notPlanned).toBe("70.00");
    expect(Number(c.profit.expected)).toBeCloseTo(onQuote - 70, 2);
    // The order's money page agrees (only expenses borne by us count, the planned kinds against the plan once).
    expect(Number((await money()).profit.earned)).toBeCloseTo(onQuote - 70, 2);

    // Its history is on the step it belongs to.
    const shipping = (await api(app, manager).get(`/history?type=order&id=${orderId}&step=shipping`).expect(200)).body as { summary: string }[];
    expect(shipping.map((h) => h.summary).join("\n")).toContain(`Sea freight ${tag}`);
  });

  it("adds an expense charged to the customer to what they owe, not to our costs", async () => {
    const before = await money();
    const c0 = await costs();
    expect(before.due).toBe("2000.00");
    await add({ category: "inspection", description: `Inspection for them ${tag}`, amount: 50, borneBy: "customer" }).expect(201);
    const after = await money();
    expect(after.due).toBe("2050.00");
    expect(after.chargedTotal).toBe("50.00");
    expect(after.charged).toEqual([expect.objectContaining({ description: `Inspection for them ${tag}`, amount: "50.00" })]);
    const c = await costs();
    expect(c.totals.chargedToCustomer).toBe("50.00");
    expect(c.profit.expected).toBe(c0.profit.expected);
    // Staff see what the customer owes, without the expenses.
    const staff = await money(sana);
    expect(staff.due).toBe("2050.00");
    expect(staff.expenses).toBeNull();
    // Only an order's expense can be charged to someone.
    await api(app, manager)
      .post("/expenses", { category: "meals", description: "Lunch", amount: 10, currency: "USD", spentOn: today, borneBy: "customer" })
      .expect(400);
  });

  it("takes an expense the factory bears off what we owe it", async () => {
    const owed = (await money()).factories.rows[0];
    expect(owed).toMatchObject({ currency: "CNY", owed: "11300.00", toPay: "11300.00" });
    // The factory must be said, and be on the order.
    await add({ category: "inspection", description: "Re-inspection", amount: 710, currency: "CNY", rate: 7.1, borneBy: "factory" }).expect(400);
    await add({ category: "inspection", description: "Re-inspection", amount: 710, currency: "CNY", rate: 7.1, borneBy: "factory", factoryId: otherFactoryId }).expect(400);
    await add({ category: "inspection", description: `Re-inspection ${tag}`, amount: 710, currency: "CNY", rate: 7.1, borneBy: "factory", factoryId }).expect(201);
    // Paid in USD: turned into CNY at the Settings rate.
    await add({ category: "courier", description: `Spare parts courier ${tag}`, amount: 10, borneBy: "factory", factoryId }).expect(201);
    const row = (await money()).factories.rows[0];
    const usdInCny = Number(row.takenOff) - 710;
    expect(usdInCny).toBeGreaterThan(10);
    expect(Number(row.toPay)).toBeCloseTo(11300 - 710 - usdInCny, 2);
    const c = await costs();
    expect(Number(c.totals.takenOffFactory)).toBeCloseTo(100 + 10, 1);
    // Not our cost.
    expect(c.totals.notPlanned).toBe("70.00");
    // What we owe factories across orders agrees.
    const payable = ((await api(app, manager).get("/money/payables").expect(200)).body as { factory: { id: string }; toPay: string }[]).find(
      (p) => p.factory.id === factoryId,
    );
    expect(payable?.toPay).toBe(row.toPay);
  });

  it("keeps who to repay when someone paid from their own money, until it is repaid", async () => {
    await add({ category: "hotel", description: "Hotel", amount: 860, currency: "CNY", rate: 7.1, ownMoney: true }).expect(400);
    const hotel = (
      await add({ category: "hotel", description: `Hotel ${tag}`, amount: 860, currency: "CNY", rate: 7.1, ownMoney: true, paidById: sanaId, step: "production" }).expect(201)
    ).body;
    expect(hotel).toMatchObject({ ownMoney: true, repaid: null, account: null });
    let c = await costs();
    expect(c.toRepay).toEqual([expect.objectContaining({ person: expect.objectContaining({ id: sanaId }), currency: "CNY", amount: "860.00" })]);
    expect(c.planned.find((r) => r.key === "other:travel")).toMatchObject({ label: "Travel and hotel", status: "not_planned" });

    await api(app, manager).post(`/expenses/${hotel.id}/repay`, { repaidOn: later }).expect(400);
    const freight = c.expenses.find((e) => !e.ownMoney)!;
    await api(app, manager).post(`/expenses/${freight.id}/repay`, { repaidOn: today }).expect(400);
    await api(app, sana).post(`/expenses/${hotel.id}/repay`, { repaidOn: today }).expect(403);
    const repaid = (await api(app, manager).post(`/expenses/${hotel.id}/repay`, { repaidOn: today }).expect(200)).body;
    expect(repaid.repaid).toMatchObject({ on: today });
    await api(app, manager).post(`/expenses/${hotel.id}/repay`, { repaidOn: today }).expect(400);
    c = await costs();
    expect(c.toRepay).toEqual([]);
    // A change from the Money page (which does not send the new fields) keeps them.
    const changed = (
      await api(app, manager)
        .patch(`/expenses/${hotel.id}`, { orderId, category: "hotel", description: `Hotel ${tag}`, amount: 860, currency: "CNY", spentOn: today, paidById: sanaId, reason: "Typo" })
        .expect(200)
    ).body;
    expect(changed).toMatchObject({ step: "production", borneBy: "us", ownMoney: true, repaid: { on: today } });
  });

  it("is for managers with the expenses feature only", async () => {
    await api(app, sana).get(`/orders/${orderId}/costs`).expect(403);
    await modulesOff(["expenses"]);
    try {
      await api(app, manager).get(`/orders/${orderId}/costs`).expect(403);
      const m = await money();
      expect(m.expenses).toBeNull();
      expect(m.profit).toBeNull();
      // Without the feature nothing is charged to the customer either.
      expect(m.due).toBe("2000.00");
    } finally {
      await modulesOff([]);
    }
  });

  it("keeps the repayment account inside the company", async () => {
    const other = await prisma.platform.company.create({ data: { slug: `co-${tag}`.slice(0, 30), name: `Costs other ${tag}` } });
    try {
      const account = await prisma.company(other.id).moneyAccount.create({
        data: { name: "Their cash", kind: "cash", currency: "CNY", openingBalance: 0, openingOn: new Date("2026-01-01") },
      });
      const mine = await prisma.company(FIRST_COMPANY_ID).expense.findFirstOrThrow({ where: { orderId, ownMoney: true } });
      await expect(
        prisma.company(FIRST_COMPANY_ID).expense.update({ where: { id: mine.id }, data: { repaidAccountId: account.id } }),
      ).rejects.toThrow(/another company|foreign key/);
      // Another company does not see the order's expenses.
      expect(await prisma.company(other.id).expense.count({ where: { orderId } })).toBe(0);
    } finally {
      await prisma.platform.moneyAccount.deleteMany({ where: { companyId: other.id } }).catch(() => undefined);
      await prisma.platform.company.delete({ where: { id: other.id } });
    }
  });
});
