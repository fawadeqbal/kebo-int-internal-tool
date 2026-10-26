import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";

/**
 * Tax, one rule: prices are without tax and the tax % is added on top. The
 * product (HS code) decides the export rebate; the customer's country the tax on the sale.
 */
describe("tax", () => {
  let app: INestApplication;
  let sana: string;
  let me: string;
  const tag = Date.now().toString(36);
  const hs = `9${String(Date.now()).slice(-7)}`; // a code no other run has used

  beforeAll(async () => {
    app = await startApp();
    sana = await signIn(app, "sana@example.com");
    me = (await api(app, sana).get("/auth/me")).body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  /** A deal with one item for a new customer in this country. */
  let n = 0;
  const deal = async (country: string) => {
    n += 1;
    const customer = (await api(app, sana).post("/customers", { name: `Tax ${country} ${tag} ${n}`, country, contacts: [{ name: "Li", email: `li-${n}-${tag}@tax.test` }] }).expect(201)).body;
    const inquiry = (await api(app, sana).post("/inquiries", { customerId: customer.id, category: "Machinery", assigneeId: me, items: [{ description: "Gear pump", quantity: 10 }] }).expect(201)).body;
    const item = (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.items[0];
    return { inquiryId: inquiry.id as string, itemId: item.id as string };
  };

  const price = (itemId: string, over: Record<string, unknown> = {}, line: Record<string, unknown> = {}) => ({
    newFactoryName: `Taizhou Pumps ${tag}`,
    receivedOn: "2026-10-20",
    currency: "CNY",
    vatRate: 13,
    ...over,
    lines: [{ requestedItemId: itemId, description: "Gear pump", hsCode: ` ${hs} `, quantity: 10, unitPrice: 100, rebateRate: 13, ...line }],
  });

  it("adds 13% tax on top of a factory price unless changed, and asks the rebate for each item", async () => {
    const { inquiryId, itemId } = await deal("NG");
    const { vatRate: _, ...noVat } = price(itemId, {}, { hsCode: null });
    await api(app, sana).post(`/inquiries/${inquiryId}/factory-quotes`, noVat).expect(201);
    expect((await api(app, sana).get(`/inquiries/${inquiryId}/sourcing`)).body.quotes[0].vatRate).toBe(13);
    const b = await api(app, sana).post(`/inquiries/${inquiryId}/factory-quotes`, price(itemId, {}, { rebateRate: "" })).expect(422);
    expect(JSON.stringify(b.body)).toMatch(/Choose the export rebate for this item/);
  });

  it("explains each factory price in words and remembers the rebate by HS code", async () => {
    const { inquiryId, itemId } = await deal("NG");
    expect((await api(app, sana).get(`/hs-codes/${hs}`).expect(200)).body).toEqual({ code: null }); // first time
    await api(app, sana).post(`/inquiries/${inquiryId}/factory-quotes`, price(itemId)).expect(201);
    const s = (await api(app, sana).get(`/inquiries/${inquiryId}/sourcing`).expect(200)).body;
    expect(s.quotes[0].vatRate).toBe(13);
    expect(s.quotes[0].lines[0]).toMatchObject({ hsCode: hs, rebateRate: 13, rebateBack: 13, costNote: "CNY 100.00 + 13% tax = CNY 113.00 · 13% rebate back · your cost CNY 100.00" });
    expect((await api(app, sana).get(`/hs-codes/${hs}`).expect(200)).body).toMatchObject({ code: hs, rebateRate: 13 });

    // The official rate changes: one edit; prices already entered keep theirs.
    const saved = (await api(app, sana).put(`/hs-codes/${hs}`, { rebateRate: 9, description: "Gear pumps" }).expect(200)).body;
    expect(saved).toMatchObject({ code: hs, rebateRate: 9, description: "Gear pumps" });
    expect((await api(app, sana).get(`/hs-codes?q=${hs}`).expect(200)).body).toEqual([expect.objectContaining({ code: hs, rebateRate: 9, updatedBy: expect.objectContaining({ id: me }) })]);
    expect((await api(app, sana).get(`/inquiries/${inquiryId}/sourcing`)).body.quotes[0].lines[0].rebateRate).toBe(13);
    await api(app, sana).put("/hs-codes/abc", { rebateRate: 9 }).expect(400);
  });

  it("gives no rebate without tax, and at most the tax", async () => {
    const { inquiryId, itemId } = await deal("NG");
    await api(app, sana).post(`/inquiries/${inquiryId}/factory-quotes`, price(itemId, { vatRate: 0 })).expect(201);
    await api(app, sana).post(`/inquiries/${inquiryId}/factory-quotes`, price(itemId, { vatRate: 3, newFactoryName: `Small Works ${tag}` })).expect(201);
    const lines = (await api(app, sana).get(`/inquiries/${inquiryId}/sourcing`)).body.quotes.map((q: { lines: unknown[] }) => q.lines[0]);
    const notes = lines.map((l: { costNote: string }) => l.costNote).sort();
    expect(notes).toEqual(["CNY 100.00 + 3% tax = CNY 103.00 · 3% rebate back · your cost CNY 100.00", "CNY 100.00, no tax · your cost CNY 100.00"]);
  });

  it("charges VAT on the sale only to a customer in China", async () => {
    const exportDeal = await deal("AE");
    const domestic = await deal("CN");
    expect((await api(app, sana).get(`/inquiries/${exportDeal.inquiryId}/quotation/draft`).expect(200)).body.vatRate).toBe(0);
    expect((await api(app, sana).get(`/inquiries/${domestic.inquiryId}/quotation/draft`).expect(200)).body.vatRate).toBe(13);
  });
});
