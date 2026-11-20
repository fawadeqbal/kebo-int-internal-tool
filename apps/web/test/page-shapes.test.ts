import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PAGE_SHAPES, partsOf, shapeOf } from "@/lib/page-shapes";

/**
 * The skeleton rule (Fawad 21 Nov): a page loads in its own shape. Every page has a shape in lib/page-shapes.ts
 * (its own line or the page above it), every loading.tsx draws the shape of the address it opens, and grey bars
 * are drawn only by components/common/skeletons.tsx. The browser test skeletons.spec.ts checks each shape
 * against the page itself.
 */
const APP = resolve(process.cwd(), "src/app/(app)");
const SRC = resolve(process.cwd(), "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** The app's pages as routes: "/customers/[id]/money" (groups left out, the window's parallel route too). */
function routes(): string[] {
  return walk(APP)
    .filter((f) => f.endsWith("/page.tsx") && !f.includes("/@"))
    .map((f) =>
      (
        "/" +
        relative(APP, f)
          .split("/")
          .slice(0, -1)
          .filter((s) => !/^\(.+\)$/.test(s))
          .join("/")
      ).replace(/\/$/, ""),
    )
    .filter((r) => r && r !== "/loading-preview");
}

const PARTS = new Set(["header", "record-top", "facts", "tiles", "tabs", "record-tabs", "filter", "table", "record-body", "~greeting", "~board", "~form", "~charts", "~cards", "~pager"]);

describe("every page loads in its own shape", () => {
  it("every loading.tsx draws the shape of the page it opens (no skeleton of its own)", () => {
    const loading = walk(APP).filter((f) => f.endsWith("/loading.tsx"));
    expect(loading.length).toBeGreaterThan(20);
    const bad = loading.filter((f) => {
      const text = readFileSync(f, "utf8").replace(/^\/\/.*$/gm, "").trim();
      return (
        text !== 'export { default } from "@/components/common/page-loading";' &&
        text !== 'export { TabLoading as default } from "@/components/common/page-loading";'
      );
    });
    expect(bad.map((f) => relative(SRC, f))).toEqual([]);
  });

  it("every page has a shape: its own line in PAGE_SHAPES or the page above it", () => {
    const missing = routes().filter((r) => {
      // The address with its [segments] filled in, as the browser has it.
      const address = r.replace(/\[[^\]]+\]/g, "x0");
      for (let p = r; p; p = p.slice(0, p.lastIndexOf("/"))) if (PAGE_SHAPES[p]) return false;
      return shapeOf(address) === "header · table";
    });
    expect(missing).toEqual([]);
  });

  it("every shape is made of the known parts, and a shape's line is a real page", () => {
    const all = routes();
    const unknown = Object.entries(PAGE_SHAPES).flatMap(([route, shape]) => partsOf(shape).filter((p) => !PARTS.has(p.name)).map((p) => `${route}: ${p.name}`));
    expect(unknown).toEqual([]);
    expect(Object.keys(PAGE_SHAPES).filter((r) => !all.includes(r) && !all.some((x) => x.startsWith(`${r}/`)))).toEqual([]);
  });

  it("the most specific shape wins: a list, its board and its new page are not its record", () => {
    expect(shapeOf("/customers")).toBe(PAGE_SHAPES["/customers"]);
    expect(shapeOf("/customers?tab=owe")).toBe(PAGE_SHAPES["/customers"]);
    expect(shapeOf("/customers/new")).toBe(PAGE_SHAPES["/customers/new"]);
    expect(shapeOf("/customers/5f0c/money")).toBe(PAGE_SHAPES["/customers/[id]"]);
    expect(shapeOf("/inquiries/board")).toBe(PAGE_SHAPES["/inquiries/board"]);
    expect(shapeOf("/orders/5f0c/papers/proforma")).toBe(PAGE_SHAPES["/orders/[id]/papers/[kind]"]);
    expect(shapeOf("/settings/sales")).toBe(PAGE_SHAPES["/settings"]);
  });

  it("grey bars are drawn in one place (components/common/skeletons.tsx)", () => {
    const pulse = walk(SRC)
      .filter((f) => /\.(tsx?|css)$/.test(f) && readFileSync(f, "utf8").includes("animate-pulse"))
      .map((f) => relative(SRC, f));
    expect(pulse).toEqual(["components/common/skeletons.tsx"]);
  });
});
