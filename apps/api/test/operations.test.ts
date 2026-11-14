import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";

type Ship = { id: string; order: { id: string; refNo: string }; status: string; eta: string | null; overdue: boolean };
type Po = {
  key: string;
  order: { id: string };
  supplier: { id: string; name: string };
  currency: string;
  owed: string;
  paid: string;
  toPay: string;
};

/** Operations & trading lists across orders: shipments, and one purchase order per supplier on an order. */
describe("operations lists", () => {
  let app: INestApplication;
  let manager: string;
  let bilal: string;

  beforeAll(async () => {
    app = await startApp();
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    bilal = await signIn(app, "bilal@example.com");
  });

  afterAll(async () => {
    await app?.close();
  });

  it("lists shipments under way, the next to arrive first; all of them on asking", async () => {
    const open = (await api(app, manager).get("/operations/shipments").expect(200)).body as Ship[];
    const all = (await api(app, manager).get("/operations/shipments?all=true").expect(200)).body as Ship[];
    expect(all.length).toBeGreaterThanOrEqual(open.length);
    for (const s of open) expect(["planned", "booked", "loaded", "departed"]).toContain(s.status);
    const etas = open.map((s) => s.eta).filter((e): e is string => !!e);
    expect(etas).toEqual([...etas].sort());
    await api(app).get("/operations/shipments").expect(401);
  });

  it("lists a purchase order per supplier on each order, with what we owe and paid as the order's money shows", async () => {
    const rows = (await api(app, manager).get("/operations/purchase-orders?all=true").expect(200)).body as Po[];
    expect(rows.length).toBeGreaterThan(0);
    const one = rows[0]!;
    const m = (await api(app, manager).get(`/orders/${one.order.id}/money`).expect(200)).body as {
      factories: { rows: { factory: { id: string }; currency: string; owed: string; paid: string }[] };
    };
    const same = m.factories.rows.find((r) => r.factory.id === one.supplier.id && r.currency === one.currency)!;
    expect([one.owed, one.paid]).toEqual([same.owed, same.paid]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    // One sales order's purchase orders (the purchase order's own page reads these): the same rows, only that order's.
    const ofOne = (await api(app, manager).get(`/operations/purchase-orders?all=true&order=${one.order.id}`).expect(200)).body as Po[];
    expect(ofOne.length).toBeGreaterThan(0);
    expect(ofOne).toEqual(rows.filter((r) => r.order.id === one.order.id));
    await api(app, manager).get("/operations/purchase-orders?order=not-an-id").expect(422);
    // Staff see factory costs (sourcing), on the orders they handle only.
    const staff = (await api(app, bilal).get("/operations/purchase-orders?all=true").expect(200)).body as Po[];
    expect(staff.length).toBeLessThanOrEqual(rows.length);
  });
});
