import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import { MODULES, SRC, tsFiles } from "./source-files";

/**
 * A table is written by exactly one module (architecture review §7.2). Other modules ask the owner through its
 * interface (`<module>/api.ts`) or its exported services. Add a table here when its owner is settled.
 */
const OWNERS: Record<string, string> = {
  moneyMovement: "treasury",
  allocation: "treasury",
  moneyAccount: "treasury",
  invoice: "billing",
  orderDelivery: "flow",
  purchaseOrder: "flow",
  orderCancellation: "cancellation",
  orderPaymentTerms: "orders",
  orderPaper: "documents",
  orderDocument: "documents",
};

const WRITE = /\b(?:tx|db|this\.prisma\.db)\.(\w+)\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g;

describe("table owners", () => {
  it("writes each owned table only from its module", () => {
    const wrong: string[] = [];
    for (const file of tsFiles(MODULES)) {
      const module = relative(MODULES, file).split("/")[0]!;
      for (const [, model] of readFileSync(file, "utf8").matchAll(WRITE))
        if (OWNERS[model!] && OWNERS[model!] !== module) wrong.push(`${relative(MODULES, file)} writes ${model} (owned by ${OWNERS[model!]})`);
    }
    expect(wrong).toEqual([]);
  });

  it("gives out numbers only through the counters helpers", () => {
    // nextCount / nextReference / claimOnce (packages/database/src/counters.ts): one place takes a number.
    const raw = tsFiles(SRC)
      .filter((file) => /insert\s+into\s+counters/i.test(readFileSync(file, "utf8")))
      .map((file) => relative(MODULES, file));
    expect(raw).toEqual([]);
  });
});
