import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PaymentList, PaymentView } from "@kebo/shared";
import { api, signIn, startApp } from "./app";
import { today } from "./dates";

/**
 * Treasury › Payments: every payment in and out in one list, and one page per payment, read from
 * the records that hold them (customer payments, supplier payments, expenses, moves between our
 * accounts, money sent for approval), with the same rules on who sees what as their own pages.
 */
describe("treasury: every payment in one list", () => {
  let app: INestApplication;
  let manager: string;
  let sana: string;
  let bilal: string;
  let orderId: string;
  let customerId: string;
  let paymentId: string;
  let supplierPaymentId: string;
  let expenseId: string;
  let transferId: string;
  let submissionId: string;
  const tag = Date.now().toString(36);
  const list = async (who: string, q = "") => (await api(app, who).get(`/treasury/payments?${q}`).expect(200)).body as PaymentList;
  const mine = (l: PaymentList) => l.rows.filter((r) => r.reference?.includes(tag) || r.what.includes(tag));

  beforeAll(async () => {
    app = await startApp();
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    sana = await signIn(app, "sana@example.com");
    bilal = await signIn(app, "bilal@example.com");
    const sanaId = (await api(app, sana).get("/auth/me")).body.id as string;
    // Sana's order: 10 valves at USD 300 from a factory at CNY 1,000 each.
    customerId = (
      await api(app, sana)
        .post("/customers", { name: `Treasury Co ${tag}`, country: "KE", contacts: [{ name: "Wanjiru", email: `w-${tag}@treasury.test` }] })
        .expect(201)
    ).body.id;
    const inquiry = (
      await api(app, sana)
        .post("/inquiries", { customerId, category: "Machinery", assigneeId: sanaId, items: [{ description: "Valve", quantity: 10 }] })
        .expect(201)
    ).body;
    const item = (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.items[0];
    await api(app, sana)
      .post(`/inquiries/${inquiry.id}/factory-quotes`, {
        newFactoryName: `Treasury Valves ${tag}`,
        receivedOn: today,
        currency: "CNY",
        lines: [{ requestedItemId: item.id, description: "Valve", quantity: 10, unitPrice: 1000 }],
      })
      .expect(201);
    const draft = (await api(app, sana).get(`/inquiries/${inquiry.id}/quotation/draft`)).body;
    const options = [
      { ...draft.options[0], prices: draft.options[0].prices.map((p: Record<string, unknown>) => ({ ...p, unitPrice: 300 })) },
    ];
    const r = (
      await api(app, sana)
        .post(`/inquiries/${inquiry.id}/quotation/revisions`, { ...draft, currency: "USD", options })
        .expect(201)
    ).body;
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "sent" }).expect(200);
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "accepted" }).expect(200);
    orderId = (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.orders[0].id;

    // Money in, money out, an expense, a move between accounts, and money a staff member sent for approval.
    await api(app, manager)
      .post(`/orders/${orderId}/payments`, { kind: "deposit", amount: 900, currency: "USD", paidOn: today, reference: `TT-${tag}` })
      .expect(201);
    const money = (await api(app, manager).get(`/orders/${orderId}/money`).expect(200)).body;
    const factoryId = money.factories.rows[0].factory.id as string;
    await api(app, manager)
      .post(`/orders/${orderId}/factory-payments`, {
        factoryId,
        kind: "deposit",
        amount: 3000,
        currency: "CNY",
        rate: 7.1,
        paidOn: today,
        reference: `FP-${tag}`,
      })
      .expect(201);
    expenseId = (
      await api(app, manager)
        .post("/expenses", { category: "office", description: `Paper ${tag}`, amount: 25, currency: "USD", spentOn: today, orderId })
        .expect(201)
    ).body.id;
    const accounts = await Promise.all(
      ["A", "B"].map(
        async (n) =>
          (
            await api(app, manager)
              .post("/money/accounts", { name: `Box ${n} ${tag}`, kind: "cash", currency: "USD", openingOn: today })
              .expect(201)
          ).body.id as string,
      ),
    );
    transferId = (
      await api(app, manager)
        .post("/money/transfers", {
          fromAccountId: accounts[0],
          toAccountId: accounts[1],
          amountOut: 40,
          transferredOn: today,
          note: `Float ${tag}`,
        })
        .expect(201)
    ).body.id;
    submissionId = (
      await api(app, sana)
        .post("/submissions", { kind: "payment", orderId, body: { amount: 100, currency: "USD", paidOn: today, reference: `SUB-${tag}` } })
        .expect(201)
    ).body.id;
    const l = await list(manager, `order=${orderId}`);
    paymentId = l.rows.find((x) => x.kind === "customer")!.id;
    supplierPaymentId = l.rows.find((x) => x.kind === "supplier")!.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("lists every kind of payment of an order, newest first, with its number from the ledger", async () => {
    const l = await list(manager, `order=${orderId}`);
    expect(l.rows.map((r) => [r.kind, r.direction, r.status])).toEqual(
      expect.arrayContaining([
        ["customer", "in", "recorded"],
        ["supplier", "out", "recorded"],
        ["expense", "out", "recorded"],
        ["submission", "in", "to_verify"],
      ]),
    );
    const pay = l.rows.find((r) => r.kind === "customer")!;
    expect(pay).toMatchObject({
      amount: "900.00",
      currency: "USD",
      party: { label: `Treasury Co ${tag}`, href: `/customers/${customerId}` },
    });
    expect(pay.number).toMatch(/^RC-/);
    expect(l.rows.find((r) => r.kind === "supplier")!.number).toMatch(/^FP-/);
    expect(l.rows.find((r) => r.kind === "supplier")).toMatchObject({ amount: "3000.00", currency: "CNY" });
    // What waits for a manager is on top of its day.
    expect(l.rows[0].status).toBe("to_verify");
    expect(l.counts).toMatchObject({ to_verify: 1 });
    expect(l.canRecord).toEqual({ in: true, out: true, expense: true, transfer: true });
  });

  it("filters by direction, status and words; moves between accounts are their own direction", async () => {
    const out = mine(await list(manager, `from=${today}&to=${today}&dir=out&q=${tag}`));
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out.every((r) => r.direction === "out")).toBe(true);
    const moves = await list(manager, `from=${today}&to=${today}&dir=move&q=${tag}`);
    expect(moves.rows.map((r) => r.id)).toEqual([transferId]);
    const waiting = await list(manager, `status=to_verify&order=${orderId}`);
    expect(waiting.rows.map((r) => r.id)).toEqual([submissionId]);
    expect((await list(manager, `q=TT-${tag}`)).rows.map((r) => r.id)).toEqual([paymentId]);
  });

  it("shows a removed payment only under Removed", async () => {
    await api(app, manager).post(`/expenses/${expenseId}/void`, { reason: "Typed twice" }).expect(200);
    expect((await list(manager, `order=${orderId}`)).rows.some((r) => r.id === expenseId)).toBe(false);
    const removed = await list(manager, `order=${orderId}&status=void`);
    expect(removed.rows.map((r) => [r.id, r.status])).toEqual([[expenseId, "void"]]);
  });

  it("opens one payment with what it was, who recorded it, its ledger posting and how to remove it", async () => {
    const v = (await api(app, manager).get(`/treasury/payments/customer/${paymentId}`).expect(200)).body as PaymentView;
    expect(v).toMatchObject({
      kind: "customer",
      id: paymentId,
      title: "Customer payment · USD 900.00",
      recordedBy: "Manager",
      voided: null,
      voidPath: `/payments/${paymentId}/void`,
    });
    expect(v.fields).toEqual(
      expect.arrayContaining([
        { label: "Received", value: "USD 900.00" },
        { label: "Paid on", value: today },
      ]),
    );
    expect(v.ledgerHref).toMatch(/^\/finance\/ledger\?panel=entry&id=[0-9a-f-]{36}$/);
    const e = (await api(app, manager).get(`/treasury/payments/expense/${expenseId}`).expect(200)).body as PaymentView;
    expect(e).toMatchObject({ status: "void", voided: { reason: "Typed twice" }, voidPath: null });
    await api(app, manager).get(`/treasury/payments/supplier/${paymentId}`).expect(404);
    await api(app, manager).get(`/treasury/payments/nothing/${paymentId}`).expect(400);
  });

  it("shows each person what their own pages show them", async () => {
    // Sana (staff): customer and supplier money of her deals, and what she sent; no expenses, no moves, no removing.
    const s = await list(sana, `order=${orderId}`);
    expect(s.rows.map((r) => r.kind).sort()).toEqual(["customer", "submission", "supplier"]);
    expect(s.canRecord).toEqual({ in: false, out: false, expense: false, transfer: false });
    expect((await list(sana, `q=${tag}&dir=move`)).rows).toEqual([]);
    expect(((await api(app, sana).get(`/treasury/payments/customer/${paymentId}`).expect(200)).body as PaymentView).voidPath).toBeNull();
    await api(app, sana).get(`/treasury/payments/transfer/${transferId}`).expect(404);
    // Bilal does not handle the deal: none of its money.
    expect((await list(bilal, `order=${orderId}`)).rows).toEqual([]);
    await api(app, bilal).get(`/treasury/payments/supplier/${supplierPaymentId}`).expect(404);
    expect((await api(app, sana).get("/treasury/payments/access").expect(200)).body).toEqual({ opens: true });
  });
});
