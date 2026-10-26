import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";

/**
 * Every read endpoint, for every record in the database, as a manager (who sees
 * everything) and as staff: nothing may answer 500. Type checks cannot catch every
 * query against the database (some query shapes are loosely typed), so this runs them.
 */
describe("every read endpoint answers for every record", () => {
  let app: INestApplication;
  let manager: string;
  let admin: string;
  let staff: string;

  beforeAll(async () => {
    app = await startApp();
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    admin = await signIn(app, "admin@example.com", "Admin@12345");
    staff = await signIn(app, "bilal@example.com");
  });

  afterAll(async () => {
    await app?.close();
  });

  const ok = async (who: string, path: string) => {
    const res = await api(app, who).get(path);
    expect(res.status, `${path} → ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`).toBeLessThan(500);
    return res.body;
  };

  it("lists and pages", async () => {
    for (const who of [manager, staff]) {
      for (const path of ["/auth/me", "/dashboard", "/notifications", "/me/todo", "/me/two-step", "/users/people", "/inquiries", "/customers", "/factories", "/orders", "/orders?status=closed", "/orders?status=cancelled", "/orders?mine=true&late=true", "/hs-codes", "/hs-codes/8481.80"]) await ok(who, path);
    }
    for (const path of ["/reports", "/audit", "/users", "/settings"]) await ok(admin, path);
  });

  it("every deal, with its sourcing and quotation", async () => {
    const deals = (await ok(manager, "/inquiries?pageSize=100")).rows as { id: string }[];
    expect(deals.length).toBeGreaterThan(0);
    for (const d of deals) {
      await ok(manager, `/inquiries/${d.id}`);
      await ok(manager, `/inquiries/${d.id}/sourcing`);
      const q = await ok(manager, `/inquiries/${d.id}/quotation`);
      for (const r of (q?.revisions ?? []) as { id: string }[]) await ok(manager, `/revisions/${r.id}`);
    }
  });

  it("every customer and factory", async () => {
    for (const c of (await ok(manager, "/customers?pageSize=100")).rows as { id: string }[]) await ok(manager, `/customers/${c.id}`);
    for (const f of (await ok(manager, "/factories?pageSize=100")).rows as { id: string }[]) await ok(manager, `/factories/${f.id}`);
  });

  it("every order, its payments and its documents", async () => {
    const orders = [...(await ok(manager, "/orders")), ...(await ok(manager, "/orders?status=closed")), ...(await ok(manager, "/orders?status=cancelled"))] as { id: string }[];
    expect(orders.length).toBeGreaterThan(0);
    for (const o of orders) {
      await ok(manager, `/orders/${o.id}`);
      await ok(manager, `/orders/${o.id}/payments`);
      for (const kind of ["proforma", "packing-list"]) await ok(manager, `/orders/${o.id}/documents/${kind}`);
    }
  });
});
