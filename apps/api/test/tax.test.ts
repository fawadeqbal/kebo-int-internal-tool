import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";

/** Tax is only on factory items: each item's tax % is added on top of its price. Sales carry no tax. */
describe("tax", () => {
  let app: INestApplication;
  let sana: string;
  let me: string;
  const tag = Date.now().toString(36);

  beforeAll(async () => {
    app = await startApp();
    sana = await signIn(app, "sana@example.com");
    me = (await api(app, sana).get("/auth/me")).body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  let n = 0;
  /** A deal with two items for a new customer in this country. */
  const deal = async (country: string) => {
    n += 1;
    const customer = (await api(app, sana).post("/customers", { name: `Tax ${country} ${tag} ${n}`, country, contacts: [{ name: "Li", email: `li-${n}-${tag}@tax.test` }] }).expect(201)).body;
    const inquiry = (await api(app, sana).post("/inquiries", { customerId: customer.id, category: "Machinery", assigneeId: me, items: [{ description: "Gear pump", quantity: 10 }, { description: "Spare seals", quantity: 10 }] }).expect(201)).body;
    const items = (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.items as { id: string }[];
    return { inquiryId: inquiry.id as string, items: items.map((i) => i.id) };
  };

  it("adds each factory item's own tax on top of its price (13% unless changed)", async () => {
    const { inquiryId, items } = await deal("NG");
    await api(app, sana)
      .post(`/inquiries/${inquiryId}/factory-quotes`, {
        newFactoryName: `Taizhou Pumps ${tag}`,
        receivedOn: "2026-10-20",
        currency: "CNY",
        lines: [
          { requestedItemId: items[0], description: "Gear pump", quantity: 10, unitPrice: 100 },
          { requestedItemId: items[1], description: "Spare seals", quantity: 10, unitPrice: 50, taxRate: 0 },
        ],
      })
      .expect(201);
    const q = (await api(app, sana).get(`/inquiries/${inquiryId}/sourcing`).expect(200)).body.quotes[0];
    expect(q).not.toHaveProperty("vatRate");
    expect(q.lines.map((l: { taxRate: number; costNote: string }) => [l.taxRate, l.costNote])).toEqual([
      [13, "CNY 100.00 + 13% tax = CNY 113.00"],
      [0, "CNY 50.00, no tax"],
    ]);
    expect(q.lines[0]).not.toHaveProperty("hsCode");
    expect(q.lines[0]).not.toHaveProperty("rebateRate");
  });

  it("quotes without tax: the total is the items less the discount, for any customer", async () => {
    const { inquiryId } = await deal("CN");
    const draft = (await api(app, sana).get(`/inquiries/${inquiryId}/quotation/draft`).expect(200)).body;
    expect(draft).not.toHaveProperty("vatRate");
    // No factory prices: the option is the customer's own items, priced by hand.
    const [pump, seals] = draft.options[0].prices.map((p: { lineId: string }) => p.lineId);
    const options = [{ ...draft.options[0], discount: 5, prices: [{ lineId: pump, unitPrice: 20 }, { lineId: seals, unitPrice: 0 }] }];
    const r = (await api(app, sana).post(`/inquiries/${inquiryId}/quotation/revisions`, { ...draft, vatRate: 13, options }).expect(201)).body;
    expect(r).toMatchObject({ subtotal: "200.00", discount: "5.00", total: "195.00" });
    expect(r).not.toHaveProperty("vatAmount");
  });

  it("has no export rebate or HS code pages any more", async () => {
    await api(app, sana).get("/hs-codes").expect(404);
  });
});
