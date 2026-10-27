import type { INestApplication } from "@nestjs/common";
import { unzipSync } from "fflate";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";

type Item = { id: string; no: string; description: string; priced: boolean; parentId: string | null };
type ItemBody = { id?: string; parentId: string | null; description: string; model: string | null; quantity: number; unit: string };
const itemsBody = (rows: (Item & { model: string | null; quantity: string; unit: string })[]): ItemBody[] =>
  rows.map((i) => ({
    id: i.id,
    parentId: i.parentId,
    description: i.description,
    model: i.model,
    quantity: Number(i.quantity),
    unit: i.unit,
  }));
type Entry = {
  action: string;
  summary: string;
  reason: string | null;
  by: { name: string } | null;
  changes: { field: string; from: string | null; to: string | null }[];
};

/**
 * One line everywhere (items split into parts are numbered 2.1, 2.2 on the
 * deal, the quotation and the order), a reason for every change that reaches
 * someone else, each record's history, and the deal's URS & documents.
 */
describe("lines, reasons and history", () => {
  let app: INestApplication;
  let sana: string;
  let bilal: string;
  let manager: string;
  let admin: string;
  let me: string;
  let bilalId: string;
  const tag = Date.now().toString(36);
  let customerId: string;
  let inquiryId: string;
  let items: Item[];
  let quoteId: string;
  let quoteBody: Record<string, unknown> & { lines: Record<string, unknown>[] };

  const deal = async () => (await api(app, sana).get(`/inquiries/${inquiryId}`).expect(200)).body;
  /** multipart upload (the api() helper always sends JSON). */
  const upload = (token: string) =>
    request(app.getHttpServer()).post(`/api/inquiries/${inquiryId}/files`).set("authorization", `Bearer ${token}`);
  const history = async (type: string, id: string, who = sana) =>
    (await api(app, who).get(`/history?type=${type}&id=${id}`).expect(200)).body as Entry[];

  beforeAll(async () => {
    app = await startApp();
    sana = await signIn(app, "sana@example.com");
    bilal = await signIn(app, "bilal@example.com");
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    admin = await signIn(app, "admin@example.com", "Admin@12345");
    me = (await api(app, sana).get("/auth/me")).body.id;
    bilalId = (await api(app, bilal).get("/auth/me")).body.id;
    customerId = (
      await api(app, sana)
        .post("/customers", { name: `Lines Co ${tag}`, country: "KE", contacts: [{ name: "Wanjiru", email: `w-${tag}@lines.test` }] })
        .expect(201)
    ).body.id;
    inquiryId = (
      await api(app, sana)
        .post("/inquiries", {
          customerId,
          category: "Machinery",
          assigneeId: me,
          items: [
            { description: "Boiler", quantity: 1, unit: "set" },
            { description: "Filling line", quantity: 1, unit: "set" },
          ],
        })
        .expect(201)
    ).body.id;
    items = (await deal()).items;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("splits an item into parts numbered under it, without asking why before any price", async () => {
    expect(items.map((i) => i.no)).toEqual(["1", "2"]);
    const line = items[1]!;
    await api(app, sana)
      .post(`/inquiries/${inquiryId}/items/${line.id}/parts`, {
        parts: [
          { description: "Filling machine", quantity: 1, unit: "set" },
          { description: "Capping machine", quantity: 1, unit: "set" },
        ],
      })
      .expect(200);
    items = (await deal()).items;
    expect(items.map((i) => `${i.no} ${i.description}`)).toEqual([
      "1 Boiler",
      "2 Filling line",
      "2.1 Filling machine",
      "2.2 Capping machine",
    ]);
    // A part is not split again.
    await api(app, sana)
      .post(`/inquiries/${inquiryId}/items/${items[2]!.id}/parts`, { parts: [{ description: "Nozzle", quantity: 4 }] })
      .expect(400);
  });

  it("keeps parts under their item when the deal is edited", async () => {
    const d = await deal();
    const body = {
      customerId,
      category: "Machinery",
      assigneeId: me,
      items: itemsBody(d.items),
    };
    body.items.push({ parentId: items[1]!.id, description: "Labeller", model: null, quantity: 1, unit: "set" });
    items = (await api(app, sana).put(`/inquiries/${inquiryId}`, body).expect(200), await deal()).items;
    expect(items.map((i) => i.no)).toEqual(["1", "2", "2.1", "2.2", "2.3"]);
  });

  it("asks why once a factory has priced the item, and keeps the reason in the history", async () => {
    const created = await api(app, sana)
      .post(`/inquiries/${inquiryId}/factory-quotes`, {
        newFactoryName: `Zhangjiagang Fill ${tag}`,
        receivedOn: "2026-10-20",
        currency: "CNY",
        lines: [
          { requestedItemId: items[0]!.id, description: "Boiler", quantity: 1, unit: "set", unitPrice: 50000 },
          { requestedItemId: items[2]!.id, description: "Filling machine", quantity: 1, unit: "set", unitPrice: 80000 },
          { requestedItemId: items[3]!.id, description: "Capping machine", quantity: 1, unit: "set", unitPrice: 30000 },
        ],
      })
      .expect(201);
    quoteId = created.body.id;
    const d = await deal();
    expect(d.items.map((i: Item) => i.priced)).toEqual([true, false, true, true, false]);
    const body = {
      customerId,
      category: "Machinery",
      assigneeId: me,
      items: itemsBody(d.items),
    };
    body.items[0]!.quantity = 2;
    const asked = (await api(app, sana).put(`/inquiries/${inquiryId}`, body).expect(409)).body;
    expect(asked).toMatchObject({ code: "reason_needed", choices: expect.arrayContaining(["Customer changed the quantity"]) });
    // Changing an item nobody has priced is not asked.
    await api(app, sana)
      .put(`/inquiries/${inquiryId}`, {
        ...body,
        items: body.items.map((i, n) => (n === 0 ? { ...i, quantity: 1 } : n === 4 ? { ...i, quantity: 2 } : i)),
      })
      .expect(200);
    await api(app, sana)
      .put(`/inquiries/${inquiryId}`, { ...body, reason: "Customer changed the quantity" })
      .expect(200);
    const h = await history("deal", inquiryId);
    expect(h[0]).toMatchObject({ reason: "Customer changed the quantity", by: { name: expect.any(String) } });
    expect(h[0]!.summary).toMatch(/Boiler/);
  });

  it("numbers the quotation like the deal, and asks why prices it uses change", async () => {
    const draft = (await api(app, sana).get(`/inquiries/${inquiryId}/quotation/draft`).expect(200)).body;
    const r1 = (await api(app, sana).post(`/inquiries/${inquiryId}/quotation/revisions`, draft).expect(201)).body;
    // The option is the factory's offer: its own lines (boiler, filling machine, capping machine), covering items 1 and 2.
    expect(r1.options[0].lines.map((l: { no: string; description: string }) => `${l.no} ${l.description}`)).toEqual(["1 Boiler", "2 Filling machine", "3 Capping machine"]);
    expect(r1.options[0].coverage).toEqual({ covered: ["1", "2"], missing: [] });

    const src = (await api(app, sana).get(`/inquiries/${inquiryId}/sourcing`).expect(200)).body.quotes[0];
    quoteBody = {
      factoryId: src.factory.id,
      receivedOn: src.receivedOn,
      currency: src.currency,
      lines: src.lines.map((l: Record<string, unknown>) => ({
        id: l.id,
        requestedItemId: l.requestedItemId,
        description: l.description,
        quantity: Number(l.quantity),
        unit: l.unit,
        unitPrice: Number(l.unitPrice),
        taxRate: l.taxRate,
      })),
    };
    const cheaper = { ...quoteBody, lines: quoteBody.lines.map((l, n) => (n === 0 ? { ...l, unitPrice: 48000 } : l)) };
    expect((await api(app, sana).put(`/factory-quotes/${quoteId}`, cheaper).expect(409)).body).toMatchObject({
      code: "reason_needed",
      choices: expect.arrayContaining(["Factory changed its price"]),
    });
    await api(app, sana)
      .put(`/factory-quotes/${quoteId}`, { ...cheaper, reason: "Factory changed its price" })
      .expect(200);
    // Notes and other changes that leave the prices alone are not asked.
    await api(app, sana)
      .put(`/factory-quotes/${quoteId}`, { ...cheaper, notes: "Price includes wooden case" })
      .expect(200);
    expect((await api(app, sana).delete(`/factory-quotes/${quoteId}`).expect(409)).body.code).toBe("reason_needed");

    const h = await history("deal", inquiryId);
    expect(h.find((e) => e.reason === "Factory changed its price")?.summary).toMatch(/Boiler: 50000\.00 → 48000\.00/);
  });

  it("asks why a deal is put on hold or handed to someone else", async () => {
    expect((await api(app, sana).post(`/inquiries/${inquiryId}/hold`, { onHold: true }).expect(409)).body.code).toBe("reason_needed");
    await api(app, sana).post(`/inquiries/${inquiryId}/hold`, { onHold: true, reason: "Customer is deciding" }).expect(200);
    await api(app, sana).post(`/inquiries/${inquiryId}/hold`, { onHold: false }).expect(200); // taking it off hold is not asked
    expect((await api(app, manager).post(`/inquiries/${inquiryId}/assign`, { assigneeId: bilalId }).expect(409)).body.code).toBe(
      "reason_needed",
    );
    await api(app, manager).post(`/inquiries/${inquiryId}/assign`, { assigneeId: bilalId, reason: "Person is away" }).expect(200);
    await api(app, manager).post(`/inquiries/${inquiryId}/assign`, { assigneeId: me, reason: "Workload" }).expect(200);
    const reasons = (await history("deal", inquiryId)).map((e) => e.reason);
    expect(reasons).toEqual(expect.arrayContaining(["Customer is deciding", "Person is away", "Workload"]));
  });

  it("shows a deal's history only to people who may see the deal", async () => {
    await api(app, bilal).get(`/history?type=deal&id=${inquiryId}`).expect(404);
    await api(app, sana).get(`/history?type=deal&id=not-an-id`).expect(422);
  });

  it("keeps the deal's URS & documents with their type and note, and gives them all in one zip", async () => {
    const urs = (
      await upload(sana)
        .field("kind", "urs")
        .field("note", "Rev B from the customer")
        .attach("file", Buffer.from("%PDF-1.4 urs"), { filename: "URS.pdf", contentType: "application/pdf" })
        .expect(201)
    ).body;
    expect(urs).toMatchObject({ kind: "urs", note: "Rev B from the customer" });
    const drawing = (
      await upload(sana)
        .attach("file", Buffer.from("%PDF-1.4 drawing"), { filename: "URS.pdf", contentType: "application/pdf" })
        .expect(201)
    ).body;
    expect(drawing.kind).toBe("other");
    expect((await api(app, sana).patch(`/files/${drawing.id}`, { kind: "drawing", note: "Layout" }).expect(200)).body).toMatchObject({
      kind: "drawing",
      note: "Layout",
    });
    await api(app, bilal).patch(`/files/${drawing.id}`, { kind: "photo" }).expect(404);

    const zip = await api(app, sana)
      .get(`/inquiries/${inquiryId}/files.zip`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(zip.headers["content-type"]).toBe("application/zip");
    const names = Object.keys(unzipSync(new Uint8Array(zip.body as Buffer)));
    expect(names).toHaveLength(2);
    expect(names[0]).toBe("URS.pdf"); // the URS first, the same name made unique
    expect(names[1]).not.toBe("URS.pdf");
    await api(app, bilal).get(`/inquiries/${inquiryId}/files.zip`).expect(404);
  });

  it("asks why a customer's name or country changes", async () => {
    const c = (await api(app, sana).get(`/customers/${customerId}`).expect(200)).body;
    const body = {
      name: `Lines Company ${tag}`,
      country: c.country,
      contacts: c.contacts.map((x: Record<string, unknown>) => ({ id: x.id, name: x.name, email: x.email })),
    };
    expect((await api(app, sana).put(`/customers/${customerId}`, body).expect(409)).body).toMatchObject({
      code: "reason_needed",
      choices: expect.arrayContaining(["Company renamed"]),
    });
    await api(app, sana)
      .put(`/customers/${customerId}`, { ...body, reason: "Company renamed" })
      .expect(200);
    await api(app, sana)
      .put(`/customers/${customerId}`, { ...body, notes: "Pays by LC" })
      .expect(200);
    const h = await history("customer", customerId);
    expect(h[1]).toMatchObject({
      reason: "Company renamed",
      changes: expect.arrayContaining([{ field: "name", from: `Lines Co ${tag}`, to: `Lines Company ${tag}` }]),
    });
    expect(h[0]!.reason).toBeNull();
  });

  it("gives each factory a person who looks after it, and lists my factories", async () => {
    const f = (
      await api(app, sana)
        .post("/factories", { name: `Owned Works ${tag}`, ownerId: me })
        .expect(201)
    ).body;
    expect(f.ownerId).toBe(me);
    const mine = (await api(app, sana).get(`/factories?mine=true&q=Owned Works ${tag}`).expect(200)).body.rows;
    expect(mine.map((r: { id: string; owner: { id: string } }) => [r.id, r.owner.id])).toEqual([[f.id, me]]);
    expect((await api(app, bilal).get(`/factories?mine=true&q=Owned Works ${tag}`).expect(200)).body.rows).toHaveLength(0);
    // A factory first added while entering its prices is looked after by whoever added it.
    expect((await api(app, sana).get(`/factories?mine=true&q=Zhangjiagang Fill ${tag}`).expect(200)).body.rows).toHaveLength(1);
    // Handing it to someone else (or renaming it) says why; adding a phone does not.
    await api(app, sana).put(`/factories/${f.id}`, { name: f.name, ownerId: me, phone: "+86 512 5555" }).expect(200);
    expect((await api(app, sana).put(`/factories/${f.id}`, { name: f.name, ownerId: bilalId }).expect(409)).body.code).toBe(
      "reason_needed",
    );
    await api(app, sana)
      .put(`/factories/${f.id}`, { name: f.name, ownerId: bilalId, reason: "Another person handles this factory" })
      .expect(200);
    const h = await history("factory", f.id);
    expect(h[0]).toMatchObject({
      reason: "Another person handles this factory",
      changes: expect.arrayContaining([expect.objectContaining({ field: "lookedAfterBy", to: "Bilal" })]),
    });
    await api(app, sana)
      .post("/factories", { name: `Nobody Works ${tag}`, ownerId: "00000000-0000-4000-8000-000000000000" })
      .expect(400);
  });

  it("asks why exchange rates or money defaults change", async () => {
    const sales = (await api(app, admin).get("/settings").expect(200)).body.sales;
    const withEur = { ...sales, exchangeRates: { ...sales.exchangeRates, PKR: 280 } };
    expect((await api(app, admin).put("/settings/sales", withEur).expect(409)).body).toMatchObject({
      code: "reason_needed",
      choices: expect.arrayContaining(["New exchange rate"]),
    });
    await api(app, admin)
      .put("/settings/sales", { ...withEur, reason: "New exchange rate" })
      .expect(200);
    await api(app, admin)
      .put("/settings/sales", { ...sales, reason: "Mistake fixed" })
      .expect(200);
    await api(app, admin)
      .put("/settings/sales", { ...sales, defaultPaymentTerms: "By T/T", defaultDeliveryTerms: "Export wooden cases" })
      .expect(200); // nothing that moves money: not asked
  });
});
