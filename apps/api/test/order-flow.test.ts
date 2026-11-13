import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIRST_COMPANY_ID } from "@kebo/database";
import { flowSteps, MODULE_PRESETS, ORDER_FLOW_FEATURES, requiredDocuments, withPreset, type FlowFacts } from "@kebo/shared";
import { api, signIn, startApp } from "./app";
import { day } from "./dates";
import { PrismaService } from "../src/database/prisma.service";
import { CompaniesService } from "../src/common/company/companies.service";

/**
 * After the customer accepts: asking factories, how the customer pays (informal,
 * bank contract, LC), production, shipments, the document set and its trip
 * through the banks, delivery, SAT and claims. Each part is a module the
 * platform admin can switch off for a company, and each change a permission.
 */
describe("order flow: from asking factories to SAT", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sana: string;
  let bilal: string;
  let admin: string;
  let inquiryId: string;
  let orderId: string;
  let henan: string;
  let wuxi: string;
  const tag = Date.now().toString(36);
  const password = "Person@12345";
  /** A reply-by date that is still ahead whenever the test runs (a fixed date fails once it has passed). */
  const flow = async (who = sana) => (await api(app, who).get(`/orders/${orderId}/flow`).expect(200)).body;
  const stepState = (f: { steps: { key: string; state: string }[] }) => Object.fromEntries(f.steps.map((s) => [s.key, s.state]));
  const modulesOff = async (off: string[]) => {
    await prisma.platform.company.update({ where: { id: FIRST_COMPANY_ID }, data: { featuresOff: off } });
    app.get(CompaniesService).forget(FIRST_COMPANY_ID);
  };

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);
    sana = await signIn(app, "sana@example.com");
    bilal = await signIn(app, "bilal@example.com");
    admin = await signIn(app, "admin@example.com", "Admin@12345");
    const me = (await api(app, sana).get("/auth/me")).body.id;
    const customer = (await api(app, sana).post("/customers", { name: `Lahore Pharma ${tag}`, country: "PK", contacts: [{ name: "Ali", email: `ali-${tag}@lp.test` }] }).expect(201)).body;
    const inquiry = (await api(app, sana).post("/inquiries", { customerId: customer.id, category: "Machinery", assigneeId: me, items: [{ description: "Blister packing machine", quantity: 1 }] }).expect(201)).body;
    inquiryId = inquiry.id;
    henan = (await api(app, sana).post("/factories", { name: `Henan Pack ${tag}` }).expect(201)).body.id;
    wuxi = (await api(app, sana).post("/factories", { name: `Wuxi Machinery ${tag}` }).expect(201)).body.id;
  });

  afterAll(async () => {
    if (prisma) await modulesOff([]);
    await app?.close();
  });

  it("sends the spec to several factories and sees who answered", async () => {
    // Before asking: every factory is offered, none asked here yet.
    const before = (await api(app, sana).get(`/inquiries/${inquiryId}/factory-requests`).expect(200)).body;
    expect(before.items).toEqual([]);
    expect(before.suggestions.find((f: { id: string }) => f.id === henan)).toMatchObject({ name: `Henan Pack ${tag}`, askedHere: false, lastAskedOn: null, won: 0, goodAt: null, isNew: true });
    // A day sent in the future is refused; one in the past is kept.
    await api(app, sana).post(`/inquiries/${inquiryId}/factory-requests`, { factoryIds: [henan], sentOn: day(3) }).expect(400);
    const asked = (await api(app, sana).post(`/inquiries/${inquiryId}/factory-requests`, { factoryIds: [henan, wuxi], replyBy: day(7), channel: "wechat", sentOn: day(0) }).expect(201)).body;
    expect(asked.counts).toEqual({ asked: 2, quoted: 0, waiting: 2, late: 0 });
    expect(asked.items[0]).toMatchObject({ channel: "wechat", waitingDays: 0 });
    expect(asked.suggestions.find((f: { id: string }) => f.id === henan)).toMatchObject({ askedHere: true, lastAskedOn: expect.any(String) });
    await api(app, sana).post(`/inquiries/${inquiryId}/factory-requests`, { factoryIds: [henan], channel: "pigeon" }).expect(422);
    // Asking again leaves them as they are.
    await api(app, sana).post(`/inquiries/${inquiryId}/factory-requests`, { factoryIds: [henan] }).expect(201);
    expect((await api(app, sana).get(`/inquiries/${inquiryId}/factory-requests`).expect(200)).body.items).toHaveLength(2);

    // Henan's offer comes in: its request counts as answered.
    const item = (await api(app, sana).get(`/inquiries/${inquiryId}`)).body.items[0];
    await api(app, sana)
      .post(`/inquiries/${inquiryId}/factory-quotes`, { factoryId: henan, receivedOn: day(-22), currency: "CNY", lines: [{ requestedItemId: item.id, description: "DPP-250 blister machine", quantity: 1, unitPrice: 185000 }] })
      .expect(201);
    const list = (await api(app, sana).get(`/inquiries/${inquiryId}/factory-requests`).expect(200)).body;
    const byFactory = Object.fromEntries(list.items.map((i: { factory: { id: string }; status: string; id: string }) => [i.factory.id, i]));
    expect(byFactory[henan]).toMatchObject({ status: "quoted", factoryQuoteId: expect.any(String) });
    expect(byFactory[wuxi]).toMatchObject({ status: "sent" });
    const declined = (await api(app, sana).patch(`/factory-requests/${byFactory[wuxi].id}`, { status: "declined", note: "Too busy until March" }).expect(200)).body;
    expect(declined.counts).toMatchObject({ quoted: 1, waiting: 0 });

    // Staff who do not handle the deal cannot see it; a reply-by before the date sent is refused.
    await api(app, bilal).get(`/inquiries/${inquiryId}/factory-requests`).expect(404);
    await api(app, sana).post(`/inquiries/${inquiryId}/factory-requests`, { factoryIds: [wuxi], sentOn: day(-32), replyBy: day(-41) }).expect(400);
    await api(app, sana).post(`/inquiries/${inquiryId}/factory-requests`, { factoryIds: [] }).expect(422);

    // The history of the deal says who was asked.
    const history = (await api(app, sana).get(`/history?type=deal&id=${inquiryId}`)).body;
    expect(JSON.stringify(history)).toMatch(/asked 2 factories for a price/);
  });

  it("accepting makes an order whose flow starts at Payment, with every module", async () => {
    const draft = (await api(app, sana).get(`/inquiries/${inquiryId}/quotation/draft`)).body;
    const r1 = (await api(app, sana).post(`/inquiries/${inquiryId}/quotation/revisions`, draft).expect(201)).body;
    await api(app, sana).post(`/revisions/${r1.id}/status`, { to: "sent" }).expect(200);
    await api(app, sana).post(`/revisions/${r1.id}/status`, { to: "accepted" }).expect(200);
    orderId = (await api(app, sana).get(`/inquiries/${inquiryId}`)).body.orders[0].id;

    const f = await flow();
    expect(f.modules).toEqual({ bankContracts: true, production: true, shipping: true, bankDocuments: true, deliverySat: true });
    expect(stepState(f)).toEqual({ payment: "current", factory: "todo", production: "todo", shipping: "todo", documents: "todo", delivery: "todo" });
    // The route the quotation's terms imply (before shipment: informal), shown "from the quotation".
    expect(f.payment).toMatchObject({ route: "informal", fromQuotation: true, depositIn: false, bankContract: null });
    expect(f.factory.factories).toEqual([{ id: henan, name: `Henan Pack ${tag}` }]);
    expect(f.delivery.suggestedSat.length).toBeGreaterThan(0);
    // The informal set of papers, the proforma counted from the order itself.
    expect(f.documents.set.map((d: { kind: string }) => d.kind)).toEqual(requiredDocuments("informal"));
    expect(f.documents.bankSteps.map((b: { step: string }) => b.step)).toEqual(["copies_to_customer"]);
    await api(app, bilal).get(`/orders/${orderId}/flow`).expect(404);
  });

  it("the payment route decides the papers and the bank chain; the LC is kept with the order", async () => {
    await api(app, sana).put(`/orders/${orderId}/bank-contract`, { number: "LC-1" }).expect(400); // no bank route yet
    await api(app, sana).patch(`/orders/${orderId}/route`, { route: "letter_of_credit" }).expect(200);
    const f = (
      await api(app, sana)
        .put(`/orders/${orderId}/bank-contract`, {
          number: "LC/HBL/2026/118",
          status: "opened",
          customerBank: "Habib Bank, Lahore",
          ourBank: "Bank of China, Guangzhou",
          amount: 26500,
          currency: "USD",
          openedOn: day(-17),
          latestShipOn: day(39),
          expiresOn: day(60),
        })
        .expect(200)
    ).body;
    expect(f.payment).toMatchObject({ route: "letter_of_credit", routeLabel: "LC", bankContract: { number: "LC/HBL/2026/118", status: "opened", amount: 26500, currency: "USD" } });
    expect(f.documents.set.map((d: { kind: string }) => d.kind)).toEqual(requiredDocuments("letter_of_credit"));
    // An LC's trip has "Papers reached their bank" too (its deferred days count from there).
    expect(f.documents.bankSteps).toHaveLength(6);
    // An amount needs its currency; an LC cannot expire before it opens.
    await api(app, sana).put(`/orders/${orderId}/bank-contract`, { amount: 100 }).expect(400);
    await api(app, sana).put(`/orders/${orderId}/bank-contract`, { openedOn: day(-17), expiresOn: day(-41) }).expect(400);
    await api(app, sana).patch(`/orders/${orderId}/route`, { route: "by_pigeon" }).expect(422);

    // The deposit arrives: Payment is done, the factory order is next.
    const o = (await api(app, sana).get(`/orders/${orderId}`)).body;
    await api(app, sana).post(`/orders/${orderId}/payments`).send({}).expect(403); // staff do not record money
    await api(app, admin).post(`/orders/${orderId}/payments`, { kind: "deposit", amount: o.money.deposit, currency: o.currency, paidOn: day(-16), method: "letter_of_credit" }).expect(201);
    expect(stepState(await flow())).toMatchObject({ payment: "done", factory: "current" });
  });

  it("factory order and production", async () => {
    await api(app, sana).patch(`/orders/${orderId}/factory-order`, { factoryOrderedOn: "2099-01-01" }).expect(400);
    let f = (await api(app, sana).patch(`/orders/${orderId}/factory-order`, { factoryOrderedOn: day(-15) }).expect(200)).body;
    expect(stepState(f)).toMatchObject({ factory: "done", production: "current" });
    // The order's stage follows: ordered from the factory → In production, said in its history.
    const moved = (await api(app, sana).get(`/orders/${orderId}`)).body;
    expect(moved.stage).toBe("in_production");
    expect(moved.history.at(-1)).toMatchObject({ from: "confirmed", to: "in_production", note: "ordered from the factory" });

    // Production has the ready date, the factory test and the goods from the factory; no timeline to tick.
    await api(app, sana).put(`/orders/${orderId}/production`, { steps: [] }).expect(404);
    await api(app, sana).put(`/orders/${orderId}/factory-facts`, { fatPlannedOn: day(9) }).expect(200);
    f = (await api(app, sana).get(`/orders/${orderId}/flow`).expect(200)).body;
    expect(f.steps.find((s: { key: string }) => s.key === "production").sub).toBe("No ready date yet");
    expect(stepState(f)).toMatchObject({ production: "current" });
    // Every goods line in from the factory: the production step is done.
    const lines = (await api(app, sana).get(`/orders/${orderId}`).expect(200)).body.lines as { id: string; type: string; quantity: string }[];
    for (const l of lines.filter((x) => x.type === "goods")) await api(app, sana).patch(`/order-lines/${l.id}`, { set: "received", receivedQty: l.quantity, receivedOn: day(-10) }).expect(200);
    f = (await api(app, sana).get(`/orders/${orderId}/flow`).expect(200)).body;
    expect(f.steps.find((s: { key: string }) => s.key === "production").sub).toBe("Goods received");
    expect(stepState(f)).toMatchObject({ production: "done", shipping: "current" });
  });

  it("shipping: a sea shipment from booked to arrived", async () => {
    let f = (
      await api(app, sana)
        .post(`/orders/${orderId}/shipments`, { mode: "sea", status: "booked", forwarder: "Sino Trans", portOfLoading: "Shanghai", portOfDischarge: "Karachi", containerType: "40HQ", etd: day(14), eta: day(34) })
        .expect(201)
    ).body;
    const ship = f.shipping.shipments[0];
    expect(ship).toMatchObject({ mode: "sea", status: "booked", portOfDischarge: "Karachi", eta: day(34) });
    await api(app, sana).patch(`/shipments/${ship.id}`, { eta: day(-10) }).expect(400); // before ETD
    // The forwarder's person, tracking, freight and insurance, customs: kept on the shipment.
    f = (
      await api(app, sana)
        .patch(`/shipments/${ship.id}`, {
          forwarderContact: "Mr. Zhao Lei",
          forwarderPhone: "+86 532 5550 0101",
          customsBroker: "Karachi Clearing Co.",
          trackingNo: "MEDU1234567",
          freightAmount: "4,200.50",
          freightCurrency: "usd",
          insurer: "PICC",
          insurancePolicyNo: "PL-2291",
          customsDeclarationNo: "KAPW-HC-1021",
        })
        .expect(200)
    ).body;
    expect(f.shipping.shipments[0]).toMatchObject({
      forwarderContact: "Mr. Zhao Lei",
      customsBroker: "Karachi Clearing Co.",
      trackingNo: "MEDU1234567",
      freightAmount: "4200.5",
      freightCurrency: "USD",
      insurancePolicyNo: "PL-2291",
      customsDeclarationNo: "KAPW-HC-1021",
      clearedOn: null,
    });
    await api(app, sana).patch(`/shipments/${ship.id}`, { freightCurrency: "dollars" }).expect(422);
    // The order's checks: a screen that can ask is told what looks out of order (409 "confirm"); going ahead needs why.
    const odd = await api(app, sana).patch(`/shipments/${ship.id}`, { departedOn: day(-3), arrivedOn: day(-5), ask: true });
    expect(odd.status).toBe(409);
    expect(odd.body).toMatchObject({ code: "confirm" });
    expect(odd.body.error).toContain("before it sailed");
    await api(app, sana).patch(`/shipments/${ship.id}`, { departedOn: day(-3), arrivedOn: day(-5), confirm: true }).expect(400); // why?
    expect((await api(app, sana).get(`/orders/${orderId}/flow`).expect(200)).body.shipping.shipments[0].arrivedOn).toBeNull(); // nothing was saved
    // The order: the customer's PO, the consignee, the notify party and where it is delivered.
    await api(app, sana)
      .patch(`/orders/${orderId}/details`, { customerRef: "KMS-PO-2291", customerPoOn: day(-30), consignee: "Kabul Medical Supplies\nKabul", notifyParty: "Same as consignee", deliveryAddress: "Warehouse 4" })
      .expect(200);
    const order = (await api(app, sana).get(`/orders/${orderId}`).expect(200)).body;
    expect(order).toMatchObject({ customerRef: "KMS-PO-2291", customerPoOn: day(-30), notifyParty: "Same as consignee", deliveryAddress: "Warehouse 4" });
    await api(app, sana).post(`/orders/${orderId}/shipments`, { etd: day(20), eta: day(-10) }).expect(422);
    expect((await api(app, sana).get(`/orders/${orderId}`)).body.stage).toBe("in_production"); // booked is not shipped
    f = (await api(app, sana).patch(`/shipments/${ship.id}`, { status: "departed", departedOn: day(-12), blNo: "COSU6281734510", containerNo: "CSNU7154420" }).expect(200)).body;
    const sailed = (await api(app, sana).get(`/orders/${orderId}`)).body;
    expect(sailed).toMatchObject({ stage: "shipped", shippedOn: day(-12), blNo: "COSU6281734510" });
    expect(sailed.history.at(-1)).toMatchObject({ from: "in_production", to: "shipped", note: "a shipment left" });
    expect(f.steps.find((s: { key: string }) => s.key === "shipping").sub).toBe("On the way");
    f = (await api(app, sana).patch(`/shipments/${ship.id}`, { status: "arrived", arrivedOn: day(-10) }).expect(200)).body;
    expect(stepState(f)).toMatchObject({ shipping: "done", documents: "current" });
  });

  it("documents: the set, its files, and the trip through both banks", async () => {
    // A file on the deal becomes the B/L copy.
    const file = (
      await request(app.getHttpServer())
        .post(`/api/inquiries/${inquiryId}/files`)
        .set("authorization", `Bearer ${sana}`)
        .field("kind", "other")
        .attach("file", Buffer.from("%PDF-1.4 B/L"), { filename: "bl.pdf", contentType: "application/pdf" })
        .expect(201)
    ).body;
    let f = (await api(app, sana).post(`/orders/${orderId}/document-set`, { kind: "bill_of_lading", number: "COSU6281734510", status: "ready", attachmentId: file.id }).expect(201)).body;
    const bl = f.documents.set.find((d: { kind: string }) => d.kind === "bill_of_lading");
    expect(bl).toMatchObject({ status: "ready", required: true, file: { id: file.id, name: "bl.pdf" } });
    // "Other" needs a title; a file from another deal is refused.
    await api(app, sana).post(`/orders/${orderId}/document-set`, { kind: "other", status: "ready" }).expect(400);
    await api(app, sana).post(`/orders/${orderId}/document-set`, { kind: "insurance", status: "ready", attachmentId: "6b65626f-0000-4000-8000-00000000abcd" }).expect(400);

    // The papers the app makes are never recorded by hand: the app makes them (issued, packed, made final).
    for (const kind of ["packing_list", "commercial_invoice", "proforma_invoice", "sales_contract"]) {
      const refused = await api(app, sana).post(`/orders/${orderId}/document-set`, { kind, status: "ready" }).expect(400);
      expect(refused.body.error).toMatch(/made by the app/);
    }
    for (const kind of ["certificate_of_origin", "insurance"]) {
      await api(app, sana).post(`/orders/${orderId}/document-set`, { kind, status: "ready" }).expect(201);
    }
    await api(app, sana).post(`/orders/${orderId}/proforma`).expect(200);
    const goods = (await api(app, sana).get(`/orders/${orderId}`).expect(200)).body.lines.filter((l: { type: string }) => l.type === "goods");
    await api(app, sana)
      .put(`/orders/${orderId}/packing`, { lines: goods.map((l: { id: string }) => ({ lineId: l.id, packages: 1, packageType: "Wooden case" })) })
      .expect(200);
    await api(app, sana).post(`/orders/${orderId}/papers/commercial-invoice/fix`, { field: "vessel", value: "MSC Aurora" }).expect(200);
    for (const kind of ["sales-contract", "commercial-invoice"]) {
      const made = (await api(app, sana).post(`/orders/${orderId}/papers/${kind}`, {}).expect(201)).body;
      await api(app, sana).post(`/papers/${made.paper.id}/final`, {}).expect(200);
    }
    f = await flow();
    expect(f.documents.set.filter((d: { required: boolean; status: string }) => d.required && d.status !== "ready")).toEqual([]);

    await api(app, sana).put(`/orders/${orderId}/bank-steps/teleported`, { doneOn: day(-10) }).expect(422);
    await api(app, sana).put(`/orders/${orderId}/bank-steps/sent_to_our_bank`, { doneOn: "2099-01-01" }).expect(400);
    const steps = ["sent_to_our_bank", "couriered_to_customer_bank", "customer_bank_received", "copies_to_customer", "customer_paid_bank"];
    for (const step of steps) {
      await api(app, sana).put(`/orders/${orderId}/bank-steps/${step}`, { doneOn: day(-10), ...(step === "couriered_to_customer_bank" && { courier: "DHL", reference: "1234567890" }) }).expect(200);
    }
    // "Money reached us" is the payment itself: ticked by recording it, never on its own.
    await api(app, sana).put(`/orders/${orderId}/bank-steps/bank_paid_us`, { doneOn: day(-10) }).expect(400);
    const reached = async () =>
      (await api(app, admin).post(`/orders/${orderId}/payments`, { kind: "balance", amount: "1.00", currency: "USD", paidOn: day(-10), bankStep: "bank_paid_us" }).expect(201)).body.createdId as string;
    const paymentId = await reached();
    f = await flow();
    expect(f.documents.bankSteps.find((b: { step: string }) => b.step === "couriered_to_customer_bank")).toMatchObject({ courier: "DHL", reference: "1234567890" });
    expect(stepState(f)).toMatchObject({ documents: "done", delivery: "current" });
    // Undone and done again.
    await api(app, sana).delete(`/orders/${orderId}/bank-steps/bank_paid_us`).expect(400);
    await api(app, admin).post(`/payments/${paymentId}/void`, { reason: "Recorded on the wrong day" }).expect(200);
    expect(stepState(await flow()).documents).toBe("current");
    await reached();
    expect(stepState(await flow()).documents).toBe("done");
  });

  it("delivery, SAT by our engineer, and a claim", async () => {
    const engineer = (await api(app, sana).get("/auth/me")).body.id;
    await api(app, sana).patch(`/orders/${orderId}/delivery`, { satDoneOn: day(-10) }).expect(400); // not delivered yet
    // The order keeps no condition of its own (an old client's is ignored): it is the goods lines', the worst of them.
    let f = (await api(app, sana).patch(`/orders/${orderId}/delivery`, { deliveredOn: day(-10), deliveryCondition: "good", satEngineerId: engineer, satPlannedOn: day(-8) }).expect(200)).body;
    expect(f.delivery).toMatchObject({ deliveredOn: day(-10), condition: null, satEngineer: { id: engineer } });
    const goods = (await api(app, sana).get(`/orders/${orderId}`).expect(200)).body.lines.filter((l: { type: string }) => l.type === "goods");
    await api(app, sana).patch(`/order-lines/${goods[0].id}`, { set: "delivered", deliveredQty: goods[0].quantity, condition: "minor_damage" }).expect(200);
    f = (await api(app, sana).get(`/orders/${orderId}/flow`).expect(200)).body;
    expect(f.delivery.condition).toBe("minor_damage");

    f = (await api(app, sana).put(`/orders/${orderId}/sat`, { checks: f.delivery.suggestedSat.map((item: string) => ({ item })) }).expect(200)).body;
    expect(f.delivery.sat.every((c: { result: string }) => c.result === "pending")).toBe(true);
    // Not every point passed: no sign-off.
    await api(app, sana).patch(`/orders/${orderId}/delivery`, { satDoneOn: day(-9) }).expect(400);
    await api(app, sana).put(`/orders/${orderId}/sat`, { checks: f.delivery.sat.map((c: { id: string; item: string }, i: number) => ({ id: c.id, item: c.item, result: i === 0 ? "not_applicable" : "pass" })) }).expect(200);

    f = (await api(app, sana).post(`/orders/${orderId}/claims`, { title: "Dented guard door", detail: "Arrived bent; factory to send a new one." }).expect(201)).body;
    const claim = f.delivery.claims[0];
    expect(claim).toMatchObject({ status: "open", title: "Dented guard door", amount: null, bearer: null });
    // What it costs and who pays: the amount is in the order's currency.
    f = (await api(app, sana).patch(`/claims/${claim.id}`, { amount: "180", bearer: "factory" }).expect(200)).body;
    expect(f.delivery.claims[0]).toMatchObject({ amount: "180.00", currency: f.currency ?? expect.any(String), bearer: "factory", status: "open" });
    await api(app, sana).patch(`/claims/${claim.id}`, { bearer: "nobody" }).expect(422);
    f = (await api(app, sana).patch(`/claims/${claim.id}`, { amount: "" }).expect(200)).body;
    expect(f.delivery.claims[0]).toMatchObject({ amount: null, currency: null, bearer: "factory" });
    f = (await api(app, sana).patch(`/orders/${orderId}/delivery`, { satDoneOn: day(-9), satSignedBy: "Mr. Ali, QA head" }).expect(200)).body;
    // Installed on and the warranty (months, from the SAT).
    const installed = (await api(app, sana).patch(`/orders/${orderId}/delivery`, { installedOn: day(-9), warrantyMonths: "12" }).expect(200)).body;
    expect(installed.delivery).toMatchObject({ installedOn: day(-9), warrantyMonths: 12, satSignedBy: "Mr. Ali, QA head" });
    await api(app, sana).patch(`/orders/${orderId}/delivery`, { warrantyMonths: 999 }).expect(422);
    expect(stepState(f).delivery).toBe("current"); // the claim is still open
    await api(app, sana).patch(`/claims/${claim.id}`, { status: "resolved" }).expect(400); // how was it settled?
    f = (await api(app, sana).patch(`/claims/${claim.id}`, { status: "resolved", resolution: "Factory sent a new door by air; fitted." }).expect(200)).body;
    expect(f.delivery.claims[0]).toMatchObject({ status: "resolved", resolvedOn: expect.any(String) });
    expect(f.steps.every((s: { state: string }) => s.state === "done")).toBe(true);
    // A signed-off SAT cannot be reopened silently.
    await api(app, sana).put(`/orders/${orderId}/sat`, { checks: [{ item: "Again", result: "fail" }] }).expect(400);

    const history = JSON.stringify((await api(app, sana).get(`/orders/${orderId}`)).body);
    expect(history.length).toBeGreaterThan(0);
    const audit = JSON.stringify((await api(app, admin).get(`/history?type=order&id=${orderId}`)).body);
    for (const text of ["payment route LC", "LC added", "ordered from the factory", "shipment added", "Couriered to the customer's bank", "SAT signed off", "claim opened"]) expect(audit).toContain(text);
  });

  it("the board shows each open order at its current step", async () => {
    const board = (await api(app, sana).get("/order-board?mine=true").expect(200)).body;
    const mine = board.items.find((i: { id: string }) => i.id === orderId);
    // Every step is done but the second (air) shipment the logistics test adds later: here nothing is current yet.
    expect(mine).toEqual({ id: orderId, current: null });
    await api(app, bilal).get("/order-board").expect(200);
    expect((await api(app, bilal).get("/order-board").expect(200)).body.items.map((i: { id: string }) => i.id)).not.toContain(orderId);
  });

  it("a role without a permission is refused, and does not get it in /auth/me", async () => {
    const role = (await api(app, admin).post("/roles", { name: `Logistics ${tag}`, permissions: ["dashboard.view", "inquiries.viewAll", "shipping.manage"] }).expect(201)).body;
    const email = `logistics-${tag}@example.com`;
    await api(app, admin).post("/users", { name: "Logistics", email, role: role.key, password }).expect(201);
    const logistics = await signIn(app, email, password);
    expect((await api(app, logistics).get("/auth/me")).body.permissions).toEqual(["dashboard.view", "inquiries.viewAll", "shipping.manage"]);
    const f = await flow(logistics);
    // Can book shipments, cannot touch the papers, the SAT, production or the route.
    await api(app, logistics).post(`/orders/${orderId}/shipments`, { mode: "air", status: "planned" }).expect(201);
    await api(app, logistics).post(`/orders/${orderId}/document-set`, { kind: "inspection", status: "ready" }).expect(403);
    await api(app, logistics).put(`/orders/${orderId}/sat`, { checks: [] }).expect(403);
    await api(app, logistics).put(`/orders/${orderId}/factory-facts`, { fatPlannedOn: day(9) }).expect(403);
    await api(app, logistics).patch(`/orders/${orderId}/route`, { route: "informal" }).expect(403);
    await api(app, logistics).patch(`/claims/${f.delivery.claims[0].id}`, { status: "open" }).expect(403);
  });

  it("modules switched off for the company are left out and refused, and come back", async () => {
    await modulesOff(["shipping", "delivery_sat", "factory_requests", "bank_contracts"]);
    try {
      const f = await flow();
      expect(f.modules).toMatchObject({ shipping: false, deliverySat: false, bankContracts: false, production: true });
      expect(f.shipping).toBeNull();
      expect(f.delivery).toBeNull();
      expect(f.payment.bankContract).toBeNull();
      expect(stepState(f)).toMatchObject({ shipping: "off", delivery: "off" });
      const refused = await api(app, sana).post(`/orders/${orderId}/shipments`, { mode: "sea" }).expect(403);
      expect(refused.body.code).toBe("plan_feature");
      await api(app, sana).patch(`/orders/${orderId}/delivery`, { deliveryNote: "x" }).expect(403);
      await api(app, sana).get(`/inquiries/${inquiryId}/factory-requests`).expect(403);
      // A bank route needs the bank contracts module; informal never does.
      await api(app, sana).patch(`/orders/${orderId}/route`, { route: "bank_contract" }).expect(403);
      // The permissions of switched-off modules leave /auth/me, so the buttons go too.
      const me = (await api(app, sana).get("/auth/me")).body;
      expect(me.permissions).not.toContain("shipping.manage");
      expect(me.permissions).not.toContain("delivery.manage");
      expect(me.permissions).toContain("documents.manage");
      // The board itself is a module too.
      await modulesOff(["orders_board"]);
      expect((await api(app, sana).get("/order-board").expect(403)).body.code).toBe("plan_feature");
    } finally {
      await modulesOff([]);
    }
    expect((await flow()).shipping).not.toBeNull();
    await api(app, sana).get("/order-board").expect(200);
  });

  it("the steps: a module switched off never blocks, the first unfinished step is current", () => {
    const facts: FlowFacts = {
      stage: "confirmed",
      cancelled: false,
      route: "informal",
      depositIn: true,
      factoryOrderedOn: day(-41),
      production: { lines: 0, received: 0 },
      readyOn: null,
      shipments: { total: 0, departed: 0, arrived: 0 },
      documents: { required: 4, ready: 0 },
      bankSteps: { required: 1, done: 0 },
      deliveredOn: null,
      sat: { total: 0, passed: 0, failed: 0, doneOn: null },
      openClaims: 0,
    };
    expect(flowSteps(facts, null).map((s) => s.state)).toEqual(["done", "done", "current", "todo", "todo", "todo"]);
    expect(flowSteps(facts, ["shipping", "bank_documents"]).map((s) => s.state)).toEqual(["done", "done", "off", "current", "todo", "off"]);
    expect(flowSteps({ ...facts, cancelled: true }, null).some((s) => s.state === "current")).toBe(false);
    expect(requiredDocuments("informal", "air")).toContain("airway_bill");
  });

  it("module presets change only the order-flow modules, and the Lite plan exists without them", async () => {
    const [quotes, simple, full] = MODULE_PRESETS;
    expect(withPreset(["excel", "insights", "shipping", "production"], quotes!).sort()).toEqual(["excel", "insights"]);
    expect(withPreset(["excel"], simple!).sort()).toEqual(["excel", "factory_requests", "orders_board", "production", "shipping"]);
    expect(withPreset([], full!).sort()).toEqual([...ORDER_FLOW_FEATURES].sort());
    const lite = await prisma.platform.plan.findUnique({ where: { name: "Lite" } });
    expect(lite).toMatchObject({ isActive: true, features: ["excel"], maxUsers: 2 });
  });
});

