import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";

type Line = { unitPrice: string; unitCost?: string | null };
type Option = {
  factoryQuoteId: string | null;
  leadDays: number | null;
  factoryValidUntil: string | null;
  factoryCurrency: string | null;
  offerChanged: { no: string; description: string; was: string; now: string | null }[];
  lines: Line[];
};
type Rev = { id: string; status: string; incoterm: string; incotermPlace: string | null; warrantyMonths: number | null; warrantyFrom: string | null; validUntil: string; options: Option[] };
type Page = { quotations: { id: string; letter: string; revisions: Rev[] }[] };

/**
 * Canvas "From the supplier offer to the quotation" (19 Nov): what a quotation takes from the supplier's offer —
 * the port, the warranty, its validity, the lead time with spare days, the cost less the export VAT refund — and
 * what it says when the offer's prices change after it was made.
 */
describe("from the supplier offer to the quotation", () => {
  let app: INestApplication;
  let sana: string;
  let admin: string;
  let inquiryId: string;
  let offerId: string;
  let offerLines: { id: string; parentId: string | null; description: string }[];
  let sales: Record<string, unknown>;
  const tag = Date.now().toString(36);
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const page = async () => (await api(app, sana).get(`/inquiries/${inquiryId}/quotation`).expect(200)).body as Page;

  beforeAll(async () => {
    app = await startApp();
    sana = await signIn(app, "sana@example.com");
    admin = await signIn(app, "admin@example.com", "Admin@12345");
    sales = (await api(app, admin).get("/settings").expect(200)).body.sales;
    // FOB by default, 30 days valid, 7 spare days; no export refund yet.
    await api(app, admin)
      .put("/settings/sales", { ...sales, defaultIncoterm: "FOB", quotationValidityDays: 30, leadSpareDays: 7, exportVatRefundPercent: 0, reason: "Test: offer to quotation" })
      .expect(200);
    const me = (await api(app, sana).get("/auth/me")).body.id;
    const customer = (await api(app, sana).post("/customers", { name: `Muscat Pharma ${tag}`, country: "OM", defaultCurrency: "USD", contacts: [{ name: "Hamad", email: `h-${tag}@mp.test` }] }).expect(201)).body;
    inquiryId = (
      await api(app, sana)
        .post("/inquiries", {
          customerId: customer.id,
          category: "Machinery",
          assigneeId: me,
          items: [
            { description: `Capsule filler ${tag}`, quantity: 1, unit: "set" },
            { description: "Change parts", quantity: 1, unit: "set" },
          ],
        })
        .expect(201)
    ).body.id;
    const items = (await api(app, sana).get(`/inquiries/${inquiryId}`)).body.items as { id: string }[];
    offerId = (
      await api(app, sana)
        .post(`/inquiries/${inquiryId}/factory-quotes`, {
          newFactoryName: `Ruian Capsule ${tag}`,
          receivedOn: day(-1),
          validUntil: day(20),
          currency: "USD",
          taxIncluded: false,
          taxRate: 13,
          basis: "FOB",
          basisPlace: "Shanghai",
          leadDays: 40,
          leadFrom: "after_payment",
          warrantyMonths: 18,
          warrantyFrom: "shipment",
          lines: [
            { requestedItemId: items[0]!.id, description: "Capsule filler NJP-800", quantity: 1, unitPrice: "10000.00", taxRate: 13 },
            { requestedItemId: items[1]!.id, description: "Change parts", quantity: 1, unitPrice: "1000.00", taxRate: 13 },
          ],
        })
        .expect(201)
    ).body.id as string;
    const sourcing = (await api(app, sana).get(`/inquiries/${inquiryId}/sourcing`).expect(200)).body;
    offerLines = sourcing.quotes.find((q: { id: string }) => q.id === offerId).lines;
  });

  afterAll(async () => {
    await api(app, admin)?.put("/settings/sales", { ...sales, reason: "Test: settings as they were" });
    await app?.close();
  });

  it("takes the offer's port, warranty and validity; the lead time gets the spare days", async () => {
    await api(app, sana).post(`/inquiries/${inquiryId}/quotations`, { offers: [offerId], currency: "USD", validUntil: day(30), margin: 20 }).expect(201);
    const a = (await page()).quotations.find((q) => q.letter === "A")!.revisions[0]!;
    // FOB at the supplier's end: its port is ours too.
    expect(a).toMatchObject({ incoterm: "FOB", incotermPlace: "Shanghai", warrantyMonths: 18, warrantyFrom: "shipment" });
    // Never valid longer than the supplier's prices.
    expect(a.validUntil).toBe(day(20));
    expect(a.options[0]).toMatchObject({ factoryQuoteId: offerId, leadDays: 47, factoryValidUntil: day(20), factoryCurrency: "USD", offerChanged: [] });
    // Cost with the 13% tax on top: 11,300 → at 20% on the price, 14,125.
    expect(a.options[0]!.lines.map((l) => l.unitPrice)).toEqual(["14125.00", "1412.50"]);
  });

  it("costs less by the export VAT refund set in Settings (never more than the tax)", async () => {
    await api(app, admin).put("/settings/sales", { ...sales, defaultIncoterm: "FOB", quotationValidityDays: 30, leadSpareDays: 7, exportVatRefundPercent: 13, reason: "Test: export refund" }).expect(200);
    const offers = (await api(app, sana).get(`/inquiries/${inquiryId}/quotation/offers?currency=USD`).expect(200)).body.offers as { factoryQuoteId: string; lines: { unitCost: string | null }[] }[];
    // 10,000 + 13% tax − 13% refund = 10,000.
    expect(offers.find((o) => o.factoryQuoteId === offerId)!.lines.map((l) => l.unitCost)).toEqual(["10000.00", "1000.00"]);
    await api(app, admin).put("/settings/sales", { ...sales, defaultIncoterm: "FOB", quotationValidityDays: 30, leadSpareDays: 7, exportVatRefundPercent: 0, reason: "Test: no refund" }).expect(200);
  });

  it("counts only items without a price: a part is priced in its item, an item in its parts", async () => {
    const items = (await api(app, sana).get(`/inquiries/${inquiryId}`)).body.items as { id: string }[];
    const other = (
      await api(app, sana)
        .post(`/inquiries/${inquiryId}/factory-quotes`, {
          newFactoryName: `Wenzhou Parts ${tag}`,
          receivedOn: day(-1),
          currency: "USD",
          lines: [
            { requestedItemId: items[0]!.id, description: "Capsule filler", quantity: 1, unitPrice: "9000.00", taxRate: 0 },
            { requestedItemId: items[1]!.id, description: "Change parts", quantity: 1, unitPrice: "0", taxRate: 0 },
          ],
        })
        .expect(201)
    ).body.id as string;
    const unpriced = async () =>
      ((await api(app, sana).get(`/inquiries/${inquiryId}/quotation/offers?currency=USD`).expect(200)).body.offers as { factoryQuoteId: string; unpriced: number }[]).find(
        (o) => o.factoryQuoteId === other,
      )!.unpriced;
    expect(await unpriced()).toBe(1);
    const lines = (await api(app, sana).get(`/inquiries/${inquiryId}/sourcing`).expect(200)).body.quotes.find((q: { id: string }) => q.id === other).lines as { id: string; description: string }[];
    const filler = lines.find((l) => l.description === "Capsule filler")!;
    const parts = lines.find((l) => l.description === "Change parts")!;
    // A part priced under the change parts: the item is priced in it.
    await api(app, sana).post(`/factory-quotes/${other}/lines`, { parentId: parts.id, lines: [{ description: "Size 0 set", quantity: 1, unitPrice: "800.00", taxRate: 0 }], reason: "Supplier sent the parts" }).expect(201);
    expect(await unpriced()).toBe(0);
    // A part with no price under a priced item: not missing (its item carries the price).
    await api(app, sana).post(`/factory-quotes/${other}/lines`, { parentId: filler.id, lines: [{ description: "Dust extractor", quantity: 1, unitPrice: "0", taxRate: 0 }], reason: "Supplier listed it" }).expect(201);
    expect(await unpriced()).toBe(0);
  });

  it("says when the offer's prices changed; a draft keeps its prices or is priced again at its margins", async () => {
    const draft = () => page().then((p) => p.quotations.find((q) => q.letter === "A")!.revisions[0]!);
    const filler = offerLines.find((l) => l.description === "Capsule filler NJP-800")!;
    // The supplier changes its price after the quotation was made.
    await api(app, sana).patch(`/factory-lines/${filler.id}`, { unitPrice: "11000.00", reason: "Supplier changed its price" }).expect(200);
    const changed = await draft();
    expect(changed.options[0]!.offerChanged).toEqual([{ no: "1", description: "Capsule filler NJP-800", was: "10000.00", now: "11000.00" }]);
    // Keep: the draft's prices stay; it is now on the offer as it is, so it says nothing more.
    await api(app, sana).post(`/revisions/${changed.id}/offer-prices`, { mode: "keep" }).expect(200);
    const kept = await draft();
    expect(kept.options[0]!.offerChanged).toEqual([]);
    expect(kept.options[0]!.lines.map((l) => l.unitPrice)).toEqual(["14125.00", "1412.50"]);
    // Again, then Update: priced at the margin it had (20% on the price), on the cost now.
    await api(app, sana).patch(`/factory-lines/${filler.id}`, { unitPrice: "12000.00", reason: "Supplier changed its price" }).expect(200);
    const again = await draft();
    expect(again.options[0]!.offerChanged).toEqual([{ no: "1", description: "Capsule filler NJP-800", was: "11000.00", now: "12000.00" }]);
    await api(app, sana).post(`/revisions/${again.id}/offer-prices`, { mode: "update" }).expect(200);
    const updated = await draft();
    expect(updated.options[0]!.offerChanged).toEqual([]);
    // 12,000 + 13% = 13,560; the margin it had on 12,430 (11,000 + 13%) for 14,125 was 12%: 13,560 ÷ 0.88.
    expect(updated.options[0]!.lines[0]!.unitPrice).toBe("15409.09");
    expect(updated.options[0]!.lines[1]!.unitPrice).toBe("1412.50");
  });
});
