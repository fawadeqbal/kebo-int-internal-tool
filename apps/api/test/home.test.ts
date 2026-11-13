import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";
import { today } from "./dates";

type Stage = { key: string; label: string; count: number; value: string | null; note: string; level: string | null };
type Home = {
  currency: string;
  today: string;
  seeMoney: boolean;
  seeProfit: boolean;
  month: {
    sold: { now: string; before: string; orders: number };
    collected: { now: string; before: string; payments: number } | null;
    profit: { now: string; margin: number | null; marginBefore: number | null; afterCompanyCosts: boolean };
    cash: { total: string; byCurrency: { currency: string; amount: string; inMain: string }[] } | null;
  };
  standout: { key: string; level: "bad" | "warn" | "ok" | "info"; lead: string; text: string; href: string; link: string }[];
  weeks: { from: string; to: string; in: string; out: string; after: string }[] | null;
  months: { month: string; orders: number; sold: string; profit: string }[];
  orders: { open: number; value: string; stages: Stage[] };
  thin: { count: number; rows: { orderId: string; margin: number; profit: string }[]; others: number } | null;
  inquiries: { open: number; stages: Stage[]; won: { won: number; answered: number; rate: number | null } };
};
const cents = (v: string) => Math.round(Number(v) * 100);

/**
 * Money, step 6: Home's figures in one read (GET /insights/home). The rules behind the sentences and the
 * four weeks are tested on their own (home-rules.test.ts); here: who may read it, and that its parts agree
 * with each other whatever else is being recorded.
 */
describe("Home's figures", () => {
  let app: INestApplication;
  let admin: string;
  let sana: string;
  let h: Home;

  beforeAll(async () => {
    app = await startApp();
    admin = await signIn(app, "admin@example.com", "Admin@12345");
    sana = await signIn(app, "sana@example.com");
    h = (await api(app, admin).get("/insights/home").expect(200)).body as Home;
  });
  afterAll(async () => {
    await app?.close();
  });

  it("is for people who see the reports", async () => {
    await api(app, sana).get("/insights/home").expect(403);
    expect(h).toMatchObject({ today, seeMoney: true, seeProfit: true });
  });

  it("the month's figures and the last of the six months are the same month", () => {
    expect(h.months).toHaveLength(6);
    expect(h.months.map((m) => m.month)).toEqual([...h.months.map((m) => m.month)].sort());
    const last = h.months[5]!;
    expect(last.month).toBe(today.slice(0, 7));
    expect(last.sold).toBe(h.month.sold.now);
    expect(last.orders).toBe(h.month.sold.orders);
    expect(last.profit).toBe(h.month.profit.now);
    expect(h.month.profit.afterCompanyCosts).toBe(true);
  });

  it("the next four weeks start today, follow each other, and carry the cash forward", () => {
    const w = h.weeks!;
    expect(w).toHaveLength(4);
    expect(w[0]!.from).toBe(today);
    let cash = cents(h.month.cash!.total);
    for (const x of w) {
      cash += cents(x.in) - cents(x.out);
      expect(cents(x.after)).toBe(cash);
      expect((Date.parse(x.to) - Date.parse(x.from)) / 86_400_000).toBe(6);
    }
    for (let i = 1; i < 4; i++) expect((Date.parse(w[i]!.from) - Date.parse(w[i - 1]!.to)) / 86_400_000).toBe(1);
    expect(cents(h.month.cash!.total)).toBe(h.month.cash!.byCurrency.reduce((t, x) => t + cents(x.inMain), 0));
  });

  it("what stands out is at most five sentences, each once, what needs acting on first, each with its page", () => {
    const rank = { bad: 0, warn: 1, ok: 2, info: 3 };
    expect(h.standout.length).toBeLessThanOrEqual(5);
    expect(new Set(h.standout.map((s) => s.key)).size).toBe(h.standout.length);
    expect(h.standout.map((s) => rank[s.level])).toEqual([...h.standout.map((s) => rank[s.level])].sort());
    for (const s of h.standout) {
      expect(s.lead.length).toBeGreaterThan(5);
      expect(s.text.endsWith(".")).toBe(true);
      expect(s.href.startsWith("/")).toBe(true);
    }
  });

  it("orders and inquiries are counted by stage, and add up to what is open", () => {
    expect(h.orders.stages.map((s) => s.key)).toEqual(["confirmed", "in_production", "shipped", "done"]);
    expect(h.orders.stages.reduce((t, s) => t + s.count, 0)).toBe(h.orders.open);
    expect(h.orders.stages.reduce((t, s) => t + cents(s.value!), 0)).toBe(cents(h.orders.value));
    expect(h.inquiries.stages.map((s) => s.key)).toEqual(["new", "sourcing", "quoted"]);
    expect(h.inquiries.stages.reduce((t, s) => t + s.count, 0)).toBeLessThanOrEqual(h.inquiries.open);
    expect(h.inquiries.won.won).toBeLessThanOrEqual(h.inquiries.won.answered);
  });

  it("thin orders are open orders under 10%, the lowest first, four at most", () => {
    const t = h.thin!;
    expect(t.rows.length).toBeLessThanOrEqual(4);
    expect(t.rows.length).toBeLessThanOrEqual(t.count);
    for (const r of t.rows) expect(r.margin).toBeLessThan(10);
    expect(t.rows.map((r) => r.margin)).toEqual([...t.rows.map((r) => r.margin)].sort((a, b) => a - b));
  });
});
