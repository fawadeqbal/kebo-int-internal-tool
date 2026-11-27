import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";

/**
 * A phone app installed before "factory" became "supplier" in the API's field names (27 Nov 2026) still
 * sends `factoryId` and reads `factoryTotal`. It is known by Dart's own user agent; the API reads its
 * old names as the new ones and answers with both (src/common/names/old-names.ts).
 */
describe("a phone app from before the rename keeps working", () => {
  let app: INestApplication;
  let sana: string;
  let inquiryId: string;
  let itemId: string;
  let ruian: string;
  let wenling: string;
  const tag = Date.now().toString(36);
  const DART = "Dart/3.5 (dart:io)";
  /** The old phone app: Dart's user agent, the old names. */
  const phone = (method: "get" | "post", url: string, body?: object) => {
    const r = request(app.getHttpServer())[method](`/api${url}`).set("authorization", `Bearer ${sana}`).set("user-agent", DART);
    return body ? r.send(body) : r;
  };

  beforeAll(async () => {
    app = await startApp();
    sana = await signIn(app, "sana@example.com");
    const me = (await api(app, sana).get("/auth/me")).body.id;
    const customer = (
      await api(app, sana)
        .post("/customers", { name: `Okara Mills ${tag}`, country: "PK", contacts: [{ name: "Imran", email: `imran-${tag}@om.test` }] })
        .expect(201)
    ).body;
    const inquiry = (
      await api(app, sana)
        .post("/inquiries", {
          customerId: customer.id,
          category: "Machinery",
          assigneeId: me,
          items: [{ description: "Flour sifter", quantity: 1 }],
        })
        .expect(201)
    ).body;
    inquiryId = inquiry.id;
    itemId = (await api(app, sana).get(`/inquiries/${inquiryId}`)).body.items[0].id;
    ruian = (
      await api(app, sana)
        .post("/factories", { name: `Ruian Sift ${tag}` })
        .expect(201)
    ).body.id;
    wenling = (
      await api(app, sana)
        .post("/factories", { name: `Wenling Mesh ${tag}` })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("asks suppliers for prices with the old field name", async () => {
    await phone("post", `/inquiries/${inquiryId}/factory-requests`, { factoryIds: [ruian, wenling], channel: "wechat" }).expect(201);
    const list = (await phone("get", `/inquiries/${inquiryId}/factory-requests`).expect(200)).body;
    expect((list.items as { factory: { id: string } }[]).map((r) => r.factory.id).sort()).toEqual([ruian, wenling].sort());
  });

  it("records an offer with the old field name, and reads the old names back beside the new", async () => {
    const day = new Date().toISOString().slice(0, 10);
    const made = (
      await phone("post", `/inquiries/${inquiryId}/factory-quotes`, {
        factoryId: ruian,
        receivedOn: day,
        currency: "CNY",
        lines: [{ requestedItemId: itemId, description: "Flour sifter", quantity: 1, unit: "set", unitPrice: 42000 }],
      }).expect(201)
    ).body;
    // The offer is that supplier's: the old name went in as the new one.
    const sourcing = (await phone("get", `/inquiries/${inquiryId}/sourcing`).expect(200)).body;
    const offer = (sourcing.quotes as { id: string; factory: { id: string }; supplierTotal: string; factoryTotal: string }[]).find(
      (q) => q.id === made.id,
    )!;
    expect(offer.factory.id).toBe(ruian);
    // And the answer says the total both ways, with the same value.
    expect(offer.supplierTotal).toBe("42000.00");
    expect(offer.factoryTotal).toBe(offer.supplierTotal);
    const list = (await phone("get", `/inquiries/${inquiryId}/factory-requests`).expect(200)).body;
    const asked = (list.items as { factory: { id: string }; supplierQuoteId: string | null; factoryQuoteId: string | null }[]).find(
      (r) => r.factory.id === ruian,
    )!;
    expect(asked.supplierQuoteId).toBe(made.id);
    expect(asked.factoryQuoteId).toBe(made.id);
  });

  it("is told apart from the web: without Dart's user agent the old name is not a field", async () => {
    const res = await api(app, sana).post(`/inquiries/${inquiryId}/factory-requests`, { factoryIds: [ruian] });
    expect(res.status).toBe(422);
    // And the web's answers carry the new names only.
    const sourcing = (await api(app, sana).get(`/inquiries/${inquiryId}/sourcing`).expect(200)).body;
    const offer = (sourcing.quotes as Record<string, unknown>[])[0]!;
    expect(offer.supplierTotal).toBe("42000.00");
    expect("factoryTotal" in offer).toBe(false);
  });

  it("a newer phone app that says it knows the new names is treated like the web", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/inquiries/${inquiryId}/sourcing`)
      .set("authorization", `Bearer ${sana}`)
      .set("user-agent", DART)
      .set("x-names", "supplier")
      .expect(200);
    expect("factoryTotal" in (res.body.quotes as Record<string, unknown>[])[0]!).toBe(false);
  });
});
