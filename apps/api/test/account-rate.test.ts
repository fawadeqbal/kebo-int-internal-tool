import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";
import { Clock } from "../src/common/time/clock.service";

/**
 * A money account in a currency with no exchange rate would be left out of every total: its rate is asked with
 * the account and kept in Settings (the same rates every figure uses).
 */
describe("a new account's currency gets its rate", () => {
  let app: INestApplication;
  let admin: string;
  let manager: string;
  let original: Record<string, unknown>;
  let today = "";
  const tag = Date.now().toString(36);

  beforeAll(async () => {
    app = await startApp();
    today = app.get(Clock).today();
    admin = await signIn(app, "admin@example.com", "Admin@12345");
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    original = (await api(app, admin).get("/settings").expect(200)).body.sales;
    const rates = { ...(original.exchangeRates as Record<string, number>) };
    delete rates.PKR;
    await api(app, admin).put("/settings/sales", { ...original, currency: "USD", exchangeRates: rates, reason: "Test: no PKR rate" }).expect(200);
  });

  afterAll(async () => {
    await api(app, admin).put("/settings/sales", { ...original, reason: "Test: rates as they were" });
    await app?.close();
  });

  it("asks for it (rate_needed), then keeps it in Settings with the account", async () => {
    const account = { name: `Petty cash PKR ${tag}`, kind: "cash", currency: "PKR", openingBalance: 5000, openingOn: today };
    const asked = await api(app, manager).post("/money/accounts", account).expect(409);
    expect(asked.body).toMatchObject({ code: "rate_needed" });
    expect(asked.body.error).toContain("There is no exchange rate for PKR in Settings");
    await api(app, manager).post("/money/accounts", { ...account, rate: 280 }).expect(201);
    expect((await api(app, admin).get("/settings").expect(200)).body.sales.exchangeRates.PKR).toBe(280);
    // A second one in PKR: nothing more to ask.
    await api(app, manager).post("/money/accounts", { ...account, name: `Bank PKR ${tag}` }).expect(201);
  });

  it("the main currency, or one with a rate, is never asked", async () => {
    await api(app, manager).post("/money/accounts", { name: `Bank USD ${tag}`, kind: "bank", currency: "USD", openingBalance: 0, openingOn: today }).expect(201);
    await api(app, manager).post("/money/accounts", { name: `Bank CNY ${tag}`, kind: "bank", currency: "CNY", openingBalance: 0, openingOn: today }).expect(201);
  });
});
