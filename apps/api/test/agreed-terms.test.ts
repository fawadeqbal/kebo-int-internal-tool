import type { INestApplication } from "@nestjs/common";
import { addDays } from "@kebo/utils";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIRST_COMPANY_ID } from "@kebo/database";
import { api, signIn, startApp } from "./app";
import { Clock } from "../src/common/time/clock.service";
import { PrismaService } from "../src/database/prisma.service";
import { CompaniesService } from "../src/common/company/companies.service";
import { CompanyContext } from "../src/common/company/company-context";

/**
 * Design "RFQ Desk — terms that travel" (16 Nov 2026), step 2: accepting a quotation copies what was agreed with
 * the customer into the order — its plan is the quotation's parts (30 · 60 · 10 after the site test), its lead
 * time works out the ship-by date (once the deposit is in, or from the order), its warranty and conditions are
 * the order's own — and the order's papers print them. An order made before keeps its papers as they were.
 */
describe("agreed with the customer: the quotation's terms in the order", () => {
  let app: INestApplication;
  let sana: string;
  let manager: string;
  let today = "";
  const tag = Date.now().toString(36);

  beforeAll(async () => {
    app = await startApp();
    sana = await signIn(app, "sana@example.com");
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    today = app.get(Clock).today();
  });

  afterAll(async () => {
    await app?.close();
  });

  /** A deal with one supplier offer, quoted with these terms and accepted: the order. */
  async function accepted(terms: Record<string, unknown>, lead: { leadDays: number; leadFrom: string }) {
    const me = (await api(app, sana).get("/auth/me")).body.id;
    const customer = (
      await api(app, sana)
        .post("/customers", { name: `Agreed Pharma ${tag} ${Math.random().toString(36).slice(2, 6)}`, country: "PK", contacts: [{ name: "Imran", email: `i-${tag}-${Math.random().toString(36).slice(2, 6)}@agreed.test` }] })
        .expect(201)
    ).body;
    const inquiryId = (
      await api(app, sana)
        .post("/inquiries", { customerId: customer.id, category: "Machinery", assigneeId: me, items: [{ description: "Blister packing machine", quantity: 1, unit: "set" }] })
        .expect(201)
    ).body.id;
    const item = (await api(app, sana).get(`/inquiries/${inquiryId}`)).body.items[0].id;
    await api(app, sana)
      .post(`/inquiries/${inquiryId}/factory-quotes`, {
        newSupplierName: `Jinan Agreed ${tag}`,
        receivedOn: addDays(today, -3),
        currency: "USD",
        leadDays: 30,
        leadFrom: "after_payment",
        lines: [{ requestedItemId: item, description: "Blister packing machine", quantity: 1, unit: "set", unitPrice: 20000 }],
      })
      .expect(201);
    const draft = (await api(app, sana).get(`/inquiries/${inquiryId}/quotation/draft`).expect(200)).body;
    const r = (
      await api(app, sana)
        .post(`/inquiries/${inquiryId}/quotation/revisions`, {
          ...draft,
          ...terms,
          options: [{ ...draft.options[0], prices: [{ lineId: draft.options[0].prices[0].lineId, unitPrice: 30000 }], ...lead }],
        })
        .expect(201)
    ).body;
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "sent" }).expect(200);
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "accepted", route: "informal" }).expect(200);
    const deal = (await api(app, sana).get(`/inquiries/${inquiryId}`)).body;
    return deal.orders[0].id as string;
  }
  const money = async (id: string) => (await api(app, sana).get(`/orders/${id}/money`).expect(200)).body;
  const order = async (id: string) => (await api(app, sana).get(`/orders/${id}`).expect(200)).body;
  const contract = async (id: string) => (await api(app, sana).get(`/orders/${id}/papers/sales-contract/doc`).expect(200)).body;

  const THREE = {
    paymentParts: [
      { label: "Deposit 30%", percent: 30, rule: "on_order" },
      { label: "Before shipment 60%", percent: 60, rule: "before_shipment" },
      { label: "After the site test 10%", percent: 10, rule: "after_sat", days: 15 },
    ],
    warrantyMonths: 12,
    warrantyFrom: "sat",
    warranty: "parts and service",
    deliveryTerms: "Export wooden cases.",
    paymentTerms: "Bank charges outside China are for the buyer.",
  };

  let threeId = "";

  it("the plan is the quotation's parts, each dated by its rule", async () => {
    threeId = await accepted(THREE, { leadDays: 45, leadFrom: "after_payment" });
    const m = await money(threeId);
    expect(m.plan.items.map((i: { label: string; amount: string; dueRule: string | null; dueDays: number | null }) => [i.label, i.amount, i.dueRule, i.dueDays])).toEqual([
      ["Deposit 30%", "9000.00", "fixed", null],
      ["Before shipment 60%", "18000.00", "on_ready", null],
      ["After the site test 10%", "3000.00", "after_sat", 15],
    ]);
    // Not dated until the site test is done.
    expect(m.plan.items[2].dueOn).toBeNull();
  });

  it("the ship-by date is worked out once the deposit is in; typed by hand, it stays", async () => {
    expect((await order(threeId)).shipBy).toBeNull();
    const deposit = (await money(threeId)).plan.items[0];
    await api(app, manager).post(`/orders/${threeId}/payments`, { kind: "deposit", amount: deposit.amount, currency: "USD", paidOn: today }).expect(201);
    expect((await order(threeId)).shipBy).toBe(addDays(today, 45));
    // Typed by hand: a later payment no longer moves it.
    await api(app, sana).patch(`/orders/${threeId}/details`, { shipBy: addDays(today, 60) }).expect(200);
    await api(app, manager).post(`/orders/${threeId}/payments`, { kind: "balance", amount: 100, currency: "USD", paidOn: today }).expect(201);
    expect((await order(threeId)).shipBy).toBe(addDays(today, 60));
  });

  it("counted from the order, the ship-by date is there at once", async () => {
    const id = await accepted({}, { leadDays: 40, leadFrom: "after_order" });
    expect((await order(id)).shipBy).toBe(addDays(today, 40));
  });

  it("the order's documents print the parts, the lead time, the warranty and the conditions agreed", async () => {
    const doc = (await contract(threeId)).doc as { bullets: string[] };
    const text = doc.bullets.join("\n");
    expect(text).toContain("Our usual payment is made by 30% deposit, 60% before shipment and 10% 15 days after the site acceptance test (SAT).");
    expect(text).toContain("Delivery: 45 days after the deposit.");
    expect(text).toContain("Warranty: 12 months from the site acceptance test (SAT), parts and service.");
    expect(text).toContain("Export wooden cases.");
  });

  it("the order shows what was agreed and what the supplier gives; a change from the quotation asks why", async () => {
    const o = await order(threeId);
    expect(o.agreed).toMatchObject({ copied: true, leadDays: 45, leadFrom: "after_payment", leadTime: "45 days after the deposit", warrantyMonths: 12, warrantyFrom: "sat", deliveryConditions: "Export wooden cases." });
    expect(o.agreed.warrantyLine).toBe("12 months from the site acceptance test (SAT), parts and service.");
    expect(o.supplierTerms).toHaveLength(1);
    expect(o.supplierTerms[0]).toMatchObject({ terms: { leadDays: 30, leadFrom: "after_payment" }, costMinor: 2_000_000 });
    // A new port of discharge differs from the quotation: why?
    const asked = await api(app, sana).patch(`/orders/${threeId}/agreed`, { portOfDischarge: "Port Qasim" }).expect(409);
    expect(JSON.stringify(asked.body)).toMatch(/reason/i);
    const saved = (await api(app, sana).patch(`/orders/${threeId}/agreed`, { portOfDischarge: "Port Qasim", reason: "Agreed a new port" }).expect(200)).body;
    expect(saved.agreed).toMatchObject({ portOfDischarge: "Port Qasim", quoted: { portOfDischarge: null } });
    // The lead time from the order: ship by follows it, unless typed (it was typed above).
    await api(app, sana).patch(`/orders/${threeId}/agreed`, { shipBy: null, leadDays: 50, leadFrom: "after_order", reason: "Supplier changed its lead time" }).expect(200);
    const after = await order(threeId);
    expect(after.shipBy).toBe(addDays(after.orderedOn, 50));
    expect(after.agreed.shipByTyped).toBe(false);
    expect(after.agreed.shipByFrom).toEqual({ by: "order", on: after.orderedOn });
    // While the route is the one accepted, the agreed payment conditions print (no choice to make).
    expect(after.papers).toEqual({ conditionsPrinted: true, conditionsChoice: false });
  });

  it("saving what is there changes nothing; back to the quotation needs no why; a typed ship by does; the history says what changed", async () => {
    const before = await order(threeId);
    const a = before.agreed;
    // The form sends every field as it stands: nothing is changed, nothing asked, ship by stays worked out.
    await api(app, sana)
      .patch(`/orders/${threeId}/agreed`, {
        incotermPlace: before.incotermPlace,
        portOfDischarge: a.portOfDischarge,
        leadDays: a.leadDays,
        leadFrom: a.leadFrom,
        shipBy: before.shipBy,
        warrantyMonths: a.warrantyMonths,
        warrantyFrom: a.warrantyFrom,
        warranty: a.warranty,
        deliveryConditions: a.deliveryConditions,
        paymentConditions: a.paymentConditions,
        notes: a.notes,
      })
      .expect(200);
    const same = await order(threeId);
    expect(same.agreed.changes).toBe(a.changes);
    expect(same.agreed.shipByTyped).toBe(false);
    // Back to what the quotation said (no port): no why.
    await api(app, sana).patch(`/orders/${threeId}/agreed`, { portOfDischarge: null }).expect(200);
    const back = await order(threeId);
    expect(back.agreed.portOfDischarge).toBeNull();
    expect(back.agreed.changes).toBe(a.changes + 1);
    // A ship-by date typed by hand asks why; then it stays as typed.
    await api(app, sana).patch(`/orders/${threeId}/agreed`, { shipBy: addDays(back.orderedOn, 70) }).expect(409);
    await api(app, sana).patch(`/orders/${threeId}/agreed`, { shipBy: addDays(back.orderedOn, 70), reason: "Customer asked for it" }).expect(200);
    const typed = await order(threeId);
    expect(typed.shipBy).toBe(addDays(back.orderedOn, 70));
    expect(typed.agreed).toMatchObject({ shipByTyped: true, shipByFrom: { by: "typed" }, changes: a.changes + 2 });
    // The history: each change with only what changed, by the same names before and after.
    const history = (await api(app, sana).get(`/history?type=order&id=${threeId}`).expect(200)).body as { summary: string; changes: { field: string; from: string | null; to: string | null }[] }[];
    const port = history.find((e) => e.summary.includes("what was agreed with the customer changed (port of discharge none)"));
    expect(port?.changes).toEqual([{ field: "portOfDischarge", from: "Port Qasim", to: null }]);
    const lead = history.find((e) => e.summary.includes("lead time 50 days after the order"));
    expect(lead?.changes.map((c) => c.field).sort()).toEqual(["leadTime", "shipBy"]);
    expect(lead?.changes.find((c) => c.field === "leadTime")).toMatchObject({ from: "45 days after the deposit", to: "50 days after the order" });
  });

  it("an older order shows its quotation's terms; changing them keeps the ship-by date typed on it", async () => {
    const id = await accepted(THREE, { leadDays: 45, leadFrom: "after_payment" });
    const typedOn = addDays(today, 90);
    // As an order made before it kept its own copy: the date typed on it, nothing copied.
    const asCompany = async <T>(fn: () => Promise<T>) => CompanyContext.run((await app.get(CompaniesService).byId(FIRST_COMPANY_ID))!, fn);
    await asCompany(() =>
      app.get(PrismaService).db.order.update({ where: { id }, data: { termsCopied: false, shipBy: new Date(`${typedOn}T00:00:00Z`), leadDays: null, leadFrom: null, warrantyMonths: null, warrantyFrom: null, deliveryConditions: null } }),
    );
    const old = await order(id);
    expect(old.agreed).toMatchObject({ copied: false, leadDays: 45, warrantyMonths: 12, deliveryConditions: "Export wooden cases.", shipByFrom: null });
    const deposit = (await money(id)).plan.items[0];
    await api(app, manager).post(`/orders/${id}/payments`, { kind: "deposit", amount: deposit.amount, currency: "USD", paidOn: today }).expect(201);
    expect((await order(id)).shipBy).toBe(typedOn);
    // Changed on the order: it takes the quotation's as its own, and the date typed on it stays.
    await api(app, sana).patch(`/orders/${id}/agreed`, { notes: "Loading at Qingdao.", reason: "Customer asked for it" }).expect(200);
    const now = await order(id);
    expect(now.shipBy).toBe(typedOn);
    expect(now.agreed).toMatchObject({ copied: true, leadDays: 45, notes: "Loading at Qingdao.", shipByTyped: true });
  });

  it("a deposit and one balance build the plan from the route, as before", async () => {
    const id = await accepted({ paymentParts: [{ label: "Deposit 30%", percent: 30, rule: "on_order" }, { label: "Balance 70%", percent: 70, rule: "against_bl_copy" }] }, { leadDays: 30, leadFrom: "after_payment" });
    const m = await money(id);
    expect(m.plan.items.map((i: { label: string; part: string | null }) => i.label)).toEqual(["Deposit 30%", "Balance against B/L copy"]);
    const text = ((await contract(id)).doc as { bullets: string[] }).bullets.join("\n");
    expect(text).toContain("Our usual payment is made by 30% deposit and 70% against B/L copy.");
  });
});
