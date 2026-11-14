import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";

/**
 * Reuse along the deal: a factory mostly offers on the same terms, so a new offer from it starts from
 * its last one (the latest received, on any inquiry). Only read here; the form fills and the person can
 * type over every field.
 */
describe("a factory's last offer", () => {
  let app: INestApplication;
  let sana: string;
  let inquiryId: string;
  let factoryId: string;
  const tag = Date.now().toString(36);

  beforeAll(async () => {
    app = await startApp();
    sana = await signIn(app, "sana@example.com");
    const me = (await api(app, sana).get("/auth/me")).body.id;
    const customer = (await api(app, sana).post("/customers", { name: `Last Offer Co ${tag}`, country: "NG", contacts: [{ name: "Ade", email: `lo-${tag}@lo.test` }] }).expect(201)).body;
    inquiryId = (await api(app, sana).post("/inquiries", { customerId: customer.id, category: "Machinery", assigneeId: me, requirements: `Juice line ${tag}` }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("is nothing for a factory that has not offered yet", async () => {
    const f = (await api(app, sana).post("/factories", { name: `Quiet Factory ${tag}` }).expect(201)).body;
    const res = await api(app, sana).get(`/factories/${f.id}/last-offer`).expect(200);
    expect(res.body).toEqual({ offer: null });
  });

  it("gives the terms of the offer received last", async () => {
    const first = (
      await api(app, sana)
        .post(`/inquiries/${inquiryId}/factory-quotes`, {
          newFactoryName: `Jiangsu Filling ${tag}`,
          receivedOn: "2026-10-01",
          currency: "CNY",
          basis: "EXW",
          basisPlace: "Zhangjiagang",
          taxIncluded: false,
          taxRate: "0",
          leadTime: "60 days",
        })
        .expect(201)
    ).body;
    factoryId = first.factoryId;
    await api(app, sana)
      .post(`/inquiries/${inquiryId}/factory-quotes`, {
        factoryId,
        receivedOn: "2026-10-12",
        currency: "USD",
        basis: "FOB",
        basisPlace: "Shanghai",
        taxIncluded: true,
        taxRate: "13",
        leadTime: "45 days",
        moq: "1 set",
        paymentTerms: "30% T/T advance, 70% before shipment",
        advancePercent: "30",
        warranty: "12 months",
        notes: "Only for this inquiry",
      })
      .expect(201);
    const { offer } = (await api(app, sana).get(`/factories/${factoryId}/last-offer`).expect(200)).body;
    expect(offer).toMatchObject({
      receivedOn: "2026-10-12",
      currency: "USD",
      basis: "FOB",
      basisPlace: "Shanghai",
      taxIncluded: true,
      taxRate: 13,
      leadTime: "45 days",
      paymentTerms: "30% T/T advance, 70% before shipment",
      advancePercent: 30,
      warranty: "12 months",
    });
    expect(offer.inquiryRef).toMatch(/\S/);
    // What belongs to that one offer is not handed on.
    expect(offer).not.toHaveProperty("notes");
    expect(offer).not.toHaveProperty("reference");
    expect(offer).not.toHaveProperty("validUntil");
  });

  it("forgets an offer that was removed", async () => {
    const view = (await api(app, sana).get(`/inquiries/${inquiryId}/sourcing`).expect(200)).body as { quotes: { id: string; currency: string; factory: { id: string } }[] };
    const latest = view.quotes.find((q) => q.factory.id === factoryId && q.currency === "USD")!;
    await api(app, sana).delete(`/factory-quotes/${latest.id}?reason=${encodeURIComponent("Entered twice")}`).expect(200);
    const { offer } = (await api(app, sana).get(`/factories/${factoryId}/last-offer`).expect(200)).body;
    expect(offer).toMatchObject({ receivedOn: "2026-10-01", currency: "CNY", basis: "EXW", basisPlace: "Zhangjiagang", leadTime: "60 days" });
  });

  it("is only for people who see factory prices", async () => {
    await api(app, "").get(`/factories/${factoryId}/last-offer`).expect(401);
    await api(app, sana).get(`/factories/not-an-id/last-offer`).expect(400);
  });
});
