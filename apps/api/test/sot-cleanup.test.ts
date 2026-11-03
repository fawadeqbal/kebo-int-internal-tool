import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIRST_COMPANY_ID } from "@kebo/database";
import { PrismaService } from "../src/database/prisma.service";
import { startApp } from "./app";

/**
 * Single source of truth, PR 5: no mirrors, no dead tables. What the database itself
 * now holds to (the rest is covered where each screen is tested).
 */
describe("no mirrors, no dead weight", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const db = () => prisma.company(FIRST_COMPANY_ID);

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  it("keeps a payment in its order's currency, and an order's currency under its payments", async () => {
    const p = await db().payment.findFirstOrThrow({ where: { voidedAt: null }, include: { order: { select: { id: true, currency: true } } } });
    const other = p.order.currency === "USD" ? "CNY" : "USD";
    await expect(db().payment.update({ where: { id: p.id }, data: { currency: other } })).rejects.toThrow(/order's currency/);
    await expect(db().payment.create({ data: { ...p, id: undefined, order: undefined, receiptNo: undefined, currency: other } as never })).rejects.toThrow(
      /order's currency/,
    );
    await expect(db().order.update({ where: { id: p.order.id }, data: { currency: other } })).rejects.toThrow(/its currency stays/);
    // Every payment there is agrees (the readers count them all, unfiltered).
    const [{ off }] = await prisma.platform.$queryRaw<{ off: bigint }[]>`
      select count(*) as off from payments p join orders o on o.id = p.order_id where p.voided_at is null and p.currency <> o.currency`;
    expect(Number(off)).toBe(0);
  });

  it("has no production steps table (the timeline is the checklist's)", async () => {
    const [{ t }] = await prisma.platform.$queryRaw<{ t: string | null }[]>`select to_regclass('production_steps')::text as t`;
    expect(t).toBeNull();
  });

  it("keeps no condition on the order, and no figures on a revision", async () => {
    const cols = await prisma.platform.$queryRaw<{ c: string }[]>`
      select table_name || '.' || column_name as c from information_schema.columns
       where (table_name = 'orders' and column_name = 'delivery_condition')
          or (table_name = 'quotation_revisions' and column_name in ('subtotal', 'discount', 'total', 'lead_time'))`;
    expect(cols).toEqual([]);
  });
});
