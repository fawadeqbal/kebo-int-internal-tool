import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIRST_COMPANY_ID } from "@kebo/database";
import { orderStatusLine, type ProgressItem } from "@kebo/shared";
import { api, signIn, startApp } from "./app";
import { today } from "./dates";
import { PrismaService } from "../src/database/prisma.service";

type Row = { id: string; refNo: string; stage: string; word: string; status: string };

/**
 * One word for where an order stands, the same everywhere: the list row, the order itself and its to-do items
 * say the same thing, because the word is worked out from what is stored and never from the stage someone set.
 */
describe("the order's one status word", () => {
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

  it("is the same in the list, on the order and in its to-do items", async () => {
    const rows = ((await api(app, manager).get("/orders?status=open&limit=12").expect(200)).body as Row[]).slice(0, 12);
    for (const r of rows) {
      const o = (await api(app, manager).get(`/orders/${r.id}`).expect(200)).body as { word: string };
      expect(o.word, r.refNo).toBe(r.word);
      const steps = (await api(app, manager).get(`/orders/${r.id}/steps`).expect(200)).body as { items: ProgressItem[] };
      const fromItems = orderStatusLine(steps.items, {}, today);
      // The items alone call an order with everything ticked "Done"; the word says so only once it is closed.
      if (fromItems.stage !== "Done") expect(fromItems.stage, r.refNo).toBe(r.word);
    }
  });

  it("follows the facts, not a stage moved by hand: back when the factory order is undone, forward only when it is placed", async () => {
    const db = prisma.company(FIRST_COMPANY_ID);
    // An open order not ordered from the factory yet and with nothing shipped: Confirmed.
    const o = await db.order.findFirst({
      where: { status: "open", stage: "confirmed", factoryOrderedOn: null, shipments: { none: {} }, delivery: null },
      select: { id: true, refNo: true },
    });
    if (!o) return; // the seed has none (nothing to check)
    const word = async () => (await api(app, manager).get(`/orders/${o.id}`).expect(200)).body as { word: string; stage: string };
    expect((await word()).word).toBe("Confirmed");
    // Someone moves the stage on by hand: the stored stage changes, the word does not (nothing was ordered).
    await api(app, manager).post(`/orders/${o.id}/stage`, { to: "in_production", confirm: true }).expect(200);
    try {
      expect(await word()).toMatchObject({ stage: "in_production", word: "Confirmed" });
      const inList = (
        (
          await api(app, manager)
            .get(`/orders?status=open&q=${encodeURIComponent(o.refNo)}`)
            .expect(200)
        ).body as Row[]
      ).find((r) => r.id === o.id);
      expect(inList?.word).toBe("Confirmed");
      // The factory order is placed: now it is in production; taken back: Confirmed again.
      await db.order.update({ where: { id: o.id }, data: { factoryOrderedOn: new Date(`${today}T00:00:00Z`) } });
      expect((await word()).word).toBe("In production");
      await db.order.update({ where: { id: o.id }, data: { factoryOrderedOn: null } });
      expect((await word()).word).toBe("Confirmed");
    } finally {
      // Put the stage back as it was.
      await db.order.update({ where: { id: o.id }, data: { factoryOrderedOn: null } });
      await api(app, manager).post(`/orders/${o.id}/stage`, { to: "confirmed", reason: "Moved by mistake in a test" }).expect(200);
    }
  });

  it("counts the list's chips by the word each row shows", async () => {
    type Page = { rows: Row[]; total: number; counts: Record<string, number> };
    const under = (w: string) => (w === "Confirmed" ? "confirmed" : w === "In production" ? "in_production" : "shipped");
    for (const col of ["confirmed", "in_production", "shipped"]) {
      const page = (await api(app, manager).get(`/orders/page?status=open&stage=${col}&page=1&pageSize=100`).expect(200)).body as Page;
      // The chip's number is how many rows it lists, and every row it lists shows a word under that chip.
      expect(page.total, col).toBe(page.counts[col]);
      expect(
        page.rows.filter((r) => under(r.word) !== col).map((r) => r.refNo),
        col,
      ).toEqual([]);
    }
  });
});
