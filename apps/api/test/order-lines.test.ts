import type { INestApplication } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIRST_COMPANY_ID, seedCompanyBase } from "@kebo/database";
import { api, signIn, startApp } from "./app";
import { PrismaService } from "../src/database/prisma.service";
import { CompaniesService } from "../src/common/company/companies.service";

/**
 * Order flow v3, phase 2: the order's lines in one line table. Each step changes
 * one line at a time (PATCH /order-lines/:id): what came in from the factory,
 * the packing, what reached the customer. Same rules and history as the whole
 * lists, each set behind its own permission (and Delivery & SAT behind its module).
 */
describe("order lines, one at a time", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sana: string;
  let bilal: string;
  let admin: string;
  let orderId: string;
  let machine: { id: string };
  let moulds: { id: string };
  let freight: { id: string };
  const tag = Date.now().toString(36);
  const password = "Lines@12345678";
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

  type Line = {
    id: string;
    type: string;
    receivedQty: string;
    receivedOn: string | null;
    packing: { packages: number | null; packageType: string | null; netWeightKg: string | null; grossWeightKg: string | null; cbm: string | null };
    delivered: { qty: string; condition: string | null; note: string | null } | null;
  };
  const order = async (who = sana) => (await api(app, who).get(`/orders/${orderId}`).expect(200)).body as { lines: Line[]; goods: { received: number; packed: boolean } };
  const patch = (id: string, body: object, who = sana) => api(app, who).patch(`/order-lines/${id}`, body);
  const history = async (step: string) =>
    (await api(app, sana).get(`/history?type=order&id=${orderId}&step=${step}`).expect(200)).body as { action: string; summary: string }[];
  const modulesOff = async (off: string[]) => {
    await prisma.platform.company.update({ where: { id: FIRST_COMPANY_ID }, data: { featuresOff: off } });
    app.get(CompaniesService).forget(FIRST_COMPANY_ID);
  };

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);
    sana = await signIn(app, "sana@example.com");
    bilal = await signIn(app, "bilal@example.com");
    admin = await signIn(app, "admin@example.com", "Admin@12345");
    const me = (await api(app, sana).get("/auth/me")).body.id;
    const customerId = (
      await api(app, sana)
        .post("/customers", { name: `Lines Pharma ${tag}`, country: "PK", contacts: [{ name: "Imran", email: `imran-${tag}@lines.test` }] })
        .expect(201)
    ).body.id;
    const inquiry = (
      await api(app, sana)
        .post("/inquiries", {
          customerId,
          category: "Machinery",
          assigneeId: me,
          items: [
            { description: "Blister packing machine DPP-260", quantity: 2 },
            { description: "Mould set", quantity: 4, unit: "sets" },
          ],
        })
        .expect(201)
    ).body;
    const items = (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.items as { id: string }[];
    await api(app, sana)
      .post(`/inquiries/${inquiry.id}/factory-quotes`, {
        newFactoryName: `Wenzhou Lines ${tag}`,
        receivedOn: day(-3),
        currency: "CNY",
        lines: [
          { requestedItemId: items[0]!.id, description: "DPP-260", quantity: 2, unitPrice: 130000 },
          { requestedItemId: items[1]!.id, description: "Moulds", quantity: 4, unitPrice: 4500 },
        ],
      })
      .expect(201);
    const draft = (await api(app, sana).get(`/inquiries/${inquiry.id}/quotation/draft`)).body;
    draft.options[0].charges.push({ type: "charge", description: "Sea freight to Karachi", quantity: 1, unitPrice: 2400 });
    const r = (await api(app, sana).post(`/inquiries/${inquiry.id}/quotation/revisions`, draft).expect(201)).body;
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "sent" }).expect(200);
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "accepted" }).expect(200);
    orderId = (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.orders[0].id;
    const lines = (await order()).lines;
    [machine, moulds] = lines.filter((l) => l.type === "goods") as [Line, Line];
    freight = lines.find((l) => l.type === "charge")!;
  });

  afterAll(async () => {
    if (prisma) await modulesOff([]);
    await app?.close();
  });

  it("records what came in, dated today unless a date is given, and refuses more than ordered", async () => {
    const r = (await patch(machine.id, { set: "received", receivedQty: "1" }).expect(200)).body;
    expect(r.line).toMatchObject({ id: machine.id, no: "1", receivedQty: "1", receivedOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(r.goods).toMatchObject({ lines: 2, received: 0, allReceived: false });

    const dated = (await patch(machine.id, { set: "received", receivedOn: day(-2) }).expect(200)).body;
    expect(dated.line).toMatchObject({ receivedQty: "1", receivedOn: day(-2) });

    const more = await patch(machine.id, { set: "received", receivedQty: 3 }).expect(400);
    expect(more.body.error).toBe("DPP-260: 3 is more than the 2 pcs ordered.");
    await patch(machine.id, { set: "received", receivedOn: day(2) }).expect(400);
    await patch(machine.id, { set: "received", receivedQty: -1 }).expect(422);
    await patch(machine.id, { set: "nowhere" }).expect(422);
    // A charge is not received or packed.
    await patch(freight.id, { set: "received", receivedQty: 1 }).expect(400);

    await patch(machine.id, { set: "received", receivedQty: 2 }).expect(200);
    const all = (await patch(moulds.id, { set: "received", receivedQty: 4 }).expect(200)).body;
    expect(all.goods).toMatchObject({ received: 2, allReceived: true });
    // The checklist ticks itself from the lines.
    const steps = (await api(app, sana).get(`/orders/${orderId}/steps`).expect(200)).body as { items: { key: string | null; done: boolean }[] };
    expect(steps.items.find((i) => i.key === "goods_received")).toMatchObject({ done: true });

    const changes = await history("production");
    expect(changes.filter((c) => c.action === "goods_received").map((c) => c.summary)).toEqual(
      expect.arrayContaining([expect.stringMatching(/received from the factory .*DPP-260 1 → 2$/)]),
    );

    // Back to nothing: no date either.
    const none = (await patch(moulds.id, { set: "received", receivedQty: "" }).expect(200)).body;
    expect(none.line).toMatchObject({ receivedQty: "0", receivedOn: null });
    await patch(moulds.id, { set: "received", receivedQty: 4 }).expect(200);
  });

  it("fills in the packing line by line; the list is made once every line has its packages", async () => {
    const one = (await patch(machine.id, { set: "packing", packages: "2", grossWeightKg: "4320", netWeightKg: "3900", cbm: "18.4" }).expect(200)).body;
    expect(one.line.packing).toEqual({ packages: 2, packageType: "Carton", netWeightKg: "3900.00", grossWeightKg: "4320.00", cbm: "18.400" });
    expect(one.goods.packed).toBe(false);
    const typed = (await patch(machine.id, { set: "packing", packageType: "Wooden case" }).expect(200)).body;
    expect(typed.line.packing.packageType).toBe("Wooden case");

    const heavy = await patch(moulds.id, { set: "packing", packages: 1, netWeightKg: 300, grossWeightKg: 230 }).expect(400);
    expect(heavy.body.error).toMatch(/net weight cannot be more than the gross weight/);
    await patch(moulds.id, { set: "packing", packages: 1.5 }).expect(422);

    const done = (await patch(moulds.id, { set: "packing", packages: 1, grossWeightKg: 230, netWeightKg: 190, cbm: 0.6 }).expect(200)).body;
    expect(done.goods).toMatchObject({ packed: true, totals: { packages: 3, grossWeightKg: "4550.00", netWeightKg: "4090.00", cbm: "19.000" } });
    const steps = (await api(app, sana).get(`/orders/${orderId}/steps`).expect(200)).body as { items: { key: string | null; done: boolean }[] };
    expect(steps.items.find((i) => i.key === "packing_list")).toMatchObject({ done: true });
    // The packing list paper reads the same lines.
    const pl = (await api(app, sana).get(`/orders/${orderId}/documents/packing-list`).expect(200)).body;
    expect(pl.packing).toMatchObject({ done: true, totals: { packages: 3 } });

    // Clearing a line's packages un-makes the list.
    const cleared = (await patch(moulds.id, { set: "packing", packages: "" }).expect(200)).body;
    expect(cleared.goods.packed).toBe(false);
    await patch(moulds.id, { set: "packing", packages: 1 }).expect(200);

    const changes = await history("shipping");
    expect(changes.some((c) => c.action === "packing_list" && /packing list, Moulds: packages 1 → —/.test(c.summary))).toBe(true);

    // The container and the shipping marks are the order's (its details).
    await api(app, sana).patch(`/orders/${orderId}/details`, { containerNo: "MSKU 7741203", shippingMarks: "AL-SHIFA\nKARACHI" }).expect(200);
    expect((await api(app, sana).get(`/orders/${orderId}`)).body.goods).toMatchObject({ containerNo: "MSKU 7741203", shippingMarks: "AL-SHIFA\nKARACHI" });
    expect((await history("shipping")).some((c) => /container and shipping marks changed/.test(c.summary))).toBe(true);
  });

  it("records what reached the customer, line by line", async () => {
    const r = (await patch(machine.id, { set: "delivered", deliveredQty: 2, condition: "good" }).expect(200)).body;
    expect(r.line.delivered).toEqual({ qty: "2", condition: "good", note: null });
    const m = (await patch(moulds.id, { set: "delivered", deliveredQty: "3", condition: "missing", note: "One set short" }).expect(200)).body;
    expect(m.line.delivered).toEqual({ qty: "3", condition: "missing", note: "One set short" });
    await patch(moulds.id, { set: "delivered", condition: "lost" }).expect(422);
    await patch(moulds.id, { set: "delivered", note: "x".repeat(201) }).expect(422);
    const more = await patch(moulds.id, { set: "delivered", deliveredQty: 5 }).expect(400);
    expect(more.body.error).toBe("Moulds: 5 is more than the 4 pcs ordered.");
    const cleared = (await patch(moulds.id, { set: "delivered", condition: "", note: "" }).expect(200)).body;
    expect(cleared.line.delivered).toEqual({ qty: "3", condition: null, note: null });

    const changes = await history("delivery");
    expect(changes.filter((c) => c.action === "delivered").map((c) => c.summary)).toEqual(
      expect.arrayContaining([expect.stringMatching(/delivered, Moulds: 3 of 4 pcs, missing, note "One set short"$/)]),
    );
  });

  it("delivered lines need the Delivery & SAT module", async () => {
    await modulesOff(["delivery_sat"]);
    try {
      const refused = await patch(machine.id, { set: "delivered", deliveredQty: 1 }).expect(403);
      expect(refused.body.code).toBe("plan_feature");
      expect((await order()).lines.every((l) => l.delivered === null)).toBe(true);
      // Goods and packing are core: they stay.
      await patch(machine.id, { set: "packing", cbm: 18.5 }).expect(200);
    } finally {
      await modulesOff([]);
    }
    expect((await order()).lines.find((l) => l.id === machine.id)!.delivered).toEqual({ qty: "2", condition: "good", note: null });
  });

  it("each set needs its own permission, and staff only reach their own orders", async () => {
    // Bilal (staff) has the permissions but not this deal: not found.
    await patch(machine.id, { set: "received", receivedQty: 1 }, bilal).expect(404);
    await api(app, sana).patch(`/order-lines/00000000-0000-4000-8000-000000000000`, { set: "received", receivedQty: 1 }).expect(404);
    await api(app).patch(`/order-lines/${machine.id}`).send({ set: "received", receivedQty: 1 }).expect(401);

    // A role that sees every order and may manage delivery, but may not change orders.
    const role = (
      await api(app, admin)
        .post("/roles", { name: `Site team ${tag}`, permissions: ["dashboard.view", "inquiries.viewAll", "delivery.manage"] })
        .expect(201)
    ).body;
    const email = `site-${tag}@example.com`;
    await api(app, admin).post("/users", { name: "Site team", email, role: role.key, password }).expect(201);
    const site = await signIn(app, email, password);
    await patch(machine.id, { set: "received", receivedQty: 1 }, site).expect(403);
    await patch(machine.id, { set: "packing", packages: 9 }, site).expect(403);
    await patch(machine.id, { set: "delivered", note: "Unloaded by crane" }, site).expect(200);

    // And the other way round.
    const role2 = (
      await api(app, admin).post("/roles", { name: `Office ${tag}`, permissions: ["dashboard.view", "inquiries.viewAll", "orders.update"] }).expect(201)
    ).body;
    const email2 = `office-${tag}@example.com`;
    await api(app, admin).post("/users", { name: "Office", email: email2, role: role2.key, password }).expect(201);
    const office = await signIn(app, email2, password);
    await patch(machine.id, { set: "delivered", note: "x" }, office).expect(403);
    await patch(machine.id, { set: "received", receivedQty: 2 }, office).expect(200);
    // Factory prices only for people who see them.
    expect((await order(office)).lines.find((l) => l.id === machine.id)).toMatchObject({ factoryPrice: null });
    expect((await order(sana)).lines.find((l) => l.id === machine.id)).toMatchObject({ factoryPrice: { unitPrice: "130000.00", currency: "CNY" } });
  });

  it("another company's line is not found, and its rows stay out of reach", async () => {
    const company = await prisma.platform.company.create({ data: { slug: `ln-${tag}`.slice(0, 30), name: `Lines other ${tag}` } });
    const email = `boss@ln-${tag}.test`;
    await seedCompanyBase(prisma.company(company.id), {
      admin: { email, name: "Boss", role: "admin", passwordHash: await bcrypt.hash(password, 10) },
    });
    const boss = await signIn(app, email, password);
    const refused = await patch(machine.id, { set: "received", receivedQty: 0 }, boss).expect(404);
    expect(refused.body.error).toMatch(/not found/i);
    await patch(machine.id, { set: "packing", packages: 0 }, boss).expect(404);
    const db = prisma.company(company.id);
    expect(await db.orderLine.findUnique({ where: { id: machine.id } })).toBeNull();
    expect((await db.orderLine.updateMany({ where: { id: machine.id }, data: { deliveredQty: 0 } })).count).toBe(0);
    // Nothing changed on ours.
    expect((await order()).lines.find((l) => l.id === machine.id)).toMatchObject({ receivedQty: "2", packing: { packages: 2 } });
  });

  it("a cancelled order's lines do not change", async () => {
    const manager = await signIn(app, "manager@example.com", "Manager@12345");
    await api(app, manager).post(`/orders/${orderId}/cancel`, { reason: "Customer cancelled (test)" }).expect(200);
    const r = await patch(machine.id, { set: "packing", packages: 3 }).expect(400);
    expect(r.body.error).toBe("This order is cancelled.");
  });
});
