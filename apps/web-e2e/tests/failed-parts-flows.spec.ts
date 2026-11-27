import { expect, test } from "@playwright/test";
import { accessibilityProblems, watchErrors } from "./check";
import { foundPages } from "./routes";

/**
 * A part of a page that could not be read says so in its place, and the rest of the page works (Fawad, 27 Nov;
 * lib/part.ts). The proxy's counting door (proxy.mjs) makes the reads named in the user-agent fail, for this
 * browser only.
 */
test.describe("the dashboard with its figures and what needs you failing", () => {
  test.use({ userAgent: "Mozilla/5.0 (failed parts check) fail-api:/insights/home,/reminders" });

  test("each failed part says 'Could not load'; the page and the other parts are there", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("This page could not load")).toHaveCount(0);
    await expect(page.getByText("Could not load the month's figures")).toBeVisible();
    await expect(page.getByText("Could not load what needs you")).toBeVisible();
    // A part that did load is there (who owes, from another read).
    await expect(page.getByRole("heading", { name: /owe/i }).first()).toBeVisible();
    expect(await accessibilityProblems(page), "the page with its failed parts meets WCAG 2.2 AA").toEqual([]);
    // Try again asks again (still failing here: the notice stays, the page stays).
    const asked = page.waitForResponse((r) => new URL(r.url()).pathname === "/dashboard" && r.request().headers()["rsc"] === "1");
    await page.getByRole("button", { name: "Try again" }).first().click();
    await asked;
    await expect(page.getByRole("button", { name: "Try again" }).first()).toBeEnabled();
    await expect(page.getByText("Could not load the month's figures")).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe("staff's dashboard with their orders failing", () => {
  test.use({ storageState: { cookies: [], origins: [] }, userAgent: "Mozilla/5.0 (failed parts check) fail-api:/orders/page" });

  test("the latest orders say 'Could not load'; Add a cost still goes on the company, and its Order says why it is empty", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.locator("#email").fill("bilal@example.com");
    await page.locator("#password").fill("Demo@12345");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/dashboard/);
    await expect(page.getByText("Could not load the latest orders")).toBeVisible();
    await page.getByRole("button", { name: "Add a cost" }).click();
    const panel = page.getByRole("dialog", { name: /New cost/ });
    await expect(panel).toBeVisible();
    await panel.getByRole("radio", { name: "An order" }).check();
    await expect(panel.getByText("Could not load your open orders")).toBeVisible();
    await panel.getByRole("radio", { name: "The company" }).check();
    await expect(panel.getByText("Could not load your open orders")).toHaveCount(0);
  });
});

