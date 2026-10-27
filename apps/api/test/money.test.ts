import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";

/**
 * Step 2: the customer's payment plan, what we owe and paid each factory,
 * expenses (managers only) and profit & loss per order and per month.
 */
describe("money", () => {
  let app: INestApplication;
  let sana: string;
  let bilal: string;
  let manager: string;
  let sanaId: string;
  let orderId: string;
  let factoryId: string;
  const tag = Date.now().toString(36);
  const money = async (who = sana) => (await api(app, who).get(`/orders/${orderId}/money`).expect(200)).body;
  const today = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    app = await startApp();
    sana = await signIn(app, "sana@example.com");
    bilal = await signIn(app, "bilal@example.com");
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    sanaId = (await api(app, sana).get("/auth/me")).body.id;
    // Sana's deal: 10 pumps from a new factory at CNY 1,000 + 13% tax each, quoted at a margin, accepted.
    const customer = (
      await api(app, sana)
        .post("/customers", { name: `Accra Water ${tag}`, country: "GH", contacts: [{ name: "Kofi", email: `kofi-${tag}@accra.test` }] })
        .expect(201)
    ).body;
    const inquiry = (
      await api(app, sana)
        .post("/inquiries", {
          customerId: customer.id,
          category: "Machinery",
          assigneeId: sanaId,
          items: [{ description: "Centrifugal pump", quantity: 10 }],
        })
        .expect(201)
    ).body;
    const item = (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.items[0];
    await api(app, sana)
      .post(`/inquiries/${inquiry.id}/factory-quotes`, {
        newFactoryName: `Wenling Pumps ${tag}`,
        receivedOn: "2026-10-01",
        currency: "CNY",
        lines: [{ requestedItemId: item.id, description: "Centrifugal pump", quantity: 10, unitPrice: 1000 }],
      })
      .expect(201);
    const draft = (await api(app, sana).get(`/inquiries/${inquiry.id}/quotation/draft`)).body;
    const options = [{ ...draft.options[0], prices: draft.options[0].prices.map((p: Record<string, unknown>) => ({ ...p, unitPrice: 200 })) }];
    const r1 = (
      await api(app, sana)
        .post(`/inquiries/${inquiry.id}/quotation/revisions`, { ...draft, options })
        .expect(201)
    ).body;
    await api(app, sana).post(`/revisions/${r1.id}/status`, { to: "sent" }).expect(200);
    await api(app, sana).post(`/revisions/${r1.id}/status`, { to: "accepted" }).expect(200);
    orderId = (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.orders[0].id;
    factoryId = (await api(app, sana).get(`/factories?q=Wenling Pumps ${tag}`)).body.rows[0].id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("starts the order with a plan from its terms, and shows what we owe the factory", async () => {
    const m = await money();
    expect(m).toMatchObject({ currency: "USD", total: "2000.00" });
    expect(m.plan.items.map((i: { label: string; amount: string; status: string }) => [i.label, i.amount, i.status])).toEqual([
      ["Deposit 30%", "600.00", "open"],
      ["Balance", "1400.00", "open"],
    ]);
    expect(m.plan.items[0].dueOn).not.toBeNull();
    expect(m.plan).toMatchObject({ matchesTotal: true, next: { label: "Deposit 30%", open: "600.00" } });
    // 10 × (1,000 + 13%) = CNY 11,300, looked after by Sana who added the factory.
    expect(m.factories.rows).toEqual([
      expect.objectContaining({
        factory: expect.objectContaining({ id: factoryId }),
        currency: "CNY",
        owed: "11300.00",
        paid: "0.00",
        toPay: "11300.00",
        lookedAfterBy: { id: sanaId, name: expect.any(String) },
      }),
    ]);
    // Staff see the plan and factory costs, never expenses or profit.
    expect(m.expenses).toBeNull();
    expect(m.profit).toBeNull();
    await api(app, bilal).get(`/orders/${orderId}/money`).expect(404);
  });

  it("changes the plan freely before any payment; it must add up to the total", async () => {
    const plan = (items: { label: string; amount: number; dueOn?: string | null }[], reason?: string) =>
      api(app, sana).put(`/orders/${orderId}/payment-plan`, { items, reason });
    expect(
      (
        await plan([
          { label: "Deposit", amount: 500 },
          { label: "Balance", amount: 1400 },
        ]).expect(400)
      ).body.error,
    ).toMatch(/add up to USD 1,900.00, but the order is USD 2,000.00/);
    const m = (
      await plan([
        { label: "Deposit", amount: 600, dueOn: today },
        { label: "Second", amount: 700 },
        { label: "Balance", amount: 700 },
      ]).expect(200)
    ).body;
    expect(m.plan.items.map((i: { label: string }) => i.label)).toEqual(["Deposit", "Second", "Balance"]);
  });

  it("ticks instalments off as money comes in; then a plan change says why", async () => {
    await api(app, manager)
      .post(`/orders/${orderId}/payments`, { kind: "deposit", amount: 700, currency: "USD", paidOn: today })
      .expect(201);
    const m = await money();
    expect(m.plan.items.map((i: { status: string; paid: string }) => [i.status, i.paid])).toEqual([
      ["paid", "600.00"],
      ["part_paid", "100.00"],
      ["open", "0.00"],
    ]);
    const items = m.plan.items.map((i: { id: string; label: string; amount: string; dueOn: string | null }) => ({
      id: i.id,
      label: i.label,
      amount: Number(i.amount),
      dueOn: i.dueOn,
    }));
    items[2].dueOn = "2027-01-15";
    expect((await api(app, sana).put(`/orders/${orderId}/payment-plan`, { items }).expect(409)).body).toMatchObject({
      code: "reason_needed",
      choices: expect.arrayContaining(["Agreed a new schedule"]),
    });
    await api(app, sana).put(`/orders/${orderId}/payment-plan`, { items, reason: "Agreed a new schedule" }).expect(200);
    const h = (await api(app, sana).get(`/history?type=order&id=${orderId}`).expect(200)).body;
    expect(h[0]).toMatchObject({ action: "payment_plan", reason: "Agreed a new schedule" });
  });

  it("changes a customer payment only with a reason", async () => {
    const p = (await api(app, manager).get(`/orders/${orderId}/payments`).expect(200)).body.payments[0];
    const body = { kind: "deposit", amount: 650, currency: "USD", paidOn: today, reference: "TT-1" };
    expect((await api(app, manager).patch(`/payments/${p.id}`, body).expect(409)).body.code).toBe("reason_needed");
    await api(app, sana)
      .patch(`/payments/${p.id}`, { ...body, reason: "Wrong amount" })
      .expect(403);
    const after = (
      await api(app, manager)
        .patch(`/payments/${p.id}`, { ...body, reason: "Wrong amount" })
        .expect(200)
    ).body;
    expect(after.received).toBe("650.00");
  });

  it("records what we pay the factory: paid by the person who looks after it, at the Settings rate", async () => {
    const pay = { factoryId, kind: "deposit", amount: 3390, currency: "CNY", paidOn: today, reference: "FP-1" };
    await api(app, sana).post(`/orders/${orderId}/factory-payments`, pay).expect(403);
    // We owe the factory in CNY: a payment in USD would not count against it, so it is refused.
    expect((await api(app, manager).post(`/orders/${orderId}/factory-payments`, { ...pay, currency: "USD", amount: 477 }).expect(400)).body.error).toMatch(
      /^We owe .+ in CNY\. Record the payment in CNY: a payment in USD would not count against what we owe\./,
    );
    const m = (await api(app, manager).post(`/orders/${orderId}/factory-payments`, pay).expect(201)).body;
    expect(m.factories.rows[0]).toMatchObject({ paid: "3390.00", toPay: "7910.00" });
    const p = m.factories.payments[0];
    expect(p).toMatchObject({ amount: "3390.00", currency: "CNY", paidBy: { id: sanaId }, recordedBy: { name: expect.any(String) }, changedAt: null, after: { paid: "3390.00", toPay: "7910.00" } });
    expect(p.rate).toBeGreaterThan(1);
    // Changing it says why; removing it too, and it stays listed, crossed out.
    expect(
      (
        await api(app, manager)
          .patch(`/factory-payments/${p.id}`, { ...pay, amount: 3400 })
          .expect(409)
      ).body.code,
    ).toBe("reason_needed");
    await api(app, manager)
      .patch(`/factory-payments/${p.id}`, { ...pay, currency: "USD", amount: 479, reason: "Wrong currency" })
      .expect(400);
    await api(app, manager)
      .patch(`/factory-payments/${p.id}`, { ...pay, amount: 3400, reason: "Wrong amount" })
      .expect(200);
    const extra = (
      await api(app, manager)
        .post(`/orders/${orderId}/factory-payments`, { ...pay, amount: 100, reference: "typo" })
        .expect(201)
    ).body.factories.payments.at(-1);
    const voided = (await api(app, manager).post(`/factory-payments/${extra.id}/void`, { reason: "Typed twice" }).expect(200)).body;
    expect(voided.factories.rows[0]).toMatchObject({ paid: "3400.00", toPay: "7900.00" });
    expect(voided.factories.payments.at(-1).voided).toMatchObject({ reason: "Typed twice" });
    // And it shows in what we owe across orders.
    const owe = (await api(app, sana).get("/money/payables?mine=true").expect(200)).body;
    expect(owe.find((r: { factory: { id: string } }) => r.factory.id === factoryId)).toMatchObject({
      toPay: "7900.00",
      orders: [expect.objectContaining({ id: orderId, toPay: "7900.00" })],
    });
  });

  it("keeps expenses for managers only, and works out the order's profit", async () => {
    const exp = { orderId, category: "inspection", description: "Pre-shipment inspection", amount: 150, currency: "USD", spentOn: today };
    await api(app, sana).post("/expenses", exp).expect(403);
    await api(app, sana).get("/expenses").expect(403);
    const e = (await api(app, manager).post("/expenses", exp).expect(201)).body;
    expect(e).toMatchObject({ inMain: "150.00", order: { id: orderId } });
    await api(app, manager)
      .post("/expenses", { category: "rent", description: `Office rent ${tag}`, amount: 7100, currency: "CNY", rate: 7.1, spentOn: today })
      .expect(201);

    const m = await money(manager);
    expect(m.expenses).toHaveLength(1);
    // 2,000 sold − goods cost on the lines − 150 expenses; cash: 650 in − 3,400 CNY out − 150.
    expect(Number(m.profit.earned)).toBeCloseTo(2000 - Number(m.profit.goodsCost) - 150, 2);
    expect(m.profit).toMatchObject({ revenue: "2000.00", expenses: "150.00", received: "650.00" });
    expect(Number(m.profit.cash)).toBeCloseTo(650 - Number(m.profit.factoryPaid) - 150, 2);

    expect(
      (
        await api(app, manager)
          .patch(`/expenses/${e.id}`, { ...exp, amount: 180 })
          .expect(409)
      ).body.code,
    ).toBe("reason_needed");
    expect(
      (
        await api(app, manager)
          .patch(`/expenses/${e.id}`, { ...exp, amount: 180, reason: "Wrong amount" })
          .expect(200)
      ).body.amount,
    ).toBe("180.00");
    // The order's history shows expenses to managers only.
    const actions = async (who: string) =>
      ((await api(app, who).get(`/history?type=order&id=${orderId}`).expect(200)).body as { action: string }[]).map((h) => h.action);
    expect(await actions(manager)).toContain("expense");
    expect((await actions(sana)).filter((a) => a.startsWith("expense"))).toEqual([]);
    expect(await actions(sana)).toContain("payment_out");
    const general = (await api(app, manager).get(`/expenses?kind=general&from=${today}&to=${today}`).expect(200)).body;
    expect(general.rows.map((r: { description: string }) => r.description)).toContain(`Office rent ${tag}`);
    expect(general.rows.every((r: { order: unknown }) => r.order === null)).toBe(true);
  });

  it("gives managers the year's profit & loss, month by month, earned and cash", async () => {
    await api(app, sana).get("/money/profit-and-loss?year=2026").expect(403);
    const year = Number(today.slice(0, 4));
    const pnl = (await api(app, manager).get(`/money/profit-and-loss?year=${year}`).expect(200)).body;
    expect(pnl.months).toHaveLength(12);
    const m = pnl.months[Number(today.slice(5, 7)) - 1];
    // This month: the customer's 650 came in, the factory payment and the expenses went out.
    expect(Number(m.cash.in)).toBeGreaterThanOrEqual(650);
    expect(Number(m.cash.expenses)).toBeGreaterThanOrEqual(180 + 1000);
    expect(Number(m.earned.generalExpenses)).toBeGreaterThanOrEqual(1000);
    expect(Number(pnl.total.cash.net)).toBeCloseTo(
      Number(pnl.total.cash.in) - Number(pnl.total.cash.factories) - Number(pnl.total.cash.expenses),
      2,
    );
  });

  it("reminds the handler and the managers once an instalment is late", async () => {
    const admin = await signIn(app, "admin@example.com", "Admin@12345");
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const m = await money();
    const items = m.plan.items.map((i: { id: string; label: string; amount: string; dueOn: string | null }, n: number) => ({
      id: i.id,
      label: i.label,
      amount: Number(i.amount),
      dueOn: n === 1 ? yesterday : i.dueOn,
    }));
    await api(app, sana).put(`/orders/${orderId}/payment-plan`, { items, reason: "Agreed a new schedule" }).expect(200);
    expect((await money()).plan.items[1].status).toBe("late");
    await api(app, admin).post("/admin/reminders/run").expect(200);
    const mine = (await api(app, sana).get("/notifications?take=50").expect(200)).body;
    const rows = Array.isArray(mine) ? mine : (mine.rows ?? mine.items);
    expect(
      rows.find((n: { type: string; title: string }) => n.type === "reminder.instalmentLate" && n.title.includes(m.refNo))?.title,
    ).toMatch(/Second: USD 650\.00 due .* not paid yet/);
  });

  it("dates the balance when the order ships", async () => {
    await api(app, sana).post(`/orders/${orderId}/stage`, { to: "in_production", confirm: true }).expect(200);
    // Clear the date set above, so shipping fills it in.
    const m = await money();
    const items = m.plan.items.map((i: { id: string; label: string; amount: string; dueOn: string | null }, n: number) => ({
      id: i.id,
      label: i.label,
      amount: Number(i.amount),
      dueOn: n === 2 ? null : i.dueOn,
    }));
    await api(app, sana).put(`/orders/${orderId}/payment-plan`, { items, reason: "Order changed" }).expect(200);
    await api(app, sana).post(`/orders/${orderId}/stage`, { to: "shipped", shippedOn: today, confirm: true }).expect(200);
    expect((await money()).plan.items[2].dueOn).toBe(today); // balance before shipment: due by the ship date
  });
});
