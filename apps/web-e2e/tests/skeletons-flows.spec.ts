import { expect, test, type Page } from "@playwright/test";
import { landed } from "./check";
import { appRoutes, foundPages } from "./routes";

/**
 * The skeleton rule (Fawad 21 Nov): every page loads in its own shape. For every page of the app, the skeleton
 * its loading.tsx draws (held still at /loading-preview) has the same parts as the page itself, in the same order,
 * with the same counts: header or record top, facts line, tiles, tabs, filter and its choices, the table, the
 * record's tabs and body with or without its side panel (a list's tabs and facts may show up to two fewer than the
 * skeleton draws: those with nothing in them are left out). A page that changes its parts fails here until its line
 * in apps/web/src/lib/page-shapes.ts says the same.
 */
test.use({ viewport: { width: 1440, height: 900 } });

/** The page's parts as the eye meets them: visible [data-part] pieces, outermost only, in page order. */
async function partsOf(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector("main") ?? document.body;
    const all = [...main.querySelectorAll<HTMLElement>("[data-part]")].filter((el) => el.checkVisibility());
    const outer = all.filter((el) => !all.some((o) => o !== el && o.contains(el)));
    return outer
      .map((el) => {
        const part = el.dataset.part === "empty" ? "table" : el.dataset.part!;
        const n = el.dataset.count;
        return part + (n !== undefined ? `:${n}` : "") + (part === "record-body" && el.hasAttribute("data-panel") ? ":panel" : "");
      })
      .filter((x, i, a) => i === 0 || x !== a[i - 1]);
  });
}

const pages = appRoutes().filter((r) => r.area === "app" && !r.forwards && r.route !== "/loading-preview");

test.describe("every page loads in its own shape", () => {
  for (const r of pages) {
    test(r.route, async ({ page }) => {
      const address = r.dynamic ? foundPages()[r.route] : r.route;
      test.skip(!address, "no link to this page in the demo data");
      await page.goto(address!);
      await landed(page);
      const real = await partsOf(page);
      await page.goto(`/loading-preview?path=${encodeURIComponent(address!)}`);
      // The preview itself streams in behind the app's own loading screen: read it once it is there.
      await page.waitForLoadState("networkidle");
      await expect(page.locator("main [data-preview]")).toBeAttached();
      const skeleton = await partsOf(page);
      // The parts, their order and the record's side panel must be the same. A count may run up to two short of
      // the skeleton's: a list's tabs and facts that show only when they have something (the demo data varies).
      const name = (x: string) => x.replace(/:\d+$/, "");
      const n = (x: string) => Number(/:(\d+)$/.exec(x)?.[1] ?? 0);
      expect(skeleton.map(name), `the skeleton of ${r.route} (lib/page-shapes.ts) against the page`).toEqual(real.map(name));
      const off = real.filter((x, i) => n(skeleton[i]!) - n(x) < 0 || n(skeleton[i]!) - n(x) > 2 || (/^(record-tabs|filter)/.test(x) && x !== skeleton[i]));
      expect(off, `counts in ${r.route}: page ${real.join(" · ")}; skeleton ${skeleton.join(" · ")}`).toEqual([]);
    });
  }

  test("a record's tab loads its body only, under the record's top and tabs", async ({ page }) => {
    const address = foundPages()["/orders/[id]/payment"];
    test.skip(!address, "no order in the demo data");
    await page.goto(`/loading-preview?path=${encodeURIComponent(address!)}&tab=1`);
    await expect(page.locator("main [data-preview]")).toBeAttached();
    expect(await partsOf(page)).toEqual(["record-body:panel"]);
  });
});
