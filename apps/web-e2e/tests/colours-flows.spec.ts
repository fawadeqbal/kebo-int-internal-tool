import { expect, test, type Page } from "@playwright/test";
import { accessibilityProblems, watchErrors } from "./check";
import { MANAGER, signIn } from "./people";

/**
 * The app's colours (design "the app's colours: four sets, light and dark", now eight): a company picks one of the
 * sets from a dropdown on Company settings; the whole app changes at once, for everyone in the company, and Undo puts it back. Every set,
 * light and dark, meets WCAG AA on the pages people use most.
 */

const SETS = ["green", "graphite", "midnight", "warm", "clay", "teal", "ink", "onyx"] as const;
type Set = (typeof SETS)[number];
/** Each set's ground, light and dark (packages/ui/src/styles/theme.css): tells which colours the page has. */
const GROUND: Record<Set, { light: string; dark: string }> = {
  green: { light: "#f4f7f5", dark: "#0b120e" },
  graphite: { light: "#f4f5f6", dark: "#0f1012" },
  midnight: { light: "#f3f6fa", dark: "#0b1018" },
  warm: { light: "#f7f5f1", dark: "#131211" },
  clay: { light: "#faf9f5", dark: "#0a0a09" },
  teal: { light: "#f3f8f7", dark: "#050807" },
  ink: { light: "#f6f6f5", dark: "#000000" },
  onyx: { light: "#ffffff", dark: "#000000" },
};
/** The page's --bg as #rrggbb (the built CSS may write #ffffff as #fff). */
const ground = (page: Page) =>
  page.evaluate(() => {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim().toLowerCase();
    return /^#[0-9a-f]{3}$/.test(v) ? `#${[...v.slice(1)].map((c) => c + c).join("")}` : v;
  });
const LABEL: Record<Set, string> = { green: "Green", graphite: "Graphite", midnight: "Midnight", warm: "Warm", clay: "Clay", teal: "Teal", ink: "Ink", onyx: "Onyx" };

/** Company settings › The app's colours: chooses one and waits until it is saved (the note says so). */
async function choose(page: Page, set: Set) {
  await page.getByRole("combobox", { name: "Colours" }).selectOption(set);
  await expect(page.getByRole("status").filter({ hasText: `The app's colours are now ${LABEL[set]}` })).toBeVisible();
}

test("the app's colours: the whole app changes at once, stays, is everyone's, and Undo puts it back", async ({ page, browser }, info) => {
  const errors = watchErrors(page);
  await page.goto("/settings/company");
  const select = page.getByRole("combobox", { name: "Colours" });
  await expect(select.locator("option")).toHaveCount(SETS.length);
  // Green says it is the default; the chosen set is drawn light and dark.
  await expect(select.locator("option", { hasText: "Green (Default)" })).toHaveCount(1);
  if ((await select.inputValue()) !== "green") await choose(page, "green");
  await expect(page.locator('#colours [data-colours="green"][data-mode="dark"]')).toHaveCount(1);
  expect(await ground(page)).toBe(GROUND.green.light);

  try {
    // At once: the page has the new colours before the save has answered.
    await select.selectOption("graphite");
    expect(await ground(page)).toBe(GROUND.graphite.light);
    await expect(page.getByRole("status").filter({ hasText: "The app's colours are now Graphite" })).toBeVisible();
    expect(await accessibilityProblems(page), "Company settings in Graphite meets WCAG 2.2 AA").toEqual([]);

    // Kept: on the next page and after a reload.
    await page.goto("/orders");
    expect(await ground(page)).toBe(GROUND.graphite.light);
    await page.reload();
    expect(await ground(page)).toBe(GROUND.graphite.light);

    // Everyone's: the manager, signed in on their own, has it too.
    const other = await browser.newContext({ baseURL: info.project.use.baseURL, storageState: { cookies: [], origins: [] } });
    const manager = await other.newPage();
    await signIn(manager, MANAGER);
    expect(await ground(manager)).toBe(GROUND.graphite.light);
    await other.close();

    // Arrowing through the choices saves only where it stops; Undo puts the one before back.
    await page.goto("/settings/company");
    await select.focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(select).toHaveValue("warm");
    expect(await ground(page)).toBe(GROUND.warm.light);
    const note = page.getByRole("status").filter({ hasText: "The app's colours are now Warm" });
    await expect(note).toBeVisible();
    await note.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Undone" })).toBeVisible();
    await expect(select).toHaveValue("graphite");
    expect(await ground(page)).toBe(GROUND.graphite.light);
    await page.reload();
    await expect(select).toHaveValue("graphite");
  } finally {
    // Back to the default, for the other checks.
    await page.goto("/settings/company");
    if ((await select.inputValue()) !== "green") await choose(page, "green");
  }
  expect(await ground(page)).toBe(GROUND.green.light);
  expect(errors, "errors in the browser").toEqual([]);
});

for (const mode of ["light", "dark"] as const) {
  test(`every set, ${mode}: the pages people use most meet WCAG 2.2 AA`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ colorScheme: mode });
    // An order's Payment tab: cards, a plan, badges, buttons and a table.
    await page.goto("/orders");
    const order = await page.locator("tr[data-href]").first().getAttribute("data-href");
    for (const path of ["/dashboard", "/orders", `${order}/payment`, "/settings/company"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      for (const set of SETS) {
        // The set on this page only (nothing saved): the frame's marker names it.
        await page.evaluate((s) => document.getElementById("app-colours")?.setAttribute("data-colours", s), set);
        expect(await ground(page), `${set} ${mode} on ${path}`).toBe(GROUND[set][mode]);
        expect(await accessibilityProblems(page), `${set} ${mode} on ${path}`).toEqual([]);
      }
    }
  });
}
