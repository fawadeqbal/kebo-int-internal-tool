import { expect, test, type Locator, type Page } from "@playwright/test";
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

/** Where the focus is: null inside an open window, else a few words for what has it. */
const outside = (page: Page) =>
  page.evaluate(() => {
    const at = document.activeElement;
    const open = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')];
    if (at && open.some((w) => w.contains(at))) return null;
    return `${at?.tagName.toLowerCase() ?? "nothing"} "${(at?.getAttribute("aria-label") ?? at?.textContent ?? "").trim().slice(0, 40)}"`;
  });

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
      const left: string[] = [];
      // More presses than the fullest window has buttons (the document window: about 30), so a way out at its end is found.
      for (const key of [...Array<string>(60).fill("Tab"), ...Array<string>(10).fill("Shift+Tab")]) {
        await page.keyboard.press(key);
        const where = await outside(page);
        if (where) left.push(`${key}: ${where}`);
      }
      expect(left, "Tab left the window for the page behind it").toEqual([]);

      await page.keyboard.press("Escape");
      await expect(open, "Esc closed it").toBeHidden();
      await expect(opener, "the focus is back on what opened it").toBeFocused();
    });
  });
}