test.describe("customers and suppliers with their money reads failing", () => {
  test.use({ userAgent: "Mozilla/5.0 (failed parts check) fail-api:/insights/facts/owed,/payments,/insights/facts/factory-orders" });

  test("the lists say which parts could not be read, and still list everyone", async ({ page }) => {
    await page.goto("/customers");
    await expect(page.getByText("Could not load what customers owe")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Customers" })).toBeVisible();
    await expect(page.locator("tr[data-href]").first()).toBeVisible();
    await page.goto("/suppliers");
    await expect(page.getByText("Could not load what we owe suppliers")).toBeVisible();
    await expect(page.locator("tr[data-href]").first()).toBeVisible();
  });

  test("a customer's page says their payments could not be read; its other parts are there", async ({ page }) => {
    const customer = foundPages()["/customers/[id]"];
    test.skip(!customer, "no customer in the demo data");
    await page.goto(customer!);
    await expect(page.getByText("Could not load their payments").first()).toBeVisible();
    await expect(page.getByText("This page could not load")).toHaveCount(0);
    // The Orders tab says it, and so does the side panel beside every tab (both use their payments).
    await page.goto(`${customer}/orders`);
    await expect(page.getByRole("complementary", { name: "At a glance" }).getByText("Could not load their payments")).toBeVisible();
    await expect(page.getByText("Could not load their payments")).toHaveCount(2);
    expect(await accessibilityProblems(page), "the tab with a failed part meets WCAG 2.2 AA").toEqual([]);
  });

  test("a supplier's page says its orders could not be read", async ({ page }) => {
    const supplier = foundPages()["/suppliers/[id]"];
    test.skip(!supplier, "no supplier in the demo data");
    await page.goto(supplier!);
    await expect(page.getByText("Could not load its orders").first()).toBeVisible();
    await expect(page.getByText("This page could not load")).toHaveCount(0);
  });
});

test.describe("an inquiry and the orders with their side reads failing", () => {
  test.use({ userAgent: "Mozilla/5.0 (failed parts check) fail-api:~/sourcing,~/factory-requests,/customers/names,/follow-ups" });

  test("the inquiry keeps its Supplier offers tab and says the offers could not be read; its items are there", async ({ page }) => {
    const inquiry = foundPages()["/inquiries/[id]"];
    test.skip(!inquiry, "no inquiry in the demo data");
    await page.goto(inquiry!);
    await expect(page.getByText("Could not load the supplier offers")).toBeVisible();
    await expect(page.getByRole("link", { name: /^Supplier offers/ })).toBeVisible();
    await expect(page.getByText("Could not load the offers for each item")).toBeVisible();
    await expect(page.getByText("This page could not load")).toHaveCount(0);
    expect(await accessibilityProblems(page), "the inquiry with failed parts meets WCAG 2.2 AA").toEqual([]);
  });

  test("the orders list and board say the customers to choose from could not be read, and show the orders", async ({ page }) => {
    await page.goto("/orders");
    await expect(page.getByText("Could not load the customers to choose from")).toBeVisible();
    await expect(page.locator("tr[data-href]").first()).toBeVisible();
    await page.goto("/orders/board");
    await expect(page.getByText("Could not load the customers to choose from")).toBeVisible();
    await expect(page.getByText("This page could not load")).toHaveCount(0);
  });
});

test.describe("reports, the account and settings with a read failing", () => {
  test.use({
    userAgent: "Mozilla/5.0 (failed parts check) fail-api:/money/cash-report,/me/profile,/company/website-form,/reports/spending",
  });

  test("Reports › Cash says it could not load the cash report, not that Cash & bank is off", async ({ page }) => {
    await page.goto("/reports/cash");
    await expect(page.getByText("Could not load the cash report")).toBeVisible();
    await expect(page.getByText(/not switched on/)).toHaveCount(0);
    // Profit shows its figures, and says the spending beside it could not be read.
    await page.goto("/reports/profit");
    await expect(page.getByText("Could not load the spending")).toBeVisible();
    await expect(page.getByText("This page could not load")).toHaveCount(0);
  });

  test("the account page offers no profile form it could not fill (it would save the phone empty)", async ({ page }) => {
    await page.goto("/account");
    await expect(page.getByText("Could not load your phone and language")).toBeVisible();
    await expect(page.getByLabel(/^Phone/)).toHaveCount(0);
    // The password form still works.
    await expect(page.getByRole("heading", { name: "Password" })).toBeVisible();
  });

  test("the website form's card says it could not load the key, not that only a Super Admin may see it", async ({ page }) => {
    await page.goto("/settings/website-form");
    await expect(page.getByText("Could not load the website form's key")).toBeVisible();
    await expect(page.getByText(/Only a Super Admin can see/)).toHaveCount(0);
  });
});

test.describe("money accounts, money waiting and a ledger entry failing", () => {
  test.use({ userAgent: "Mozilla/5.0 (failed parts check) fail-api:/money/accounts,/submissions,/ledger/entries" });

  test("Payments says the money waiting to be verified could not be read, not that none waits", async ({ page }) => {
    await page.goto("/payments");
    await expect(page.getByText("Could not load the money accounts to choose from")).toBeVisible();
    await expect(page.getByText("Could not load the money waiting to be verified")).toBeVisible();
    await expect(page.locator("tr[data-href]").first()).toBeVisible();
  });

  test("a ledger entry that could not be read still opens its window, and says so inside", async ({ page }) => {
    await page.goto("/finance/ledger?panel=entry&id=00000000-0000-4000-8000-000000000001");
    const entry = page.getByRole("dialog", { name: "Entry" });
    await expect(entry).toBeVisible();
    await expect(entry.getByText("Could not load the entry")).toBeVisible();
  });
});

test.describe("staff's money form with the accounts failing", () => {
  test.use({ storageState: { cookies: [], origins: [] }, userAgent: "Mozilla/5.0 (failed parts check) fail-api:/money/accounts" });

  test("the form says the accounts could not be read, and offers no 'Add one' (there may well be one)", async ({ page }) => {
    await page.goto("/login");
    await page.locator("#email").fill("bilal@example.com");
    await page.locator("#password").fill("Demo@12345");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/dashboard/);
    await expect(page.getByText("Could not load the money accounts to choose from")).toBeVisible();
    await page.getByRole("button", { name: "Add a cost" }).click();
    const panel = page.getByRole("dialog", { name: /New cost/ });
    // The account is asked for once it was paid from one.
    await panel.getByRole("radio", { name: "Paid now" }).check();
    await expect(panel.getByText("Could not load the accounts. It can still be recorded without one.")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Add one" })).toHaveCount(0);
  });
});

test.describe("Reports with the sales and the cash failing", () => {
  test.use({ userAgent: "Mozilla/5.0 (failed parts check) fail-api:/insights/facts/orders/groups,/money/cash-report" });

  test("Spending shows a dash for what was sold, never '0 sold' beside its notice", async ({ page }) => {
    await page.goto("/reports/spending");
    test.skip((await page.getByText(/Expenses are not switched on/).count()) > 0, "expenses are off in the demo data");
    await expect(page.getByText("Could not load what each person sold and the sales by month")).toBeVisible();
    await expect(page.getByText("the sales could not be read")).toBeVisible();
    await expect(page.getByText(/on \S+ 0 sold/)).toHaveCount(0);
  });

  test("an Excel export is the whole report or none: it says what could not be read", async ({ page }) => {
    await page.goto("/reports/cash");
    const res = await page.request.get("/sheets/export/insights?section=cash");
    test.skip(res.status() === 403, "Excel is not in the demo company's plan");
    expect(res.status()).toBe(503);
    expect(await res.text()).toContain("Could not load the cash report, so the file was not made");
  });
});

test.describe("notes and what we owe a supplier failing", () => {
  test.use({ userAgent: "Mozilla/5.0 (failed parts check) fail-api:~/notes,/money/payables" });

  test("a customer's notes say they could not be read, never 'No notes yet' or 'Nothing yet'", async ({ page }) => {
    const customer = foundPages()["/customers/[id]"];
    test.skip(!customer, "no customer in the demo data");
    await page.goto(`${customer}/notes`);
    await expect(page.getByRole("heading", { name: "Notes and calls" })).toBeVisible();
    // The tab, and the side panel's Activity beside it.
    await expect(page.getByText("Could not load the notes")).toHaveCount(2);
    await expect(page.getByText(/No notes yet|Nothing yet\. Notes/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add a note" })).toBeVisible();
    expect(await accessibilityProblems(page), "the notes tab with its list failed meets WCAG 2.2 AA").toEqual([]);
  });

  test("a supplier's Orders tab and money box say what we owe could not be read, never 'Nothing bought or owed yet'", async ({ page }) => {
    const supplier = foundPages()["/suppliers/[id]"];
    test.skip(!supplier, "no supplier in the demo data");
    await page.goto(`${supplier}/orders`);
    await expect(page.getByText("Could not load what we still owe them").first()).toBeVisible();
    await expect(page.getByText("This page could not load")).toHaveCount(0);
    await page.goto(`${supplier}/notes`);
    await expect(page.getByText("Could not load the notes")).toBeVisible();
    await expect(page.getByText("Nothing bought or owed yet")).toHaveCount(0);
  });
});

test.describe("reports' counts and the books' order list failing", () => {
  test.use({ userAgent: "Mozilla/5.0 (failed parts check) fail-api:/customers,/orders" });

  test("Reports › Customers says it could not count them, never 'of 0'", async ({ page }) => {
    await page.goto("/reports/customers");
    await expect(page.getByText("Could not load how many customers there are")).toBeVisible();
    await expect(page.getByText(/^of 0 ·/)).toHaveCount(0);
    await expect(page.getByText("This page could not load")).toHaveCount(0);
  });

  test("the books' Orders view says the orders could not be read, never 'No orders yet'", async ({ page }) => {
    await page.goto("/finance/ledger?view=orders");
    await expect(page.getByText("Could not load the orders")).toBeVisible();
    await expect(page.getByText("No orders yet")).toHaveCount(0);
  });
});
