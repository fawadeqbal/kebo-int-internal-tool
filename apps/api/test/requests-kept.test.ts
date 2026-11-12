import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";
import { Clock } from "../src/common/time/clock.service";

/**
 * Core plan, phase 1: payment requests and receipts kept as sent.
 *  - a plan row is a payment request with a status: not sent, sent, part paid, paid (worked out, never typed);
 *  - Send request keeps exactly what it prints; the order changing afterwards does not move the copy;
 *  - sent again: R2, with why; R1 stays as it was;
 *  - the deposit is asked for by the proforma; a payment without a request is simply paid;
 *  - a receipt is kept when its payment is recorded and says the account as it stood then;
 *  - a request whose row left the plan stays, cancelled;
 *  - no figure moves: the plan's totals, received and due are what they were.
 */
describe("payment requests and receipts kept as sent", () => {
  let app: INestApplication;
  let sana: string;
  let manager: string;
  let me: string;
  let customerId: string;
  let factoryId: string;
  let today = "";
  const tag = Date.now().toString(36);
  const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const day = (n: number) => addDays(today, n);

  type Request = {
    state: string;
    with: string | null;
    sentOn: string | null;
    sentBy: { name: string } | null;
    revision: number | null;
    proformaNo: string | null;
    through: string;
    changed: boolean;
    receipts: { id: string; number: string; amount: string; paidOn: string }[];
  };
  type Item = {
    id: string;
    number: string;
    label: string;
    amount: string;
    dueOn: string | null;
    paid: string;
    open: string;
    status: string;
    part: string | null;
    request: Request;
  };
  type Money = {
    total: string;
    received: string;
    due: string;
    plan: { items: Item[]; cancelled: { ref: string; number: string; revision: number; amount: string | null }[]; canSend: boolean };
  };
  type PaperRow = {
    key: string;
    kind: string;
    number: string | null;
    ref: string | null;
    state: string;
    stateLabel: string;
    version: number | null;
    kept?: boolean;
    live: boolean;
    makeable: boolean;
    sub: string;
  };
  type Doc = {
    final: boolean;
    kept: boolean;
    watermark: string | null;
    versions: { version: number }[];
    doc: {
      number: string;
      date: string;
      total: { amount: string } | null;
      meta: { label: string; value: unknown }[];
      bullets: (string | { label: string; value: { money?: string } })[];
    };
  };

  const money = async (id: string) => (await api(app, sana).get(`/orders/${id}/money`).expect(200)).body as Money;
  const papers = async (id: string) => (await api(app, sana).get(`/orders/${id}/papers`).expect(200)).body.papers as PaperRow[];
  const doc = async (id: string, kind: string, q = "") =>
    (await api(app, sana).get(`/orders/${id}/papers/${kind}/doc${q}`).expect(200)).body as Doc;
  const send = (id: string, ref: string, reason?: string) =>
    api(app, sana).post(`/orders/${id}/requests/send`, { ref, ...(reason ? { reason } : {}) });
  const pay = async (id: string, amount: string, paidOn = today) =>
    (
      await api(app, manager)
        .post(`/orders/${id}/payments`, { kind: "deposit", amount, currency: "USD", paidOn, reference: `TT-${amount}` })
        .expect(201)
    ).body;
  /** "Received so far" and "Still due" as a paper prints them. */
  const bullet = (d: Doc, label: string) =>
    (d.doc.bullets.find((b) => typeof b !== "string" && b.label === label) as { value: { money: string } } | undefined)?.value.money ??
    null;

  /** A new deal, quoted in USD with a 30% deposit and accepted: its order. */
  const newOrder = async () => {
    const inquiry = (
      await api(app, sana)
        .post("/inquiries", { customerId, category: "Machinery", assigneeId: me, items: [{ description: "Blister packer", quantity: 1 }] })
        .expect(201)
    ).body;
    const item = (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.items[0];
    await api(app, sana)
      .post(`/inquiries/${inquiry.id}/factory-quotes`, {
        factoryId,
        receivedOn: day(-5),
        currency: "CNY",
        lines: [{ requestedItemId: item.id, description: "DPP-260", quantity: 1, unitPrice: 200000, taxRate: 0 }],
      })
      .expect(201);
    const draft = (await api(app, sana).get(`/inquiries/${inquiry.id}/quotation/draft`)).body;
    const r = (
      await api(app, sana)
        .post(`/inquiries/${inquiry.id}/quotation/revisions`, {
          ...draft,
          depositPercent: 30,
          currency: "USD",
          balanceTerms: "before_shipment",
        })
        .expect(201)
    ).body;
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "sent" }).expect(200);
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "accepted" }).expect(200);
    const o = (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.orders[0];
    return { id: o.id as string, refNo: o.refNo as string };
  };

  beforeAll(async () => {
    app = await startApp();
    today = app.get(Clock).today();
    sana = await signIn(app, "sana@example.com");
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    me = (await api(app, sana).get("/auth/me")).body.id;
    customerId = (
      await api(app, sana)
        .post("/customers", {
          name: `Kept Pharma ${tag}`,
          country: "PK",
          address: "Plot 9, SITE, Karachi",
          contacts: [{ name: "Adeel", email: `adeel-${tag}@kept.test` }],
        })
        .expect(201)
    ).body.id;
    factoryId = (
      await api(app, sana)
        .post("/factories", { name: `Kept Works ${tag}` })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("a plan row starts not sent; before it is sent the request prints from the data, marked NOT SENT", async () => {
    const o = await newOrder();
    const m = await money(o.id);
    expect(m.plan.items.length).toBe(2);
    expect(m.plan.items.map((i) => i.request.state)).toEqual(["not_sent", "not_sent"]);
    expect(m.plan.canSend).toBe(true);
    const [deposit] = m.plan.items;
    const d = await doc(o.id, "payment-request", `?ref=${deposit!.id}`);
    expect(d).toMatchObject({ final: false, kept: true, watermark: "NOT SENT" });
    const row = (await papers(o.id)).find((p) => p.kind === "payment-request" && p.ref === deposit!.id)!;
    expect(row).toMatchObject({ state: "can", stateLabel: "Not sent", kept: true, live: false, makeable: false, version: null });
    // No draft and no Make page for it.
    await api(app, sana).post(`/orders/${o.id}/papers/payment-request`, { ref: deposit!.id, options: {} }).expect(400);
  });

  it("Send request keeps what it prints; a plan change does not move the copy; sent again is R2 with why", async () => {
    const o = await newOrder();
    const before = await money(o.id);
    const [deposit, balance] = before.plan.items;
    const sent = (await send(o.id, deposit!.id).expect(200)).body;
    expect(sent).toMatchObject({ number: deposit!.number, revision: 1 });

    let m = await money(o.id);
    expect(m.plan.items[0]!.request).toMatchObject({ state: "sent", with: "request", sentOn: today, revision: 1, changed: false });
    expect(m.plan.items[0]!.request.sentBy?.name).toBeTruthy();
    expect(m.plan.items[1]!.request.state).toBe("not_sent");
    // Nothing about the money moved.
    expect({ total: m.total, received: m.received, due: m.due }).toEqual({
      total: before.total,
      received: before.received,
      due: before.due,
    });

    const first = await doc(o.id, "payment-request", `?ref=${deposit!.id}`);
    expect(first).toMatchObject({ final: true, watermark: null });
    expect(first.doc.total?.amount).toBe(deposit!.amount);
    const row = (await papers(o.id)).find((p) => p.kind === "payment-request" && p.ref === deposit!.id)!;
    expect(row).toMatchObject({ state: "ready", stateLabel: "Sent", version: 1 });
    expect(row.sub).toContain(`sent ${today}`);

    // The plan changes: the deposit asks for 100 more, the balance for 100 less.
    const up = (Number(deposit!.amount) + 100).toFixed(2);
    await api(app, sana)
      .put(`/orders/${o.id}/payment-plan`, {
        items: [
          { id: deposit!.id, label: deposit!.label, amount: up, dueOn: deposit!.dueOn ?? day(7) },
          { id: balance!.id, label: balance!.label, amount: (Number(balance!.amount) - 100).toFixed(2) },
        ],
      })
      .expect(200);
    m = await money(o.id);
    expect(m.plan.items[0]!.amount).toBe(up);
    expect(m.plan.items[0]!.request).toMatchObject({ state: "sent", revision: 1, changed: true });
    // The copy that was sent still says what was sent; "as it would print now" says the new amount.
    expect((await doc(o.id, "payment-request", `?ref=${deposit!.id}`)).doc.total?.amount).toBe(deposit!.amount);
    const now = await doc(o.id, "payment-request", `?ref=${deposit!.id}&now=1`);
    expect(now).toMatchObject({ final: false, watermark: "NOT SENT" });
    expect(now.doc.total?.amount).toBe(up);

    // Sent again: asks why, then R2; R1 stays as it was.
    const ask = await send(o.id, deposit!.id).expect(409);
    expect(ask.body.code).toBe("reason_needed");
    expect((await send(o.id, deposit!.id, "Amount changed").expect(200)).body).toMatchObject({ revision: 2 });
    m = await money(o.id);
    expect(m.plan.items[0]!.request).toMatchObject({ state: "sent", revision: 2, changed: false });
    const second = await doc(o.id, "payment-request", `?ref=${deposit!.id}`);
    expect(second.doc.total?.amount).toBe(up);
    expect(second.doc.number).toBe(deposit!.number);
    expect(second.doc.meta.some((x) => x.label === "Revision" && x.value === "R2")).toBe(true);
    expect(second.versions.map((v) => v.version)).toEqual([1, 2]);
    expect((await doc(o.id, "payment-request", `?ref=${deposit!.id}&v=1`)).doc.total?.amount).toBe(deposit!.amount);

    // One request's page: what it asks for, where it stands, both copies.
    const page = (await api(app, sana).get(`/orders/${o.id}/requests/${deposit!.id}`).expect(200)).body;
    expect(page).toMatchObject({ number: deposit!.number, amount: up, cancelled: false, request: { state: "sent", revision: 2 } });
    expect(page.copies.map((c: { revision: number; amount: string }) => [c.revision, c.amount])).toEqual([
      [1, deposit!.amount],
      [2, up],
    ]);
    const history = (await api(app, sana).get(`/history?type=order&id=${o.id}`).expect(200)).body as { action: string; summary: string }[];
    const acts = history.filter((e) => e.action === "paper.sent");
    expect(acts.some((e) => /sent again \(R2\)/.test(e.summary))).toBe(true);
    expect(acts.length).toBe(2);
  });

  it("the proforma asks for the deposit; paid without a request is simply paid; receipts are kept as recorded", async () => {
    const o = await newOrder();
    await api(app, sana)
      .post(`/orders/${o.id}/proforma`, {})
      .expect((r) => expect(r.status).toBeLessThan(300));
    let m = await money(o.id);
    const [deposit, balance] = m.plan.items;
    expect(deposit!.request).toMatchObject({ state: "sent", with: "proforma", sentOn: today, revision: null });
    expect(deposit!.request.proformaNo).toBeTruthy();
    expect(balance!.request.state).toBe("not_sent");

    // The deposit comes in: paid, with its receipt; the balance was never asked for and gets the rest.
    const over = (Number(deposit!.amount) + 500).toFixed(2);
    await pay(o.id, over, day(-2));
    m = await money(o.id);
    expect(m.plan.items[0]!.request).toMatchObject({ state: "paid" });
    expect(m.plan.items[0]!.request.receipts.map((r) => r.amount)).toEqual([deposit!.amount]);
    expect(m.plan.items[1]!.request).toMatchObject({ state: "part_paid", with: null });
    expect(m.plan.items[1]!.request.receipts.map((r) => r.amount)).toEqual(["500.00"]);
    // A paid row has nothing to ask for.
    await send(o.id, deposit!.id).expect(400);

    // Its receipt is kept: version 1, and says the account as it stood then.
    const list = await papers(o.id);
    const rc = list.filter((p) => p.kind === "payment-receipt");
    expect(rc.length).toBe(1);
    expect(rc[0]).toMatchObject({ state: "ready", version: 1, kept: true, live: false });
    const r1 = await doc(o.id, "payment-receipt", `?ref=${rc[0]!.ref}`);
    expect(r1).toMatchObject({ final: true, watermark: null });
    expect(bullet(r1, "Received so far:")).toBe(over);
    expect(r1.doc.bullets.some((b) => typeof b === "string" && b.includes(deposit!.number) && b.includes(balance!.number))).toBe(true);

    // A second payment: the first receipt does not move; the second says the new account.
    await pay(o.id, "1000.00", day(-1));
    const again = await doc(o.id, "payment-receipt", `?ref=${rc[0]!.ref}`);
    expect(bullet(again, "Received so far:")).toBe(over);
    expect(again.doc).toEqual(r1.doc);
    const rc2 = (await papers(o.id)).filter((p) => p.kind === "payment-receipt");
    expect(rc2.length).toBe(2);
    const r2 = await doc(o.id, "payment-receipt", `?ref=${rc2[1]!.ref}`);
    expect(bullet(r2, "Received so far:")).toBe((Number(over) + 1000).toFixed(2));
    m = await money(o.id);
    expect(m.received).toBe((Number(over) + 1000).toFixed(2));

    // A payment corrected: its receipt is kept again (version 2); version 1 stays as it was.
    const payments = (await api(app, manager).get(`/orders/${o.id}/payments`).expect(200)).body.payments as {
      id: string;
      amount: string;
    }[];
    const last = payments.find((p) => p.amount === "1000.00")!;
    await api(app, manager)
      .patch(`/payments/${last.id}`, {
        kind: "balance",
        amount: "900.00",
        currency: "USD",
        paidOn: day(-1),
        reference: "TT-900",
        reason: "Wrong amount",
      })
      .expect(200);
    const rc3 = (await papers(o.id)).find((p) => p.kind === "payment-receipt" && p.ref === last.id)!;
    expect(rc3.version).toBe(2);
    expect(rc3.sub).toContain("corrected");
    expect((await doc(o.id, "payment-receipt", `?ref=${last.id}`)).doc.total?.amount).toBe("900.00");
    expect((await doc(o.id, "payment-receipt", `?ref=${last.id}&v=1`)).doc.total?.amount).toBe("1000.00");
  });

  it("the invoice of an order: its own view and the list; a request tells how each payment came", async () => {
    const o = await newOrder();
    // No proforma yet: the view says so and still shows what it will bill.
    const before = (await api(app, sana).get(`/billing/customer-invoices/${o.id}`).expect(200)).body;
    expect(before.invoice).toBeNull();
    expect(before.lines.length).toBe(1);
    expect(before.parts.map((p: { request: { state: string } }) => p.request.state)).toEqual(["not_sent", "not_sent"]);
    const listed = async () =>
      ((await api(app, sana).get("/billing/customer-invoices").expect(200)).body.rows as { order: { id: string }; invoice: { kind: string; number: string }; status: string; total: string; paid: string; due: string }[]).find(
        (r) => r.order.id === o.id,
      );
    expect(await listed()).toBeUndefined();

    await api(app, sana).post(`/orders/${o.id}/proforma`, {}).expect((r) => expect(r.status).toBeLessThan(300));
    const m = await money(o.id);
    const [deposit, balance] = m.plan.items;
    expect(await listed()).toMatchObject({ invoice: { kind: "proforma" }, status: "unpaid", total: m.total, paid: "0.00", due: m.total });

    // The deposit and a little more come in by cash.
    const paid = (Number(deposit!.amount) + 250).toFixed(2);
    await api(app, manager).post(`/orders/${o.id}/payments`, { kind: "deposit", amount: paid, currency: "USD", paidOn: day(-1), method: "cash", reference: "CASH-77" }).expect(201);
    const v = (await api(app, sana).get(`/billing/customer-invoices/${o.id}`).expect(200)).body;
    expect(v).toMatchObject({ invoice: { kind: "proforma", version: 1 }, status: "part_paid", total: m.total, paid, due: (Number(m.total) - Number(paid)).toFixed(2) });
    expect(v.invoice.number).toBeTruthy();
    expect(v.parts.map((p: { request: { state: string }; paid: string; lastPaidOn: string | null }) => [p.request.state, p.paid, p.lastPaidOn])).toEqual([
      ["paid", deposit!.amount, day(-1)],
      ["part_paid", "250.00", day(-1)],
    ]);
    expect(v.terms.payment).toBeTruthy();
    expect(v.linked.quotation?.refNo).toBeTruthy();
    expect(await listed()).toMatchObject({ status: "part_paid", paid });

    // The request's own view: the payment that paid it, how it came, and where its page is.
    const page = (await api(app, sana).get(`/orders/${o.id}/requests/${balance!.id}`).expect(200)).body;
    expect(page.request.receipts).toEqual([
      expect.objectContaining({ amount: "250.00", whole: paid, method: "cash", reference: "CASH-77", paidOn: day(-1), hasProof: false }),
    ]);
    expect(page.request.receipts[0].entryId).toBeTruthy();
    expect(page.request.receipts[0].recordedBy).toBeTruthy();
    // Another customer's order: not seen through someone else's company is covered elsewhere; a wrong id is not found.
    await api(app, sana).get(`/billing/customer-invoices/${balance!.id}`).expect(404);
  });

  it("a request whose row leaves the plan stays, cancelled", async () => {
    const o = await newOrder();
    const m = await money(o.id);
    const [deposit, balance] = m.plan.items;
    await send(o.id, balance!.id).expect(200);
    // The plan is made again as one part: both rows go.
    await api(app, sana)
      .put(`/orders/${o.id}/payment-plan`, { items: [{ label: "Payment in full", amount: m.total, dueOn: day(10) }] })
      .expect(200);
    const after = await money(o.id);
    expect(after.plan.items.length).toBe(1);
    expect(after.plan.items[0]!.request.state).toBe("not_sent");
    expect(after.plan.cancelled).toEqual([
      expect.objectContaining({ ref: balance!.id, number: balance!.number, revision: 1, amount: balance!.amount }),
    ]);
    const page = (await api(app, sana).get(`/orders/${o.id}/requests/${balance!.id}`).expect(200)).body;
    expect(page).toMatchObject({ cancelled: true, number: balance!.number, amount: balance!.amount, canSend: false });
    expect(await doc(o.id, "payment-request", `?ref=${balance!.id}`)).toMatchObject({ final: true, watermark: "CANCELLED" });
    // The deposit was never sent: nothing is left of it.
    await api(app, sana).get(`/orders/${o.id}/requests/${deposit!.id}`).expect(404);
    await send(o.id, balance!.id, "Mistake fixed").expect(404);
  });

  it("on an LC the balance is asked for through the banks, not with a request", async () => {
    const o = await newOrder();
    await api(app, sana).patch(`/orders/${o.id}/route`, { route: "letter_of_credit" }).expect(200);
    const m = await money(o.id);
    const balance = m.plan.items.find((i) => i.part === "balance")!;
    const deposit = m.plan.items.find((i) => i.part === "deposit")!;
    expect(deposit.request).toMatchObject({ state: "not_sent", through: "customer" });
    expect(balance.request).toMatchObject({ state: "not_sent", through: "bank" });
    const page = (await api(app, sana).get(`/orders/${o.id}/requests/${balance.id}`).expect(200)).body;
    expect(page.canSend).toBe(false);
    const list = (await api(app, sana).get("/billing/requests").expect(200)).body as { rows: { order: { id: string }; ref: string; state: string; through: string }[] };
    expect(list.rows.filter((r) => r.order.id === o.id).map((r) => [r.state, r.through])).toEqual([
      ["not_sent", "customer"],
      ["not_sent", "bank"],
    ]);
  });

  it("the open invoices list says where each request stands", async () => {
    const o = await newOrder();
    const m = await money(o.id);
    await send(o.id, m.plan.items[0]!.id).expect(200);
    const list = (await api(app, manager).get("/billing/invoices?side=receivable").expect(200)).body as {
      rows: { id: string | null; order: { id: string }; request: { state: string; revision: number | null } | null }[];
    };
    const mine = list.rows.filter((r) => r.order.id === o.id);
    expect(mine.map((r) => r.request?.state)).toEqual(["sent", "not_sent"]);
    expect(mine[0]!.request).toMatchObject({ revision: 1 });
  });
});
