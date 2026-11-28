import { expect, test } from "@playwright/test";
import known from "./page-cost.known.json";
import { appRoutes, foundPages } from "./routes";

/**
 * What a page costs the server: how many times the web app asks the API to draw it once (review 27 Nov 2026: an
 * order page asked 18 to 21 times, and each call loaded the order again). Every page stays at or under the
 * ceiling; the pages that are over it today are listed in page-cost.known.json with what they ask now, and may
 * only ask less. The order's pages are listed too, under it: they read the order once (GET /orders/:id/page,
 * 28 Nov), and their numbers keep it that way. A page that needs more is asking for the same thing twice, or is
 * missing a read of its own in the API: one call that answers what the page shows.
 *
 * The page is asked for as plain HTML (no browser, so no links are fetched ahead), with a tag on its user-agent;
 * the web app passes the user-agent on, and the proxy's counting door (proxy.mjs) counts the calls that carry it.
 */
const COUNT_URL = `http://localhost:${process.env.E2E_COUNT_PORT ?? 4001}`;

/** The most a page may ask the API for one draw (the app's frame asks 6 of them: who, company, settings, counts). */
const CEILING = 16;

const budgets: Record<string, number> = known;
const pages = appRoutes().filter((r) => r.area === "app" && !r.forwards);

test.describe.configure({ mode: "parallel" });

for (const r of pages) {
  test(`${r.route} asks the API no more than it may`, async ({ request }, info) => {
    const address = r.dynamic ? foundPages()[r.route] : r.route;
    test.skip(!address, "no link to this page in the demo data");

    const tag = `${info.workerIndex}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const res = await request.get(address!, { headers: { "user-agent": `Mozilla/5.0 (page cost check) page-cost/${tag}` } });
    expect(res.status(), `${address} answered`).toBeLessThan(400);
    await res.text();

    const { calls } = (await (await request.get(`${COUNT_URL}/__page-cost/${tag}`)).json()) as { calls: string[] };
    // On a laptop the web app may be one that was already running, asking the API directly: nothing to count.
    // (In CI Playwright starts it with the counting door as its API_URL, so no call at all is a failure.)
    test.skip(calls.length === 0 && !process.env.CI, "the web app does not ask through the counting door (API_URL)");
    expect(calls.length, "the page's calls went through the counting door").toBeGreaterThan(0);

    const limit = budgets[r.route] ?? CEILING;
    info.annotations.push({ type: "api calls", description: `${calls.length} of ${limit}` });
    expect(
      calls.length,
      `${r.route} asked the API ${calls.length} times (${limit} allowed${r.route in budgets ? ", page-cost.known.json" : ""}):\n${calls.join("\n")}`,
    ).toBeLessThanOrEqual(limit);
    if (r.route in budgets && calls.length < limit)
      info.annotations.push({ type: "lower", description: `page-cost.known.json: ${r.route} can go down to ${calls.length}` });
  });
}
