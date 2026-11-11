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

  const today = new Date().toISOString().slice(0, 10);
  const ok = async (who: string, path: string) => {
    const res = await api(app, who).get(path);
    expect(res.status, `${path} → ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`).toBeLessThan(500);
    return res.body;
  };

  it("lists and pages", async () => {
    for (const who of [manager, staff]) {
      for (const path of ["/auth/me", "/dashboard", "/notifications", "/me/todo", "/me/two-step", "/users/people", "/inquiries", "/customers", "/factories", "/orders", "/orders?status=closed", "/orders?status=cancelled", "/orders?mine=true&late=true", "/orders/page", "/orders/page?status=late&q=a", "/orders/page?status=all&mine=true&page=2", "/money/payables", "/submissions?mine=true&status=all", "/me/today", "/follow-ups", "/follow-ups?mine=true&open=true", "/follow-ups?open=false&page=2", `/follow-ups?on=${today}`, `/follow-ups?from=${today}&to=${today}`]) await ok(who, path);
    }
    for (const path of ["/reports", "/audit", "/users", "/settings", "/settings/checklist", "/submissions", "/submissions?status=all"]) await ok(admin, path);
  });

  it("every deal, with its sourcing and quotation", async () => {
    const deals = (await ok(manager, "/inquiries?pageSize=100")).rows as { id: string }[];
    expect(deals.length).toBeGreaterThan(0);
    for (const d of deals) {
      await ok(manager, `/inquiries/${d.id}`);
      await ok(manager, `/inquiries/${d.id}/sourcing`);
      await ok(manager, `/inquiries/${d.id}/factory-requests`);
      const q = await ok(manager, `/inquiries/${d.id}/quotation`);
      for (const r of (q?.revisions ?? []) as { id: string }[]) await ok(manager, `/revisions/${r.id}`);
    }
  });

  it("every customer and factory", async () => {
    for (const c of (await ok(manager, "/customers?pageSize=100")).rows as { id: string }[]) {
      await ok(manager, `/customers/${c.id}`);
      await ok(manager, `/customers/${c.id}/credit`);
      await ok(manager, `/payments?customerId=${c.id}`);
    }
    for (const f of (await ok(manager, "/factories?pageSize=100")).rows as { id: string }[]) await ok(manager, `/factories/${f.id}`);
  });

  it("every record's notes and follow-ups, and every follow-up", async () => {
    const records: [string, string][] = [
      ...((await ok(manager, "/inquiries?pageSize=100")).rows as { id: string }[]).map((r) => ["inquiries", r.id] as [string, string]),
      ...((await ok(manager, "/orders")) as { id: string }[]).map((r) => ["orders", r.id] as [string, string]),
      ...((await ok(manager, "/customers?pageSize=100")).rows as { id: string }[]).map((r) => ["customers", r.id] as [string, string]),
      ...((await ok(manager, "/factories?pageSize=100")).rows as { id: string }[]).map((r) => ["factories", r.id] as [string, string]),
    ];
    const key = { inquiries: "inquiryId", orders: "orderId", customers: "customerId", factories: "factoryId" } as Record<string, string>;
    for (const [kind, id] of records) {
      for (const who of [manager, staff]) {
        await ok(who, `/${kind}/${id}/notes`);
        await ok(who, `/follow-ups?${key[kind]}=${id}`);
      }
    }
    const all = (await ok(manager, "/follow-ups?pageSize=200")) as { rows: { id: string }[] };
    for (const f of all.rows) {
      await ok(manager, `/follow-ups/${f.id}`);
      await ok(staff, `/follow-ups/${f.id}`);
    }
  });

  it("every money submission and its photo", async () => {
    const all = (await ok(manager, "/submissions?status=all&pageSize=200")) as { rows: { id: string; file: { id: string } | null }[] };
    const mine = (await ok(staff, "/submissions?status=all&mine=true&pageSize=200")) as { rows: { id: string }[] };
    for (const s of all.rows) {
      await ok(manager, `/submissions/${s.id}`);
      if (s.file) await ok(manager, `/files/${s.file.id}`);
      await ok(staff, `/submissions/${s.id}`);
    }
    for (const s of mine.rows) await ok(staff, `/submissions/${s.id}`);
  });

  it("the ledger: lists, every entry, every party's ledger, ageing, accounts", async () => {
    for (const q of ["", "?lead=true", "?removed=false", "?type=correction", "?account=sales", "?account=money:", "?currency=USD&page=2&pageSize=5", `?from=2020-01-01&to=${today}`])
      await ok(manager, `/ledger/entries${q}`);
    const all = (await ok(manager, "/ledger/entries?pageSize=500")) as { rows: { id: string; groupId: string }[] };
    expect(all.rows.length).toBeGreaterThan(0);
    for (const g of [...new Set(all.rows.map((r) => r.groupId))]) await ok(manager, `/ledger/entries/${g}`);
    for (const c of (await ok(manager, "/customers?pageSize=100")).rows as { id: string }[]) {
      await ok(manager, `/ledger/parties/customer/${c.id}`);
      await ok(manager, `/ledger/parties/customer/${c.id}?onlyOpen=true&removed=true&from=2020-01-01`);
      await ok(manager, `/ledger/parties/customer/${c.id}/statement`);
    }
    for (const f of (await ok(manager, "/factories?pageSize=100")).rows as { id: string }[]) {
      await ok(manager, `/ledger/parties/factory/${f.id}`);
      await ok(manager, `/ledger/parties/factory/${f.id}/statement?currency=CNY`);
    }
    for (const u of (await ok(admin, "/users")) as { id: string }[]) {
      await ok(manager, `/ledger/parties/staff/${u.id}`);
      await ok(manager, `/ledger/parties/staff/${u.id}/statement`);
    }
    for (const side of ["receivable", "payable", "staff"]) await ok(manager, `/ledger/ageing?side=${side}`);
    await ok(manager, "/ledger/accounts");
    await ok(manager, `/ledger/accounts?to=${today}`);
    await ok(manager, "/ledger/check");
    // Staff without ledger.view: refused, never a 500.
    for (const path of ["/ledger/entries", "/ledger/accounts", "/ledger/ageing"]) expect((await api(app, staff).get(path)).status).toBe(403);
  }, 120_000);

  it("an order's money (plan, factory plans, credit) for the latest orders", async () => {
    const orders = [...(await ok(manager, "/orders")), ...(await ok(manager, "/orders?status=cancelled"))] as { id: string }[];
    for (const o of orders.slice(0, 25)) await ok(manager, `/orders/${o.id}/money`);
  });

  it("every order, its payments and its documents", async () => {
    const orders = [...(await ok(manager, "/orders")), ...(await ok(manager, "/orders?status=closed")), ...(await ok(manager, "/orders?status=cancelled"))] as { id: string }[];
    expect(orders.length).toBeGreaterThan(0);
    const rendered: Record<string, number> = {};
    for (const o of orders) {
      await ok(manager, `/orders/${o.id}`);
      await ok(manager, `/orders/${o.id}/payments`);
      await ok(manager, `/orders/${o.id}/flow`);
      await ok(manager, `/orders/${o.id}/steps`);
      await ok(manager, `/orders/${o.id}/defaults`);
      await ok(manager, `/history?type=order&id=${o.id}&step=production`);
      for (const kind of ["proforma", "packing-list"]) await ok(manager, `/orders/${o.id}/documents/${kind}`);
      const papers = (await ok(manager, `/orders/${o.id}/papers`)) as { papers: { kind: string; ref: string | null; makeable: boolean; live: boolean }[] };
      // Each kind of paper on a few orders (every kind, every route), not every paper of every order.
      for (const p of papers.papers.filter((x) => x.makeable || x.live)) {
        if ((rendered[p.kind] = (rendered[p.kind] ?? 0) + 1) > 3) continue;
        const q = p.ref ? `?ref=${p.ref}` : "";
        await ok(manager, `/orders/${o.id}/papers/${p.kind}/doc${q}`);
        await ok(manager, `/orders/${o.id}/papers/${p.kind}/checks${q}`);
      }
      await ok(staff, `/orders/${o.id}/papers`);
    }
  }, 120_000);
});
