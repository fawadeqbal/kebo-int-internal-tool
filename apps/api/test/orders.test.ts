import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";

/**
 * An order from acceptance to Done: Confirmed → In production → Shipped → Done,
 * one button at a time, with warnings to confirm (never blocks), payments, and
 * the documents made from the order.
 */
describe("orders: four stages", () => {
  let app: INestApplication;
  let sana: string;
  let bilal: string;
  let manager: string;
  let orderId: string;
  let customerId: string;
  const tag = Date.now().toString(36);
  const order = async () => (await api(app, sana).get(`/orders/${orderId}`).expect(200)).body;
  const move = (who: string, body: Record<string, unknown>) => api(app, who).post(`/orders/${orderId}/stage`, body);

  beforeAll(async () => {
    app = await startApp();
    sana = await signIn(app, "sana@example.com");
    bilal = await signIn(app, "bilal@example.com");
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    const me = (await api(app, sana).get("/auth/me")).body.id;
    // A deal of Sana's: 100 machines and a freight charge, quoted, accepted.
    const customer = (await api(app, sana).post("/customers", { name: `Kano Agro ${tag}`, country: "NG", contacts: [{ name: "Musa", email: `musa-${tag}@kano.test` }] }).expect(201)).body;
    customerId = customer.id;
    const inquiry = (await api(app, sana).post("/inquiries", { customerId, category: "Machinery", assigneeId: me, items: [{ description: "Maize sheller 5t/h", quantity: 100 }] }).expect(201)).body;
    const item = (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.items[0];
    await api(app, sana)
      .post(`/inquiries/${inquiry.id}/factory-quotes`, { newFactoryName: `Henan Agri ${tag}`, receivedOn: "2026-10-01", currency: "CNY", lines: [{ requestedItemId: item.id, description: "Maize sheller", quantity: 100, unitPrice: 1420, vatRate: 13 }] })
      .expect(201);
    const draft = (await api(app, sana).get(`/inquiries/${inquiry.id}/quotation/draft`)).body;
    draft.lines.push({ type: "charge", description: "Sea freight to Lagos", quantity: 1, unitPrice: 1500 });
    const r1 = (await api(app, sana).post(`/inquiries/${inquiry.id}/quotation/revisions`, { ...draft, discount: 100 }).expect(201)).body;
    await api(app, sana).post(`/revisions/${r1.id}/status`, { to: "sent" }).expect(200);
    await api(app, sana).post(`/revisions/${r1.id}/status`, { to: "accepted" }).expect(200);
    orderId = (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.orders[0].id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("starts Confirmed, with one button and the deposit to ask for", async () => {
    const o = await order();
    expect(o).toMatchObject({ status: "open", stage: "confirmed", depositPercent: 30, next: { to: "in_production", label: "Start production" }, back: null });
    expect(o.needs).toMatchObject({ title: expect.stringMatching(/^Get the deposit \(USD /), late: false });
    expect(Number(o.money.deposit)).toBeCloseTo(Number(o.total) * 0.3, 2);
    expect(o.money).toMatchObject({ received: "0.00", due: o.total, status: "unpaid" });
    expect(o.history).toEqual([expect.objectContaining({ from: null, to: "confirmed" })]);
    expect(o.documents.map((d: { kind: string }) => d.kind)).toEqual(["quotation", "proforma", "invoice", "packing-list"]);
  });

  it("refuses without a session, and shows staff only their own orders", async () => {
    await api(app).get(`/orders/${orderId}`).expect(401);
    await api(app, bilal).get(`/orders/${orderId}`).expect(404);
    await api(app, bilal).post(`/orders/${orderId}/stage`, { to: "in_production" }).expect(404);
    await api(app, manager).get(`/orders/${orderId}`).expect(200);
  });

  it("shows staff only their own orders on a customer's page", async () => {
    await api(app, bilal).post("/inquiries", { customerId, category: "Machinery", items: [{ description: "Access test", quantity: 1 }] }).expect(201);
    const asBilal = (await api(app, bilal).get(`/customers/${customerId}`).expect(200)).body;
    expect(asBilal.orders.map((o: { id: string }) => o.id)).not.toContain(orderId);
    const asManager = (await api(app, manager).get(`/customers/${customerId}`).expect(200)).body;
    expect(asManager.orders.map((o: { id: string }) => o.id)).toContain(orderId);
  });

  it("moves one stage at a time, and explains", async () => {
    const skip = await move(sana, { to: "shipped" }).expect(409);
    expect(skip.body).toMatchObject({ code: "not_next_or_previous", error: expect.stringMatching(/one stage at a time/) });
    const bad = await move(sana, { to: "nowhere" }).expect(422);
    expect(bad.body.fieldErrors.to).toBeDefined();
  });

  it("warns before production without the deposit, and goes ahead when confirmed", async () => {
    const warned = await move(sana, { to: "in_production" }).expect(409);
    expect(warned.body).toMatchObject({ code: "confirm", error: expect.stringMatching(/deposit .* has not been received/) });
    expect((await order()).stage).toBe("confirmed"); // nothing changed
    const moved = (await move(sana, { to: "in_production", confirm: true, readyOn: "2026-12-01", note: "Customer sent the swift copy" }).expect(200)).body;
    expect(moved).toMatchObject({ stage: "in_production", readyOn: "2026-12-01", back: { to: "confirmed" }, next: { to: "shipped" } });
    expect(moved.history.at(-1)).toMatchObject({ from: "confirmed", to: "in_production", confirmed: true, note: "Customer sent the swift copy", by: { name: expect.any(String) } });
    expect(moved.needs).toMatchObject({ title: "Goods due from the factory", due: "2026-12-01" });
  });

  it("moves back one stage without questions, and forward again", async () => {
    expect((await move(sana, { to: "confirmed" }).expect(200)).body.stage).toBe("confirmed");
    expect((await move(sana, { to: "in_production", confirm: true }).expect(200)).body.stage).toBe("in_production");
  });

  it("records payments (accounts only) and works out what is still due", async () => {
    const o = await order();
    const deposit = Number(o.money.deposit);
    await api(app, sana).post(`/orders/${orderId}/payments`, { kind: "deposit", amount: "100", currency: "USD", paidOn: "2026-10-21" }).expect(403);
    await api(app, manager).post(`/orders/${orderId}/payments`, { kind: "deposit", amount: "100", currency: "EUR", paidOn: "2026-10-21" }).expect(400);
    await api(app, manager).post(`/orders/${orderId}/payments`, { kind: "deposit", amount: "100", currency: "USD", paidOn: "2099-01-01" }).expect(400);
    const paid = (await api(app, manager).post(`/orders/${orderId}/payments`, { kind: "deposit", amount: (deposit - 25).toFixed(2), bankCharges: "25", currency: "USD", paidOn: "2026-10-21", reference: "TT-1" }).expect(201)).body;
    expect(paid).toMatchObject({ status: "deposit_paid", received: deposit.toFixed(2) });
    await api(app, manager).post(`/orders/${orderId}/payments`, { kind: "balance", amount: (Number(o.total) + 1).toFixed(2), currency: "USD", paidOn: "2026-10-21" }).expect(400); // more than due
    expect((await order()).money).toMatchObject({ received: deposit.toFixed(2), depositDue: "0.00" });
  });

  it("warns before shipping with the balance unpaid (balance before shipment), then records the ship date and B/L", async () => {
    const warned = await move(sana, { to: "shipped", blNo: "QDLOS-77" }).expect(409);
    expect(warned.body.error).toMatch(/still due, and the terms say the balance is paid before shipping/);
    await move(sana, { to: "shipped", confirm: true, shippedOn: "2099-01-01" }).expect(400); // no future dates
    const shipped = (await move(sana, { to: "shipped", confirm: true, shippedOn: "2026-10-24", blNo: "QDLOS-77" }).expect(200)).body;
    expect(shipped).toMatchObject({ stage: "shipped", shippedOn: "2026-10-24", blNo: "QDLOS-77", next: { to: "done", label: "Close the order" } });
    expect(shipped.needs.title).toMatch(/^Get the balance \(USD /);
  });

  it("serves two clicks at once one after the other: exactly one moves", async () => {
    const o = await order();
    await api(app, manager).post(`/orders/${orderId}/payments`, { kind: "balance", amount: o.money.due, currency: "USD", paidOn: "2026-10-25" }).expect(201);
    const [a, b] = await Promise.all([move(sana, { to: "done" }), move(sana, { to: "done" })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const done = await order();
    expect(done).toMatchObject({ stage: "done", status: "closed", next: null, needs: null, back: { to: "shipped" } });
    expect(done.money).toMatchObject({ due: "0.00", status: "paid" });
    expect((await api(app, sana).get("/orders?status=closed").expect(200)).body.map((x: { id: string }) => x.id)).toContain(orderId);
  });

  it("reopens when moved back from Done", async () => {
    expect((await move(sana, { to: "shipped", note: "Customer claims a short shipment" }).expect(200)).body).toMatchObject({ stage: "shipped", status: "open" });
    expect((await move(sana, { to: "done" }).expect(200)).body.status).toBe("closed");
  });

  it("makes the documents from the order", async () => {
    const o = await order();
    const pi = (await api(app, sana).get(`/orders/${orderId}/documents/proforma`).expect(200)).body;
    expect(pi).toMatchObject({ title: "Proforma invoice", number: o.refNo.replace("SO-", "PI-"), date: o.orderedOn, currency: "USD", showPrices: true });
    expect(pi.lines.map((l: { type: string }) => l.type)).toEqual(["goods", "charge"]);
    expect(pi.totals).toMatchObject({ discount: "100.00", total: o.total, depositPercent: 30 });
    expect(pi.customer).toMatchObject({ name: `Kano Agro ${tag}` });
    const inv = (await api(app, sana).get(`/orders/${orderId}/documents/invoice`).expect(200)).body;
    expect(inv).toMatchObject({ title: "Commercial invoice", number: o.refNo.replace("SO-", "INV-"), date: "2026-10-24", totals: { received: o.total, due: "0.00" } });
    expect(inv.order.blNo).toBe("QDLOS-77");
    const pl = (await api(app, sana).get(`/orders/${orderId}/documents/packing-list`).expect(200)).body;
    expect(pl).toMatchObject({ title: "Packing list", showPrices: false, totals: null, bankDetails: null });
    expect(pl.lines).toEqual([expect.objectContaining({ description: expect.stringMatching(/Maize sheller/), quantity: "100", unitPrice: null })]); // goods only
    await api(app, sana).get(`/orders/${orderId}/documents/receipt`).expect(422);
    await api(app, bilal).get(`/orders/${orderId}/documents/proforma`).expect(404);
  });

  it("lets a manager remove a wrong payment (it stays, crossed out) and cancel with a reason", async () => {
    const list = (await api(app, sana).get(`/orders/${orderId}/payments`).expect(200)).body;
    const p = list.payments[0];
    await api(app, sana).post(`/payments/${p.id}/void`, { reason: "Typed twice" }).expect(403);
    const after = (await api(app, manager).post(`/payments/${p.id}/void`, { reason: "Typed twice" }).expect(200)).body;
    expect(after.payments.find((x: { id: string }) => x.id === p.id).voided).toMatchObject({ reason: "Typed twice" });
    expect(Number(after.due)).toBeGreaterThan(0);
  });

  it("lists my to-do: what each order needs, late first", async () => {
    const todo = (await api(app, bilal).get("/me/todo").expect(200)).body;
    expect(todo.length).toBeGreaterThan(0);
    expect(todo[0]).toMatchObject({ refNo: expect.stringMatching(/^SO-/), needs: { title: expect.any(String), due: expect.any(String) } });
    const lates = todo.map((t: { needs: { late: boolean } }) => t.needs.late);
    expect(lates).toEqual([...lates].sort((a: boolean, b: boolean) => Number(b) - Number(a)));
  });
});
