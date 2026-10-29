import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";

/** One deal from first message to order, through every module, as staff and a manager would do it. */
describe("a whole deal through the API", () => {
  let app: INestApplication;
  let manager: string;
  let staff: string;
  let staffId: string;
  const tag = Date.now().toString(36);
  const phone = `+971 55 ${String(Date.now()).slice(-7)}`;
  let inquiryId: string;
  let itemId: string;
  const rev: Record<number, string> = {};

  beforeAll(async () => {
    process.env.PUBLIC_FORM_ORIGINS = "https://keboint.com";
    app = await startApp();
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    staff = await signIn(app, "bilal@example.com");
    staffId = (await api(app, staff).get("/auth/me").expect(200)).body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("takes an RFQ from the website form, refusing other sites and bots", async () => {
    const form = {
      "Full Name": "Yusuf Ali",
      email: `yusuf-${tag}@gulf.test`,
      "Phone / WhatsApp": phone,
      company: `Gulf Valves ${tag}`,
      category: "machinery",
      message: "200 gate valves DN100 PN16\nDelivery Jebel Ali",
    };
    // Not from an allowed site, and no form key: refused (so is no Origin at all).
    await api(app).post("/public/inquiries", form).set("origin", "https://evil.test").expect(403);
    await api(app).post("/public/inquiries", form).expect(403);
    const bot = await api(app)
      .post("/public/inquiries", { ...form, website: "http://spam" })
      .set("origin", "https://keboint.com")
      .expect(201);
    expect(bot.body).toEqual({ ok: true, message: "Thank you." });
    const bad = await api(app)
      .post("/public/inquiries", { ...form, email: "nope" })
      .set("origin", "https://keboint.com")
      .expect(422);
    expect(bad.body.error).toBe("Please enter a valid business email");
    const ok = await api(app).post("/public/inquiries", form).set("origin", "https://keboint.com").expect(201);
    // Only that it arrived: no number that tells how many came before.
    expect(Object.keys(ok.body).sort()).toEqual(["message", "ok"]);
    expect(JSON.stringify(ok.body)).not.toMatch(/RFQ-/);
    expect(ok.headers["access-control-allow-origin"]).toBe("https://keboint.com");

    const list = await api(app, manager)
      .get(`/inquiries?q=${encodeURIComponent(`Gulf Valves ${tag}`)}`)
      .expect(200);
    expect(list.body.rows).toHaveLength(1);
    const row = list.body.rows[0];
    expect(row).toMatchObject({ stage: "new", channel: "website", category: "Machinery", assignee: null });
    expect(row.customer.country).toBe("ZZ"); // the form gives no country: staff are asked for it
    inquiryId = row.id;

    // The same person writing again is matched to the same customer; the public form never edits it.
    await api(app)
      .post("/public/inquiries", { ...form, "Full Name": "Y. Ali" })
      .set("origin", "https://keboint.com")
      .expect(201);
    const both = (
      await api(app, manager)
        .get(`/inquiries?q=${encodeURIComponent(`Gulf Valves ${tag}`)}`)
        .expect(200)
    ).body.rows as { id: string; customer: { id: string } }[];
    expect(both).toHaveLength(2);
    const second = both.find((r) => r.id !== row.id)!;
    expect(second.customer.id).toBe(row.customer.id);
    const detail = await api(app, manager).get(`/inquiries/${second.id}`).expect(200);
    expect(detail.body.requirements).toMatch(/Name: Y\. Ali/);
    expect(detail.body.customer.contacts[0].name).toBe("Yusuf Ali");
  });

  it("starts sourcing when someone is assigned, and only the handler may work on it", async () => {
    await api(app, staff).get(`/inquiries/${inquiryId}`).expect(404); // not theirs yet
    const assigned = await api(app, manager).post(`/inquiries/${inquiryId}/assign`, { assigneeId: staffId }).expect(200);
    expect(assigned.body.stage).toBe("sourcing");
    const detail = await api(app, staff).get(`/inquiries/${inquiryId}`).expect(200);
    expect(detail.body.allowed).toMatchObject({ edit: true, quote: true, source: true });
    expect(detail.body.stageChanges.map((s: { toStage: string; cause: string }) => `${s.toStage}:${s.cause}`)).toEqual([
      "new:created",
      "sourcing:assigned",
    ]);
    itemId = detail.body.items[0].id;
    // Staff turn the free-text message into proper items.
    const d = detail.body;
    const edited = await api(app, staff)
      .put(`/inquiries/${inquiryId}`, {
        customerId: d.customerId,
        contactId: d.contactId,
        channel: d.channel,
        category: d.category,
        requirements: d.requirements,
        priority: "high",
        items: [{ id: itemId, description: "Gate valve DN100 PN16", quantity: 200, unit: "pcs" }],
      })
      .expect(200);
    expect(edited.body.title).toBe("Gate valve DN100 PN16");
  });

  it("records factory prices and works out the landed cost in USD", async () => {
    const q = await api(app, staff)
      .post(`/inquiries/${inquiryId}/factory-quotes`, {
        newFactoryName: `Wenzhou Valve ${tag}`,
        receivedOn: "2026-10-20",
        currency: "CNY",
        lines: [{ requestedItemId: itemId, description: "Gate valve DN100 PN16", quantity: 200, unitPrice: "628.32", taxRate: 13 }],
      })
      .expect(201);
    expect(q.body.id).toBeTruthy();
    const s = await api(app, staff).get(`/inquiries/${inquiryId}/sourcing`).expect(200);
    const item = s.body.items.find((i: { id: string }) => i.id === itemId);
    expect(item.options[0].unitCost).toBe("100.00"); // CNY 628.32 + 13% tax = 710.00, at 7.1 = USD 100
    expect(s.body.quotes[0]).toMatchObject({ coverage: { covered: ["1"], missing: [] }, totalCost: "20000.00" });
  });

  it("drafts R1 from the cost plus the default margin, sends it, and the deal is Quoted", async () => {
    const draft = await api(app, staff).get(`/inquiries/${inquiryId}/quotation/draft`).expect(200);
    expect(draft.body.number).toBe(1);
    expect(draft.body.options).toHaveLength(1);
    expect(draft.body.options[0].prices[0]).toMatchObject({ unitPrice: 117.65 }); // USD 100 cost, 15% margin on the price
    const r1 = await api(app, staff)
      .post(`/inquiries/${inquiryId}/quotation/revisions`, { ...draft.body, incotermPlace: "Qingdao" })
      .expect(201);
    rev[1] = r1.body.id;
    expect(r1.body).toMatchObject({ status: "draft", total: "23530.00" });
    expect(r1.body.options[0]).toMatchObject({ letter: "A", status: "open", total: "23530.00" });
    expect(r1.body.options[0].costing).toMatchObject({ cost: "20000.00", marginPercent: 15 });
    const sent = await api(app, staff).post(`/revisions/${rev[1]}/status`, { to: "sent" }).expect(200);
    expect(sent.body.status).toBe("sent");
    expect(sent.body.customerSnapshot.country).toBe("ZZ");
    expect((await api(app, staff).get(`/inquiries/${inquiryId}`)).body.stage).toBe("quoted");
  });

  it("supersedes R1 when a cheaper R2 is sent, and won't let a sent revision change", async () => {
    await api(app, staff)
      .put(`/revisions/${rev[1]}`, (await api(app, staff).get(`/inquiries/${inquiryId}/quotation/draft`)).body)
      .expect(400);
    const draft = (await api(app, staff).get(`/inquiries/${inquiryId}/quotation/draft`).expect(200)).body;
    expect(draft.number).toBe(2);
    // R1 was sent, so a new revision says why.
    const discounted = { ...draft, options: draft.options.map((o: Record<string, unknown>) => ({ ...o, discount: 530 })) };
    const asked = await api(app, staff).post(`/inquiries/${inquiryId}/quotation/revisions`, discounted).expect(409);
    expect(asked.body).toMatchObject({ code: "reason_needed", choices: expect.arrayContaining(["Customer asked for a discount"]) });
    const r2 = await api(app, staff)
      .post(`/inquiries/${inquiryId}/quotation/revisions`, { ...discounted, reason: "Customer asked for a discount" })
      .expect(201);
    rev[2] = r2.body.id;
    await api(app, staff).post(`/revisions/${rev[2]}/status`, { to: "sent" }).expect(200);
    const all = (await api(app, staff).get(`/inquiries/${inquiryId}/quotation`).expect(200)).body;
    expect(all.revisions.map((r: { number: number; status: string }) => `R${r.number}:${r.status}`)).toEqual(["R2:sent", "R1:superseded"]);
    expect(all.revisions[0].options[0].costing.marginPercent).toBeLessThan(15); // the discount comes off the profit
  });

  it("records the customer's yes on R2 even with an R3 draft open: order made, deal won, draft discarded", async () => {
    const draft = (await api(app, staff).get(`/inquiries/${inquiryId}/quotation/draft`).expect(200)).body;
    rev[3] = (
      await api(app, staff)
        .post(`/inquiries/${inquiryId}/quotation/revisions`, { ...draft, reason: "Terms changed" })
        .expect(201)
    ).body.id;
    await api(app, staff).post(`/revisions/${rev[1]}/status`, { to: "accepted" }).expect(409); // superseded: no answer possible
    const accepted = await api(app, staff).post(`/revisions/${rev[2]}/status`, { to: "accepted" }).expect(200);
    expect(accepted.body.status).toBe("accepted");
    await api(app, staff).get(`/revisions/${rev[3]}`).expect(404);

    const deal = (await api(app, staff).get(`/inquiries/${inquiryId}`).expect(200)).body;
    expect(deal.stage).toBe("won");
    expect(deal.orders).toHaveLength(1);
    const order = (await api(app, staff).get(`/orders/${deal.orders[0].id}`).expect(200)).body;
    expect(order).toMatchObject({
      total: "23000.00",
      depositPercent: 30,
      balanceTerms: "before_shipment",
      stage: "confirmed",
      next: { to: "in_production" },
    });
    expect(order.money.deposit).toBe("6900.00");
    expect(order.needs.title).toBe("Get the deposit (USD 6,900.00)");
    // Acceptance is final.
    const after = (await api(app, staff).get(`/inquiries/${inquiryId}/quotation`).expect(200)).body;
    expect(after.canStartRevision).toBe(false);
  });

  it("cancelling the order voids the revision and loses the deal; a manager can reopen and quote again", async () => {
    const orderId = (await api(app, staff).get(`/inquiries/${inquiryId}`)).body.orders[0].id;
    await api(app, staff).post(`/orders/${orderId}/cancel`, { reason: "Customer's project stopped" }).expect(403);
    const cancelled = await api(app, manager).post(`/orders/${orderId}/cancel`, { reason: "Customer's project stopped" }).expect(200);
    expect(cancelled.body.status).toBe("cancelled");
    const lost = (await api(app, staff).get(`/inquiries/${inquiryId}`)).body;
    expect(lost).toMatchObject({ stage: "lost", lostReason: "customer_cancelled" });
    await api(app, staff).post(`/inquiries/${inquiryId}/stage`, { to: "sourcing" }).expect(409); // staff cannot reopen
    await api(app, manager).post(`/inquiries/${inquiryId}/stage`, { to: "sourcing", note: "Project back on" }).expect(200);
    const q = (await api(app, staff).get(`/inquiries/${inquiryId}/quotation`).expect(200)).body;
    expect(q.revisions[0].status).toBe("void");
    expect(q.canStartRevision).toBe(true);
  });

  it("asks why a deal is lost, and lists deals by stage", async () => {
    const res = await api(app, staff).post(`/inquiries/${inquiryId}/stage`, { to: "lost" }).expect(422);
    expect(res.body.error).toBe("Choose why the inquiry was lost");
    await api(app, staff).post(`/inquiries/${inquiryId}/hold`, { onHold: true, note: "Waiting for new drawings" }).expect(200);
    const held = await api(app, staff).get("/inquiries?stage=on_hold&assignee=me").expect(200);
    expect(held.body.rows.map((r: { id: string }) => r.id)).toContain(inquiryId);
    expect(held.body.counts.sourcing).toBeGreaterThan(0);
  });
});
