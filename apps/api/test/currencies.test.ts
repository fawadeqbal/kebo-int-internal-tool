import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";

/** The three currencies (USD, CNY, PKR), their rates in Settings, and an offer's prices following its currency. */
describe("currencies", () => {
  let app: INestApplication;
  let admin: string;
  let sana: string;
  let sales: Record<string, unknown>;
  const tag = Date.now().toString(36);

  beforeAll(async () => {
    app = await startApp();
    admin = await signIn(app, "admin@example.com", "Admin@12345");
    sana = await signIn(app, "sana@example.com");
    sales = (await api(app, admin).get("/settings").expect(200)).body.sales;
    await api(app, admin)
      .put("/settings/sales", { ...sales, currency: "USD", exchangeRates: { CNY: 7.1, PKR: 280 }, reason: "New exchange rate" })
      .expect(200);
  });

  afterAll(async () => {
    await api(app, admin).put("/settings/sales", { ...sales, reason: "Back as it was" });
    await app?.close();
  });

  it("keeps only USD, CNY and PKR", async () => {
    const s = (await api(app, admin).get("/settings").expect(200)).body.sales;
    expect(s).toMatchObject({ currency: "USD", exchangeRates: { CNY: 7.1, PKR: 280 } });
    // Another currency's rate is not kept; another main currency is refused.
    await api(app, admin).put("/settings/sales", { ...s, exchangeRates: { CNY: 7.1, PKR: 280, EUR: 0.92 } }).expect(200);
    expect((await api(app, admin).get("/settings").expect(200)).body.sales.exchangeRates).toEqual({ CNY: 7.1, PKR: 280 });
    await api(app, admin).put("/settings/sales", { ...s, currency: "EUR" }).expect(422);
    const me = (await api(app, sana).get("/auth/me")).body.id;
    const customer = (await api(app, sana).post("/customers", { name: `Lahore Foods ${tag}`, country: "PK", contacts: [{ name: "Ali", email: `ali-${tag}@lf.test` }] }).expect(201))
      .body;
    const deal = (await api(app, sana).post("/inquiries", { customerId: customer.id, category: "Machinery", assigneeId: me, requirements: "Filling line" }).expect(201)).body;
    const bad = await api(app, sana).post(`/inquiries/${deal.id}/factory-quotes`, { newFactoryName: `Euro Works ${tag}`, receivedOn: "2026-10-26", currency: "EUR" }).expect(422);
    expect(bad.body.fieldErrors.currency[0]).toBe("Choose USD, CNY, PKR");
    // Lower case is fine.
    await api(app, sana).post(`/inquiries/${deal.id}/factory-quotes`, { newFactoryName: `Pak Works ${tag}`, receivedOn: "2026-10-26", currency: "pkr" }).expect(201);
  });

  it("converts an offer's prices when its currency changes, or keeps the numbers when asked", async () => {
    const me = (await api(app, sana).get("/auth/me")).body.id;
    const customer = (await api(app, sana).post("/customers", { name: `Karachi Agro ${tag}`, country: "PK", contacts: [{ name: "Omar", email: `omar-${tag}@ka.test` }] }).expect(201))
      .body;
    const deal = (await api(app, sana).post("/inquiries", { customerId: customer.id, category: "Machinery", assigneeId: me, requirements: "Rice mill" }).expect(201)).body;
    const header = { newFactoryName: `Hubei Mills ${tag}`, receivedOn: "2026-10-26", currency: "CNY" };
    const q = (await api(app, sana).post(`/inquiries/${deal.id}/factory-quotes`, header).expect(201)).body;
    await api(app, sana)
      .post(`/factory-quotes/${q.id}/lines`, { lines: [{ description: "Rice mill 2 t/h", quantity: 1, unit: "set", unitPrice: 7100, taxRate: 0 }, { description: "Spares", quantity: 1, unit: "lot", unitPrice: 355, taxRate: 0 }] })
      .expect(201);
    const factoryId = (await api(app, sana).get(`/factory-quotes/${q.id}`).expect(200)).body.factory.id;
    const put = (currency: string, convertPrices: boolean) =>
      api(app, sana).put(`/factory-quotes/${q.id}`, { factoryId, receivedOn: "2026-10-26", currency, convertPrices }).expect(200);
    const prices = async () => (await api(app, sana).get(`/factory-quotes/${q.id}`).expect(200)).body.lines.map((l: { unitPrice: string }) => l.unitPrice);

    await put("USD", true);
    expect(await prices()).toEqual(["1000.00", "50.00"]);
    await put("PKR", true);
    expect(await prices()).toEqual(["280000.00", "14000.00"]);
    // Typed in the wrong currency: only the currency changes.
    await put("USD", false);
    expect(await prices()).toEqual(["280000.00", "14000.00"]);
    expect((await api(app, sana).get(`/factory-quotes/${q.id}`)).body.currency).toBe("USD");
  });
});
