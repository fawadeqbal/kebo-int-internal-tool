import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";
import { today } from "./dates";
import { PrismaService } from "../src/database/prisma.service";

type Row = {
  key: string;
  kind: "goods" | "cost" | "bank" | "estimate";
  label: string;
  category: string | null;
  owedTo: string | null;
  from: string;
  amount: string;
  currency: string;
  inOrder: string | null;
  paidInOrder: string | null;
  toPayInOrder: string | null;
  state: string;
  borneBy: string;
  expenseId: string | null;
};
type Sheet = { rows: Row[]; total: string; costs: string; paid: string; toPay: string; profit: string; margin: number | null };

/**
 * Money, step 2: the order's cost sheet. A cost counts as soon as it is known and is marked paid when it is
 * paid; the freight and the insurance premium typed on a shipment are costs by themselves and follow the
 * shipment until they are paid; an unpaid bill is a cost already and cash only once it is paid.
 */
describe("the order's cost sheet", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sana: string;
  let manager: string;
  let sanaId: string;
  let orderId: string;
  let shipmentId: string;
  const tag = Date.now().toString(36);
  const sheet = async () => (await api(app, manager).get(`/orders/${orderId}/costs`).expect(200)).body.sheet as Sheet;
  const profit = async () => (await api(app, manager).get(`/orders/${orderId}/money`).expect(200)).body.profit as { expected: string; cash: string; expenses: string };
  const cost = (s: Sheet, from: string, category: string) => s.rows.find((r) => r.kind === "cost" && r.from === from && r.category === category);
  const ship = (body: object) => api(app, sana).patch(`/shipments/${shipmentId}`, body).expect(200);
  const bills = async () =>
    Number(
      (
        await prisma.platform.$queryRaw<{ open: string }[]>`
          select coalesce(sum(l.credit - l.debit), 0)::text as open from ledger_entries l
           where l.account = 'bills' and l.order_id = ${orderId}::uuid`
      )[0]!.open,
    );

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);
    sana = await signIn(app, "sana@example.com");
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    sanaId = (await api(app, sana).get("/auth/me")).body.id;
    // 10 pumps from a factory at CNY 1,000, sold CFR at USD 200 with USD 100 to the port and USD 300 freight set aside on the quotation.
    const customer = (await api(app, sana).post("/customers", { name: `Sheet Co ${tag}`, country: "GH", contacts: [{ name: "Ama", email: `ama-${tag}@sheet.test` }] }).expect(201)).body;
    const inquiry = (await api(app, sana).post("/inquiries", { customerId: customer.id, category: "Machinery", assigneeId: sanaId, items: [{ description: "Pump", quantity: 10 }] }).expect(201)).body;
    const item = (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.items[0];
    await api(app, sana)
      .post(`/inquiries/${inquiry.id}/factory-quotes`, { newFactoryName: `Sheet Pumps ${tag}`, receivedOn: "2026-10-01", currency: "CNY", lines: [{ requestedItemId: item.id, description: "Pump", quantity: 10, unitPrice: 1000 }] })
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
    const r1 = (await api(app, sana).post(`/inquiries/${inquiry.id}/quotation/revisions`, { ...draft, incoterm: "CFR", incotermPlace: "Tema", options }).expect(201)).body;
    await api(app, sana).post(`/revisions/${r1.id}/status`, { to: "sent" }).expect(200);
    await api(app, sana).post(`/revisions/${r1.id}/status`, { to: "accepted" }).expect(200);
    orderId = (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.orders[0].id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("starts with the goods and what the quotation set aside, and they add up to the costs", async () => {
    const s = await sheet();
    expect(s.total).toBe("2000.00");
    expect(s.rows.map((r) => [r.kind, r.from, r.state])).toEqual([
      ["goods", "factory", "to_pay"],
      ["estimate", "quotation", "estimate"],
    ]);
    const [goods, estimate] = s.rows;
    expect(goods).toMatchObject({ owedTo: `Sheet Pumps ${tag}`, amount: "10000.00", currency: "CNY", paidInOrder: "0.00" });
    expect(estimate).toMatchObject({ label: "To the port, Sea freight", inOrder: "400.00" });
    expect(Number(s.costs)).toBeCloseTo(Number(goods!.inOrder) + 400, 2);
    expect(Number(s.profit)).toBeCloseTo(2000 - Number(s.costs), 2);
    expect(s.paid).toBe("0.00");
    expect(Number(s.toPay)).toBeCloseTo(Number(goods!.inOrder), 2);
    expect(s.profit).toBe((await profit()).expected);
  });

  it("the freight typed on a shipment is a cost by itself, owed to the forwarder, and takes the place of the estimate", async () => {
    const before = await sheet();
    const made = (await api(app, sana).post(`/orders/${orderId}/shipments`, { mode: "sea", forwarder: "Sino-Africa Logistics", freightAmount: 350, freightCurrency: "USD", freightTerms: "prepaid" }).expect(201)).body;
    shipmentId = made.shipping.shipments[0].id;
    let s = await sheet();
    const freight = cost(s, "shipment", "freight")!;
    expect(freight).toMatchObject({ label: "Sea freight", owedTo: "Sino-Africa Logistics", amount: "350.00", currency: "USD", state: "to_pay", toPayInOrder: "350.00", paidInOrder: "0.00" });
    // 350 of the 400 set aside is now a real cost: 50 is still an estimate, and the profit has not moved.
    expect(s.rows.find((r) => r.kind === "estimate")).toMatchObject({ inOrder: "50.00" });
    expect(s.costs).toBe(before.costs);
    expect(s.profit).toBe(before.profit);
    // A new amount on the shipment: the cost follows, and beyond what was set aside it cuts the profit.
    await ship({ freightAmount: 450 });
    s = await sheet();
    expect(cost(s, "shipment", "freight")).toMatchObject({ amount: "450.00", expenseId: freight.expenseId });
    expect(s.rows.some((r) => r.kind === "estimate")).toBe(false);
    expect(Number(s.profit)).toBeCloseTo(Number(before.profit) - 50, 2);
    expect(s.profit).toBe((await profit()).expected);
  });

  it("a cost that follows its shipment is changed there, not on the sheet", async () => {
    const id = cost(await sheet(), "shipment", "freight")!.expenseId!;
    const edit = await api(app, manager).patch(`/expenses/${id}`, { orderId, category: "freight", description: "Sea freight", amount: 1, currency: "USD", spentOn: today, reason: "typed here" }).expect(400);
    expect(edit.body.error).toMatch(/comes from the shipment/);
    expect((await api(app, manager).post(`/expenses/${id}/void`, { reason: "not wanted" }).expect(400)).body.error).toMatch(/comes from the shipment/);
  });

  it("an unpaid bill is a cost already and cash only once it is paid", async () => {
    const id = cost(await sheet(), "shipment", "freight")!.expenseId!;
    expect((await profit()).cash).toBe("0.00");
    expect(await bills()).toBe(450);
    await api(app, manager).post(`/expenses/${id}/repay`, { repaidOn: today }).expect(200);
    const s = await sheet();
    expect(cost(s, "shipment", "freight")).toMatchObject({ state: "paid", paidInOrder: "450.00", toPayInOrder: "0.00" });
    expect(s.paid).toBe("450.00");
    expect((await profit()).cash).toBe("-450.00");
    expect(await bills()).toBe(0);
    // Paid twice is refused.
    expect((await api(app, manager).post(`/expenses/${id}/repay`, { repaidOn: today }).expect(400)).body.error).toMatch(/already paid/);
  });

  it("once paid it is what was paid: the shipment no longer moves it", async () => {
    await ship({ freightAmount: 500 });
    expect(cost(await sheet(), "shipment", "freight")).toMatchObject({ amount: "450.00", state: "paid" });
  });

  it("the insurance premium is a cost too, and goes when it is cleared; freight on “collect” is not ours", async () => {
    await ship({ insurer: "PICC", insurancePremium: 80, insuranceCurrency: "USD" });
    let s = await sheet();
    expect(cost(s, "shipment", "insurance")).toMatchObject({ label: "Cargo insurance", owedTo: "PICC", amount: "80.00", state: "to_pay" });
    await ship({ insurancePremium: null });
    s = await sheet();
    expect(cost(s, "shipment", "insurance")).toBeUndefined();
    // A second shipment whose freight the customer pays: nothing is added.
    const two = (await api(app, sana).post(`/orders/${orderId}/shipments`, { mode: "air", freightAmount: 900, freightCurrency: "USD", freightTerms: "collect" }).expect(201)).body.shipping.shipments[1];
    s = await sheet();
    expect(s.rows.filter((r) => r.from === "shipment")).toHaveLength(1);
    // The same shipment on "prepaid": its freight is a cost; removing the shipment removes the cost with it.
    await api(app, sana).patch(`/shipments/${two.id}`, { freightTerms: "prepaid" }).expect(200);
    s = await sheet();
    expect(s.rows.filter((r) => r.from === "shipment").map((r) => [r.label, r.amount, r.state])).toEqual([
      ["Sea freight", "450.00", "paid"],
      ["Air freight (shipment 2)", "900.00", "to_pay"],
    ]);
    await api(app, sana).delete(`/shipments/${two.id}`).expect(200);
    s = await sheet();
    expect(s.rows.filter((r) => r.from === "shipment").map((r) => r.amount)).toEqual(["450.00"]);
    expect(await bills()).toBe(0);
  });

  it("a cost added by hand waits under “to pay” as a bill until it is paid, or was paid by someone from their own money", async () => {
    const before = await sheet();
    const bill = (await api(app, manager).post("/expenses", { orderId, category: "inspection", description: "SGS inspection", amount: 120, currency: "USD", spentOn: today, payLater: true, payee: "SGS" }).expect(201)).body;
    expect(bill).toMatchObject({ payLater: true, payee: "SGS", account: null, repaid: null });
    const own = (await api(app, manager).post("/expenses", { orderId, category: "courier", description: "DHL documents", amount: 30, currency: "USD", spentOn: today, ownMoney: true, payLater: true, paidById: sanaId }).expect(201)).body;
    // Someone's own money is not a bill: it is owed to the person.
    expect(own).toMatchObject({ ownMoney: true, payLater: false });
    let s = await sheet();
    expect(s.rows.find((r) => r.expenseId === bill.id)).toMatchObject({ from: "typed", owedTo: "SGS", state: "to_pay", toPayInOrder: "120.00" });
    expect(s.rows.find((r) => r.expenseId === own.id)).toMatchObject({ state: "to_repay", toPayInOrder: "30.00" });
    expect(Number(s.costs)).toBeCloseTo(Number(before.costs) + 150, 2);
    expect(Number(s.toPay)).toBeCloseTo(Number(before.toPay) + 150, 2);
    expect(await bills()).toBe(120);
    // A bill that waits can be changed and removed here.
    await api(app, manager).patch(`/expenses/${bill.id}`, { orderId, category: "inspection", description: "SGS inspection", amount: 140, currency: "USD", spentOn: today, reason: "their bill" }).expect(200);
    expect(await bills()).toBe(140);
    await api(app, manager).post(`/expenses/${bill.id}/repay`, { repaidOn: today }).expect(200);
    await api(app, manager).post(`/expenses/${own.id}/repay`, { repaidOn: today }).expect(200);
    s = await sheet();
    expect(s.rows.find((r) => r.expenseId === bill.id)).toMatchObject({ amount: "140.00", state: "paid", paidInOrder: "140.00" });
    expect(s.rows.find((r) => r.expenseId === own.id)).toMatchObject({ state: "paid" });
    expect(await bills()).toBe(0);
    expect(Number(s.costs)).toBeCloseTo(Number(s.paid) + Number(s.toPay), 2);
  });

  it("a paid bill shows among the payments on the day it was paid, and an unpaid one does not", async () => {
    const waiting = (await api(app, manager).post("/expenses", { orderId, category: "customs", description: "Export clearance", amount: 75, currency: "USD", spentOn: today, payLater: true, payee: "Broker" }).expect(201)).body;
    const list = (await api(app, manager).get(`/treasury/payments?order=${orderId}`).expect(200)).body as { rows: { id: string }[] };
    const ids = list.rows.map((r) => r.id);
    expect(ids).not.toContain(waiting.id);
    const paid = (await sheet()).rows.filter((r) => r.kind === "cost" && r.state === "paid").map((r) => r.expenseId);
    for (const id of paid) expect(ids).toContain(id);
    expect(await bills()).toBe(75);
  });

  it("the company's open bills list what waits to be paid, and who is to be paid back (money, step 3)", async () => {
    const own = (await api(app, manager).post("/expenses", { orderId, category: "travel", description: "Train to the port", amount: 40, currency: "USD", spentOn: today, ownMoney: true, paidById: sanaId }).expect(201)).body;
    const list = (await api(app, manager).get("/money/bills").expect(200)).body as { rows: { id: string; kind: string; owedTo: string | null; order: { id: string } | null; amount: string; currency: string; days: number }[]; totals: { currency: string; open: string; count: number }[] };
    const mine = list.rows.filter((r) => r.order?.id === orderId);
    expect(mine.map((r) => [r.kind, r.owedTo, r.amount]).sort()).toEqual(
      [
        ["bill", "Broker", "75.00"],
        ["repay", (await api(app, sana).get("/auth/me")).body.name, "40.00"],
      ].sort(),
    );
    expect(mine.every((r) => r.days === 0)).toBe(true);
    const usd = list.totals.find((t) => t.currency === "USD")!;
    expect(Number(usd.open)).toBeCloseTo(list.rows.filter((r) => r.currency === "USD").reduce((t, r) => t + Number(r.amount), 0), 2);
    // Paid back: it leaves the list.
    await api(app, manager).post(`/expenses/${own.id}/repay`, { repaidOn: today }).expect(200);
    const after = (await api(app, manager).get("/money/bills").expect(200)).body as typeof list;
    expect(after.rows.some((r) => r.id === own.id)).toBe(false);
    // Only people who see expenses open it.
    await api(app, sana).get("/money/bills").expect(403);
  });
});
