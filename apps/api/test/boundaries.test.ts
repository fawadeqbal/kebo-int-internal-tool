import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import known from "./boundaries.known.json";

/**
 * Module boundaries (architecture review §7.2). Today's imports from one module
 * into another are listed in boundaries.known.json; the list may only shrink.
 * A new line there means new coupling: use the other module's interface or an
 * event instead, or add the line on purpose in the same change.
 */
const MODULES = resolve(__dirname, "../src/modules");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
  });
}

const moduleOf = (path: string) => {
  const rel = relative(MODULES, path);
  return rel.startsWith("..") ? null : rel.split("/")[0]!;
};

const all = files(MODULES);

function edges(): string[] {
  const found = new Set<string>();
  for (const file of all) {
    const from = moduleOf(file)!;
    for (const [, target] of readFileSync(file, "utf8").matchAll(/from\s+"(\.{1,2}\/[^"]+)"/g)) {
      const to = moduleOf(resolve(dirname(file), target!));
      if (to && to !== from) found.add(`${from} -> ${to}`);
    }
  }
  return [...found].sort();
}

describe("module boundaries", () => {
  const now = edges();

  it("adds no import from one module into another", () => {
    expect(now.filter((e) => !known.includes(e))).toEqual([]);
  });

  it("keeps the known list true: an import that is gone is taken off the list", () => {
    expect(known.filter((e) => !now.includes(e))).toEqual([]);
  });

  it("keeps controllers in their own files, out of *.module.ts", () => {
    const inline = all.filter((f) => f.endsWith(".module.ts") && /^@Controller\(/m.test(readFileSync(f, "utf8")));
    expect(inline.map((f) => relative(MODULES, f))).toEqual([]);
  });
});
