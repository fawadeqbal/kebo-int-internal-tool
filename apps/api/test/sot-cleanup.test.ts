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
    const p = await db().allocation.findFirstOrThrow({
      where: { voidedAt: null, target: "order" },
      include: { order: { select: { id: true, currency: true } }, movement: true },
    });
    const other = p.order!.currency === "USD" ? "CNY" : "USD";
    // What pays an order counts in its currency: the entry's allocation currency.
    await expect(db().moneyMovement.update({ where: { id: p.movementId }, data: { allocCurrency: other } })).rejects.toThrow(/order's currency/);
    const elsewhere = await db().moneyMovement.create({
      data: { ...p.movement, id: undefined, allocCurrency: other, currency: other, voidedAt: null, createdAt: undefined, updatedAt: undefined } as never,
    });
    await expect(
      db().allocation.create({
        data: { movementId: elsewhere.id, target: "order", orderId: p.order!.id, amount: 1, share: 1, on: p.on, recordedById: p.recordedById },
      }),
    ).rejects.toThrow(/order's currency/);
    await db().moneyMovement.delete({ where: { id: elsewhere.id } });
    await expect(db().order.update({ where: { id: p.order!.id }, data: { currency: other } })).rejects.toThrow(/its currency stays/);
    // Every payment there is agrees (the readers count them all, unfiltered).
    const [{ off }] = await prisma.platform.$queryRaw<{ off: bigint }[]>`
      select count(*) as off from allocations a join money_movements m on m.id = a.movement_id join orders o on o.id = a.order_id
       where a.voided_at is null and m.alloc_currency <> o.currency`;
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
