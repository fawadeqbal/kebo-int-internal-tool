import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";

/**
 * Two things an offer and a quotation keep: the warranty (the factory's on its offer, ours on the quotation,
 * starting from Settings), and how a quotation went to the customer (email, WhatsApp, WeChat…).
 */
describe("warranty and how a quotation was sent", () => {
  let app: INestApplication;
  let sana: string;
  let inquiryId: string;
  let offerId: string;
  let revisionId: string;
  const tag = Date.now().toString(36);

  beforeAll(async () => {
    app = await startApp();
    sana = await signIn(app, "sana@example.com");
    const me = (await api(app, sana).get("/auth/me")).body.id;
    const customer = (
      await api(app, sana)
        .post("/customers", { name: `Accra Water ${tag}`, country: "GH", contacts: [{ name: "Kofi", email: `k-${tag}@aw.test` }] })
        .expect(201)
    ).body;
    inquiryId = (
      await api(app, sana)
        .post("/inquiries", { customerId: customer.id, category: "Machinery", assigneeId: me, items: [{ description: "Filling line", quantity: 1, unit: "set" }] })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  const offer = async () => (await api(app, sana).get(`/inquiries/${inquiryId}/sourcing`).expect(200)).body.quotes.find((q: { id: string }) => q.id === offerId);

  it("keeps the factory's warranty on its offer, and leaves it alone when a save does not say it", async () => {
    const [item] = (await api(app, sana).get(`/inquiries/${inquiryId}`)).body.items as { id: string }[];
    const body = {
      newFactoryName: `Jiangsu Fill ${tag}`,
      receivedOn: "2026-11-10",
      currency: "CNY",
      warranty: "18 months from shipment",
      lines: [{ requestedItemId: item!.id, description: "Filling line", quantity: 1, unit: "set", unitPrice: 200000 }],
    };
    offerId = (await api(app, sana).post(`/inquiries/${inquiryId}/factory-quotes`, body).expect(201)).body.id;
    const q = await offer();
    expect(q.warranty).toBe("18 months from shipment");
    // A save that does not carry the warranty (an older form) keeps it.
    await api(app, sana).put(`/factory-quotes/${offerId}`, { factoryId: q.factory.id, receivedOn: q.receivedOn, currency: q.currency, leadTime: "40 days", reason: "Lead time came" }).expect(200);
    expect((await offer()).warranty).toBe("18 months from shipment");
    // An empty one clears it.
    await api(app, sana).put(`/factory-quotes/${offerId}`, { factoryId: q.factory.id, receivedOn: q.receivedOn, currency: q.currency, leadTime: "40 days", warranty: null, reason: "They gave none" }).expect(200);
    expect((await offer()).warranty).toBeNull();
    // Too long is refused.
    await api(app, sana).put(`/factory-quotes/${offerId}`, { factoryId: q.factory.id, receivedOn: q.receivedOn, currency: q.currency, warranty: "x".repeat(301), reason: "Too long" }).expect(422);
  });

  it("starts a quotation with the company's warranty, and keeps the one written for it", async () => {
    const draft = (await api(app, sana).get(`/inquiries/${inquiryId}/quotation/draft`).expect(200)).body;
    // From Settings, without a leading "Warranty:" (the print adds the word).
    expect(typeof draft.warranty === "string" || draft.warranty === null).toBe(true);
    if (draft.warranty) expect(/^warranty\s*:/i.test(draft.warranty)).toBe(false);
    revisionId = (await api(app, sana).post(`/inquiries/${inquiryId}/quotation/revisions`, { ...draft, warranty: "24 months, parts only" }).expect(201)).body.id;
    const view = (await api(app, sana).get(`/inquiries/${inquiryId}/quotation`).expect(200)).body;
    expect(view.revisions[0].warranty).toBe("24 months, parts only");
    expect(view.revisions[0].sentVia).toBeNull();
    // The print reads the same line; the editor gets it back.
    expect((await api(app, sana).get(`/revisions/${revisionId}`).expect(200)).body.warranty).toBe("24 months, parts only");
    const values = (await api(app, sana).get(`/revisions/${revisionId}/values`).expect(200)).body;
    expect(values.warranty).toBe("24 months, parts only");
    // A save without it keeps it.
    const { warranty: _left, ...rest } = values;
    void _left;
    await api(app, sana).put(`/revisions/${revisionId}`, rest).expect(200);
    expect((await api(app, sana).get(`/revisions/${revisionId}/values`).expect(200)).body.warranty).toBe("24 months, parts only");
  });

  it("keeps how the quotation went to the customer", async () => {
    // A way we do not know is refused.
    await api(app, sana).post(`/revisions/${revisionId}/status`, { to: "sent", via: "pigeon" }).expect(422);
    await api(app, sana).post(`/revisions/${revisionId}/status`, { to: "sent", via: "wechat" }).expect(200);
    const view = (await api(app, sana).get(`/inquiries/${inquiryId}/quotation`).expect(200)).body;
    expect(view.revisions[0].status).toBe("sent");
    expect(view.revisions[0].sentVia).toBe("wechat");
    // The accepted order still prints the quotation's warranty, not the company's usual one.
    const optionId = view.revisions[0].options[0].id;
    await api(app, sana).post(`/revisions/${revisionId}/status`, { to: "accepted", optionId }).expect(200);
    const after = (await api(app, sana).get(`/inquiries/${inquiryId}/quotation`).expect(200)).body;
    expect(after.revisions[0].sentVia).toBe("wechat");
    expect(after.revisions[0].warranty).toBe("24 months, parts only");
  });
});
