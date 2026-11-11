import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A table is written by exactly one module (architecture review §7.2). Other modules ask the owner through its
 * interface (`<module>/api.ts`) or its exported services. Add a table here when its owner is settled.
 */
const OWNERS: Record<string, string> = {
  moneyMovement: "treasury",
  allocation: "treasury",
  moneyAccount: "treasury",
};

const MODULES = resolve(__dirname, "../src/modules");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
  });
const WRITE = /\b(?:tx|db|this\.prisma\.db)\.(\w+)\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g;

describe("table owners", () => {
  it("writes each owned table only from its module", () => {
    const wrong: string[] = [];
    for (const file of files(MODULES)) {
      const module = relative(MODULES, file).split("/")[0]!;
      for (const [, model] of readFileSync(file, "utf8").matchAll(WRITE))
        if (OWNERS[model!] && OWNERS[model!] !== module) wrong.push(`${relative(MODULES, file)} writes ${model} (owned by ${OWNERS[model!]})`);
    }
    expect(wrong).toEqual([]);
  });
});
