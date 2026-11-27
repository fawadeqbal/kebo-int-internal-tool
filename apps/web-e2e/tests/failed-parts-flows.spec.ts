import { expect, test } from "@playwright/test";
import { accessibilityProblems, watchErrors } from "./check";

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