describe("order flow tables are company tables", () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await startApp();
  });
  afterAll(async () => {
    await app?.close();
  });

  it("every link between company tables is checked to stay inside the company", async () => {
    const prisma = app.get(PrismaService);
    const unchecked = await prisma.platform.$queryRaw<{ link: string }[]>`
      select cl.relname || '.' || a.attname as link
        from pg_constraint k
        join pg_class cl on cl.oid = k.conrelid
        join pg_class pa on pa.oid = k.confrelid
        join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
       where k.contype = 'f' and cl.relrowsecurity and pa.relrowsecurity and a.attname <> 'company_id'
         and cl.relname in ('factory_requests', 'order_bank_contracts', 'shipments', 'order_documents', 'order_bank_steps', 'sat_checks', 'order_claims', 'orders', 'money_movements', 'allocations', 'invoices', 'order_papers')
         and not exists (select 1 from pg_trigger t where t.tgrelid = k.conrelid and t.tgname = left('same_company_' || k.conname, 63))`;
    expect(unchecked).toEqual([]);
    for (const t of ["factory_requests", "order_bank_contracts", "shipments", "order_documents", "order_bank_steps", "sat_checks", "order_claims", "money_movements", "allocations", "invoices", "order_papers"]) {
      const [row] = await prisma.platform.$queryRawUnsafe<{ rls: boolean; policies: bigint }[]>(
        `select c.relrowsecurity as rls, (select count(*) from pg_policies p where p.tablename = c.relname) as policies from pg_class c where c.relname = $1`,
        t,
      );
      expect(row, t).toMatchObject({ rls: true });
      expect(Number(row.policies), t).toBe(1);
    }
  });
});
