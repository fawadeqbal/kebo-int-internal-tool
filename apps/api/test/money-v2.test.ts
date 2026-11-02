import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";
import { PrismaService } from "../src/database/prisma.service";
import { Clock } from "../src/common/time/clock.service";

/**
 * Money v2 (order flow v3, phase 5): a payment in any currency counted at the
 * rate kept with it; one transfer over several orders with the rest as credit;
 * credit used and refunded; the route builds the plan; an LC's deferred
 * balance dated from the papers; "Money reached us" is the payment; the LC
 * checked against the order; the factory payment plan; cancelling with money in.
 */
describe("money v2", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sana: string;
  let bilal: string;
  let manager: string;
  let admin: string;
  let office: string;
  let me: string;
  let customerId: string;
  let factoryId: string;
  const tag = Date.now().toString(36);
  /** Days as the API counts them (the company's time zone). */
  let today = "";
  const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const day = (n: number) => addDays(today, n);

  /** A new deal for the customer, quoted (USD, 30% deposit) and accepted: its order's id. */
  const newOrder = async (price = 71000) => {
    const inquiry = (
      await api(app, sana)
        .post("/inquiries", { customerId, category: "Machinery", assigneeId: me, items: [{ description: "Cartoning machine", quantity: 1 }] })
        .expect(201)
    ).body;
    const item = (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.items[0];
    await api(app, sana)
      .post(`/inquiries/${inquiry.id}/factory-quotes`, {
        factoryId,
        receivedOn: day(-5),
        currency: "CNY",
        lines: [{ requestedItemId: item.id, description: "ZH-120", quantity: 1, unitPrice: price, taxRate: 0 }],
      })
      .expect(201);
    const draft = (await api(app, sana).get(`/inquiries/${inquiry.id}/quotation/draft`)).body;
    const r = (await api(app, sana).post(`/inquiries/${inquiry.id}/quotation/revisions`, { ...draft, depositPercent: 30, currency: "USD" }).expect(201)).body;
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "sent" }).expect(200);
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "accepted" }).expect(200);
    return (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.orders[0].id as string;
  };
  const money = async (id: string, who = manager) => (await api(app, who).get(`/orders/${id}/money`).expect(200)).body;
  const payments = async (id: string, who = manager) => (await api(app, who).get(`/orders/${id}/payments`).expect(200)).body;
  const flow = async (id: string, who = sana) => (await api(app, who).get(`/orders/${id}/flow`).expect(200)).body;
  const steps = async (id: string, who = manager) => (await api(app, who).get(`/orders/${id}/steps`).expect(200)).body;
  const credit = async (who = manager) => (await api(app, who).get(`/customers/${customerId}/credit`).expect(200)).body;
  const creditIn = async (currency = "USD") => (await credit()).balances.find((b: { currency: string }) => b.currency === currency)?.amount ?? "0.00";
  const account = async (name: string, currency: string) =>
    (await api(app, manager).post("/money/accounts", { name: `${name} ${tag}`, kind: "bank", currency, openingOn: day(-30) }).expect(201)).body.id as string;

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);
    today = app.get(Clock).today();
    sana = await signIn(app, "sana@example.com");
    bilal = await signIn(app, "bilal@example.com");
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    admin = await signIn(app, "admin@example.com", "Admin@12345");
    me = (await api(app, sana).get("/auth/me")).body.id;
    customerId = (
      await api(app, sana)
        .post("/customers", { name: `Moneytwo Pharma ${tag}`, country: "PK", contacts: [{ name: "Rauf", email: `rauf-${tag}@shifa.test` }] })
        .expect(201)
    ).body.id;
    factoryId = (await api(app, sana).post("/factories", { name: `Moneytwo Works ${tag}` }).expect(201)).body.id;
    // A role that changes orders but neither records money nor sees factory money.
    const role = (
      await api(app, admin).post("/roles", { name: `Desk ${tag}`, permissions: ["dashboard.view", "inquiries.viewAll", "orders.update"] }).expect(201)
    ).body;
    await api(app, admin).post("/users", { name: "Desk", email: `desk-${tag}@example.com`, role: role.key, password: "Person@12345" }).expect(201);
    office = await signIn(app, `desk-${tag}@example.com`, "Person@12345");
  });

  afterAll(async () => {
    await app?.close();
  });

  it("records a payment in any currency, counted at the rate kept with it", async () => {
    const id = await newOrder();
    const o = await payments(id);
    const pkr = await account("Lahore cash", "PKR");
    const usd = await account("Company USD", "USD");
    // PKR 1,500,000 at 280 per USD counts as USD 5,357.14 (half away from zero, to the cent).
    const body = { kind: "deposit", currency: "USD", receivedAmount: 1500000, receivedCurrency: "PKR", rate: 280, paidOn: today, method: "cash", paidByName: "Mr. Rauf (their agent)" };
    await api(app, sana).post(`/orders/${id}/payments`, { ...body, accountId: pkr }).expect(403);
    // The account must hold what arrived (PKR).
    await api(app, manager).post(`/orders/${id}/payments`, { ...body, accountId: usd }).expect(400);
    const paid = (await api(app, manager).post(`/orders/${id}/payments`, { ...body, accountId: pkr }).expect(201)).body;
    expect(paid.received).toBe("5357.14");
    expect(paid.payments.at(-1)).toMatchObject({
      amount: "5357.14",
      currency: "USD",
      receivedAmount: "1500000.00",
      receivedCurrency: "PKR",
      rate: 280,
      paidByName: "Mr. Rauf (their agent)",
      account: { id: pkr },
    });
    expect(Number(paid.due)).toBeCloseTo(Number(o.total) - 5357.14, 2);
    // The rate is kept: changing Settings later never moves it.
    const settings = (await api(app, admin).get("/settings").expect(200)).body;
    await api(app, admin).put("/settings/sales", { ...settings.sales, exchangeRates: { ...settings.sales.exchangeRates, PKR: 300 }, reason: "New exchange rate" }).expect(200);
    expect((await payments(id)).payments.at(-1)).toMatchObject({ amount: "5357.14", rate: 280 });
    // The cash book has what really arrived, in the account's currency.
    const book = (await api(app, manager).get(`/money/cash-book?from=${today}&to=${today}&account=${pkr}`).expect(200)).body;
    expect(book.rows.find((r: { id: string }) => r.id === paid.createdId)).toMatchObject({ amount: "1500000.00", currency: "PKR" });
    expect(book.closing).toBe("1500000.00");
    // No rate given: Settings' rate (PKR 300 per USD now): PKR 3,000 → USD 10.00.
    const viaSettings = (await api(app, manager).post(`/orders/${id}/payments`, { kind: "balance", currency: "USD", receivedAmount: 3000, receivedCurrency: "PKR", paidOn: today }).expect(201)).body;
    expect(viaSettings.payments.at(-1)).toMatchObject({ amount: "10.00", rate: 300 });
    await api(app, admin).put("/settings/sales", { ...settings.sales, reason: "Back as it was" }).expect(200);
    // Older clients (amount + the order's currency) work as before.
    const old = (await api(app, manager).post(`/orders/${id}/payments`, { kind: "balance", amount: "100.00", currency: "USD", paidOn: today }).expect(201)).body;
    expect(old.payments.at(-1)).toMatchObject({ amount: "100.00", receivedAmount: "100.00", receivedCurrency: "USD", rate: 1 });
    // Changing the rate of a payment recounts it (with a reason).
    const edited = (
      await api(app, manager)
        .patch(`/payments/${paid.createdId}`, { ...body, accountId: pkr, rate: 250, reason: "Agreed rate was 250" })
        .expect(200)
    ).body;
    expect(edited.payments.find((p: { id: string }) => p.id === paid.createdId)).toMatchObject({ amount: "6000.00", rate: 250 });
  });

  it("splits one transfer over two orders, oldest due first, the rest as credit", async () => {
    const a = await newOrder(50000);
    const b = await newOrder(10000);
    const [pa, pb] = [await payments(a), await payments(b)];
    const usd = await account("Split USD", "USD");
    const before = Number(await creditIn());
    const parts = [
      { orderId: a, amount: pa.depositDue },
      { orderId: b, amount: pb.depositDue },
    ];
    const total = Number(pa.depositDue) + Number(pb.depositDue);
    const receipt = { receivedAmount: (total + 7320).toFixed(2), receivedCurrency: "USD", currency: "USD", paidOn: today, method: "bank_transfer", reference: `TT-${tag}`, accountId: usd, parts };
    await api(app, sana).post(`/customers/${customerId}/receipts`, receipt).expect(403);
    // A part more than the order owes is refused.
    await api(app, manager).post(`/customers/${customerId}/receipts`, { ...receipt, parts: [{ orderId: a, amount: Number(pa.total) + 1 }] }).expect(400);
    const after = (await api(app, manager).post(`/customers/${customerId}/receipts`, receipt).expect(201)).body;
    expect(after.orders.find((o: { id: string }) => o.id === a)).toMatchObject({ depositDue: "0.00" });
    expect(after.orders.find((o: { id: string }) => o.id === b)).toMatchObject({ depositDue: "0.00" });
    expect(Number(after.credit.balances.find((x: { currency: string }) => x.currency === "USD").amount)).toBeCloseTo(before + 7320, 2);
    // The payments belong to one receipt; the cash book shows the transfer once, for the whole amount.
    const ps = after.payments.filter((p: { reference: string }) => p.reference === `TT-${tag}`);
    expect(ps).toHaveLength(2);
    expect(new Set(ps.map((p: { receiptId: string }) => p.receiptId)).size).toBe(1);
    const book = (await api(app, manager).get(`/money/cash-book?from=${today}&to=${today}&account=${usd}`).expect(200)).body;
    expect(book.rows.filter((r: { voided: boolean }) => !r.voided)).toHaveLength(1);
    expect(book.closing).toBe((total + 7320).toFixed(2));
    // A payment of a split transfer is not changed or removed on its own.
    await api(app, manager).post(`/payments/${ps[0].id}/void`, { reason: "x" }).expect(400);

    // Paying more than an order owes, without splitting, keeps the rest as credit (never refused).
    const c = await newOrder(20000);
    const pc = await payments(c);
    const overpaid = (await api(app, manager).post(`/orders/${c}/payments`, { kind: "balance", amount: (Number(pc.total) + 500).toFixed(2), currency: "USD", paidOn: today }).expect(201)).body;
    expect(overpaid).toMatchObject({ due: "0.00", status: "paid" });
    expect(Number(await creditIn())).toBeCloseTo(before + 7320 + 500, 2);
    // Money v2: this order's part as typed, the rest to another order and credit.
    const d = await newOrder(30000);
    const pd = await payments(d);
    const split = (
      await api(app, manager)
        .post(`/orders/${d}/payments`, { kind: "deposit", currency: "USD", receivedAmount: Number(pd.depositDue) + 1000, receivedCurrency: "USD", amount: pd.depositDue, paidOn: today })
        .expect(201)
    ).body;
    expect(split.depositDue).toBe("0.00");
    expect(Number(await creditIn())).toBeCloseTo(before + 7320 + 500 + 1000, 2);
    // Parts that add up to more than arrived are refused.
    await api(app, manager)
      .post(`/orders/${d}/payments`, { kind: "balance", currency: "USD", receivedAmount: 100, receivedCurrency: "USD", amount: 100, parts: [{ orderId: a, amount: 50 }], paidOn: today })
      .expect(400);
  });

  it("uses credit on an order and refunds it", async () => {
    const id = await newOrder(15000);
    const p = await payments(id);
    expect(Number(p.credit.amount)).toBeGreaterThan(1000);
    const start = Number(p.credit.amount);
    await api(app, sana).post(`/orders/${id}/use-credit`, { amount: 1000 }).expect(403);
    await api(app, manager).post(`/orders/${id}/use-credit`, { amount: start + 1 }).expect(400);
    const used = (await api(app, manager).post(`/orders/${id}/use-credit`, { amount: 1000 }).expect(201)).body;
    expect(used.payments.at(-1)).toMatchObject({ method: "credit", amount: "1000.00", account: null });
    expect(Number(used.credit.amount)).toBeCloseTo(start - 1000, 2);
    expect((await credit()).entries[0]).toMatchObject({ kind: "used", amount: "1000.00", order: { id } });
    // Removing the payment gives the credit back.
    await api(app, manager).post(`/payments/${used.payments.at(-1).id}/void`, { reason: "Wrong order" }).expect(200);
    expect(Number(await creditIn())).toBeCloseTo(start, 2);
    // Refund: from an account, never more than the credit.
    const usd = await account("Refund USD", "USD");
    await api(app, manager).post(`/customers/${customerId}/credit/refund`, { amount: start + 1, currency: "USD", on: today, accountId: usd }).expect(400);
    await api(app, sana).post(`/customers/${customerId}/credit/refund`, { amount: 100, currency: "USD", on: today, accountId: usd }).expect(403);
    const refunded = (await api(app, manager).post(`/customers/${customerId}/credit/refund`, { amount: 100, currency: "USD", on: today, accountId: usd }).expect(201)).body;
    expect(Number(refunded.balances.find((x: { currency: string }) => x.currency === "USD").amount)).toBeCloseTo(start - 100, 2);
    const book = (await api(app, manager).get(`/money/cash-book?from=${today}&to=${today}&account=${usd}`).expect(200)).body;
    expect(book.rows[0]).toMatchObject({ kind: "refund", amount: "-100.00" });
    // A refund recorded by mistake: managers remove it and the credit is back.
    const refund = refunded.entries.find((e: { kind: string; voided: unknown }) => e.kind === "refund" && !e.voided);
    await api(app, sana).post(`/customer-credits/${refund.id}/void`, { reason: "Typed twice" }).expect(403);
    await api(app, manager).post(`/customer-credits/${refund.id}/void`, { reason: "Typed twice" }).expect(200);
    expect(Number(await creditIn())).toBeCloseTo(start, 2);
  });

  it("builds the plan from the route and rebuilds what is not paid when it changes", async () => {
    const id = await newOrder();
    await api(app, sana).patch(`/orders/${id}/route`, { route: "informal", balanceWhen: "against_bl_copy" }).expect(200);
    let m = await money(id);
    expect(m.route.summary).toBe("Informal, against the B/L copy");
    expect(m.plan.items.map((i: { label: string }) => i.label)).toEqual(["Deposit 30%", "Balance against B/L copy"]);
    const deposit = m.plan.items[0];
    await api(app, manager).post(`/orders/${id}/payments`, { kind: "deposit", amount: deposit.amount, currency: "USD", paidOn: today }).expect(201);
    // A deferred LC needs its days.
    await api(app, sana).patch(`/orders/${id}/route`, { route: "letter_of_credit", lcTerms: "deferred" }).expect(400);
    const f = (await api(app, sana).patch(`/orders/${id}/route`, { route: "letter_of_credit", lcTerms: "deferred", lcDays: 90 }).expect(200)).body;
    expect(f.payment).toMatchObject({ route: "letter_of_credit", lcTerms: "deferred", lcDays: 90, summary: "LC, deferred 90 days" });
    m = await money(id);
    // The paid deposit stays (same row); the balance is the LC's, due 90 days after the papers.
    expect(m.plan.items[0]).toMatchObject({ id: deposit.id, status: "paid" });
    expect(m.plan.items[1]).toMatchObject({ label: "Balance through the LC", part: "balance", how: "LC, deferred 90 days", when: "90 days after the papers", dueOn: null });
    expect(m.plan.matchesTotal).toBe(true);
    // The papers' terms follow the route.
    expect((await api(app, sana).get(`/orders/${id}`).expect(200)).body.balanceTerms).toBe("letter_of_credit");

    // Deferred: the balance is due 90 days after "Papers reached their bank".
    const on = day(-2);
    await api(app, sana).put(`/orders/${id}/bank-steps/customer_bank_received`, { doneOn: on }).expect(200);
    expect((await money(id)).plan.items[1].dueOn).toBe(addDays(on, 90));
    await api(app, sana).delete(`/orders/${id}/bank-steps/customer_bank_received`).expect(200);
    expect((await money(id)).plan.items[1].dueOn).toBeNull();
    // The change is in the order's history under Payment.
    const history = (await api(app, sana).get(`/history?type=order&id=${id}`).expect(200)).body;
    expect(JSON.stringify(history)).toContain("plan rebuilt");
  });

  it("records Money reached us as the payment that ticks the bank step", async () => {
    const id = await newOrder();
    await api(app, sana).patch(`/orders/${id}/route`, { route: "bank_contract" }).expect(200);
    // Ticking it without a payment is not possible any more.
    await api(app, sana).put(`/orders/${id}/bank-steps/bank_paid_us`, { doneOn: today }).expect(400);
    const p = await payments(id);
    const usd = await account("Reached USD", "USD");
    const credited = (Number(p.total) - 230).toFixed(2);
    const paid = (
      await api(app, manager)
        .post(`/orders/${id}/payments`, { kind: "balance", currency: "USD", receivedAmount: credited, receivedCurrency: "USD", bankCharges: 230, paidOn: today, reference: "MT103-1", accountId: usd, bankStep: "bank_paid_us" })
        .expect(201)
    ).body;
    expect(paid).toMatchObject({ due: "0.00", status: "paid" });
    const step = (await flow(id)).documents.bankSteps.find((s: { step: string }) => s.step === "bank_paid_us");
    expect(step).toMatchObject({ doneOn: today, reference: "MT103-1", paymentId: paid.createdId });
    expect((await steps(id)).items.find((i: { key: string }) => i.key === "bank:bank_paid_us")).toMatchObject({ done: true });
    // Undone only by removing the payment.
    await api(app, sana).delete(`/orders/${id}/bank-steps/bank_paid_us`).expect(400);
    await api(app, manager).post(`/payments/${paid.createdId}/void`, { reason: "Wrong order" }).expect(200);
    expect((await flow(id)).documents.bankSteps.find((s: { step: string }) => s.step === "bank_paid_us")).toMatchObject({ doneOn: null });
    // Not on an informal order.
    const informal = await newOrder();
    await api(app, sana).patch(`/orders/${informal}/route`, { route: "informal" }).expect(200);
    await api(app, manager).post(`/orders/${informal}/payments`, { kind: "deposit", amount: 10, currency: "USD", paidOn: today, bankStep: "bank_paid_us" }).expect(400);
  });

  it("checks the LC against the order", async () => {
    const id = await newOrder();
    await api(app, sana).patch(`/orders/${id}/route`, { route: "letter_of_credit", lcTerms: "at_sight" }).expect(200);
    await api(app, sana).patch(`/orders/${id}/details`, { readyOn: day(60) }).expect(200);
    const m = await money(id);
    const balance = m.plan.items.find((i: { part: string }) => i.part === "balance").amount;
    // Short of the balance, and the ship-by date before the factory's ready date.
    let f = (
      await api(app, sana)
        .put(`/orders/${id}/bank-contract`, { number: `LC/${tag}`, status: "opened", amount: Number(balance) - 1, currency: "USD", openedOn: today, latestShipOn: day(55), expiresOn: day(120) })
        .expect(200)
    ).body;
    const byKey = (checks: { key: string; ok: boolean | null }[]) => Object.fromEntries(checks.map((c) => [c.key, c.ok]));
    expect(byKey(f.payment.lcChecks)).toEqual({ amount: false, currency: true, ship_by: false, expiry: true });
    expect(f.payment.lcChecksLine).toBe("2 of 4 match");
    let item = (await steps(id)).items.find((i: { key: string }) => i.key === "contract");
    expect(item).toMatchObject({ title: "LC opened and checked against the order", done: false, late: true });
    expect(item.needs).toMatch(/ask for an amendment/);
    expect(item.data).toContainEqual(["Checks", "2 of 4 match"]);
    // Amended: every check matches and the item ticks.
    f = (
      await api(app, sana)
        .put(`/orders/${id}/bank-contract`, { number: `LC/${tag}`, status: "amended", amount: balance, currency: "USD", openedOn: today, latestShipOn: day(70), expiresOn: day(120) })
        .expect(200)
    ).body;
    expect(f.payment.lcChecksLine).toBe("4 of 4 match");
    item = (await steps(id)).items.find((i: { key: string }) => i.key === "contract");
    expect(item).toMatchObject({ done: true, late: false });
    // Expiry too close to the latest ship date plus the courier days.
    f = (
      await api(app, sana)
        .put(`/orders/${id}/bank-contract`, { number: `LC/${tag}`, status: "amended", amount: balance, currency: "USD", openedOn: today, latestShipOn: day(70), expiresOn: day(72) })
        .expect(200)
    ).body;
    expect(byKey(f.payment.lcChecks).expiry).toBe(false);
  });

  it("pays the factory on a plan: advance when ordered, balance on the ready date", async () => {
    const id = await newOrder(100000);
    // Before ordering: the company's default, not saved.
    let m = await money(id);
    expect(m.factories.plans[0]).toMatchObject({ saved: false, currency: "CNY", owed: "100000.00" });
    await api(app, sana).patch(`/orders/${id}/factory-order`, { factoryOrderedOn: today }).expect(200);
    m = await money(id);
    const plan = m.factories.plans[0];
    expect(plan).toMatchObject({ saved: true });
    expect(plan.rows.map((r: { label: string; amount: string; dueRule: string }) => [r.label, r.amount, r.dueRule])).toEqual([
      ["Advance 30%", "30000.00", "on_order"],
      ["Balance 70%", "70000.00", "on_ready"],
    ]);
    expect(plan.rows[0]).toMatchObject({ due: today, status: "due" });
    expect(plan.rows[1]).toMatchObject({ due: null, status: "later" });
    // The balance's date follows the ready date, both ways.
    await api(app, sana).patch(`/orders/${id}/details`, { readyOn: day(66) }).expect(200);
    expect((await money(id)).factories.plans[0].rows[1]).toMatchObject({ due: day(66), inDays: 66 });
    await api(app, sana).patch(`/orders/${id}/details`, { readyOn: day(-1) }).expect(200);
    expect((await money(id)).factories.plans[0].rows[1]).toMatchObject({ due: day(-1), status: "late" });
    let s = await steps(id);
    expect(s.items.find((i: { key: string }) => i.key === "factory_paid")).toMatchObject({ title: "Balance paid to the factory", done: false, dueOn: day(-1), late: true });
    expect(s.items.find((i: { key: string }) => i.key === "factory_advance")).toMatchObject({ done: false });
    // Paying the advance ticks it.
    await api(app, manager).post(`/orders/${id}/factory-payments`, { factoryId, kind: "deposit", amount: 30000, currency: "CNY", rate: 7.12, paidOn: today }).expect(201);
    m = await money(id);
    expect(m.factories.plans[0].rows[0]).toMatchObject({ status: "paid", paid: "30000.00" });
    s = await steps(id);
    expect(s.items.find((i: { key: string }) => i.key === "factory_advance")).toMatchObject({ done: true });
    // Money › We owe factories shows the next part and its date.
    const payables = (await api(app, manager).get("/money/payables").expect(200)).body;
    const row = payables.find((r: { factory: { id: string } }) => r.factory.id === factoryId);
    expect(row.orders.find((o: { id: string }) => o.id === id).next).toMatchObject({ label: "Balance 70%", due: day(-1), status: "late" });
    // My to-do (Home) has it.
    const todo = (await api(app, sana).get("/me/todo").expect(200)).body;
    expect(todo.find((t: { id: string }) => t.id === id)?.needs).toMatchObject({ late: true });
    // Changing the plan: the parts must add up to what we owe; only people who see factory money.
    const items = [
      { label: "Advance 50%", percent: 50, amount: 50000, dueRule: "on_order" },
      { label: "Balance 50%", percent: 50, amount: 50000, dueRule: "fixed", dueOn: day(10) },
    ];
    await api(app, office).put(`/orders/${id}/factory-plan`, { factoryId, items }).expect(403);
    await api(app, sana).put(`/orders/${id}/factory-plan`, { factoryId, items: [items[0]] }).expect(400);
    await api(app, sana).put(`/orders/${id}/factory-plan`, { factoryId, items: [items[0], { ...items[1], dueOn: null }] }).expect(400);
    m = (await api(app, sana).put(`/orders/${id}/factory-plan`, { factoryId, items }).expect(200)).body;
    expect(m.factories.plans[0].rows[1]).toMatchObject({ label: "Balance 50%", due: day(10), dueRule: "fixed" });
    expect(m.factories.plans[0].rows[0]).toMatchObject({ status: "due", paid: "30000.00", open: "20000.00" });
  });

  it("cancels with money in: credit, refund or a fee; the factory's money a refund or a loss", async () => {
    const usd = await account("Cancel USD", "USD");
    const payDeposit = async (id: string) => {
      const p = await payments(id);
      await api(app, manager).post(`/orders/${id}/payments`, { kind: "deposit", amount: p.depositDue, currency: "USD", paidOn: today }).expect(201);
      return Number(p.depositDue);
    };
    // Keep as credit (the default).
    const a = await newOrder(12000);
    const inA = await payDeposit(a);
    const before = Number(await creditIn());
    await api(app, sana).post(`/orders/${a}/cancel`, { reason: "Postponed" }).expect(403);
    const cancelled = (await api(app, manager).post(`/orders/${a}/cancel`, { reason: "Project postponed to next year", customerMoney: "credit" }).expect(200)).body;
    expect(cancelled.cancelled).toMatchObject({ customerMoney: "credit", factoryMoney: null });
    expect(Number(await creditIn())).toBeCloseTo(before + inA, 2);

    // Refund now: credit in and out, from the account.
    const b = await newOrder(12000);
    const inB = await payDeposit(b);
    await api(app, manager).post(`/orders/${b}/cancel`, { reason: "Lost the tender", customerMoney: "refund", refundNow: true, refundAccountId: usd, refundOn: today }).expect(200);
    expect(Number(await creditIn())).toBeCloseTo(before + inA, 2);
    expect((await credit()).entries.find((e: { kind: string; order: { id: string } | null }) => e.kind === "refund" && e.order?.id === b)).toMatchObject({ amount: inB.toFixed(2) });

    // Keep as a fee: income, not credit.
    const c = await newOrder(12000);
    const inC = await payDeposit(c);
    await api(app, manager).post(`/orders/${c}/cancel`, { reason: "Changed their mind", customerMoney: "fee" }).expect(200);
    expect(Number(await creditIn())).toBeCloseTo(before + inA, 2);
    expect((await credit()).entries.find((e: { kind: string; order: { id: string } | null }) => e.kind === "fee" && e.order?.id === c)).toMatchObject({ amount: inC.toFixed(2) });

    // Money paid to the factory: a loss on the order becomes its expense (borne by us).
    const d = await newOrder(12000);
    await api(app, manager).post(`/orders/${d}/factory-payments`, { factoryId, kind: "deposit", amount: 3600, currency: "CNY", rate: 7.1, paidOn: today }).expect(201);
    await api(app, manager).post(`/orders/${d}/cancel`, { reason: "Factory failed", factoryMoney: "loss" }).expect(200);
    const loss = await prisma.platform.expense.findFirst({ where: { orderId: d } });
    expect(loss).toMatchObject({ category: "other", currency: "CNY", borneBy: "us", step: "factory" });
    expect(loss!.amount.toFixed(2)).toBe("3600.00");
    // …or a refund expected from the factory (the default).
    const e = await newOrder(12000);
    await api(app, manager).post(`/orders/${e}/factory-payments`, { factoryId, kind: "deposit", amount: 3600, currency: "CNY", rate: 7.1, paidOn: today }).expect(201);
    const ce = (await api(app, manager).post(`/orders/${e}/cancel`, { reason: "Customer withdrew" }).expect(200)).body;
    expect(ce.cancelled).toMatchObject({ factoryMoney: "refund_due", customerMoney: null });
    const history = (await api(app, manager).get(`/history?type=order&id=${e}`).expect(200)).body;
    expect(JSON.stringify(history)).toContain("refund expected");
  });

  it("keeps the new tables to the company and the order's people", async () => {
    // Someone who may not see the customer's orders sees none of their money.
    const id = await newOrder();
    await api(app, bilal).get(`/orders/${id}/payments`).expect(404);
    await api(app, bilal).post(`/orders/${id}/use-credit`, { amount: 1 }).expect(403);
    await api(app, bilal).put(`/orders/${id}/factory-plan`, { factoryId, items: [{ label: "All", amount: 1, dueRule: "on_order" }] }).expect(404);
    for (const t of ["customer_receipts", "customer_credits", "factory_payment_plans"]) {
      const [row] = await prisma.platform.$queryRawUnsafe<{ rls: boolean }[]>(`select relrowsecurity as rls from pg_class where relname = $1`, t);
      expect(row, t).toMatchObject({ rls: true });
    }
  });
});
