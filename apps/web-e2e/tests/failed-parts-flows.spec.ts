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
    await page.getByRole("button", { name: "Try again" }).first().click();
    await expect(page.getByText("Could not load the month's figures")).toBeVisible();
    expect(errors).toEqual([]);
  });
});
