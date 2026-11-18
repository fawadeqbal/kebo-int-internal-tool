import { expect, test, type Locator, type Page } from "@playwright/test";
import { watchErrors } from "./check";

/**
 * Design rule 7: a long list in a window keeps its tools and column names on top while only the items scroll; the
 * window grows with the items up to its height and never squeezes them away (a short window scrolls as a whole).
 */

async function longOffer(page: Page) {
  const tag = Date.now().toString(36);
  const send = async (url: string, data: object) => {
    const r = await page.request.post(`/api${url}`, { data });
    expect(r.ok(), `${url}: ${await r.text()}`).toBe(true);
    return r.json();
  };
  const me = await (await page.request.get("/api/auth/me")).json();
  const customer = await send("/customers", { name: `Scroll Pharma ${tag}`, country: "PK", contacts: [{ name: "Sana", email: `sana-${tag}@scroll.test` }] });
  const items = Array.from({ length: 24 }, (_, i) => ({ description: `Spare part ${i + 1}`, quantity: i + 1, unit: "pcs" }));
  const inquiry = await send("/inquiries", { customerId: customer.id, category: "Machinery", assigneeId: me.id, items });
  const offer = await send(`/inquiries/${inquiry.id}/factory-quotes`, {
    newFactoryName: `Scroll Supplier ${tag}`,
    receivedOn: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
    currency: "USD",
    taxIncluded: false,
    taxRate: 12,
    lines: items.map((it, i) => ({ ...it, unitPrice: 100 + i })),
  });
  return { inquiry: inquiry.id as string, offer: offer.id as string };
}

/** Which boxes in the window scroll up and down, and where the first column name is. */
const layout = (win: Locator) =>
  win.evaluate((w) => {
    const scrolls = [...w.querySelectorAll<HTMLElement>("*")].filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 2);
    const head = w.querySelector("[role=region] thead th");
    return { scrolls: scrolls.map((e) => (e.getAttribute("role") === "region" ? "items" : "window")), rows: w.querySelector<HTMLElement>("[role=region]")?.clientHeight ?? 0, headTop: head?.getBoundingClientRect().top ?? -1 };
  });

test("a long list in Edit offer › Prices: the tools and column names stay, only the items scroll", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const { inquiry, offer } = await longOffer(page);
  await page.goto(`/inquiries/${inquiry}/offers/${offer}`);
  await page.getByRole("button", { name: "Edit offer" }).click();
  const win = page.getByRole("dialog", { name: "Edit offer" });
  await win.getByRole("navigation", { name: "Steps" }).getByRole("button", { name: /Prices/ }).click();
  await expect(win.getByRole("button", { name: /^Add item/ })).toBeVisible();

  const before = await layout(win);
  // Only the items scroll, and they get the room the window has (more than the 11rem they keep at least).
  expect(before.scrolls).toEqual(["items"]);
  expect(before.rows).toBeGreaterThan(200);
  await win.getByRole("region", { name: "Items" }).evaluate((g) => (g.scrollTop = g.scrollHeight));
  const after = await layout(win);
  expect(Math.round(after.headTop)).toBe(Math.round(before.headTop));
  await expect(win.getByRole("button", { name: /^Add item/ })).toBeInViewport();
  await expect(win.getByText("Total with tax")).toBeInViewport();

  // A short laptop: the items keep their least height; the window scrolls as a whole only by what is missing.
  await page.setViewportSize({ width: 1280, height: 640 });
  const short = await layout(win);
  expect(short.rows).toBeGreaterThan(120);
  await expect(win.getByRole("button", { name: /^Add item/ })).toBeInViewport();
  expect(errors).toEqual([]);
});
