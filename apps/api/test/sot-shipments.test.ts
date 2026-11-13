import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIRST_COMPANY_ID } from "@kebo/database";
import { api, signIn, startApp } from "./app";
import { PrismaService } from "../src/database/prisma.service";
import { Clock } from "../src/common/time/clock.service";

/**
 * Single source of truth, PR 3: the shipment is the shipment.
 *  - the B/L, the day it left, the container and the ports live on the shipments only; the order's copies
 *    are gone (the migration moved them, keeping the shipment's where both differed, with a history row);
 *  - every paper, the order page, the stages' lines and the LC checks read Shipment 1 (the first made);
 *    "shipped on" is the earliest day a shipment left;
 *  - a new shipment's ports come from the terms: E/F terms load at the Incoterm place, C/D terms discharge there;
 *  - our ship-by is kept beside the LC's latest shipment date, and warned about when it is later.
 */
describe("the shipment is the shipment", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sana: string;
  let manager: string;
  let me: string;
  let customerId: string;
  let factoryId: string;
  let today = "";
  const tag = Date.now().toString(36);
  const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const day = (n: number) => addDays(today, n);

  /** A new deal, quoted with these terms and accepted: its order. */
  const newOrder = async (incoterm = "FOB", incotermPlace = "Ningbo", requiredBy?: string) => {
    const inquiry = (
      await api(app, sana)
        .post("/inquiries", { customerId, category: "Machinery", assigneeId: me, requiredBy, items: [{ description: "Capsule filler", quantity: 1 }] })
        .expect(201)
    ).body;
    const item = (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.items[0];
    await api(app, sana)
      .post(`/inquiries/${inquiry.id}/factory-quotes`, {
        factoryId,
        receivedOn: day(-5),
        currency: "CNY",
        lines: [{ requestedItemId: item.id, description: "NJP-800", quantity: 1, unitPrice: 200000, taxRate: 0 }],
      })
      .expect(201);
    const draft = (await api(app, sana).get(`/inquiries/${inquiry.id}/quotation/draft`)).body;
    const r = (
      await api(app, sana)
        .post(`/inquiries/${inquiry.id}/quotation/revisions`, { ...draft, depositPercent: 30, currency: "USD", balanceTerms: "before_shipment", incoterm, incotermPlace })
        .expect(201)
    ).body;
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "sent" }).expect(200);
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "accepted" }).expect(200);
    const o = (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.orders[0];
    // Won and ordered months ago: this month's reports elsewhere are left as they are.
    await prisma.platform.$executeRaw`update orders set ordered_on = ordered_on - 75 where id = ${o.id}::uuid`;
    await prisma.platform.$executeRaw`update inquiries set closed_at = closed_at - interval '75 days' where id = ${inquiry.id}::uuid`;
    return { id: o.id as string, refNo: o.refNo as string };
  };
  const order = async (id: string) => (await api(app, sana).get(`/orders/${id}`).expect(200)).body;
  const flow = async (id: string) => (await api(app, sana).get(`/orders/${id}/flow`).expect(200)).body;
  const shipments = async (id: string) => (await flow(id)).shipping.shipments as Record<string, unknown>[];
  const paperDoc = async (id: string, kind: string) => (await api(app, sana).get(`/orders/${id}/papers/${kind}/doc`).expect(200)).body;
  const paperChecks = async (id: string, kind: string) =>
    (await api(app, sana).get(`/orders/${id}/papers/${kind}/checks`).expect(200)).body as {
      checks: { key: string; ok: boolean; value: string; fix: string | null; warn?: string | null }[];
    };
  /** Where each stage stands (its word and its line of facts), read from what is stored. */
  const stands = async (id: string) => (await api(app, sana).get(`/orders/${id}/sections`).expect(200)).body.stands as { stage: string; word: string; fact: string; missing: string }[];
  const history = async (id: string) =>
    (await api(app, sana).get(`/history?type=order&id=${id}&step=shipping`).expect(200)).body as {
      action: string;
      summary: string;
      changes: { field: string; from: string | null; to: string | null }[];
    }[];
  /** Received and packed, ready to ship. */
  const packed = async (id: string) => {
    await api(app, sana).post(`/orders/${id}/stage`, { to: "in_production", confirm: true }).expect(200);
    const goods = (await order(id)).lines.find((l: { type: string }) => l.type === "goods");
    await api(app, sana).put(`/orders/${id}/receipt`, { lines: [{ lineId: goods.id, receivedQty: 1 }] }).expect(200);
    await api(app, sana).put(`/orders/${id}/packing`, { lines: [{ lineId: goods.id, packages: "2", packageType: "Wooden case", grossWeightKg: "900" }] }).expect(200);
    return goods.id as string;
  };

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);
    today = app.get(Clock).today();
    sana = await signIn(app, "sana@example.com");
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    me = (await api(app, sana).get("/auth/me")).body.id;
    customerId = (
      await api(app, sana)
        .post("/customers", { name: `Harbour Pharma ${tag}`, country: "PK", address: "Port Qasim, Karachi", contacts: [{ name: "Adil", email: `adil-${tag}@harbour.test` }] })
        .expect(201)
    ).body.id;
    factoryId = (await api(app, sana).post("/factories", { name: `Harbour Works ${tag}` }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("new shipments take their ports from the terms: E/F terms load at the place, C/D terms discharge there", async () => {
    const cfr = await newOrder("CFR", "Karachi");
    // Not sent: from the terms (CFR Karachi is the destination, never the loading port).
    const made = (await api(app, sana).post(`/orders/${cfr.id}/shipments`, { mode: "sea" }).expect(201)).body.shipping.shipments[0];
    expect(made).toMatchObject({ n: 1, portOfLoading: null, portOfDischarge: "Karachi" });
    expect((await api(app, sana).get(`/orders/${cfr.id}/defaults`).expect(200)).body.ports).toEqual({ portOfLoading: null, portOfDischarge: "Karachi" });
    // The order's destination wins over the place; ports sent are kept, empty ones are empty.
    await api(app, sana).patch(`/orders/${cfr.id}/details`, { portOfDischarge: "Hairatan, Afghanistan" }).expect(200);
    const second = (await api(app, sana).post(`/orders/${cfr.id}/shipments`, { mode: "sea" }).expect(201)).body.shipping.shipments[1];
    expect(second).toMatchObject({ n: 2, portOfLoading: null, portOfDischarge: "Hairatan, Afghanistan" });
    const typed = (await api(app, sana).post(`/orders/${cfr.id}/shipments`, { mode: "sea", portOfLoading: "Shanghai", portOfDischarge: "" }).expect(201)).body
      .shipping.shipments[2];
    expect(typed).toMatchObject({ portOfLoading: "Shanghai", portOfDischarge: null });

    const fob = await newOrder("FOB", "Ningbo");
    expect((await api(app, sana).post(`/orders/${fob.id}/shipments`, { mode: "sea" }).expect(201)).body.shipping.shipments[0]).toMatchObject({
      portOfLoading: "Ningbo",
      portOfDischarge: null,
    });
    expect((await api(app, sana).get(`/orders/${fob.id}/defaults`).expect(200)).body.ports).toEqual({ portOfLoading: "Ningbo", portOfDischarge: null });
  });

  it("the order's shipping facts are Shipment 1's: typed on the order (no shipping module) they go there", async () => {
    const wanted = day(50);
    const o = await newOrder("CIF", "Karachi", wanted);
    // No ship-by yet: the deal's "wanted by" is the suggestion.
    let v = await order(o.id);
    expect(v).toMatchObject({ shipBy: null, shipBySuggested: wanted, shipment: null, shippedOn: null, blNo: null });
    expect((await api(app, sana).get(`/orders/${o.id}/defaults`).expect(200)).body.shipBy).toMatchObject({ on: wanted });
    await api(app, sana).patch(`/orders/${o.id}/details`, { shipBy: day(45) }).expect(200);
    expect((await order(o.id)).shipBySuggested).toBeNull();

    // The Details card's B/L and ship date: an implicit Shipment 1 is made, with the ports the terms give.
    await api(app, sana).patch(`/orders/${o.id}/details`, { blNo: "OOLU-1", shippedOn: day(-43), containerNo: "TGHU 1" }).expect(200);
    const [s] = await shipments(o.id);
    expect(s).toMatchObject({ n: 1, status: "departed", blNo: "OOLU-1", departedOn: day(-43), containerNo: "TGHU 1", portOfLoading: null, portOfDischarge: "Karachi" });
    v = await order(o.id);
    expect(v).toMatchObject({ shippedOn: day(-43), blNo: "OOLU-1", shipment: { id: s!.id, count: 1, blNo: "OOLU-1", containerNo: "TGHU 1" } });
    expect(v.goods.containerNo).toBe("TGHU 1");
    // Changed on the shipment: the order shows the shipment's (one place).
    await api(app, sana).patch(`/shipments/${s!.id}`, { containerNo: "TGHU 2" }).expect(200);
    expect((await order(o.id)).goods.containerNo).toBe("TGHU 2");
    // An older client sending the container with the packing list: saved on the shipment, not the order.
    const goods = (await order(o.id)).lines.find((l: { type: string }) => l.type === "goods");
    await api(app, sana).put(`/orders/${o.id}/packing`, { containerNo: "TGHU 3", lines: [{ lineId: goods.id, packages: "1" }] }).expect(200);
    expect((await shipments(o.id))[0]).toMatchObject({ containerNo: "TGHU 3" });
    // The packing list sent without a container leaves the shipment's alone.
    await api(app, sana).put(`/orders/${o.id}/packing`, { lines: [{ lineId: goods.id, packages: "2" }] }).expect(200);
    expect((await shipments(o.id))[0]).toMatchObject({ containerNo: "TGHU 3" });
    expect(await shipments(o.id)).toHaveLength(1);
  });

  it("papers and the order page agree after a B/L correction; the final packing list keeps what it printed", async () => {
    const o = await newOrder("FOB", "Ningbo");
    await packed(o.id);
    await api(app, sana).post(`/orders/${o.id}/stage`, { to: "shipped", confirm: true, shippedOn: day(-40), blNo: "MEDU123" }).expect(200);
    // Moving to Shipped wrote Shipment 1 (made from the terms: FOB Ningbo loads at Ningbo).
    const [s] = await shipments(o.id);
    expect(s).toMatchObject({ status: "departed", departedOn: day(-40), blNo: "MEDU123", portOfLoading: "Ningbo" });
    const pl = async (q = "") => (await api(app, sana).get(`/orders/${o.id}/documents/packing-list${q}`).expect(200)).body;
    expect(await pl()).toMatchObject({ final: true, order: { blNo: "MEDU123", shippedOn: day(-40) }, shipment: { portOfLoading: "Ningbo" } });

    // The B/L corrected on the shipment (the one place).
    await api(app, sana).patch(`/shipments/${s!.id}`, { blNo: "MEDU124" }).expect(200);
    expect(await order(o.id)).toMatchObject({ blNo: "MEDU124", shippedOn: day(-40) });
    const ci = await paperDoc(o.id, "commercial-invoice");
    expect(ci.doc.meta).toContainEqual({ label: "B/L No.", value: "MEDU124" });
    expect(ci.doc.date).toBe(day(-40));
    const advice = await paperDoc(o.id, "shipping-advice");
    expect(advice.doc.meta).toContainEqual({ label: "B/L No.", value: "MEDU124" });
    expect(advice.doc.bullets).toContainEqual({ label: "Port of loading:", value: "Ningbo" });
    // The document set's B/L row prints the shipment's number.
    const list = (await api(app, sana).get(`/orders/${o.id}/papers`).expect(200)).body.papers as { kind: string; number: string | null }[];
    expect(list.find((p) => p.kind === "bill_of_lading")).toMatchObject({ number: "MEDU124" });
    // The packing list made final keeps what it printed; version 2 reads the shipment.
    expect((await pl()).order.blNo).toBe("MEDU123");
    await api(app, manager).post(`/orders/${o.id}/documents/packing-list/again`).expect(200);
    expect(await pl()).toMatchObject({ final: false, order: { blNo: "MEDU124" }, paper: { version: 2 } });
    expect((await pl("?v=1")).order.blNo).toBe("MEDU123");

    // A B/L row recorded with the shipment's number keeps none of its own; another number is refused.
    await api(app, sana).post(`/orders/${o.id}/document-set`, { kind: "bill_of_lading", status: "ready", number: "MEDU124" }).expect(201);
    const stored = await prisma.company(FIRST_COMPANY_ID).orderDocument.findFirst({ where: { orderId: o.id, kind: "bill_of_lading" } });
    expect(stored?.number).toBeNull();
    const refused = await api(app, sana).post(`/orders/${o.id}/document-set`, { kind: "bill_of_lading", status: "ready", number: "OTHER-9" }).expect(400);
    expect(refused.body.error).toMatch(/shipment's \(MEDU124\)/);
    expect((await stands(o.id)).find((x) => x.stage === "shipping")!.fact).toContain("MEDU124");
  });

  it("one rule for the primary shipment: Shipment 1 prints; shipped on is the earliest departure", async () => {
    const o = await newOrder("FOB", "Qingdao");
    await packed(o.id);
    const first = (await api(app, sana).post(`/orders/${o.id}/shipments`, { mode: "sea", status: "booked", blNo: "S1-BL", vessel: "MSC One" }).expect(201)).body
      .shipping.shipments[0];
    const second = (
      await api(app, sana).post(`/orders/${o.id}/shipments`, { mode: "sea", status: "departed", departedOn: day(-65), blNo: "S2-BL" }).expect(201)
    ).body.shipping.shipments[1];
    expect([first.n, second.n]).toEqual([1, 2]);
    // The second one left first: the order shipped then, and moved to Shipped by itself (nothing copied).
    const v = await order(o.id);
    expect(v).toMatchObject({ stage: "shipped", shippedOn: day(-65), blNo: "S1-BL", shipment: { id: first.id, count: 2 } });
    // The papers speak of Shipment 1.
    expect((await paperDoc(o.id, "commercial-invoice")).doc.meta).toContainEqual({ label: "B/L No.", value: "S1-BL" });
    expect((await paperDoc(o.id, "shipping-advice")).doc.bullets).toContainEqual({ label: "Vessel:", value: "MSC One" });
    // A shipment left without a date while none had one: it left today.
    const o2 = await newOrder("FOB", "Qingdao");
    await packed(o2.id);
    await api(app, sana).post(`/orders/${o2.id}/shipments`, { mode: "sea", status: "departed" }).expect(201);
    expect(await order(o2.id)).toMatchObject({ stage: "shipped", shippedOn: today });
    await api(app, sana).patch(`/shipments/${(await shipments(o2.id))[0]!.id}`, { departedOn: day(-63) }).expect(200);
  });

  it("our ship-by is kept beside the LC's latest shipment date and warned about when later", async () => {
    const o = await newOrder("CIF", "Karachi");
    await api(app, sana).patch(`/orders/${o.id}/route`, { route: "letter_of_credit", lcTerms: "at_sight" }).expect(200);
    await api(app, sana).patch(`/orders/${o.id}/details`, { readyOn: day(20), shipBy: day(40) }).expect(200);
    const f = (
      await api(app, sana)
        .put(`/orders/${o.id}/bank-contract`, { number: `LC/${tag}`, status: "opened", currency: "USD", openedOn: today, latestShipOn: day(30), expiresOn: day(90) })
        .expect(200)
    ).body;
    const ours = f.payment.lcChecks.find((c: { key: string }) => c.key === "our_ship_by");
    expect(ours).toMatchObject({ ok: false, detail: `our ship-by ${day(40)} is after the LC's latest shipment ${day(30)} · ship by ${day(30)}, or ask for an amendment` });
    // The sales contract's Make page shows both and warns (ours is printed; the check fails).
    let shipBy = (await paperChecks(o.id, "sales-contract")).checks.find((c) => c.key === "shipBy")!;
    expect(shipBy).toMatchObject({ ok: false, fix: "shipBy" });
    expect(shipBy.value).toMatch(/LC latest/);
    expect(shipBy.warn).toMatch(/^Ours is later than the LC allows: ship by .*, or ask for an amendment\.$/);
    // Ours moved inside the LC's date: both still shown, the check passes.
    await api(app, sana).patch(`/orders/${o.id}/details`, { shipBy: day(28) }).expect(200);
    expect((await flow(o.id)).payment.lcChecks.find((c: { key: string }) => c.key === "our_ship_by")).toMatchObject({ ok: true });
    shipBy = (await paperChecks(o.id, "sales-contract")).checks.find((c) => c.key === "shipBy")!;
    expect(shipBy.ok).toBe(true);
    expect(shipBy.value).toMatch(/LC latest/);
  });

  it("the migration moves the order's shipping facts onto shipments: the shipment wins, the order's old value is in the history", async () => {
    const db = prisma.platform;
    const onlyOrder = await newOrder("CFR", "Karachi");
    const onlyShipment = await newOrder();
    const both = await newOrder();
    const gaps = await newOrder();
    const docOnly = await newOrder();
    // As before the migration: the order's own columns.
    await db.$executeRawUnsafe(
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipped_on date, ADD COLUMN IF NOT EXISTS bl_no varchar(60), ADD COLUMN IF NOT EXISTS container_no varchar(120)`,
    );
    try {
      const set = (id: string, shipped: string | null, bl: string | null, container: string | null, stage = "shipped") =>
        db.$executeRawUnsafe(
          `UPDATE orders SET shipped_on = $2::date, bl_no = $3, container_no = $4, stage = $5::order_stage WHERE id = $1::uuid`,
          id,
          shipped,
          bl,
          container,
          stage,
        );
      await set(onlyOrder.id, day(-70), "OLD-A", "CONT-A");
      await api(app, sana).post(`/orders/${onlyShipment.id}/shipments`, { mode: "sea", status: "departed", departedOn: day(-71), blNo: "SHIP-B" }).expect(201);
      await api(app, sana).post(`/orders/${both.id}/shipments`, { mode: "sea", status: "departed", departedOn: day(-60), blNo: "SHIP-C", containerNo: "SC-1" }).expect(201);
      await set(both.id, day(-62), "ORDER-C", "SC-1");
      await api(app, sana).post(`/orders/${gaps.id}/shipments`, { mode: "sea", status: "booked", forwarder: "Sino Trans" }).expect(201);
      await set(gaps.id, day(-50), "ORDER-D", "OC-D");
      await api(app, sana).post(`/orders/${docOnly.id}/shipments`, { mode: "sea", status: "booked" }).expect(201);
      await db.$executeRawUnsafe(
        `INSERT INTO order_documents (id, company_id, order_id, kind, number, status, updated_at) SELECT gen_random_uuid(), company_id, id, 'bill_of_lading', 'DOC-E', 'ready', now() FROM orders WHERE id = $1::uuid`,
        docOnly.id,
      );

      const sql = readFileSync(join(__dirname, "../../../packages/database/prisma/migrations/20261205000000_the_shipment_is_the_shipment/migration.sql"), "utf8");
      await db.$executeRawUnsafe(sql);
    } finally {
      await db.$executeRawUnsafe(`ALTER TABLE orders DROP COLUMN IF EXISTS shipped_on, DROP COLUMN IF EXISTS bl_no, DROP COLUMN IF EXISTS container_no`);
    }

    // Order-only: Shipment 1 made from its facts, ports from the terms (CFR Karachi: discharge), the history says so.
    expect(await shipments(onlyOrder.id)).toEqual([
      expect.objectContaining({ n: 1, mode: "sea", status: "departed", departedOn: day(-70), blNo: "OLD-A", containerNo: "CONT-A", portOfLoading: null, portOfDischarge: "Karachi" }),
    ]);
    expect(await order(onlyOrder.id)).toMatchObject({ shippedOn: day(-70), blNo: "OLD-A" });
    expect((await history(onlyOrder.id)).map((h) => h.summary)).toContainEqual(
      `${onlyOrder.refNo}: ship date ${day(-70)}, B/L OLD-A, container CONT-A moved from the order to Shipment 1 (one place for the shipment)`,
    );
    // Shipment-only: untouched, nothing in the history.
    expect(await shipments(onlyShipment.id)).toEqual([expect.objectContaining({ blNo: "SHIP-B", departedOn: day(-71) })]);
    expect((await history(onlyShipment.id)).some((h) => /one place for the shipment/.test(h.summary))).toBe(false);
    // Both, differing: the shipment's is kept; the order's old values are in the history.
    expect(await shipments(both.id)).toEqual([expect.objectContaining({ blNo: "SHIP-C", departedOn: day(-60), containerNo: "SC-1" })]);
    const moved = (await history(both.id)).find((h) => /differed/.test(h.summary))!;
    expect(moved.summary).toBe(
      `${both.refNo}: the order's own B/L ORDER-C, ship date ${day(-62)} differed from the shipment's (B/L SHIP-C, left ${day(-60)}): the shipment's is kept (one place for the shipment)`,
    );
    expect(moved.changes).toEqual(
      expect.arrayContaining([
        { field: "blNo", from: "ORDER-C", to: "SHIP-C" },
        { field: "shippedOn", from: day(-62), to: day(-60) },
      ]),
    );
    // A shipment without them takes the order's (what the papers printed), and moves on to departed.
    expect(await shipments(gaps.id)).toEqual([
      expect.objectContaining({ status: "departed", forwarder: "Sino Trans", blNo: "ORDER-D", departedOn: day(-50), containerNo: "OC-D" }),
    ]);
    // The document set's B/L number went to the shipment; the row keeps none.
    expect((await shipments(docOnly.id))[0]).toMatchObject({ blNo: "DOC-E" });
    const row = await prisma.company(FIRST_COMPANY_ID).orderDocument.findFirst({ where: { orderId: docOnly.id, kind: "bill_of_lading" } });
    expect(row?.number).toBeNull();
    // The papers read them.
    expect((await paperDoc(gaps.id, "commercial-invoice")).doc.meta).toContainEqual({ label: "B/L No.", value: "ORDER-D" });
  });
});
