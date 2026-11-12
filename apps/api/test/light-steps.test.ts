import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIRST_COMPANY_ID } from "@kebo/database";
import { api, signIn, startApp } from "./app";
import { PrismaService } from "../src/database/prisma.service";
import { CompaniesService } from "../src/common/company/companies.service";
import { leadDays } from "../src/modules/flow/flow.service";
import { Clock } from "../src/common/time/clock.service";

/**
 * Order v4, light checklist: the few fields the rows ask for (the factory's
 * order no., the container's seal, loaded on, VGM, who received the goods),
 * changed one at a time from the view's "+ Add"; what the rows fill in from
 * earlier orders and the quote (GET /orders/:id/defaults); the one-tap items
 * ("All delivered OK", "All passed"); files kept with automatic items. Same
 * permissions, history and row-level security as the full forms.
 */
describe("order v4: light steps", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sana: string;
  let bilal: string;
  let admin: string;
  let password: string;
  let me: string;
  let customerId: string;
  let factoryId: string;
  let first: string;
  let second: string;
  const tag = Date.now().toString(36);
  /** Days from the company's today (its time zone, as the API dates things). */
  let today = new Date().toISOString().slice(0, 10);
  const day = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

  type Item = { key: string | null; done: boolean; doneOn: string | null; data: [string, string][]; file: { id: string; name: string } | null; note: string | null };
  const items = async (id: string, who = sana) => (await api(app, who).get(`/orders/${id}/steps`).expect(200)).body.items as Item[];
  const auto = async (id: string, key: string) => (await items(id)).find((i) => i.key === key)!;
  const flow = async (id: string, who = sana) => (await api(app, who).get(`/orders/${id}/flow`).expect(200)).body;
  const history = async (id: string) => (await api(app, sana).get(`/history?type=order&id=${id}`).expect(200)).body as { action: string; summary: string }[];
  const modulesOff = async (off: string[]) => {
    await prisma.platform.company.update({ where: { id: FIRST_COMPANY_ID }, data: { featuresOff: off } });
    app.get(CompaniesService).forget(FIRST_COMPANY_ID);
  };

  /** A new deal for the customer, quoted and accepted: its order's id and deal id. */
  const newOrder = async () => {
    const inquiry = (
      await api(app, sana)
        .post("/inquiries", { customerId, category: "Machinery", assigneeId: me, items: [{ description: "Blister packing machine", quantity: 2 }] })
        .expect(201)
    ).body;
    const item = (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.items[0];
    await api(app, sana)
      .post(`/inquiries/${inquiry.id}/factory-quotes`, {
        factoryId,
        receivedOn: day(-5),
        currency: "CNY",
        lines: [{ requestedItemId: item.id, description: "DPP-260", quantity: 2, unitPrice: 90000 }],
      })
      .expect(201);
    const draft = (await api(app, sana).get(`/inquiries/${inquiry.id}/quotation/draft`)).body;
    const r = (await api(app, sana).post(`/inquiries/${inquiry.id}/quotation/revisions`, draft).expect(201)).body;
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "sent" }).expect(200);
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "accepted" }).expect(200);
    return { id: (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.orders[0].id as string, dealId: inquiry.id as string, revisionId: r.id as string };
  };

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);
    today = app.get(Clock).today();
    sana = await signIn(app, "sana@example.com");
    bilal = await signIn(app, "bilal@example.com");
    admin = await signIn(app, "admin@example.com", "Admin@12345");
    password = "Person@12345";
    me = (await api(app, sana).get("/auth/me")).body.id;
    customerId = (
      await api(app, sana).post("/customers", { name: `Light Pharma ${tag}`, country: "PK", contacts: [{ name: "Ali", email: `ali-${tag}@lt.test` }] }).expect(201)
    ).body.id;
    factoryId = (await api(app, sana).post("/factories", { name: `Light Works ${tag}` }).expect(201)).body.id;
    first = (await newOrder()).id;
  });

  afterAll(async () => {
    if (prisma) await modulesOff([]);
    await app?.close();
  });

  it("their order no. and the day we ordered are changed one at a time", async () => {
    let f = (await api(app, sana).patch(`/orders/${first}/factory-order`, { factoryOrderNo: "HP-2026-118" }).expect(200)).body;
    expect(f.factory).toMatchObject({ orderNo: "HP-2026-118", orderedOn: null });
    // Only the date: the number stays (the phone app sends the date alone).
    f = (await api(app, sana).patch(`/orders/${first}/factory-order`, { factoryOrderedOn: today }).expect(200)).body;
    expect(f.factory).toMatchObject({ orderNo: "HP-2026-118", orderedOn: today });
    const ordered = await auto(first, "factory_ordered");
    expect(ordered.done).toBe(true);
    expect(ordered.data).toEqual([
      ["Their no.", "HP-2026-118"],
      ["Ordered", today],
    ]);
    await api(app, sana).patch(`/orders/${first}/factory-order`, { factoryOrderNo: "x".repeat(61) }).expect(422);
    await api(app, sana).patch(`/orders/${first}/factory-order`, { factoryOrderedOn: day(3) }).expect(400);
    // Not this person's deal: not found; the history says what changed, under Factory order.
    await api(app, bilal).patch(`/orders/${first}/factory-order`, { factoryOrderNo: "B-1" }).expect(404);
    const h = await history(first);
    expect(h.some((e) => e.action === "flow.factory_order" && /their order no\. HP-2026-118/.test(e.summary))).toBe(true);
    const factorySteps = (await api(app, sana).get(`/history?type=order&id=${first}&step=factory`).expect(200)).body as { action: string }[];
    expect(factorySteps.some((e) => e.action === "flow.factory_order")).toBe(true);
  });

  it("a shipment keeps its seal, the day it was loaded and the VGM; Loaded ticks with them", async () => {
    let f = (
      await api(app, sana)
        .post(`/orders/${first}/shipments`, { mode: "sea", status: "booked", forwarder: "Sino Trans", bookingNo: "NGB-77812", portOfLoading: "Ningbo", portOfDischarge: "Karachi", etd: day(10) })
        .expect(201)
    ).body;
    const s = f.shipping.shipments[0];
    expect(s).toMatchObject({ sealNo: null, loadedOn: null, vgmKg: null });
    // The light row: container no. and loaded on (+ the seal); status follows.
    f = (await api(app, sana).patch(`/shipments/${s.id}`, { containerNo: "MSKU 7741203", loadedOn: today, sealNo: "0048812", status: "loaded" }).expect(200)).body;
    expect(f.shipping.shipments[0]).toMatchObject({ containerNo: "MSKU 7741203", sealNo: "0048812", loadedOn: today, forwarder: "Sino Trans" });
    // "+ Add" in the view: one value, the rest stays.
    f = (await api(app, sana).patch(`/shipments/${s.id}`, { vgmKg: "21,500.5" }).expect(200)).body;
    expect(f.shipping.shipments[0]).toMatchObject({ vgmKg: "21500.5", sealNo: "0048812", bookingNo: "NGB-77812" });
    await api(app, sana).patch(`/shipments/${s.id}`, { vgmKg: "-1" }).expect(422);
    await api(app, sana).patch(`/shipments/${s.id}`, { sealNo: "S".repeat(41) }).expect(422);
    const loaded = await auto(first, "loaded");
    expect(loaded).toMatchObject({ done: true, doneOn: today });
    expect(loaded.data).toEqual([
      ["Container", "MSKU 7741203"],
      ["Seal", "0048812"],
      ["Loaded", today],
    ]);
  });

  it("a file is kept with an automatic item (loading photos), only one of the deal's files", async () => {
    const dealId = (await api(app, sana).get(`/orders/${first}`)).body.inquiry.id;
    const photo = (
      await request(app.getHttpServer())
        .post(`/api/inquiries/${dealId}/files`)
        .set("authorization", `Bearer ${sana}`)
        .attach("file", Buffer.from("%PDF-1.4 photos"), { filename: "Loading photos.pdf", contentType: "application/pdf" })
        .expect(201)
    ).body;
    await api(app, sana).put(`/orders/${first}/checklist/auto/loaded`, { attachmentId: photo.id, note: "Lashing checked" }).expect(200);
    expect(await auto(first, "loaded")).toMatchObject({ file: { id: photo.id, name: "Loading photos.pdf" }, note: "Lashing checked" });
    // Another deal's file, or none at all, is refused.
    const other = await newOrder();
    second = other.id;
    await api(app, sana).put(`/orders/${other.id}/checklist/auto/loaded`, { attachmentId: photo.id }).expect(400);
    await api(app, sana).put(`/orders/${first}/checklist/auto/loaded`, { attachmentId: "00000000-0000-4000-8000-000000000000" }).expect(400);
    await api(app, bilal).put(`/orders/${first}/checklist/auto/loaded`, { attachmentId: photo.id }).expect(404); // not this person's deal
    expect((await history(first)).some((e) => /kept a file with "Loaded"/.test(e.summary))).toBe(true);
  });

  it("fills in the forwarder of the last order on the route, this customer's banks and the quote's lead time", async () => {
    // The first order: LC with its banks.
    await api(app, sana).patch(`/orders/${first}/route`, { route: "letter_of_credit" }).expect(200);
    await api(app, sana)
      .put(`/orders/${first}/bank-contract`, { number: "LC/HBL/1", status: "opened", customerBank: "Habib Bank, Lahore", ourBank: "Bank of China" })
      .expect(200);
    // The second order: same ports, no forwarder yet.
    await api(app, sana).post(`/orders/${second}/shipments`, { mode: "sea", portOfLoading: "ningbo", portOfDischarge: "Karachi " }).expect(201);
    const rev = await prisma.company(FIRST_COMPANY_ID).order.findUniqueOrThrow({ where: { id: second }, select: { revisionId: true, refNo: true } });
    await prisma.company(FIRST_COMPANY_ID).quotationOption.updateMany({ where: { revisionId: rev.revisionId, status: "accepted" }, data: { leadTime: "8-10 weeks after the deposit" } });
    const firstRef = (await api(app, sana).get(`/orders/${first}`)).body.refNo;
    let d = (await api(app, sana).get(`/orders/${second}/defaults`).expect(200)).body;
    expect(d.forwarder).toEqual({ name: "Sino Trans", refNo: firstRef, why: "route" });
    expect(d.banks).toEqual({ customerBank: "Habib Bank, Lahore", ourBank: "Bank of China", refNo: firstRef });
    expect(d.leadTime).toMatchObject({ text: "8-10 weeks after the deposit", days: 70, from: today });
    expect(d.leadTime.readyOn).toBe(day(70));

    // A third order with no shipment: the same factory gives the forwarder.
    const third = (await newOrder()).id;
    d = (await api(app, sana).get(`/orders/${third}/defaults`).expect(200)).body;
    expect(d.forwarder).toMatchObject({ name: "Sino Trans", why: "factory" });

    // Only orders the person may see are looked at; with the modules off, nothing from them.
    await api(app, bilal).get(`/orders/${second}/defaults`).expect(404);
    await modulesOff(["shipping", "bank_contracts"]);
    d = (await api(app, sana).get(`/orders/${second}/defaults`).expect(200)).body;
    expect(d).toMatchObject({ forwarder: null, banks: null });
    await modulesOff([]);
  });

  it("reads lead times in days, weeks and months", () => {
    expect(leadDays("45 days")).toBe(45);
    expect(leadDays("45-60 days ex works")).toBe(60);
    expect(leadDays("8 to 10 weeks")).toBe(70);
    expect(leadDays("3 months")).toBe(90);
    expect(leadDays("20 working days")).toBe(28);
    expect(leadDays("ASAP")).toBeNull();
    expect(leadDays(null)).toBeNull();
  });

  it("All delivered OK: every line in full and good, the delivery dated; who received them", async () => {
    await api(app, sana).post(`/orders/${second}/delivery/all-good`, {}).expect(200);
    const o = (await api(app, sana).get(`/orders/${second}`)).body;
    const goods = o.lines.filter((l: { type: string }) => l.type === "goods");
    expect(goods.length).toBeGreaterThan(0);
    for (const l of goods) expect(l.delivered).toMatchObject({ qty: l.quantity, condition: "good" });
    let f = await flow(second);
    expect(f.delivery).toMatchObject({ deliveredOn: today, condition: "good", receivedBy: null });
    f = (await api(app, sana).patch(`/orders/${second}/delivery`, { deliveryReceivedBy: "Mr. Imran, stores" }).expect(200)).body;
    expect(f.delivery).toMatchObject({ receivedBy: "Mr. Imran, stores", deliveredOn: today });
    expect((await auto(second, "delivered")).done).toBe(true);
    await api(app, sana).post(`/orders/${second}/delivery/all-good`, { deliveredOn: day(2) }).expect(400);
    expect((await history(second)).some((e) => e.action === "flow.delivery" && /all delivered in good condition/.test(e.summary))).toBe(true);
  });

  it("All passed: the open SAT points pass and the SAT is signed off; needs the delivery", async () => {
    await api(app, sana).post(`/orders/${first}/sat/all-passed`, { satSignedBy: "Mr. Ali" }).expect(400); // not delivered
    // No points yet: the usual ones, passed.
    let f = (await api(app, sana).post(`/orders/${second}/sat/all-passed`, { satSignedBy: "Mr. Ali, QA head" }).expect(200)).body;
    expect(f.delivery.sat.length).toBeGreaterThan(0);
    expect(f.delivery.sat.every((c: { result: string }) => c.result === "pass")).toBe(true);
    expect(f.delivery).toMatchObject({ satDoneOn: today, satSignedBy: "Mr. Ali, QA head" });
    expect((await auto(second, "sat_done")).done).toBe(true);
    // Points marked N/A stay N/A.
    const third = (await newOrder()).id;
    await api(app, sana).post(`/orders/${third}/delivery/all-good`, {}).expect(200);
    await api(app, sana).put(`/orders/${third}/sat`, { checks: [{ item: "Speed", result: "fail" }, { item: "Printer", result: "not_applicable" }, { item: "Seal", result: "pending" }] }).expect(200);
    f = (await api(app, sana).post(`/orders/${third}/sat/all-passed`, {}).expect(200)).body;
    expect(f.delivery.sat.map((c: { result: string }) => c.result)).toEqual(["pass", "not_applicable", "pass"]);
    expect((await history(third)).some((e) => e.action === "flow.sat" && /SAT all passed \(3 points\)/.test(e.summary))).toBe(true);
  });

  it("one-tap actions need their permission and module", async () => {
    const role = (await api(app, admin).post("/roles", { name: `Light logistics ${tag}`, permissions: ["dashboard.view", "inquiries.viewAll", "shipping.manage"] }).expect(201)).body;
    const email = `light-logistics-${tag}@example.com`;
    await api(app, admin).post("/users", { name: "Light logistics", email, role: role.key, password }).expect(201);
    const logistics = await signIn(app, email, password);
    await api(app, logistics).post(`/orders/${second}/delivery/all-good`, {}).expect(403);
    await api(app, logistics).post(`/orders/${second}/sat/all-passed`, {}).expect(403);
    await api(app, logistics).patch(`/orders/${second}/factory-order`, { factoryOrderNo: "L-1" }).expect(403);
    // It may read the defaults of orders it sees.
    await api(app, logistics).get(`/orders/${second}/defaults`).expect(200);
    await modulesOff(["delivery_sat"]);
    await api(app, sana).post(`/orders/${second}/delivery/all-good`, {}).expect(403);
    await modulesOff([]);
  });

  it("another company cannot see the new fields' rows", async () => {
    const other = await prisma.platform.company.create({ data: { slug: `lt-${tag}`.slice(0, 30), name: `Light other ${tag}` } });
    try {
      const db = prisma.company(other.id);
      expect(await db.shipment.count({ where: { sealNo: "0048812" } })).toBe(0);
      expect(await db.purchaseOrder.count({ where: { supplierRef: "HP-2026-118" } })).toBe(0);
      expect((await db.purchaseOrder.updateMany({ where: { orderId: first }, data: { supplierRef: "hacked" } })).count).toBe(0);
    } finally {
      await prisma.platform.company.delete({ where: { id: other.id } });
    }
  });
});
