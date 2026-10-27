import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";

/**
 * Step 3: a factory's price basis (EXW, FOB…) and the costs between it and
 * the basis we sell on, part of each option's cost so the margin is true.
 */
describe("factory price basis", () => {
  let app: INestApplication;
  let sana: string;
  let inquiryId: string;
  let exw: string;
  let cfr: string;
  let revisionId: string;
  const tag = Date.now().toString(36);

  beforeAll(async () => {
    app = await startApp();
    sana = await signIn(app, "sana@example.com");
    const me = (await api(app, sana).get("/auth/me")).body.id;
    const customer = (
      await api(app, sana)
        .post("/customers", { name: `Lagos Agro ${tag}`, country: "NG", contacts: [{ name: "Ola", email: `o-${tag}@la.test` }] })
        .expect(201)
    ).body;
    inquiryId = (
      await api(app, sana).post("/inquiries", { customerId: customer.id, category: "Machinery", assigneeId: me, requirements: "Maize sheller" }).expect(201)
    ).body.id;
    const offer = async (name: string, basis: string | null, basisPlace: string | null, price: number) => {
      const q = (
        await api(app, sana)
          .post(`/inquiries/${inquiryId}/factory-quotes`, { newFactoryName: `${name} ${tag}`, receivedOn: "2026-10-26", currency: "CNY", basis, basisPlace })
          .expect(201)
      ).body.id;
      await api(app, sana)
        .post(`/factory-quotes/${q}/lines`, { lines: [{ description: "Maize sheller 5 t/h", quantity: 1, unit: "set", unitPrice: price, taxRate: 0 }] })
        .expect(201);
      return q;
    };
    exw = await offer("Henan Agri", "EXW", "Zhengzhou", 71000);
    cfr = await offer("Shandong Agri", "CFR", "Lagos", 85200);
  });

  afterAll(async () => {
    await app?.close();
  });

  it("keeps each offer's basis and place", async () => {
    const s = (await api(app, sana).get(`/inquiries/${inquiryId}/sourcing`).expect(200)).body;
    expect(s.quotes.find((q: { id: string }) => q.id === exw)).toMatchObject({ basis: "EXW", basisPlace: "Zhengzhou" });
    const offers = (await api(app, sana).get(`/inquiries/${inquiryId}/quotation/offers?currency=USD`).expect(200)).body;
    expect(offers.offers.find((o: { factoryQuoteId: string }) => o.factoryQuoteId === cfr)).toMatchObject({ basis: "CFR", basisPlace: "Lagos" });
    await api(app, sana).put(`/factory-quotes/${exw}`, { newFactoryName: `Henan Agri ${tag}`, receivedOn: "2026-10-26", currency: "CNY", basis: "XYZ" }).expect(422);
  });

  it("adds the costs to reach the basis we sell on, in any currency, to the option's cost", async () => {
    const draft = (await api(app, sana).get(`/inquiries/${inquiryId}/quotation/draft`).expect(200)).body;
    const offers = (await api(app, sana).get(`/inquiries/${inquiryId}/quotation/offers?currency=USD`).expect(200)).body;
    const lineOf = (q: string) => offers.offers.find((o: { factoryQuoteId: string }) => o.factoryQuoteId === q).lines[0].id;
    const body = {
      ...draft,
      incoterm: "CFR",
      incotermPlace: "Lagos",
      options: [
        {
          factoryQuoteId: exw,
          discount: 0,
          prices: [{ lineId: lineOf(exw), unitPrice: 14000 }],
          charges: [],
          costs: [
            { step: "to_port", amount: 3550, currency: "CNY", note: "Truck to Qingdao" },
            { step: "freight", amount: 2500, currency: "USD" },
          ],
        },
        { factoryQuoteId: cfr, discount: 0, prices: [{ lineId: lineOf(cfr), unitPrice: 14000 }], charges: [] },
      ],
    };
    // A currency without a rate cannot be turned into USD.
    const bad = structuredClone(body);
    bad.options[0].costs[1].currency = "PKR";
    expect((await api(app, sana).post(`/inquiries/${inquiryId}/quotation/revisions`, bad).expect(400)).body.error).toMatch(
      /^Option A: there is no exchange rate for PKR in Settings/,
    );
    const r = (await api(app, sana).post(`/inquiries/${inquiryId}/quotation/revisions`, body).expect(201)).body;
    revisionId = r.id;
    const [a, b] = r.options;
    // EXW → CFR: to the port and sea freight; CNY 3,550 at 7.1 = USD 500.
    expect(a).toMatchObject({ factoryBasis: "EXW", factoryBasisPlace: "Zhengzhou", gap: { needed: ["to_port", "freight"], extra: [] } });
    expect(a.costs).toEqual([
      { step: "to_port", amount: "3550.00", currency: "CNY", cost: "500.00", note: "Truck to Qingdao" },
      { step: "freight", amount: "2500.00", currency: "USD", cost: "2500.00", note: null },
    ]);
    // Factory 71,000 / 7.1 = 10,000 + 3,000 to reach CFR = 13,000 against 14,000 sold.
    expect(a.costing).toMatchObject({ cost: "13000.00", extraCost: "3000.00", sales: "14000.00", profit: "1000.00", marginPercent: 7.1 });
    // The CFR factory already pays the freight: nothing to add.
    expect(b).toMatchObject({ factoryBasis: "CFR", gap: { needed: [], extra: [] }, costs: [] });
    expect(b.costing).toMatchObject({ cost: "12000.00", extraCost: "0.00" });
  });

  it("carries the costs into the next revision, and says when a factory's price pays for more than we sell", async () => {
    await api(app, sana).post(`/revisions/${revisionId}/status`, { to: "sent" }).expect(200);
    const next = (await api(app, sana).get(`/inquiries/${inquiryId}/quotation/draft`).expect(200)).body;
    expect(next.options[0].costs).toEqual([
      { step: "to_port", amount: 3550, currency: "CNY", note: "Truck to Qingdao" },
      { step: "freight", amount: 2500, currency: "USD", note: null },
    ]);
    // Selling FOB now: the CFR factory's price includes freight we do not sell.
    const r2 = (
      await api(app, sana)
        .post(`/inquiries/${inquiryId}/quotation/revisions`, {
          ...next,
          incoterm: "FOB",
          incotermPlace: "Qingdao",
          options: [next.options[0], next.options[1]].map((o: { costs: { step: string }[] }) => ({ ...o, costs: o.costs.filter((c) => c.step === "to_port") })),
          reason: "Customer asked for FOB",
        })
        .expect(201)
    ).body;
    expect(r2.options[0].gap).toEqual({ needed: ["to_port"], extra: [] });
    expect(r2.options[1].gap).toEqual({ needed: [], extra: ["freight"] });
  });
});
