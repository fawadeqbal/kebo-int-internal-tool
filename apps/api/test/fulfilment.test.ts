import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";

/** An accepted order taken to closed by recording the real things: invoices, payments, factory order, shipments. */
describe("fulfilment: from accepted order to closed", () => {
  let app: INestApplication;
  let manager: string;
  let staff: string;
  let orderId: string;
  let foId: string;
  const tag = Date.now().toString(36);
  const step = async (key: string) => (await api(app, manager).get(`/orders/${orderId}`).expect(200)).body.plan.steps.find((s: { key: string }) => s.key === key);

  beforeAll(async () => {
    app = await startApp();
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    staff = await signIn(app, "bilal@example.com");
    const me = (await api(app, staff).get("/auth/me")).body.id;
    // A deal: customer, two items (one goods line of 100 pcs, one freight charge), factory price, R1 sent and accepted.
    const customer = (await api(app, staff).post("/customers", { name: `Kano Agro ${tag}`, country: "NG", contacts: [{ name: "Musa", email: `musa-${tag}@kano.test` }] }).expect(201)).body;
    const inquiry = (
      await api(app, staff)
        .post("/inquiries", { customerId: customer.id, category: "Machinery", assigneeId: me, items: [{ description: "Maize sheller 5t/h", quantity: 100 }] })
        .expect(201)
    ).body;
    const item = (await api(app, staff).get(`/inquiries/${inquiry.id}`)).body.items[0];
    await api(app, staff)
      .post(`/inquiries/${inquiry.id}/factory-quotes`, { newFactoryName: `Henan Agri ${tag}`, receivedOn: "2026-10-01", currency: "CNY", lines: [{ requestedItemId: item.id, description: "Maize sheller", quantity: 100, unitPrice: 1420, vatRate: 13 }] })
      .expect(201);
    const draft = (await api(app, staff).get(`/inquiries/${inquiry.id}/quotation/draft`)).body;
    draft.lines.push({ type: "charge", description: "Sea freight to Lagos", quantity: 1, unitPrice: 1500 });
    const r1 = (await api(app, staff).post(`/inquiries/${inquiry.id}/quotation/revisions`, { ...draft, discount: 100 }).expect(201)).body;
    await api(app, staff).post(`/revisions/${r1.id}/status`, { to: "sent" }).expect(200);
    await api(app, staff).post(`/revisions/${r1.id}/status`, { to: "accepted" }).expect(200);
    orderId = (await api(app, staff).get(`/inquiries/${inquiry.id}`)).body.orders[0].id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("issuing the proforma ticks the first step", async () => {
    const pi = (await api(app, manager).post(`/orders/${orderId}/invoices`, { type: "proforma" }).expect(201)).body;
    expect(pi).toMatchObject({ status: "draft", number: null, depositPercent: 30 });
    await api(app, staff).post(`/orders/${orderId}/invoices`, { type: "proforma" }).expect(403); // accounts only
    const issued = (await api(app, manager).post(`/invoices/${pi.id}/issue`, {}).expect(200)).body;
    expect(issued.number).toMatch(/^PI-\d{4}-\d{4}$/);
    expect((await step("proforma_sent")).status).toBe("done");
    await api(app, manager).post(`/orders/${orderId}/invoices`, { type: "proforma" }).expect(400); // one live proforma
  });

  it("places the factory order from the factory's price and ticks 'Factory order placed' when sent", async () => {
    const drafts = (await api(app, staff).get(`/orders/${orderId}/factory-orders/drafts`).expect(200)).body;
    expect(drafts.groups).toHaveLength(1);
    expect(drafts.groups[0].lines[0]).toMatchObject({ quantity: 100, unitPrice: 1420 });
    const g = drafts.groups[0];
    foId = (await api(app, staff).post(`/orders/${orderId}/factory-orders`, { factoryId: g.factory.id, currency: g.currency, lines: g.lines }).expect(201)).body.id;
    const sent = (await api(app, staff).post(`/factory-orders/${foId}/send`, {}).expect(200)).body;
    expect(sent).toMatchObject({ status: "sent", total: "142000.00", deposit: "42600.00" });
    expect((await step("factory_order")).status).toBe("done");
  });

  it("refuses to record a factory payment before the customer's deposit, unless a manager writes why", async () => {
    const pay = { kind: "deposit", amount: "42600", currency: "CNY", paidOn: "2026-10-20", factoryOrderId: foId };
    const refused = await api(app, manager).post(`/orders/${orderId}/payments/out`, pay).expect(409);
    expect(refused.body.code).toBe("note_required");
    const none = (await api(app, manager).get(`/orders/${orderId}/payments`)).body.payments.filter((p: { direction: string }) => p.direction === "out");
    expect(none).toHaveLength(0); // nothing was saved
  });

  it("records the customer's deposit (bank charges included) and only then the factory deposit", async () => {
    const order = (await api(app, manager).get(`/orders/${orderId}`)).body;
    const deposit = Number(order.customerPayments.depositOutstandingMinor) / 100;
    await api(app, manager).post(`/orders/${orderId}/payments/in`, { kind: "deposit", amount: "1", currency: "EUR", paidOn: "2026-10-21" }).expect(400);
    const after = (await api(app, manager).post(`/orders/${orderId}/payments/in`, { kind: "deposit", amount: (deposit - 25).toFixed(2), bankCharges: "25", currency: "USD", paidOn: "2026-10-21", reference: "TT-1" }).expect(201)).body;
    expect(after.customer.status).toBe("deposit_paid");
    expect((await step("customer_deposit")).status).toBe("done");
    await api(app, manager).post(`/orders/${orderId}/payments/out`, { kind: "deposit", amount: "42600", currency: "CNY", paidOn: "2026-10-22", factoryOrderId: foId }).expect(201);
    expect((await step("factory_deposit")).status).toBe("done");
  });

  it("factory confirmation sets the ready date the later steps hang on", async () => {
    await api(app, staff).post(`/factory-orders/${foId}/confirm`, { readyOn: "2026-12-01" }).expect(200);
    const o = (await api(app, staff).get(`/orders/${orderId}`)).body;
    expect(o.readyOn).toBe("2026-12-01");
    expect(o.plan.steps.find((s: { key: string }) => s.key === "factory_confirmed").status).toBe("done");
    expect(o.plan.steps.find((s: { key: string }) => s.key === "inspection_passed").due).toBe("2026-12-01");
  });

  it("will not ship before inspection and the balance (balance before shipment)", async () => {
    const draft = (await api(app, staff).get(`/orders/${orderId}/shipments/draft`)).body;
    expect(draft.lines).toEqual([expect.objectContaining({ quantity: 100 })]); // goods only, freight is not packed
    // Two part-shipments of 60 and 40.
    const s1 = (await api(app, staff).post(`/orders/${orderId}/shipments`, { blNo: "BL-1", lines: [{ ...draft.lines[0], quantity: 60 }] }).expect(201)).body;
    await api(app, staff).post(`/orders/${orderId}/shipments`, { lines: [{ ...draft.lines[0], quantity: 50 }] }).expect(400); // only 40 left
    const s2 = (await api(app, staff).post(`/orders/${orderId}/shipments`, { blNo: "BL-2", lines: [{ ...draft.lines[0], quantity: 40, packages: 4 }] }).expect(201)).body;
    await api(app, staff).post(`/shipments/${s1.id}/status`, { to: "departed" }).expect(200); // not the last: no step yet
    const blocked = await api(app, staff).post(`/shipments/${s2.id}/status`, { to: "departed" }).expect(409);
    expect(blocked.body.code).toBe("inspect_first");
    // A manager goes past the gate only with a reason they write: the shipment's B/L number is not one.
    const unexplained = await api(app, manager).post(`/shipments/${s2.id}/status`, { to: "departed" }).expect(409);
    expect(unexplained.body.code).toBe("note_required");
    await api(app, staff).post(`/orders/${orderId}/steps`, { action: "skip", key: "inspection_passed", note: "Customer waived" }).expect(200);
    await api(app, staff).post(`/orders/${orderId}/steps`, { action: "skip", key: "samples_approved" }).expect(200);
    const blocked2 = await api(app, staff).post(`/shipments/${s2.id}/status`, { to: "departed" }).expect(409);
    expect(blocked2.body.code).toBe("balance_first");

    // The balance arrives; the factory is paid in full; now the goods can go.
    const o = (await api(app, manager).get(`/orders/${orderId}`)).body;
    await api(app, manager).post(`/orders/${orderId}/payments/in`, { kind: "balance", amount: (o.customerPayments.outstandingMinor / 100).toFixed(2), currency: "USD", paidOn: "2026-10-25" }).expect(201);
    expect((await step("customer_balance")).status).toBe("done");
    await api(app, manager).post(`/orders/${orderId}/payments/out`, { kind: "balance", amount: "99400", currency: "CNY", paidOn: "2026-10-25", factoryOrderId: foId }).expect(201);
    expect((await step("factory_balance")).status).toBe("done");
    await api(app, staff).post(`/shipments/${s2.id}/status`, { to: "departed" }).expect(200);
    expect((await step("shipped")).status).toBe("done");

    // Commercial invoices per shipment add up exactly to the order.
    const i1 = (await api(app, manager).post(`/orders/${orderId}/invoices`, { type: "commercial", shipmentId: s1.id }).expect(201)).body;
    const i2 = (await api(app, manager).post(`/orders/${orderId}/invoices`, { type: "commercial", shipmentId: s2.id }).expect(201)).body;
    expect(i1.lines.map((l: { type: string }) => l.type)).toEqual(["goods", "charge"]); // freight on the first invoice
    const sum = Math.round((Number(i1.total) + Number(i2.total)) * 100);
    expect(sum).toBe(Math.round(Number(o.total) * 100));
    await api(app, manager).post(`/invoices/${i1.id}/issue`, {}).expect(200);

    // Documents for both shipments released → that step; then the VAT invoice → the order closes.
    await api(app, staff).post(`/shipments/${s1.id}/documents-released`, {}).expect(200);
    expect((await step("documents_released")).status).toBe("todo");
    await api(app, staff).post(`/shipments/${s2.id}/documents-released`, {}).expect(200);
    expect((await step("documents_released")).status).toBe("done");
    await api(app, staff).post(`/factory-orders/${foId}/vat-invoice`, { number: "FP-778", on: "2026-10-26" }).expect(200);
    const closed = (await api(app, manager).get(`/orders/${orderId}`)).body;
    expect(closed).toMatchObject({ status: "closed", stage: "closed" });
    expect(closed.plan.next).toBeNull();
  });
});
