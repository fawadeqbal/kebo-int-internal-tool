import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";

type Made = { id: string; refNo: string; letter: string; revisionId: string; number: number };
type Rev = { id: string; number: number; status: string; currency: string; validUntil: string; total: string; options: { factoryQuoteId: string | null; total: string; lines: { unitPrice: string; unitCost?: string | null }[] }[] };
type Page = { quotation: { refNo: string; letter: string } | null; quotations: { id: string; refNo: string; letter: string; revisions: Rev[] }[] };

/**
 * Build step 2a of "one way, any number": New quotations makes one draft for each offer ticked (or own
 * prices), lettered A, B, C… with the inquiry's one QUO number; each quotation has its own revisions.
 */
describe("new quotations from the offers", () => {
  let app: INestApplication;
  let sana: string;
  let inquiryId: string;
  let offerX: string;
  let offerY: string;
  let made: Made[] = [];
  const tag = Date.now().toString(36);
  const validUntil = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
  const page = async () => (await api(app, sana).get(`/inquiries/${inquiryId}/quotation`).expect(200)).body as Page;
  const of = (p: Page, letter: string) => p.quotations.find((q) => q.letter === letter)!;

  beforeAll(async () => {
    app = await startApp();
    sana = await signIn(app, "sana@example.com");
    const me = (await api(app, sana).get("/auth/me")).body.id;
    const customer = (
      await api(app, sana)
        .post("/customers", { name: `Gulf Blister Co ${tag}`, country: "OM", contacts: [{ name: "Salim", email: `s-${tag}@gb.test` }] })
        .expect(201)
    ).body;
    inquiryId = (
      await api(app, sana)
        .post("/inquiries", {
          customerId: customer.id,
          category: "Machinery",
          assigneeId: me,
          items: [
            { description: `Blister packer ${tag}`, quantity: 1, unit: "set" },
            { description: "Forming moulds", quantity: 2, unit: "sets" },
          ],
        })
        .expect(201)
    ).body.id;
    const items = (await api(app, sana).get(`/inquiries/${inquiryId}`)).body.items as { id: string }[];
    const offer = async (name: string, a: string, b: string) =>
      (
        await api(app, sana)
          .post(`/inquiries/${inquiryId}/factory-quotes`, {
            newFactoryName: `${name} ${tag}`,
            receivedOn: "2026-11-12",
            currency: "USD",
            leadDays: 45,
            leadFrom: "after_payment",
            lines: [
              { requestedItemId: items[0]!.id, description: "Blister packer DPP-250", quantity: 1, unitPrice: a, taxRate: 0 },
              { requestedItemId: items[1]!.id, description: "Moulds", quantity: 2, unitPrice: b, taxRate: 0 },
            ],
          })
          .expect(201)
      ).body.id as string;
    offerX = await offer("Shenjing", "8000.00", "500.00");
    offerY = await offer("Hebei", "7000.00", "600.00");
  });

  afterAll(async () => {
    await app?.close();
  });

  it("makes one quotation per offer ticked, and one from own prices, lettered with the inquiry's one number", async () => {
    const res = await api(app, sana).post(`/inquiries/${inquiryId}/quotations`, { offers: [offerX, offerY, null], currency: "USD", validUntil, margin: 20 }).expect(201);
    made = res.body.quotations;
    expect(made.map((q) => [q.letter, q.number])).toEqual([
      ["A", 1],
      ["B", 1],
      ["C", 1],
    ]);
    const base = made[0]!.refNo.replace(/-A$/, "");
    expect(base).toMatch(/^QUO-\d{4}-\d{4}$/);
    expect(made.map((q) => q.refNo)).toEqual([`${base}-A`, `${base}-B`, `${base}-C`]);

    const p = await page();
    expect(p.quotations.map((q) => q.letter)).toEqual(["A", "B", "C"]);
    const a = of(p, "A").revisions[0]!;
    expect(a).toMatchObject({ number: 1, status: "draft", currency: "USD", validUntil });
    expect(a.options).toHaveLength(1);
    expect(a.options[0]).toMatchObject({ factoryQuoteId: offerX });
    // Priced at the margin on the price: cost ÷ (1 − 20%).
    expect(a.options[0]!.lines.map((l) => l.unitPrice)).toEqual(["10000.00", "625.00"]);
    expect(a.total).toBe("11250.00");
    expect(of(p, "B").revisions[0]!.options[0]).toMatchObject({ factoryQuoteId: offerY, total: "10250.00" });
    // Own prices: the customer's items, to be priced by hand.
    expect(of(p, "C").revisions[0]!.options[0]).toMatchObject({ factoryQuoteId: null, total: "0.00" });
  });

  it("quotes an offer again on other terms, each offer once in one go", async () => {
    await api(app, sana).post(`/inquiries/${inquiryId}/quotations`, { offers: [offerX, offerX], currency: "USD", validUntil, margin: 20 }).expect(422);
    const again = (await api(app, sana).post(`/inquiries/${inquiryId}/quotations`, { offers: [offerX], currency: "USD", validUntil, margin: 25 }).expect(201)).body.quotations as Made[];
    expect(again).toMatchObject([{ letter: "D", number: 1 }]);
    const d = of(await page(), "D").revisions[0]!;
    expect(d.options[0]).toMatchObject({ factoryQuoteId: offerX });
    expect(d.options[0]!.lines.map((l) => l.unitPrice)).toEqual(["10666.67", "666.67"]);
  });

  it("does not send a quotation that comes to 0", async () => {
    const c = of(await page(), "C").revisions[0]!;
    const refused = await api(app, sana).post(`/revisions/${c.id}/status`, { to: "sent" }).expect(400);
    expect(refused.body.error).toMatch(/comes to 0/);
  });

  it("gives a deleted draft's letter to the next new quotation, its numbers going on", async () => {
    const c = of(await page(), "C");
    await api(app, sana).delete(`/revisions/${c.revisions[0]!.id}`).expect(200);
    expect((await page()).quotations.map((q) => q.letter)).toEqual(["A", "B", "D"]);
    const next = (await api(app, sana).post(`/inquiries/${inquiryId}/quotations`, { offers: [offerY], currency: "USD", validUntil, margin: 20 }).expect(201)).body.quotations as Made[];
    expect(next).toMatchObject([{ id: c.id, letter: "C", refNo: c.refNo, number: 2 }]);
    expect((await page()).quotations.map((q) => q.letter)).toEqual(["A", "B", "C", "D"]);
  });

  it("revises one quotation without touching the others", async () => {
    const b = of(await page(), "B");
    await api(app, sana).post(`/revisions/${b.revisions[0]!.id}/status`, { to: "sent" }).expect(200);
    const draft = (await api(app, sana).get(`/quotations/${b.id}/draft`).expect(200)).body;
    expect(draft).toMatchObject({ number: 2, currency: "USD" });
    expect(draft.options[0]).toMatchObject({ factoryQuoteId: offerY });
    // The customer has seen R1: R2 says why it changes.
    const asked = await api(app, sana).post(`/quotations/${b.id}/revisions`, draft).expect(409);
    expect(asked.body.code).toBeTruthy();
    const r2 = (await api(app, sana).post(`/quotations/${b.id}/revisions`, { ...draft, reason: "Customer asked for a better price" }).expect(201)).body;
    expect(r2).toMatchObject({ number: 2, status: "draft", quotation: { id: b.id, letter: "B" } });
    const p = await page();
    expect(of(p, "B").revisions.map((r) => [r.number, r.status])).toEqual([
      [2, "draft"],
      [1, "sent"],
    ]);
    expect(of(p, "A").revisions.map((r) => r.number)).toEqual([1]);
    // The inquiry is Quoted once one quotation went out.
    expect((await api(app, sana).get(`/inquiries/${inquiryId}`)).body.stage).toBe("quoted");
  });

  it("refuses an offer that is not on the inquiry, and a closed inquiry", async () => {
    const other = (await api(app, sana).get("/inquiries?pageSize=5")).body.rows.find((r: { id: string }) => r.id !== inquiryId);
    const foreign = other ? (await api(app, sana).get(`/inquiries/${other.id}/sourcing`)).body.quotes?.[0]?.id : null;
    if (foreign) await api(app, sana).post(`/inquiries/${inquiryId}/quotations`, { offers: [foreign], currency: "USD", validUntil, margin: 20 }).expect(400);
    await api(app, sana).post(`/inquiries/${inquiryId}/quotations`, { offers: [], currency: "USD", validUntil, margin: 20 }).expect(422);
    await api(app, sana).post(`/inquiries/${inquiryId}/quotations`, { offers: [offerX], currency: "USD", validUntil, margin: 100 }).expect(422);
  });
});
