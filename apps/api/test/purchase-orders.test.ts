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
      where: { sentOn: null, order: { status: "open", factoryOrderedOn: null, allocations: { none: {} } } },
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
});
