import { expect, test, type Locator, type Page } from "@playwright/test";
import { newOrder } from "./orders";
import { foundPages } from "./routes";

/**
 * Every kind of window, used with the keyboard alone (review 27 Nov 2026; WCAG 2.4.3 focus order, 2.1.2 no
 * keyboard trap): once it is open the focus is inside it, Tab and Shift+Tab stay inside it, Esc closes it, and
 * the focus goes back to the button that opened it. The every-page check opens pages only, so a window that lets
 * Tab wander over the page behind it passed everything until now.
 *
 * `gap`: a window that does not keep this yet, with what is missing. Its test is expected to fail, and fails
 * the day it passes: the window was fixed, so its `gap` line is taken out.
 */
interface Window {
  name: string;
  phone?: boolean;
  /** Where it is opened from: a page's address, or the demo's first order ("order", "order/documents"). */
  at: string;
  /** Opens it, and gives the button the focus must come back to. */
  open: (page: Page) => Promise<Locator>;
  gap?: string;
}

const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

const WINDOWS: Window[] = [
  {
    name: "an Edit window (side panel)",
    at: "order",
    open: async (page) => {
      const edit = page.getByRole("button", { name: "Edit their order" });
      await edit.click();
      return edit;
    },
  },
  {
    name: "a new record's steps window",
    at: "/inquiries",
    open: async (page) => {
      const add = page.getByRole("link", { name: "New inquiry" });
      await add.click();
      return add;
    },
  },
  {
    name: "a confirm window (Cancel the order…)",
    at: "order",
    open: async (page) => {
      const more = page.getByRole("button", { name: /^More for SO-/ });
      await more.click();
      await page.getByRole("menuitem", { name: /Cancel the order/ }).click();
      return more;
    },
  },
  {
    name: "the document window (Proforma)",
    at: "order",
    open: async (page) => {
      const paper = page.getByRole("link", { name: "Proforma", exact: true });
      await paper.click();
      return paper;
    },
  },
  {
    name: "the document window, opened from the Documents list",
    at: "order/documents",
    open: async (page) => {
      const paper = page.getByRole("link", { name: /Quotation \(accepted\)/ }).first();
      await paper.click();
      return paper;
    },
    gap: "there it is a page of its own: closing it goes back, and the focus starts again at the top of the page",
  },
  {
    name: "the phone's Filters sheet",
    phone: true,
    at: "/orders",
    open: async (page) => {
      const filters = page.getByRole("button", { name: "Filters" });
      await filters.click();
      return filters;
    },
  },
  {
    name: "the phone's menu",
    phone: true,
    at: "/orders",
    open: async (page) => {
      const menu = page.getByRole("button", { name: "Open menu" });
      await menu.click();
      return menu;
    },
  },
  {
    name: "the phone's search",
    phone: true,
    at: "/orders",
    open: async (page) => {
      const search = page.getByRole("button", { name: "Search everything" });
      await search.click();
      return search;
    },
  },
  {
    name: "the phone's record panel sheet",
    phone: true,
    at: "order",
    open: async (page) => {
      const bar = page.getByRole("button", { name: /^Order · / });
      await bar.click();
      return bar;
    },
  },
];

/**
 * Where the focus is: null inside the top window (the last one opened), else a few words for what has it:
 * something on the page, or in a window under the top one.
 */
const outside = (page: Page) =>
  page.evaluate(() => {
    const at = document.activeElement;
    const shown = [...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]')].filter(
      (w) => w.getClientRects().length > 0,
    );
    const top = shown.at(-1);
    if (at && top?.contains(at)) return null;
    return `${at?.tagName.toLowerCase() ?? "nothing"} "${(at?.getAttribute("aria-label") ?? at?.textContent ?? "").trim().slice(0, 40)}"`;
  });

/** Tab and Shift+Tab, many times: every place the focus went that was not in the top window. */
async function wanderings(page: Page, tabs: number, back: number) {
  const left: string[] = [];
  for (const key of [...Array<string>(tabs).fill("Tab"), ...Array<string>(back).fill("Shift+Tab")]) {
    await page.keyboard.press(key);
    const where = await outside(page);
    if (where) left.push(`${key}: ${where}`);
  }
  return left;
}

for (const w of WINDOWS) {
  test.describe(w.name, () => {
    if (w.phone) test.use(PHONE);

    test("keeps the keyboard inside, closes on Esc and gives the focus back", async ({ page }) => {
      const order = foundPages()["/orders/[id]"];
      const address = w.at.startsWith("order") ? order && `${order}${w.at.slice("order".length)}` : w.at;
      test.skip(!address, "no order in the demo data");
      await page.goto(address!);
      await page.waitForLoadState("networkidle");

      const opener = await w.open(page);
      const open = page.locator('[role="dialog"], [role="alertdialog"]').last();
      await expect(open, "the window opened").toBeVisible();
      await expect(open, "the window says it covers the page").toHaveAttribute("aria-modal", "true");

      // From here on a known gap may fail the test; opening it, above, may not.
      test.fail(!!w.gap, w.gap);

      await expect.poll(() => outside(page), { message: "the focus moved into the window" }).toBeNull();
      // More presses than the fullest window has buttons (the document window: about 30), so a way out at its end is found.
      expect(await wanderings(page, 60, 10), "Tab left the window for the page behind it").toEqual([]);

      await page.keyboard.press("Escape");
      await expect(open, "Esc closed it").toBeHidden();
      await expect(opener, "the focus is back on what opened it").toBeFocused();
    });
  });
}

// One window over another: the Email panel opened from the document window. Only the top one keeps the
// keyboard (review of #427: with both keeping it, Tab from plain words went into the window underneath).
test("a window opened over the document window keeps the keyboard, and gives it back to the one under it", async ({ page }) => {
  // An order of its own whose quotation can be emailed (its customer has a contact with an address).
  const id = await newOrder(page);
  await page.goto(`/orders/${id}/documents`);
  await page.waitForLoadState("networkidle");
  await page
    .getByRole("link", { name: /Quotation \(accepted\)/ })
    .first()
    .click();
  const paper = page.getByRole("dialog", { name: /Quotation \(accepted\)/ });
  await expect(paper).toBeVisible();

  const email = paper.getByRole("button", { name: /^Email / });
  await email.click();
  const panel = page.getByRole("dialog", { name: /^Email / });
  await expect(panel).toBeVisible();
  await expect.poll(() => outside(page), { message: "the focus moved into the Email panel" }).toBeNull();
  expect(await wanderings(page, 30, 10), "Tab left the Email panel").toEqual([]);

  // The focus nowhere (as after a click on plain words), then Tab: into the panel, not the document under it.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  expect(await wanderings(page, 3, 0), "Tab from nowhere left the Email panel").toEqual([]);

  // Typing in it works (the window under it does not take the focus away).
  const message = panel.getByRole("textbox", { name: "Message" });
  await message.fill("See the quotation attached.");
  await expect(message).toBeFocused();
  await expect(message).toHaveValue("See the quotation attached.");

  // Closed (something was typed, so it asks first): the document window has the keyboard again.
  await page.keyboard.press("Escape");
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: /Discard/ })
    .click();
  await expect(panel).toBeHidden();
  await expect(paper).toBeVisible();
  await expect(email, "the focus is back on the button that opened the panel").toBeFocused();
  expect(await wanderings(page, 40, 5), "Tab left the document window").toEqual([]);
});
