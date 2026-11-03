import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { FIRST_COMPANY_ID, Prisma } from "@kebo/database";
import { multiplyMinor, toMinor, withTaxMinor, fromMinor } from "@kebo/money";
import { PrismaService } from "../src/database/prisma.service";
import { api, signIn, startApp } from "./app";

/**
 * Tax is only on factory items: each offer's prices are without tax (each line's tax % added on top) or
 * have the tax included (the price is our cost). Sales carry no tax.
 */
describe("tax", () => {
  let app: INestApplication;
  let sana: string;
  let me: string;
  let admin: string;
  const tag = Date.now().toString(36);

  beforeAll(async () => {
    app = await startApp();
    sana = await signIn(app, "sana@example.com");
    me = (await api(app, sana).get("/auth/me")).body.id;
    admin = await signIn(app, "admin@example.com", "Admin@12345");
  });

  afterAll(async () => {
    await app?.close();
  });

  let n = 0;
  /** A deal with two items for a new customer in this country. */
  const deal = async (country: string) => {
    n += 1;
    const customer = (await api(app, sana).post("/customers", { name: `Tax ${country} ${tag} ${n}`, country, contacts: [{ name: "Li", email: `li-${n}-${tag}@tax.test` }] }).expect(201)).body;
    const inquiry = (await api(app, sana).post("/inquiries", { customerId: customer.id, category: "Machinery", assigneeId: me, items: [{ description: "Gear pump", quantity: 10 }, { description: "Spare seals", quantity: 10 }] }).expect(201)).body;
    const items = (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.items as { id: string }[];
    return { inquiryId: inquiry.id as string, items: items.map((i) => i.id) };
  };

  /** An offer on the deal; its id. */
  const offer = async (inquiryId: string, body: Record<string, unknown>) =>
    (await api(app, sana).post(`/inquiries/${inquiryId}/factory-quotes`, { receivedOn: "2026-10-20", currency: "CNY", ...body }).expect(201)).body.id as string;
  const sourcing = async (inquiryId: string) => (await api(app, sana).get(`/inquiries/${inquiryId}/sourcing`).expect(200)).body;
  const quoteOf = async (inquiryId: string, id: string) => (await sourcing(inquiryId)).quotes.find((q: { id: string }) => q.id === id);
  type Line = { description: string; taxRate: number; costNote: string; unitCost: string | null };

  it("starts a new offer at the company's default: without tax, 0%", async () => {
    const { inquiryId, items } = await deal("NG");
    const id = await offer(inquiryId, {
      newFactoryName: `Taizhou Plain ${tag}`,
      lines: [{ requestedItemId: items[0], description: "Gear pump", quantity: 10, unitPrice: 100 }],
    });
    const q = await quoteOf(inquiryId, id);
    expect(q).toMatchObject({ taxIncluded: false, taxRate: 0, factoryTotal: "1000.00", taxTotal: "0.00" });
    expect(q.lines.map((l: Line) => [l.taxRate, l.costNote])).toEqual([[0, "CNY 100.00, no tax"]]);
  });

  it("without tax: adds each line's tax % (the offer's unless it has its own) on top of its price", async () => {
    const { inquiryId, items } = await deal("NG");
    const id = await offer(inquiryId, {
      newFactoryName: `Taizhou Pumps ${tag}`,
      taxIncluded: false,
      taxRate: 13,
      lines: [
        { requestedItemId: items[0], description: "Gear pump", quantity: 10, unitPrice: 100 },
        { requestedItemId: items[1], description: "Spare seals", quantity: 10, unitPrice: 50, taxRate: 0 },
      ],
    });
    // A line added later takes the offer's %.
    await api(app, sana).post(`/factory-quotes/${id}/lines`, { lines: [{ description: "Coupling", quantity: 1, unitPrice: 10 }] }).expect(201);
    const q = await quoteOf(inquiryId, id);
    expect(q).not.toHaveProperty("vatRate");
    expect(q.lines.map((l: Line) => [l.taxRate, l.costNote])).toEqual([
      [13, "CNY 100.00 + 13% tax = CNY 113.00"],
      [0, "CNY 50.00, no tax"],
      [13, "CNY 10.00 + 13% tax = CNY 11.30"],
    ]);
    // CNY 1,510 at the factory's prices, CNY 131.30 tax on top.
    expect(q).toMatchObject({ taxIncluded: false, taxRate: 13, factoryTotal: "1510.00", taxTotal: "131.30" });
    expect(q.lines[0]).not.toHaveProperty("hsCode");
    expect(q.lines[0]).not.toHaveProperty("rebateRate");
  });

  it("tax included: the price is our cost, the tax inside is shown and never added again, down to the order", async () => {
    // The same pump from two factories: CNY 1,000 + 13% on top, and CNY 1,130 with 13% included.
    const a = await deal("KE");
    const without = await offer(a.inquiryId, {
      newFactoryName: `Ruian Without ${tag}`,
      taxRate: 13,
      lines: [{ requestedItemId: a.items[0], description: "Gear pump", quantity: 10, unitPrice: 1000 }],
    });
    const b = await deal("KE");
    const included = await offer(b.inquiryId, {
      newFactoryName: `Ruian Included ${tag}`,
      taxIncluded: true,
      taxRate: 13,
      lines: [{ requestedItemId: b.items[0], description: "Gear pump", quantity: 10, unitPrice: 1130 }],
    });
    const qa = await quoteOf(a.inquiryId, without);
    const qb = await quoteOf(b.inquiryId, included);
    expect(qb).toMatchObject({ taxIncluded: true, taxRate: 13, factoryTotal: "11300.00", taxTotal: "1300.00" });
    expect(qb.lines[0]).toMatchObject({ taxRate: 13, costNote: "CNY 1,130.00, tax 13% included (CNY 130.00)" });
    // Our cost is the same either way: 1,130 a pump.
    expect(qb.lines[0].unitCost).not.toBeNull();
    expect(qb.lines[0].unitCost).toBe(qa.lines[0].unitCost);
    expect(qb.totalCost).toBe(qa.totalCost);

    // The quotation is costed from it, and the order owes the factory its prices as they are.
    const draft = (await api(app, sana).get(`/inquiries/${b.inquiryId}/quotation/draft`).expect(200)).body;
    const options = [{ ...draft.options[0], prices: draft.options[0].prices.map((p: Record<string, unknown>) => ({ ...p, unitPrice: 200 })) }];
    const rev = (await api(app, sana).post(`/inquiries/${b.inquiryId}/quotation/revisions`, { ...draft, options }).expect(201)).body;
    expect(rev.options[0].lines.find((l: { description: string }) => l.description === "Gear pump").unitCost).toBe(qa.lines[0].unitCost);
    await api(app, sana).post(`/revisions/${rev.id}/status`, { to: "sent" }).expect(200);
    await api(app, sana).post(`/revisions/${rev.id}/status`, { to: "accepted" }).expect(200);
    const orderId = (await api(app, sana).get(`/inquiries/${b.inquiryId}`)).body.orders[0].id;
    const order = (await api(app, sana).get(`/orders/${orderId}`).expect(200)).body;
    expect(order.lines[0].factoryPrice).toMatchObject({ unitPrice: "1130.00", taxRate: "13", taxIncluded: true, currency: "CNY" });
    const m = (await api(app, sana).get(`/orders/${orderId}/money`).expect(200)).body;
    // 10 × 1,130, not 10 × (1,130 + 13%).
    expect(m.factories.rows.map((f: { owed: string; toPay: string }) => [f.owed, f.toPay])).toEqual([["11300.00", "11300.00"]]);
  });

  it("changing the offer's % changes the lines that had it, not a line with its own; the audit says so", async () => {
    const { inquiryId, items } = await deal("NG");
    const id = await offer(inquiryId, {
      newFactoryName: `Yuhuan Valves ${tag}`,
      lines: [
        { requestedItemId: items[0], description: "Ball valve", quantity: 2, unitPrice: 100 },
        { requestedItemId: items[1], description: "Gasket", quantity: 2, unitPrice: 10, taxRate: 9 },
      ],
    });
    const q0 = await quoteOf(inquiryId, id);
    expect(q0.lines.map((l: Line) => l.taxRate)).toEqual([0, 9]);
    const body = { factoryId: q0.factory.id, receivedOn: q0.receivedOn, currency: "CNY" };
    await api(app, sana).put(`/factory-quotes/${id}`, { ...body, taxIncluded: true, taxRate: 13 }).expect(200);
    const q1 = await quoteOf(inquiryId, id);
    // The tax inside, on the total at each %: 200 − 200/1.13 = 23.01, 20 − 20/1.09 = 1.65.
    expect(q1).toMatchObject({ taxIncluded: true, taxRate: 13, factoryTotal: "220.00", taxTotal: "24.66" });
    expect(q1.lines.map((l: Line) => [l.taxRate, l.costNote])).toEqual([
      [13, "CNY 100.00, tax 13% included (CNY 11.50)"],
      [9, "CNY 10.00, tax 9% included (CNY 0.83)"],
    ]);
    // Left out: kept as it is.
    await api(app, sana).put(`/factory-quotes/${id}`, { ...body, leadTime: "30 days" }).expect(200);
    expect(await quoteOf(inquiryId, id)).toMatchObject({ taxIncluded: true, taxRate: 13, leadTime: "30 days" });
    const log = (await api(app, admin).get(`/audit?entityType=factory_quote&entityId=${id}`).expect(200)).body;
    const summaries = (log.rows ?? log).map((r: { summary: string }) => r.summary).join("\n");
    expect(summaries).toContain("tax 0% · added on top → 13% · included in the prices (1 line to 13%)");
  });

  it("leaves offers made before it as they were: without tax, at their lines' rate, the same costs", async () => {
    // Offers as they were before tax was per offer: lines at 13% (or their own %), the tax added on top.
    const { inquiryId, items } = await deal("NG");
    const mixed = await offer(inquiryId, {
      newFactoryName: `Old Mixed ${tag}`,
      taxRate: 13,
      lines: [
        { requestedItemId: items[0], description: "Gear pump", quantity: 3, unitPrice: "100.50" },
        { requestedItemId: items[1], description: "Spare seals", quantity: "4.10", unitPrice: "19.85", taxRate: 9 },
        { description: "Coupling", quantity: 1, unitPrice: "1.15" },
      ],
    });
    const nine = await offer(inquiryId, {
      newFactoryName: `Old Nine ${tag}`,
      lines: [{ requestedItemId: items[0], description: "Gear pump", quantity: 1, unitPrice: 100, taxRate: 9 }],
    });
    const empty = await offer(inquiryId, { newFactoryName: `Old Empty ${tag}` });
    const ids = [mixed, nine, empty];
    const before = await sourcing(inquiryId);
    // As the migration found them: no choice or % of their own yet.
    const db = app.get(PrismaService).company(FIRST_COMPANY_ID);
    await db.$executeRaw`update factory_quotes set tax_rate = 0, tax_included = true where id = any(${ids}::uuid[])`;
    const sql = readFileSync(path.join(__dirname, "../../../packages/database/prisma/migrations/20261203000000_factory_tax/migration.sql"), "utf8");
    const backfill = /UPDATE "factory_quotes" q[\s\S]*?"tax_included" = false/.exec(sql)![0];
    await db.$executeRaw`${Prisma.raw(backfill)} where q.id = any(${ids}::uuid[])`;
    const after = await sourcing(inquiryId);
    type Offer = Record<string, unknown> & { id: string; lines: Line[] };
    const byId = (v: { quotes: Offer[] }, id: string) => v.quotes.find((q) => q.id === id)!;
    expect(ids.map((id) => [byId(after, id).taxIncluded, byId(after, id).taxRate])).toEqual([
      [false, 13], // most of its lines
      [false, 9],
      [false, 13], // no lines: the old default
    ]);
    // Every line, cost and total exactly as before (only the offer's own % is new).
    const rest = ({ taxRate: _r, ...q }: Record<string, unknown>) => q;
    for (const id of ids) expect(rest(byId(after, id))).toEqual(rest(byId(before, id)));
    // And as they were always worked out: price + tax on top, × the quantity.
    const m = byId(after, mixed);
    expect(m.lines.map((l) => [l.taxRate, l.costNote])).toEqual([
      [13, "CNY 100.50 + 13% tax = CNY 113.57"],
      [9, "CNY 19.85 + 9% tax = CNY 21.64"],
      [13, "CNY 1.15 + 13% tax = CNY 1.30"],
    ]);
    const lines: [string, string, number][] = [["100.50", "3", 13], ["19.85", "4.10", 9], ["1.15", "1", 13]];
    const withTax = lines.reduce((t, [p, q, r]) => t + multiplyMinor(withTaxMinor(toMinor(p), r), q), 0);
    const plain = lines.reduce((t, [p, q]) => t + multiplyMinor(toMinor(p), q), 0);
    expect([m.factoryTotal, m.taxTotal]).toEqual([fromMinor(plain), fromMinor(withTax - plain)]);
  });

  it("takes the company's default for new offers from Settings", async () => {
    const sales = (await api(app, admin).get("/settings").expect(200)).body.sales;
    expect(sales).toMatchObject({ factoryTaxIncluded: false, factoryTaxRate: 0 });
    await api(app, admin).put("/settings/sales", { ...sales, factoryTaxIncluded: true, factoryTaxRate: 13 }).expect(200);
    try {
      const { inquiryId, items } = await deal("NG");
      const id = await offer(inquiryId, {
        newFactoryName: `Cixi Default ${tag}`,
        lines: [{ requestedItemId: items[0], description: "Gear pump", quantity: 1, unitPrice: 113 }],
      });
      const q = await quoteOf(inquiryId, id);
      expect(q).toMatchObject({ taxIncluded: true, taxRate: 13, factoryTotal: "113.00", taxTotal: "13.00" });
      expect(q.lines[0].taxRate).toBe(13);
    } finally {
      await api(app, admin).put("/settings/sales", sales).expect(200);
    }
  });

  it("quotes without tax: the total is the items less the discount, for any customer", async () => {
    const { inquiryId } = await deal("CN");
    const draft = (await api(app, sana).get(`/inquiries/${inquiryId}/quotation/draft`).expect(200)).body;
    expect(draft).not.toHaveProperty("vatRate");
    // No factory prices: the option is the customer's own items, priced by hand.
    const [pump, seals] = draft.options[0].prices.map((p: { lineId: string }) => p.lineId);
    const options = [{ ...draft.options[0], discount: 5, prices: [{ lineId: pump, unitPrice: 20 }, { lineId: seals, unitPrice: 0 }] }];
    const r = (await api(app, sana).post(`/inquiries/${inquiryId}/quotation/revisions`, { ...draft, vatRate: 13, options }).expect(201)).body;
    expect(r).toMatchObject({ subtotal: "200.00", discount: "5.00", total: "195.00" });
    expect(r).not.toHaveProperty("vatAmount");
  });

  it("has no export rebate or HS code pages any more", async () => {
    await api(app, sana).get("/hs-codes").expect(404);
  });
});
