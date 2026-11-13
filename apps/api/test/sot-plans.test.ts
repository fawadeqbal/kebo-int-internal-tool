import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";
import { PrismaService } from "../src/database/prisma.service";
import { Clock } from "../src/common/time/clock.service";

/**
 * Single source of truth, PR 4: plans follow the dates.
 *  - one ready date per factory (owner, 3 Nov 2026): each factory's PO, its plan's "on the ready date" part and
 *    its production item read its own date; the order's ready date is the latest of them;
 *  - the customer's plan has due rules worked out live (on_ready, on_ship_plus_days, after_papers, fixed);
 *    a date typed by hand is fixed and stays;
 *  - rebuilding the plan from a new route keeps the instalments changed by hand; names come from amounts;
 *  - the order starts on the route the quotation's terms imply ("from the quotation");
 *  - a factory's offer says its advance %: it seeds the factory's plan and is printed on the PO;
 *  - a payment's kind is what it pays (deposit while open, else balance); only "other" is kept as sent.
 */
describe("plans follow the dates", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sana: string;
  let manager: string;
  let me: string;
  let customerId: string;
  let today = "";
  const tag = Date.now().toString(36);
  const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const day = (n: number) => addDays(today, n);

  /** A new deal from one factory's offer, quoted on these terms and accepted: its order (dated back, out of this month's reports). */
  const newOrder = async (o: { balanceTerms?: string; advancePercent?: number | null } = {}) => {
    const factoryId = (await api(app, sana).post("/factories", { name: `Plan Works ${Math.random().toString(36).slice(2, 7)} ${tag}`, address: "Wenzhou" }).expect(201)).body
      .id as string;
    const inquiry = (
      await api(app, sana)
        .post("/inquiries", { customerId, category: "Machinery", assigneeId: me, items: [{ description: "Labeller", quantity: 2 }, { description: "Conveyor", quantity: 1 }] })
        .expect(201)
    ).body;
    const items = (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.items as { id: string }[];
    await api(app, sana)
      .post(`/inquiries/${inquiry.id}/factory-quotes`, {
        factoryId,
        receivedOn: day(-80),
        currency: "CNY",
        taxRate: 0,
        ...(o.advancePercent !== undefined ? { advancePercent: o.advancePercent } : {}),
        lines: [
          { requestedItemId: items[0]!.id, description: "Labeller", quantity: 2, unitPrice: 5000 },
          { requestedItemId: items[1]!.id, description: "Conveyor", quantity: 1, unitPrice: 2000 },
        ],
      })
      .expect(201);
    const draft = (await api(app, sana).get(`/inquiries/${inquiry.id}/quotation/draft`)).body;
    const options = [{ ...draft.options[0], prices: draft.options[0].prices.map((p: Record<string, unknown>) => ({ ...p, unitPrice: 1000 })) }];
    const r = (
      await api(app, sana)
        .post(`/inquiries/${inquiry.id}/quotation/revisions`, {
          ...draft,
          options,
          depositPercent: 30,
          currency: "USD",
          balanceTerms: o.balanceTerms ?? "before_shipment",
          incoterm: "FOB",
          incotermPlace: "Ningbo",
        })
        .expect(201)
    ).body;
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "sent" }).expect(200);
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "accepted" }).expect(200);
    const order = (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.orders[0];
    await prisma.platform.$executeRaw`update orders set ordered_on = ordered_on - 75 where id = ${order.id}::uuid`;
    await prisma.platform.$executeRaw`update inquiries set closed_at = closed_at - interval '75 days' where id = ${inquiry.id}::uuid`;
    return { id: order.id as string, refNo: order.refNo as string, factoryId };
  };
  /** The order's second line moved to another factory (as an order bought from two factories). */
  const secondFactory = async (orderId: string) => {
    const id = (await api(app, sana).post("/factories", { name: `Second Works ${tag} ${Math.random().toString(36).slice(2, 6)}`, address: "Ningbo" }).expect(201)).body
      .id as string;
    const lines = await prisma.platform.orderLine.findMany({ where: { orderId }, orderBy: { sortOrder: "asc" } });
    await prisma.platform.orderLine.update({ where: { id: lines[1]!.id }, data: { factoryId: id } });
    return id;
  };
  const order = async (id: string) => (await api(app, sana).get(`/orders/${id}`).expect(200)).body;
  const money = async (id: string) => (await api(app, manager).get(`/orders/${id}/money`).expect(200)).body;
  const flow = async (id: string) => (await api(app, sana).get(`/orders/${id}/flow`).expect(200)).body;
  const plan = async (id: string) =>
    (await money(id)).plan.items as { id: string; label: string; amount: string; dueOn: string | null; dueRule: string | null; dueDays: number | null; rule: string | null }[];
  /** The Production stage's word, read from what is stored. */
  const production = async (id: string) => ((await api(app, sana).get(`/orders/${id}/sections`).expect(200)).body.stands as { stage: string; word: string; fact: string; missing: string }[]).find((x) => x.stage === "production")!;
  const poDoc = async (id: string, ref: string) => (await api(app, manager).get(`/orders/${id}/papers/purchase-order/doc?ref=${ref}`).expect(200)).body.doc;
  const details = (id: string, body: object) => api(app, sana).patch(`/orders/${id}/details`, body).expect(200);
  const savePlan = (id: string, items: object[], reason?: string) => api(app, sana).put(`/orders/${id}/payment-plan`, { items, reason }).expect(200);

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);
    today = app.get(Clock).today();
    sana = await signIn(app, "sana@example.com");
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    me = (await api(app, sana).get("/auth/me")).body.id;
    customerId = (
      await api(app, sana).post("/customers", { name: `Plan Foods ${tag}`, country: "PK", contacts: [{ name: "Hina", email: `hina-${tag}@plan.test` }] }).expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("keeps one ready date per factory: each factory's plan, PO and production item use its own; the order's is the latest", async () => {
    const o = await newOrder();
    const b = await secondFactory(o.id);
    await api(app, sana).patch(`/orders/${o.id}/factory-order`, { factoryOrderedOn: day(-10) }).expect(200);
    // Only the first factory has said: the order's ready date is not known yet.
    await details(o.id, { readyBy: [{ factoryId: o.factoryId, readyOn: day(20) }] });
    let ord = await order(o.id);
    expect(ord.readyOn).toBeNull();
    expect(ord.readyBy).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ factoryId: o.factoryId, readyOn: day(20) }),
        expect.objectContaining({ factoryId: b, readyOn: null }),
      ]),
    );
    // One factory has not said yet: the order has no ready date.
    expect((await production(o.id)).word).toBe("Not started");
    // The second factory says later: the order's ready date is the latest.
    await details(o.id, { readyBy: [{ factoryId: b, readyOn: day(40) }] });
    ord = await order(o.id);
    expect(ord.readyOn).toBe(day(40));
    expect((await production(o.id)).word).toMatch(/^Ready /);
    expect((await flow(o.id)).factory.readyBy).toHaveLength(2);

    // Each factory's plan: its balance is due on its own ready date.
    const m = await money(o.id);
    const planOf = (id: string) => m.factories.plans.find((p: { factory: { id: string } }) => p.factory.id === id);
    expect(planOf(o.factoryId)).toMatchObject({ readyOn: day(20) });
    expect(planOf(o.factoryId).rows.find((r: { dueRule: string }) => r.dueRule === "on_ready").due).toBe(day(20));
    expect(planOf(b).rows.find((r: { dueRule: string }) => r.dueRule === "on_ready").due).toBe(day(40));
    // Each factory's PO prints its own ready date.
    expect(JSON.stringify((await poDoc(o.id, o.factoryId)).meta)).toContain(day(20));
    expect(JSON.stringify((await poDoc(o.id, b)).meta)).toContain(day(40));
    // The customer's balance before shipment follows the order's (the latest).
    expect((await plan(o.id))[1]).toMatchObject({ dueRule: "on_ready", dueOn: day(40) });

    // One date for all (the phone app, the stage move): every factory gets it.
    await details(o.id, { readyOn: day(30) });
    ord = await order(o.id);
    expect(ord.readyBy.map((r: { readyOn: string }) => r.readyOn)).toEqual([day(30), day(30)]);
    const h = (await api(app, sana).get(`/history?type=order&id=${o.id}&step=production`).expect(200)).body as { summary: string }[];
    expect(h.some((x) => /ready dates/.test(x.summary))).toBe(true);
  });

  it("works the customer's due dates out live: the ready date moves the balance before shipment, the ship date moves ship + days; a typed date stays", async () => {
    const o = await newOrder();
    // From the quotation: informal, before shipment; the balance is due on the ready date.
    let p = await plan(o.id);
    expect(p.map((i) => [i.label, i.dueRule])).toEqual([
      ["Deposit 30%", "fixed"],
      ["Balance before shipment", "on_ready"],
    ]);
    expect(p[1]).toMatchObject({ dueOn: null, rule: "on the ready date" });
    await api(app, sana).post(`/orders/${o.id}/stage`, { to: "in_production", readyOn: day(10), confirm: true }).expect(200);
    expect((await plan(o.id))[1]!.dueOn).toBe(day(10));
    // The ready date moves from day 10 to day 25: the balance moves with it (it used to stay on day 10).
    await details(o.id, { readyOn: day(25) });
    expect((await plan(o.id))[1]!.dueOn).toBe(day(25));
    expect((await money(o.id)).plan.dates).toMatchObject({ readyOn: day(25) });

    // Against the B/L copy: 14 days (the company's balance days) after the goods leave; the ship date moves it.
    await api(app, sana).patch(`/orders/${o.id}/route`, { route: "informal", balanceWhen: "against_bl_copy" }).expect(200);
    p = await plan(o.id);
    expect(p[1]).toMatchObject({ label: "Balance against B/L copy", dueRule: "on_ship_plus_days", dueDays: 14, dueOn: null });
    await api(app, sana).post(`/orders/${o.id}/stage`, { to: "shipped", shippedOn: day(-2), confirm: true }).expect(200);
    expect((await plan(o.id))[1]!.dueOn).toBe(day(12));
    await details(o.id, { shippedOn: day(-1), reason: "The vessel left a day later" });
    expect((await plan(o.id))[1]!.dueOn).toBe(day(13));

    // A date typed by hand becomes fixed: the ship date no longer moves it.
    p = await plan(o.id);
    await savePlan(o.id, p.map((i, n) => ({ id: i.id, label: i.label, amount: Number(i.amount), dueOn: n === 1 ? day(50) : i.dueOn })), "Agreed with the customer");
    p = await plan(o.id);
    expect(p[1]).toMatchObject({ dueRule: "fixed", dueOn: day(50) });
    await details(o.id, { shippedOn: day(-3), reason: "The B/L date" });
    expect((await plan(o.id))[1]!.dueOn).toBe(day(50));
    // Sent back with the date its rule gives, the rule is kept (nothing was typed).
    await savePlan(o.id, p.map((i, n) => ({ id: i.id, label: i.label, amount: Number(i.amount), dueOn: i.dueOn, ...(n === 1 ? { dueRule: "on_ship_plus_days", dueDays: 7 } : {}) })), "Back to the terms");
    expect((await plan(o.id))[1]).toMatchObject({ dueRule: "on_ship_plus_days", dueDays: 7, dueOn: day(4) });
  });

  it("an LC instalment is due from the day the papers reach the customer's bank, and moves when that does", async () => {
    const o = await newOrder({ balanceTerms: "letter_of_credit" });
    const f = await flow(o.id);
    // From the quotation: the LC route, at sight.
    expect(f.payment).toMatchObject({ route: "letter_of_credit", lcTerms: "at_sight", fromQuotation: true });
    expect((await plan(o.id))[1]).toMatchObject({ label: "Balance through the LC", dueRule: "after_papers", dueDays: 0, dueOn: null });
    await api(app, sana).patch(`/orders/${o.id}/route`, { route: "letter_of_credit", lcTerms: "deferred", lcDays: 60 }).expect(200);
    expect((await flow(o.id)).payment.fromQuotation).toBe(false);
    await api(app, sana).put(`/orders/${o.id}/bank-steps/customer_bank_received`, { doneOn: day(-5) }).expect(200);
    expect((await plan(o.id))[1]!.dueOn).toBe(day(55));
    await api(app, sana).put(`/orders/${o.id}/bank-steps/customer_bank_received`, { doneOn: day(-1) }).expect(200);
    expect((await plan(o.id))[1]!.dueOn).toBe(day(59));
  });

  it("rebuilds from a new route only the instalments still as built; a deposit changed by hand stays, named from its amount", async () => {
    const o = await newOrder({ balanceTerms: "after_arrival" });
    // "After arrival" implies no route: the order starts without one.
    expect((await flow(o.id)).payment).toMatchObject({ route: null, fromQuotation: false });
    let p = await plan(o.id);
    const total = p.reduce((t, i) => t + Number(i.amount), 0);
    // The deposit raised to 50% by hand (the balance is the rest).
    await savePlan(o.id, [
      { id: p[0]!.id, label: p[0]!.label, amount: total / 2, dueOn: p[0]!.dueOn },
      { id: p[1]!.id, label: p[1]!.label, amount: total / 2 },
    ]);
    p = await plan(o.id);
    expect(p.map((i) => i.label)).toEqual(["Deposit 50%", "Balance"]);
    expect(p[1]).toMatchObject({ dueRule: "on_ship_plus_days" });
    // A route chosen now: the deposit kept as it is, the balance rebuilt for the LC (the rest).
    await api(app, sana).patch(`/orders/${o.id}/route`, { route: "letter_of_credit" }).expect(200);
    const after = await plan(o.id);
    expect(after.map((i) => [i.label, i.amount, i.dueRule])).toEqual([
      ["Deposit 50%", (total / 2).toFixed(2), "fixed"],
      ["Balance through the LC", (total / 2).toFixed(2), "after_papers"],
    ]);
    expect(after[0]!.id).toBe(p[0]!.id);
    // A hand-made instalment survives too.
    await savePlan(o.id, [
      { id: after[0]!.id, label: after[0]!.label, amount: total / 2, dueOn: after[0]!.dueOn },
      { label: "Retention", amount: total / 10, dueOn: day(200) },
      { id: after[1]!.id, label: after[1]!.label, amount: (total * 4) / 10 },
    ]);
    await api(app, sana).patch(`/orders/${o.id}/route`, { route: "informal", balanceWhen: "before_shipment" }).expect(200);
    expect((await plan(o.id)).map((i) => [i.label, i.amount, i.dueRule])).toEqual([
      ["Deposit 50%", (total / 2).toFixed(2), "fixed"],
      ["Retention", (total / 10).toFixed(2), "fixed"],
      ["Balance before shipment", ((total * 4) / 10).toFixed(2), "on_ready"],
    ]);
  });

  it("the factory offer's advance % seeds the factory's plan and is printed on the PO", async () => {
    const o = await newOrder({ advancePercent: 50 });
    // Not saved yet: the default shown is the offer's 50%, not Settings' 30%.
    let m = await money(o.id);
    expect(m.factories.plans[0].rows.map((r: { label: string; amount: string }) => [r.label, r.amount])).toEqual([
      ["Advance 50%", "6000.00"],
      ["Balance 50%", "6000.00"],
    ]);
    await api(app, sana).patch(`/orders/${o.id}/factory-order`, { factoryOrderedOn: day(-3) }).expect(200);
    m = await money(o.id);
    expect(m.factories.plans[0]).toMatchObject({ saved: true });
    expect(m.factories.plans[0].rows[0]).toMatchObject({ label: "Advance 50%", amount: "6000.00", dueRule: "on_order" });
    expect(JSON.stringify((await poDoc(o.id, o.factoryId)).bullets)).toMatch(/Payment: Advance 50%, CNY 6,000\.00, when we order/);
    // An offer that says nothing takes the company's default (30%), stored on the offer.
    const d = await newOrder();
    m = await money(d.id);
    expect(m.factories.plans[0].rows[0]).toMatchObject({ label: "Advance 30%", amount: "3600.00" });
    const inquiryId = (await order(d.id)).inquiry.id;
    const offers = (await api(app, sana).get(`/inquiries/${inquiryId}/sourcing`).expect(200)).body.quotes;
    expect(offers[0]).toMatchObject({ advancePercent: 30 });
  });

  it("a payment's kind is what the money pays; only other is kept as sent", async () => {
    const o = await newOrder();
    const p = await plan(o.id);
    const deposit = Number(p[0]!.amount);
    const pay = (amount: number, kind?: string) =>
      api(app, manager).post(`/orders/${o.id}/payments`, { ...(kind ? { kind } : {}), amount, currency: "USD", paidOn: day(-1) }).expect(201);
    // Sent as "balance" while the deposit is open: it pays the deposit.
    await pay(deposit / 2, "balance");
    await pay(deposit / 2);
    await pay(100);
    await pay(50, "other");
    const kinds = (await prisma.platform.allocation.findMany({ where: { orderId: o.id }, orderBy: { createdAt: "asc" }, select: { kind: true } })).map((x) => x.kind);
    expect(kinds).toEqual(["deposit", "deposit", "balance", "other"]);
  });
});
