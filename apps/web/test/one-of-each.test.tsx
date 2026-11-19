import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * One of each (canvas "RFQ Desk — the pieces", consistency plan): the app's pages and pieces take their sizes and
 * colours from the theme (packages/ui/src/styles/theme.css), never typed in a class. Each check here fails when a
 * copy comes back, and names the file and the class to change.
 *
 * Not checked: the printed papers (components/print, app/print) and the marketing site (components/site), which
 * draw on white paper in their own brand; the platform's dev-tools console, which is a terminal on purpose.
 */
// Tests run in apps/web.
const ROOTS = [resolve(process.cwd(), "src"), resolve(process.cwd(), "../../packages/ui/src")];
const SKIP = ["/print/", "/site/", "/dev-tools/live-log.tsx", "/dev-tools/speed.tsx", "/platform/preview/"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(tsx?|ts)$/.test(name) ? [path] : [];
  });
}

const SOURCES = ROOTS.flatMap(files)
  .filter((f) => !SKIP.some((s) => f.replaceAll("\\", "/").includes(s)))
  .map((f) => ({ file: relative(resolve(process.cwd(), "../.."), f), text: readFileSync(f, "utf8") }));

/** Every match of `pattern` in the app's sources, as "file: match". */
function found(pattern: RegExp): string[] {
  return SOURCES.flatMap(({ file, text }) => [...text.matchAll(pattern)].map((m) => `${file}: ${m[0]}`));
}

describe("one of each", () => {
  it("reads every source file", () => {
    expect(SOURCES.length).toBeGreaterThan(300);
  });

  it("text sizes come from the theme's scale (text-2xs … text-2xl), never typed in px", () => {
    expect(found(/(?<![\w-])text-\[\d+(?:\.\d+)?px\]/g)).toEqual([]);
  });

  it("colours come from the theme's variables, never typed as #hex in a class", () => {
    expect(found(/(?<![\w-])(?:bg|text|border|ring|fill|stroke|from|to|via|outline|decoration|divide|shadow)-\[#[0-9a-fA-F]{3,8}\]/g)).toEqual([]);
  });
});
