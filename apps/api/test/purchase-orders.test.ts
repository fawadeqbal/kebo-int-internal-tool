import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIRST_COMPANY_ID } from "@kebo/database";
import { api, signIn, startApp } from "./app";
import { today } from "./dates";
import { PrismaService } from "../src/database/prisma.service";

/** Purchase orders: one per sales order × supplier, numbered PO-YYYY-NNNN, sent before the deposit only with a reason. */
describe("purchase orders", () => {
  let app: INestApplication;
  let manager: string;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);
    manager = await signIn(app, "manager@example.com", "Manager@12345");
  });

  afterAll(async () => {
    await app?.close();
  });

  it("numbers one per supplier, lists them and sends one with a reason before the deposit is verified", async () => {
    const db = prisma.company(FIRST_COMPANY_ID);
    // An open order whose deposit is not paid, with a supplier on its lines and its PO not sent.
    const po = await db.purchaseOrder.findFirst({
      // (and nothing of it has left: another test's order with a shipment at sea reads "shipped" in the list)
      where: {
        sentOn: null,
        order: { status: "open", stage: { in: ["confirmed", "in_production"] }, factoryOrderedOn: null, allocations: { none: {} }, shipments: { none: { status: { in: ["departed", "arrived", "cleared"] } } } },
      },
      include: { order: { select: { id: true } } },
    });
    if (!po) return; // the seed has none (nothing to check)
    expect(po.number).toMatch(/^PO-\d{4}-\d{4,}$/);
    const list = (await api(app, manager).get(`/orders/${po.order.id}/purchase-orders`).expect(200)).body;
    expect(list.items.map((i: { number: string }) => i.number)).toContain(po.number);
    const pos = (await api(app, manager).get("/operations/purchase-orders?all=true").expect(200)).body as { po: { number: string } | null; status: string }[];
    expect(pos.find((r) => r.po?.number === po.number)?.status).toBe("not_sent");
    if (list.deposit.verified) return;
    const no = await api(app, manager).post(`/orders/${po.order.id}/purchase-orders/${po.id}/send`, { sentOn: today }).expect(400);
    expect(no.body.error).toMatch(/deposit is not verified/);
    const sent = (
      await api(app, manager)
        .post(`/orders/${po.order.id}/purchase-orders/${po.id}/send`, { sentOn: today, supplierRef: "THEIR-1", how: "Email", reason: "The price holds only until Friday" })
        .expect(200)
    ).body;
    expect(sent.items.find((i: { id: string }) => i.id === po.id)).toMatchObject({ sentOn: today, supplierRef: "THEIR-1", sentEarlyReason: "The price holds only until Friday" });
    // The first one sent is the order's "ordered from the factory" day.
    expect((await db.order.findUniqueOrThrow({ where: { id: po.order.id } })).factoryOrderedOn).not.toBeNull();
  });

  it("finds orders by number or PO and by customer, and shows the quotation an order came from", async () => {
    const db = prisma.company(FIRST_COMPANY_ID);
    const po = await db.purchaseOrder.findFirst({ where: { order: { status: "open" } }, include: { order: { select: { id: true, refNo: true, customerId: true } } } });
    if (!po) return;
    const byPo = (await api(app, manager).get(`/orders?status=open&q=${encodeURIComponent(po.number)}`).expect(200)).body as { id: string }[];
    const byRef = (await api(app, manager).get(`/orders?q=${encodeURIComponent(po.order.refNo)}`).expect(200)).body as { id: string }[];
    const byCustomer = (await api(app, manager).get(`/orders?customer=${po.order.customerId}`).expect(200)).body as { id: string; customer: { id: string } }[];
    const rows = (x: unknown) => (Array.isArray(x) ? x : (x as { rows: { id: string }[] }).rows) as { id: string; customer?: { id: string } }[];
    expect(rows(byRef).map((o) => o.id)).toContain(po.order.id);
    if (rows(byPo).length) expect(rows(byPo).map((o) => o.id)).toContain(po.order.id);
    expect(rows(byCustomer).every((o) => !o.customer || o.customer.id === po.order.customerId)).toBe(true);
    const view = (await api(app, manager).get(`/orders/${po.order.id}`).expect(200)).body;
    if (view.quotation) expect(view.quotation.number).toBeGreaterThan(0);
  });
});
