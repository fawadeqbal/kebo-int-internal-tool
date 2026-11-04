import { readFileSync } from "node:fs";
import path from "node:path";
import type { INestApplication } from "@nestjs/common";
import { FIRST_COMPANY_ID, Prisma } from "@kebo/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../src/database/prisma.service";
import { api, signIn, startApp } from "./app";

/**
 * The customer and factory pages (approved design 36): a factory's contacts and bank fields, the migration that
 * made today's one contact the primary one, a factory's purchase orders with paid and balance due, and the
 * figures the customer's tabs read (overdue per sales order, ready date and stage, quoted and gross profit).
 */
describe("customer and factory pages", () => {
  let app: INestApplication;
  let manager: string;
  let staff: string;
  const tag = Date.now().toString(36);

  beforeAll(async () => {
    app = await startApp();
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    staff = await signIn(app, "sana@example.com");
  });

  afterAll(async () => {
    await app?.close();
  });

  it("keeps a factory's contacts, one primary, and its bank details as fields", async () => {
    const f = (
      await api(app, manager)
        .post("/factories", {
          name: `Qingdao Pack ${tag}`,
          contacts: [
            { name: "Liu Gang", position: "Engineer", wechat: "liugang88" },
            { name: "Zhang Li", position: "Sales manager", phone: "+86 532 8876 1200", email: `zl-${tag}@qd.test`, isPrimary: true },
          ],
          bankBeneficiary: "Qingdao Packaging Machinery Co., Ltd.",
          bankName: "Bank of China, Qingdao",
          bankAccount: "2316 8890 4471 6621",
          bankSwift: "bkchcnbj500",
          bankDetails: "Intermediary: none",
        })
        .expect(201)
    ).body;
    let d = (await api(app, manager).get(`/factories/${f.id}`).expect(200)).body;
    expect(d.contacts.map((c: { name: string; isPrimary: boolean }) => [c.name, c.isPrimary])).toEqual([
      ["Zhang Li", true],
      ["Liu Gang", false],
    ]);
    // The old columns keep the primary contact for the places that still read them.
    expect(d).toMatchObject({ contactPerson: "Zhang Li", phone: "+8653288761200", email: `zl-${tag}@qd.test`, wechat: null });
    expect(d).toMatchObject({ bankBeneficiary: "Qingdao Packaging Machinery Co., Ltd.", bankAccount: "2316 8890 4471 6621", bankSwift: "BKCHCNBJ500", bankDetails: "Intermediary: none" });

    // A bad SWIFT code is refused; a contact with no way to reach them too.
    await api(app, manager).put(`/factories/${f.id}`, { name: d.name, bankSwift: "BOC" }).expect(422);
    await api(app, manager).put(`/factories/${f.id}`, { name: d.name, contacts: [{ name: "Nobody" }] }).expect(422);

    // Editing keeps ids; a removed contact goes; the other becomes primary.
    const liu = d.contacts.find((c: { name: string }) => c.name === "Liu Gang");
    await api(app, manager)
      .put(`/factories/${f.id}`, { name: d.name, contacts: [{ id: liu.id, name: "Liu Gang", wechat: "liugang88", phone: "+86 138 6392 4410" }] })
      .expect(200);
    d = (await api(app, manager).get(`/factories/${f.id}`).expect(200)).body;
    expect(d.contacts).toEqual([expect.objectContaining({ id: liu.id, isPrimary: true, phone: "+8613863924410" })]);
    expect(d).toMatchObject({ contactPerson: "Liu Gang", wechat: "liugang88", email: null, bankName: null });

    // An older form (no list) changes the primary contact only.
    await api(app, manager).put(`/factories/${f.id}`, { name: d.name, contacts: [...d.contacts, { name: "Wang", email: `w-${tag}@qd.test` }] }).expect(200);
    await api(app, manager).put(`/factories/${f.id}`, { name: d.name, contactPerson: "Liu G.", phone: "+86 138 0000 0000" }).expect(200);
    d = (await api(app, manager).get(`/factories/${f.id}`).expect(200)).body;
    expect(d.contacts.map((c: { id: string; name: string; isPrimary: boolean }) => [c.id === liu.id, c.name, c.isPrimary])).toEqual([
      [true, "Liu G.", true],
      [false, "Wang", false],
    ]);

    // An import (old fields only) gets one primary contact.
    const name = `Imported Works ${tag}`;
    await api(app, manager).post("/factories/import", { factories: [{ name, contactPerson: "Chen", wechat: "chen01" }] }).expect(200);
    const imported = (await api(app, manager).get(`/factories?q=${encodeURIComponent(name)}`).expect(200)).body.rows[0];
    expect((await api(app, manager).get(`/factories/${imported.id}`).expect(200)).body.contacts).toEqual([
      expect.objectContaining({ name: "Chen", wechat: "chen01", isPrimary: true }),
    ]);
  });

  it("the migration makes today's one contact of each factory its primary contact", async () => {
    const db = app.get(PrismaService).company(FIRST_COMPANY_ID);
    const make = async (n: string, cols: { contact_person?: string; phone?: string; wechat?: string; email?: string }) =>
      (await db.factory.create({ data: { name: `${n} ${tag}`, contactPerson: cols.contact_person ?? null, phone: cols.phone ?? null, wechat: cols.wechat ?? null, email: cols.email ?? null } })).id;
    const full = await make("Old Full", { contact_person: "Mr. Hu", phone: "+86 1", wechat: "hu1", email: "hu@old.test" });
    const phoneOnly = await make("Old Phone", { phone: "+86 2" });
    const empty = await make("Old Empty", {});
    const ids = [full, phoneOnly, empty];
    const sql = readFileSync(path.join(__dirname, "../../../packages/database/prisma/migrations/20261213000000_factory_contacts_and_bank/migration.sql"), "utf8");
    const backfill = /INSERT INTO "factory_contacts"[\s\S]*?;\s*$/.exec(sql.trim())![0].replace(/;\s*$/, "");
    await db.$executeRaw`${Prisma.raw(backfill)} AND f."id" = any(${ids}::uuid[])`;
    const rows = await db.factoryContact.findMany({ where: { factoryId: { in: ids } }, orderBy: { name: "asc" } });
    expect(rows.map((r) => [r.factoryId, r.name, r.phone, r.wechat, r.email, r.isPrimary])).toEqual([
      [full, "Mr. Hu", "+86 1", "hu1", "hu@old.test", true],
      [phoneOnly, `Old Phone ${tag}`, "+86 2", null, null, true],
    ]);
    // The old columns are kept, readable as before.
    expect(await db.factory.findUnique({ where: { id: full }, select: { contactPerson: true, phone: true } })).toEqual({ contactPerson: "Mr. Hu", phone: "+86 1" });
  });

  it("lists a factory's purchase orders with the same total, paid and balance due as the sales order", async () => {
    const orders = [
      ...((await api(app, manager).get("/orders?status=open").expect(200)).body as { id: string }[]),
      ...((await api(app, manager).get("/orders?status=closed").expect(200)).body as { id: string }[]),
    ];
    let found: { orderId: string; row: { factory: { id: string }; currency: string; owed: string; paid: string; toPay: string } } | null = null;
    for (const o of orders.slice(0, 40)) {
      const m = (await api(app, manager).get(`/orders/${o.id}/money`).expect(200)).body;
      const row = m.factories?.rows?.find((r: { owed: string }) => Number(r.owed) > 0);
      if (row) {
        found = { orderId: o.id, row };
        break;
      }
    }
    expect(found).not.toBeNull();
    const { orderId, row } = found!;
    const p = (await api(app, manager).get(`/factories/${row.factory.id}/purchases`).expect(200)).body;
    const po = p.orders.find((o: { id: string }) => o.id === orderId);
    expect(po).toMatchObject({ currency: row.currency, total: row.owed, paid: row.paid, balanceDue: row.toPay });
    expect(["on_track", "overdue_step", "ready", "delivered", "cancelled"]).toContain(po.production);
    // Totals add up the orders not cancelled, per currency.
    const t = p.totals.find((x: { currency: string }) => x.currency === row.currency);
    const sum = p.orders
      .filter((o: { status: string; currency: string | null }) => o.status !== "cancelled" && o.currency === row.currency)
      .reduce((s: number, o: { balanceDue: string }) => s + Math.round(Number(o.balanceDue) * 100), 0);
    expect(Math.round(Number(t.balanceDue) * 100)).toBe(sum);
    expect(p.readiness.known).toBeGreaterThanOrEqual(p.readiness.onTime);
    expect(Array.isArray(p.payments) && Array.isArray(p.waiting)).toBe(true);
    // Only for people who source; an unknown factory is not found.
    await api(app, manager).get(`/factories/00000000-0000-4000-8000-000000000000/purchases`).expect(404);
  });

  it("gives the customer's tabs their figures: overdue per sales order, stage and ready date, quoted and gross profit", async () => {
    const customers = (await api(app, manager).get("/customers?pageSize=100").expect(200)).body.rows as { id: string; openOrders: number }[];
    const c = customers.find((x) => x.openOrders > 0)!;
    const detail = (await api(app, manager).get(`/customers/${c.id}`).expect(200)).body;
    expect(detail.orders[0]).toEqual(expect.objectContaining({ stage: expect.any(String), readyOn: expect.toBeOneOf([null, expect.any(String)]) }));
    expect(detail.orders[0].factories).toBeUndefined();
    const pay = (await api(app, manager).get(`/payments?customerId=${c.id}`).expect(200)).body;
    for (const o of pay.orders) {
      expect(Number(o.overdue)).toBeLessThanOrEqual(Number(o.due) + 0.005);
      expect(o.overdueSince === null || o.overdueSince < new Date().toISOString().slice(0, 10)).toBe(true);
      if (Number(o.overdue) > 0) expect(o.overdueSince).not.toBeNull();
    }
    const a = (await api(app, manager).get(`/customers/${c.id}/account`).expect(200)).body;
    const won = a.rows.find((r: { order: unknown }) => r.order);
    expect(won.order).toEqual(expect.objectContaining({ orderedOn: expect.any(String), currency: expect.any(String), total: expect.any(String), quotedProfit: expect.any(String), profit: expect.any(String) }));
    await api(app, staff).get(`/customers/${c.id}/account`).expect(403);
  });
});
