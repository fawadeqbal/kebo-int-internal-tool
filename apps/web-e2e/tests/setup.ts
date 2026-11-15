import fs from "node:fs";
import path from "node:path";
import { expect, test as setup } from "@playwright/test";
import { ADMIN, signIn } from "./people";
import { ADMIN_STATE, FOUND_FILE, appRoutes, routeOf } from "./routes";

// One sign-in for every check (the API limits sign-in attempts): the browser's state is kept and reused.
setup("sign in as the admin", async ({ page }) => {
  await signIn(page, ADMIN);
  fs.mkdirSync(path.dirname(ADMIN_STATE), { recursive: true });
  await page.context().storageState({ path: ADMIN_STATE });
});

/**
 * A page with an id in its address (/orders/[id]/money) is checked at an address the app itself links to: the
 * fixed pages are read, their links followed, and the first link to each such page is kept. Plain requests (the
 * HTML the server sends, links included), so this takes seconds.
 */
setup("find a link to every page with an id", async ({ browser }) => {
  setup.setTimeout(180_000);
  const context = await browser.newContext({ storageState: ADMIN_STATE });
  const routes = appRoutes().filter((r) => r.area === "app" || r.area === "print");
  const wanted = new Set(routes.filter((r) => r.dynamic).map((r) => r.route));
  const found: Record<string, string> = {};
  const queue = routes.filter((r) => !r.dynamic && r.area === "app").map((r) => r.route);
  const seen = new Set(queue);
  let read = 0;
  while (queue.length && wanted.size && read < 400) {
    const address = queue.shift()!;
    const res = await context.request.get(address, { maxRedirects: 5 });
    read++;
    if (!res.ok()) continue;
    const html = await res.text();
    for (const m of html.matchAll(/href="(\/[^"#?]*)/g)) {
      const link = m[1].replace(/\/$/, "") || "/";
      if (seen.has(link)) continue;
      const route = routeOf(link, routes);
      if (!route?.dynamic || !wanted.has(route.route)) continue;
      seen.add(link);
      found[route.route] = link;
      wanted.delete(route.route);
      queue.push(link);
    }
  }
  await context.close();
  fs.writeFileSync(FOUND_FILE, JSON.stringify(found, null, 1));
  // Not every page has a link in the demo data (a delivery page needs a delivered order): those are reported as
  // skipped by pages.spec.ts. Most must be found, or the demo data or the crawl is broken.
  expect(Object.keys(found).length, `found: ${Object.keys(found).join(", ")}`).toBeGreaterThan(20);
});
