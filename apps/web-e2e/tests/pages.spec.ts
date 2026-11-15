import { expect, test, type Page } from "@playwright/test";
import { expectSoundPage, watchErrors } from "./check";
import { appRoutes, foundPages } from "./routes";

/**
 * Every page of the app, at laptop and phone width: it opens, nothing goes wrong in the browser, nothing is wider
 * than the screen, and it meets WCAG 2.2 AA. The list comes from the app's folders, so a new page is checked too.
 * Left out: the platform's own pages (/platform/…, behind its two-step sign-in), and pages that only send an old
 * address on (checked once below that they still land somewhere; the page they land on is checked here).
 */
const SIZES = [
  { name: "laptop", width: 1280, height: 900 },
  { name: "phone", width: 390, height: 844 },
];

const routes = appRoutes();
const signedIn = routes.filter((r) => (r.area === "app" || r.area === "print") && !r.forwards);
const signedOut = routes.filter((r) => r.area === "public" && !r.dynamic && !r.forwards);
const oldAddresses = routes.filter((r) => r.area === "app" && !r.dynamic && r.forwards);

test.describe.configure({ mode: "parallel" });

async function open(page: Page, address: string) {
  const errors = watchErrors(page);
  const started = Date.now();
  const res = await page.goto(address);
  expect(res?.status() ?? 0, `${address} answered`).toBeLessThan(400);
  await page.waitForLoadState("networkidle");
  test.info().annotations.push({ type: "load", description: `${Date.now() - started} ms` });
  await expectSoundPage(page, errors);
}

for (const size of SIZES) {
  test.describe(`${size.name} ${size.width}px`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    for (const r of signedIn) {
      test(r.route, async ({ page }) => {
        const address = r.dynamic ? foundPages()[r.route] : r.route;
        test.skip(!address, "no link to this page in the demo data");
        await open(page, address!);
      });
    }

    test.describe("signed out", () => {
      test.use({ storageState: { cookies: [], origins: [] } });
      for (const r of signedOut) test(r.route, ({ page }) => open(page, r.route));
    });
  });
}

test.describe("old addresses", () => {
  for (const r of oldAddresses) {
    test(`${r.route} still lands on a page`, async ({ page }) => {
      const res = await page.goto(r.route);
      expect(res?.status() ?? 0).toBeLessThan(400);
      // Next sends a page that has started streaming on in the browser, so the move may come after "load".
      await page.waitForURL((u) => u.pathname !== r.route);
    });
  }
});
