import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";

/**
 * Every list's tabs: the number on a tab is exactly how many rows that tab lists (its `total`), for the
 * same search. A number that does not match what you see is the first thing that breaks trust.
 */
describe("tab counts match what each tab lists", () => {
  let app: INestApplication;
  let admin: string;

  beforeAll(async () => {
    app = await startApp();
    admin = await signIn(app, "admin@example.com", "Admin@12345");
  });

  afterAll(async () => {
    await app?.close();
  });

  const get = async (path: string, query: Record<string, string | undefined> = {}) => {
    const q = new URLSearchParams(Object.entries(query).filter((e): e is [string, string] => e[1] !== undefined));
    const res = await api(app, admin).get(`${path}${q.size ? `?${q}` : ""}`);
    expect(res.status, `${path}?${q} → ${res.status}`).toBe(200);
    return res.body;
  };
  const check = async (path: string, base: Record<string, string | undefined>, tabs: [string, Record<string, string>][], counts: (b: Record<string, unknown>) => Record<string, number>) => {
    const first = await get(path, { ...base, pageSize: "1" });
    const c = counts(first);
    for (const [key, params] of tabs) {
      const tab = await get(path, { ...base, ...params, pageSize: "1" });
      expect(c[key], `${path} tab "${key}" (${JSON.stringify({ ...base, ...params })})`).toBe(tab.total);
    }
  };

  it("inquiries", async () => {
    for (const base of [{}, { q: "a" }]) {
      const open = (b: Record<string, unknown>) => {
        const c = b.counts as Record<string, number>;
        return { ...c, open: (c.new ?? 0) + (c.sourcing ?? 0) + (c.quoted ?? 0) };
      };
      await check(
        "/inquiries",
        base,
        ["open", "new", "sourcing", "quoted", "on_hold", "won", "lost", "overdue"].map((s) => [s, { stage: s }]),
        open,
      );
    }
  });

  it("sales orders", async () => {
    for (const base of [{}, { q: "SO" }]) {
      await check(
        "/orders/page",
        base,
        [
          ["open", { status: "open" }],
          ["late", { status: "late" }],
          ["closed", { status: "closed" }],
          ["cancelled", { status: "cancelled" }],
          ["all", { status: "all" }],
          ["confirmed", { stage: "confirmed" }],
          ["in_production", { stage: "in_production" }],
          ["shipped", { stage: "shipped" }],
          ["done", { stage: "done" }],
        ],
        (b) => b.counts as Record<string, number>,
      );
    }
  });

  it("payments (removed ones only under Removed)", async () => {
    for (const base of [{ from: "2000-01-01", to: "2100-01-01" }, { from: "2000-01-01", to: "2100-01-01", q: "a" }]) {
      await check(
        "/treasury/payments",
        base,
        [
          ["all", {}],
          ["in", { dir: "in" }],
          ["out", { dir: "out" }],
          ["move", { dir: "move" }],
          ["expense", { kind: "expense" }],
          ["to_verify", { status: "to_verify" }],
          ["void", { status: "void" }],
        ],
        (b) => b.counts as Record<string, number>,
      );
    }
  });

  it("customers and suppliers", async () => {
    for (const base of [{}, { q: "a" }]) {
      await check(
        "/customers",
        base,
        [
          ["all", {}],
          ["company", { type: "company" }],
          ["individual", { type: "individual" }],
          ["archived", { archived: "true" }],
        ],
        (b) => b.counts as Record<string, number>,
      );
      await check(
        "/factories",
        base,
        [
          ["all", {}],
          ["offers", { status: "offers" }],
          ["none", { status: "none" }],
          ["mine", { mine: "true" }],
        ],
        (b) => b.counts as Record<string, number>,
      );
    }
  });

  it("alerts and the activity log", async () => {
    const n = await get("/notifications", { counts: "true", take: "1" });
    const groups = Object.keys(n.counts).filter((k) => k !== "all" && k !== "unread");
    expect(groups.length).toBeGreaterThan(0);
    expect(n.counts.all).toBe((await get("/notifications", { take: "1" })).total);
    expect(n.counts.unread).toBe((await get("/notifications", { unread: "true", take: "1" })).total);
    for (const g of groups) expect(n.counts[g], `alerts tab ${g}`).toBe((await get("/notifications", { group: g, take: "1" })).total);
    // The bell (every page) asks without counts: they are not worked out for it.
    expect((await get("/notifications", { take: "1" })).counts).toBeUndefined();

    for (const base of [{}, { q: "order" }]) {
      const a = await get("/audit", { ...base, pageSize: "1" });
      const kinds = Object.keys(a.counts);
      expect(Object.values(a.counts as Record<string, number>).reduce((x, y) => x + y, 0)).toBe(a.total);
      for (const k of kinds.slice(0, 5)) expect(a.counts[k], `audit ${k}`).toBe((await get("/audit", { ...base, entityType: k, pageSize: "1" })).total);
    }
  });
  it("purchase orders (one page at a time, counts for the same search)", async () => {
    const tabs = ["all", "not_sent", "in_production", "ready", "shipped", "cancelled"];
    for (const base of [{}, { q: "PO" }, { ready: "none" }]) {
      await check(
        "/operations/purchase-orders/page",
        base,
        tabs.map((t) => [t, { status: t }]),
        (b) => b.counts as Record<string, number>,
      );
    }
    // Only the page asked for comes back, and the pages add up to the tab.
    const first = await get("/operations/purchase-orders/page", { pageSize: "5" });
    expect(first.rows.length).toBeLessThanOrEqual(5);
    expect(first.total).toBe(first.counts.all);
    const all = await get("/operations/purchase-orders", { all: "true" });
    expect(first.total).toBe(all.length);
  });
});
