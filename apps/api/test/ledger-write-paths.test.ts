import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every write of money (customer payment entries and what they pay, factory payments, expenses, transfers
 * between accounts, money accounts, orders made) posts to the ledger in the same method: a new write path that
 * does not fails here. The customer-money functions (treasury/customer-money.ts) are called inside such methods. Writes that touch only a file (a proof, a receipt, its name) are listed with why.
 */
const SRC = path.join(__dirname, "../src");
const MONEY =
  /\b(?:tx|db|this\.prisma\.db)\.(moneyMovement|allocation|factoryPayment|expense|moneyTransfer|moneyAccount|order)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/;
const METHOD = /^ {2}(?:(?:async|private|protected|public|static)\s+)*([A-Za-z0-9_]+)\s*(?:<[^>]*>)?\(/;

/** file:method → why it posts nothing. */
const FILE_ONLY: Record<string, string> = {
  "modules/money/payment-files.service.ts:update": "the proof's file columns only (fileKey, fileName, fileType, fileSize)",
  "modules/money/money.service.ts:attachReceipt": "the receipt's file columns only",
  "modules/money/money.service.ts:removeReceipt": "the receipt's file columns only",
  "modules/files/order-files.service.ts:update": "a file's name only (fileName, receiptName)",
  "modules/approvals/approvals.service.ts:approve":
    "moves the photo onto the payment or expense recorded (and posted) by record()/createExpense()",
};
/** Order writes that change no money (stage, dates, details, packing, the proforma's number…): only these post. */
const ORDER_MONEY = new Set(["create"]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });
}

describe("every money write path posts to the ledger", () => {
  it("each method that writes money calls ledger.post (or only touches a file)", () => {
    const missing: string[] = [];
    let found = 0;
    for (const file of files(path.join(SRC, "modules")).filter((f) => !f.includes(`${path.sep}ledger${path.sep}`))) {
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      const lines = readFileSync(file, "utf8").split("\n");
      const starts = lines.flatMap((l, i) => {
        const m = METHOD.exec(l);
        return m && !["if", "for", "while", "switch", "catch", "return"].includes(m[1]!) ? [{ i, name: m[1]! }] : [];
      });
      lines.forEach((l, i) => {
        const m = MONEY.exec(l);
        if (!m) return;
        if (m[1] === "order" && !ORDER_MONEY.has(m[2]!)) return;
        const at = [...starts].reverse().find((s) => s.i <= i);
        if (!at) return;
        const end = starts.find((s) => s.i > at.i)?.i ?? lines.length;
        const body = lines.slice(at.i, end).join("\n");
        found += 1;
        if (body.includes("ledger.post(") || FILE_ONLY[`${rel}:${at.name}`]) return;
        missing.push(`${rel}:${at.name} (line ${i + 1}: ${m[1]}.${m[2]})`);
      });
    }
    expect(found).toBeGreaterThan(20);
    expect(missing, `money written without posting to the ledger:\n${missing.join("\n")}`).toEqual([]);
  });
});
