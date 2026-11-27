import { expect, test } from "@playwright/test";
import { accessibilityProblems, pressUntil, watchErrors } from "./check";

/** Search everything (design "search everything"), done in a browser: the top bar's box, Search, and a phone. */

test("the top bar finds every kind as you type; ↓ and Enter open one; a number typed whole opens its record", async ({ page }) => {
  const errors = watchErrors(page);
  // An order's number, from the orders list.
  await page.goto("/orders");
  const refNo = ((await page.locator("tr[data-href]").first().locator("td").first().textContent()) ?? "").match(/[A-Z]+-\d{4}-\d{3,}/)![0];

  await page.goto("/dashboard");
  const box = page.getByRole("combobox", { name: "Search everything" });
  await pressUntil(page, "/", () => expect(box).toBeFocused({ timeout: 1000 }));
  await box.fill("Al-Shifa");
  const list = page.getByRole("listbox", { name: "Results for Al-Shifa" });
  const customers = list.getByRole("group", { name: "Customers" });
  await expect(customers.getByRole("option").first()).toContainText("Al-Shifa");
  // The first result is marked; the words found are marked in it.
  await expect(list.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  await expect(list.locator("mark").first()).toHaveText(/al-shifa/i);
  expect(await accessibilityProblems(page), "the open list meets WCAG 2.2 AA").toEqual([]);
  await box.press("Enter");
  await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}$/);

  // A number typed whole: Enter opens the order itself.
  await page.keyboard.press("/");
  await box.fill(refNo.toLowerCase());
  await expect(page.getByRole("option", { name: new RegExp(`^Open ${refNo}`) })).toBeVisible();
  await box.press("Enter");
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // Esc closes the list; the words stay.
  await page.keyboard.press("/");
  await box.fill("pharma");
  await expect(page.getByRole("listbox")).toBeVisible();
  await box.press("Escape");
  await expect(page.getByRole("listbox")).toBeHidden();
  await expect(box).toHaveValue("pharma");
  expect(errors).toEqual([]);
});

test("Search: every result with a tab per kind, kept in the address", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/dashboard");
  await page.keyboard.press("/");
  const box = page.getByRole("combobox", { name: "Search everything" });
  await box.fill("pharma");
  await page.getByRole("option", { name: /^See all results for/ }).click();
  await expect(page).toHaveURL(/\/search\?q=pharma$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Search");
  const kinds = page.getByRole("navigation", { name: "Which kind" });
  await expect(kinds.getByRole("link", { name: /^All/ })).toHaveAttribute("aria-current", "page");
  await kinds.getByRole("link", { name: /^Orders/ }).click();
  await expect(page).toHaveURL(/kind=orders/);
  await expect(page.getByRole("region", { name: "Orders" }).getByRole("link").first()).toHaveAttribute("href", /^\/orders\//);
  await expect(page.getByRole("region", { name: "Customers" })).toHaveCount(0);
  // Back returns to every kind, with the words.
  await page.goBack();
  await expect(page).toHaveURL(/\/search\?q=pharma$/);
  expect(errors).toEqual([]);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the search icon opens search on the whole screen; a result opens and the screen closes; ← closes it", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Search everything" }).click();
    const screen = page.getByRole("dialog", { name: "Search everything" });
    await expect(screen.getByRole("searchbox")).toBeFocused();
    await screen.getByRole("button", { name: "Close search" }).click();
    await expect(screen).toBeHidden();

    await page.getByRole("button", { name: "Search everything" }).click();
    await screen.getByRole("searchbox").fill("Al-Shifa");
    const customers = screen.getByRole("region", { name: "Customers" });
    await expect(customers.getByRole("link").first()).toContainText("Al-Shifa");
    // Over everything: the bar at the bottom is under it.
    await expect(customers.getByRole("link").first()).toBeInViewport();
    expect(await accessibilityProblems(page), "the phone's search meets WCAG 2.2 AA").toEqual([]);
    await customers.getByRole("link").first().click();
    await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}$/);
    await expect(screen).toBeHidden();
    expect(errors).toEqual([]);
  });
});
