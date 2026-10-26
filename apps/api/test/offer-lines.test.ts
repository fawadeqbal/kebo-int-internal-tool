import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";

type Line = { id: string; no: string; description: string; model: string | null; unitPrice: string; productKey: string; parentId: string | null };
type Offer = { id: string; lines: Line[]; files: { id: string; fileName: string; kind: string }[] };

/**
 * Step 2c: the customer often sends only a requirement; the lines are made at
 * factory prices, one change at a time (added, edited, moved, removed), and
 * another factory's offer can start from the same lines. Each offer keeps its
 * own files as evidence.
 */
describe("factory offer lines, one change at a time", () => {
  let app: INestApplication;
  let sana: string;
  let bilal: string;
  let inquiryId: string;
  let offerA: string;
  let offerB: string;
  const tag = Date.now().toString(36);

  beforeAll(async () => {
    app = await startApp();
    sana = await signIn(app, "sana@example.com");
    bilal = await signIn(app, "bilal@example.com");
  });

  afterAll(async () => {
    await app?.close();
  });

  const shape = (o: Offer) => o.lines.map((l) => `${l.no} ${l.description}${l.model ? ` [${l.model}]` : ""}`);

  it("takes an inquiry with only the requirement (no list of items)", async () => {
    const me = (await api(app, sana).get("/auth/me")).body.id;
    const customer = (
      await api(app, sana)
        .post("/customers", { name: `Lagos Water ${tag}`, country: "NG", contacts: [{ name: "Ade", email: `a-${tag}@lw.test` }] })
        .expect(201)
    ).body;
    const base = { customerId: customer.id, category: "Machinery", assigneeId: me };
    await api(app, sana).post("/inquiries", base).expect(422);
    const i = (
      await api(app, sana)
        .post("/inquiries", { ...base, requirements: "Complete water bottling plant, 6000 bph\nSee the URS" })
        .expect(201)
    ).body;
    inquiryId = i.id;
    const d = (await api(app, sana).get(`/inquiries/${inquiryId}`).expect(200)).body;
    expect(d.items).toEqual([]);
    expect(d.title).toBe("Complete water bottling plant, 6000 bph");
  });

  it("starts an offer without lines, then adds, edits, moves and removes lines one by one", async () => {
    offerA = (
      await api(app, sana)
        .post(`/inquiries/${inquiryId}/factory-quotes`, { newFactoryName: `Jiangsu Water ${tag}`, receivedOn: "2026-10-26", currency: "CNY" })
        .expect(201)
    ).body.id;
    // Enter, Enter, Enter
    let o: Offer = (await api(app, sana).post(`/factory-quotes/${offerA}/lines`, { lines: [{ description: "Bottling line", quantity: 1, unit: "set", unitPrice: 0 }] }).expect(201)).body;
    const line = o.lines[0]!.id;
    o = (await api(app, sana).post(`/factory-quotes/${offerA}/lines`, { lines: [{ description: "Shrink wrapper", quantity: 1, unit: "set", unitPrice: 60000 }], afterId: line }).expect(201)).body;
    // Parts under the line (pasted), placed under it even though "Shrink wrapper" comes after.
    o = (
      await api(app, sana)
        .post(`/factory-quotes/${offerA}/lines`, {
          parentId: line,
          lines: [
            { description: "Blow moulder", model: "CPET-6", quantity: 1, unit: "set", unitPrice: 520000 },
            { description: "Filler", model: "RFC-24", quantity: 1, unit: "set", unitPrice: 380000 },
          ],
        })
        .expect(201)
    ).body;
    expect(shape(o)).toEqual(["1 Bottling line", "1.1 Blow moulder [CPET-6]", "1.2 Filler [RFC-24]", "2 Shrink wrapper"]);
    // A pasted list with its own parts, at the end.
    o = (
      await api(app, sana)
        .post(`/factory-quotes/${offerA}/lines`, {
          lines: [
            { description: "Spare parts kit", quantity: 1, unit: "lot", unitPrice: 0 },
            { description: "Nozzles", quantity: 20, unit: "pcs", unitPrice: 50, partOf: 0 },
          ],
        })
        .expect(201)
    ).body;
    expect(shape(o).slice(-2)).toEqual(["3 Spare parts kit", "3.1 Nozzles"]);
    // Edit in place.
    const filler = o.lines.find((l) => l.description === "Filler")!;
    o = (await api(app, sana).patch(`/factory-lines/${filler.id}`, { model: "RFC-32", unitPrice: 395000 }).expect(200)).body;
    expect(o.lines.find((l) => l.id === filler.id)).toMatchObject({ model: "RFC-32", unitPrice: "395000.00" });
    // Move: the filler up, the shrink wrapper into the line above as a part, then out again.
    o = (await api(app, sana).post(`/factory-lines/${filler.id}/move`, { to: "up" }).expect(201)).body;
    expect(shape(o).slice(0, 3)).toEqual(["1 Bottling line", "1.1 Filler [RFC-32]", "1.2 Blow moulder [CPET-6]"]);
    const wrapper = o.lines.find((l) => l.description === "Shrink wrapper")!;
    o = (await api(app, sana).post(`/factory-lines/${wrapper.id}/move`, { to: "indent" }).expect(201)).body;
    expect(shape(o).slice(0, 4)).toEqual(["1 Bottling line", "1.1 Filler [RFC-32]", "1.2 Blow moulder [CPET-6]", "1.3 Shrink wrapper"]);
    await api(app, sana).post(`/factory-lines/${o.lines[0]!.id}/move`, { to: "indent" }).expect(400); // a line with parts
    o = (await api(app, sana).post(`/factory-lines/${filler.id}/move`, { to: "outdent" }).expect(201)).body;
    // The parts below it come with it, so nothing moves on screen.
    expect(shape(o).slice(0, 4)).toEqual(["1 Bottling line", "2 Filler [RFC-32]", "2.1 Blow moulder [CPET-6]", "2.2 Shrink wrapper"]);
    // Remove a line with its parts.
    o = (await api(app, sana).delete(`/factory-lines/${o.lines.find((l) => l.description === "Spare parts kit")!.id}`).expect(200)).body;
    expect(shape(o)).toEqual(["1 Bottling line", "2 Filler [RFC-32]", "2.1 Blow moulder [CPET-6]", "2.2 Shrink wrapper"]);
    // Only this deal's handler (or a manager) may change it.
    await api(app, bilal).patch(`/factory-lines/${filler.id}`, { unitPrice: 1 }).expect(404);
  });

  it("starts another factory's offer from the same lines and compares them product by product", async () => {
    offerB = (
      await api(app, sana)
        .post(`/inquiries/${inquiryId}/factory-quotes`, { newFactoryName: `Zhangjiagang ${tag}`, receivedOn: "2026-10-27", currency: "CNY" })
        .expect(201)
    ).body.id;
    let b: Offer = (await api(app, sana).post(`/factory-quotes/${offerB}/copy-lines`, { fromQuoteId: offerA }).expect(201)).body;
    const a: Offer = (await api(app, sana).get(`/factory-quotes/${offerA}`).expect(200)).body;
    expect(shape(b)).toEqual(["1 Bottling line", "2 Filler [RFC-32]", "2.1 Blow moulder [CPET-6]", "2.2 Shrink wrapper"]);
    expect(b.lines.every((l) => l.unitPrice === "0.00")).toBe(true);
    expect(b.lines.map((l) => l.productKey)).toEqual(a.lines.map((l) => l.productKey));
    // This factory's own model and price.
    const blow = b.lines.find((l) => l.description === "Blow moulder")!;
    b = (await api(app, sana).patch(`/factory-lines/${blow.id}`, { model: "ZJ-BM6", unitPrice: 495000 }).expect(200)).body;
    const s = (await api(app, sana).get(`/inquiries/${inquiryId}/sourcing`).expect(200)).body;
    const product = s.products.find((p: { description: string }) => p.description === "Blow moulder");
    expect(product.options.map((o: { model: string }) => o.model)).toEqual(["ZJ-BM6", "CPET-6"]);
    expect(product.cheapestLineId).toBe(blow.id);
    await api(app, sana).post(`/factory-quotes/${offerB}/copy-lines`, { fromQuoteId: offerB }).expect(400);
  });

  it("keeps the factory's quotation and screenshots on the offer, apart from the deal's documents", async () => {
    const file = (
      await request(app.getHttpServer())
        .post(`/api/inquiries/${inquiryId}/files`)
        .set("authorization", `Bearer ${sana}`)
        .field("kind", "factory_quote")
        .field("factoryQuoteId", offerA)
        .attach("file", Buffer.from("%PDF-1.4 factory quote"), { filename: "Jiangsu quote.pdf", contentType: "application/pdf" })
        .expect(201)
    ).body;
    const a: Offer = (await api(app, sana).get(`/factory-quotes/${offerA}`).expect(200)).body;
    expect(a.files.map((f) => `${f.kind} ${f.fileName}`)).toEqual(["factory_quote Jiangsu quote.pdf"]);
    // Not among the deal's documents (which can go to anyone working on the deal).
    const d = (await api(app, sana).get(`/inquiries/${inquiryId}`).expect(200)).body;
    expect(d.files ?? d.attachments ?? []).toEqual([]);
    await api(app, sana).get(`/files/${file.id}`).expect(200);
    await api(app, bilal).get(`/files/${file.id}`).expect(404);
    // An offer of another deal is refused.
    await request(app.getHttpServer())
      .post(`/api/inquiries/${inquiryId}/files`)
      .set("authorization", `Bearer ${sana}`)
      .field("factoryQuoteId", "00000000-0000-4000-8000-000000000000")
      .attach("file", Buffer.from("%PDF-1.4"), { filename: "x.pdf", contentType: "application/pdf" })
      .expect(400);
  });

  it("asks why before changing the price of a line a quotation uses; an offer without lines cannot be offered", async () => {
    const empty = (
      await api(app, sana)
        .post(`/inquiries/${inquiryId}/factory-quotes`, { newFactoryName: `Empty ${tag}`, receivedOn: "2026-10-27", currency: "CNY" })
        .expect(201)
    ).body.id;
    const offers = (await api(app, sana).get(`/inquiries/${inquiryId}/quotation/offers?currency=USD`).expect(200)).body;
    expect(offers.offers.map((o: { factoryQuoteId: string }) => o.factoryQuoteId)).not.toContain(empty);
    const draft = (await api(app, sana).get(`/inquiries/${inquiryId}/quotation/draft`).expect(200)).body;
    // Put a price on every line of the chosen offer, then save R1.
    const options = draft.options.map((o: { prices: { lineId: string; unitPrice: number }[] }) => ({ ...o, prices: o.prices.map((p) => ({ ...p, unitPrice: p.unitPrice || 100 })) }));
    await api(app, sana).post(`/inquiries/${inquiryId}/quotation/revisions`, { ...draft, options }).expect(201);
    const used = (await api(app, sana).get(`/factory-quotes/${draft.options[0].factoryQuoteId}`)).body.lines.find((l: Line) => l.description === "Blow moulder") as Line;
    const r = await api(app, sana).patch(`/factory-lines/${used.id}`, { unitPrice: 1 }).expect(409);
    expect(r.body.code).toBe("reason_needed");
    await api(app, sana).patch(`/factory-lines/${used.id}`, { model: "renamed" }).expect(200); // wording: quotations keep their own copy
    await api(app, sana).patch(`/factory-lines/${used.id}`, { unitPrice: 1, reason: "Factory corrected the price" }).expect(200);
    await api(app, sana).delete(`/factory-lines/${used.id}`).expect(409);
  });
});
