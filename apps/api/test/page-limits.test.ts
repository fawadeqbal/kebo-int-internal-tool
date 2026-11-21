import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * One Pager, fed by the server (21 Nov): a list asks for one page and never gets more than 100 rows. Every page size
 * a request may ask for is capped at 100 (pageSize, take); a bigger read stays inside the server (an export, a sum).
 */
const SRC = resolve(__dirname, "../src");
const SHARED = resolve(__dirname, "../../../packages/shared/src");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });

describe("no list sends more than 100 rows a page", () => {
  it("every pageSize and take a request may ask for is at most 100", () => {
    const over = [...walk(SRC), ...walk(SHARED)].flatMap((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        .map((line, i) => ({ line, i }))
        .filter(({ line }) => /\b(pageSize|take|limit|latest)\b\s*:\s*z\./.test(line))
        .filter(({ line }) => Number(/\.max\((\d+)\)/.exec(line)?.[1] ?? 0) > 100)
        // The insights' facts are read whole to be counted into charts (a report, not a list on a page).
        .filter(() => !f.endsWith("insights/facts/facts.controller.ts"))
        .map(({ line, i }) => `${relative(resolve(__dirname, "../../.."), f)}:${i + 1}: ${line.trim()}`),
    );
    expect(over).toEqual([]);
  });
});
