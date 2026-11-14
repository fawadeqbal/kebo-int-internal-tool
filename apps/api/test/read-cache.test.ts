import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ReadCache } from "../src/common/cache/read-cache";
import { CompanyContext } from "../src/common/company/company-context";
import { api, signIn, startApp } from "./app";

describe("read cache", () => {
  it("shares one computation between requests that arrive together, and forgets on a change", async () => {
    process.env.READ_CACHE_SECONDS = "60";
    const cache = new ReadCache();
    const a = { id: "a", slug: "a", name: "A", kind: "client", status: "active", statusReason: null, endsAt: null, planId: null, featuresOff: [] as string[], domain: null } as const;
    const b = { ...a, id: "b", slug: "b", name: "B" };
    let runs = 0;
    const load = async () => {
      runs += 1;
      await new Promise((r) => setTimeout(r, 20));
      return runs;
    };
    await CompanyContext.run(a, async () => {
      const [x, y, z] = await Promise.all([cache.get("k", load), cache.get("k", load), cache.get("k", load)]);
      expect([x, y, z]).toEqual([1, 1, 1]);
      expect(await cache.get("k", load)).toBe(1);
    });
    // Another company never gets the first one's result, and a change in it leaves the first alone.
    await CompanyContext.run(b, async () => {
      expect(await cache.get("k", load)).toBe(2);
      cache.bump();
      expect(await cache.get("k", load)).toBe(3);
    });
    await CompanyContext.run(a, async () => {
      expect(await cache.get("k", load)).toBe(1);
      cache.bump();
      expect(await cache.get("k", load)).toBe(4);
      // A failure is not kept.
      await expect(cache.get("bad", () => Promise.reject(new Error("no")))).rejects.toThrow("no");
      expect(await cache.get("bad", async () => "ok")).toBe("ok");
    });
    process.env.READ_CACHE_SECONDS = "0";
  });

  describe("through the API", () => {
    let app: INestApplication;
    let manager: string;
    beforeAll(async () => {
      process.env.READ_CACHE_SECONDS = "60";
      app = await startApp();
      manager = await signIn(app, "manager@example.com", "Manager@12345");
    });
    afterAll(async () => {
      process.env.READ_CACHE_SECONDS = "0";
      await app?.close();
    });

    it("shows a new expense in where we lose money at once, though that report is remembered", async () => {
      const day = new Date().toISOString().slice(0, 10);
      const spent = async () => {
        const r = (await api(app, manager).get(`/reports/leaks?from=${day.slice(0, 4)}-01-01&to=${day}`).expect(200)).body;
        return Number(r.trend.at(-1).expenses);
      };
      const before = await spent();
      expect(await spent()).toBe(before);
      const order = ((await api(app, manager).get("/orders?status=open").expect(200)).body as { id: string; currency: string }[]).find((o) => o.currency === "USD")!;
      await api(app, manager)
        .post("/expenses", { orderId: order.id, category: "inspection", description: "Read cache", amount: 3, currency: "USD", spentOn: day })
        .expect(201);
      expect((await spent()) - before).toBeCloseTo(3, 2);
    });
  });
});
