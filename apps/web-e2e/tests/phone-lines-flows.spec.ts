import { expect, test, type Page } from "@playwright/test";
import { accessibilityProblems, watchErrors } from "./check";

/**
 * Design "Lines on the phone" (16 Nov 2026), asked for everywhere on 17 Nov: on a phone a lines sheet is a
 * list (one line per row, what it still needs marked), a line is typed or changed in a window of its own
 * (Add & next, Save & next), ⋯ is a sheet of what can be done to it, and a removed line comes back with Undo.
 */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

const tag = () => Date.now().toString(36);
async function post(page: Page, url: string, data: object) {
  const r = await page.request.post(`/api${url}`, { data });
  expect(r.ok(), `${url}: ${await r.text()}`).toBe(true);
  return r.json();
}
async function newInquiry(page: Page, t: string) {
  const me = await (await page.request.get("/api/auth/me")).json();
  const customer = await post(page, "/customers", { name: `Phone Pharma ${t}`, country: "PK", contacts: [{ name: "Hina", email: `hina-${t}@phone.test` }] });
  return post(page, "/inquiries", {
    customerId: customer.id,
    category: "Machinery",
    assigneeId: me.id,
    items: [{ description: "Tablet press", quantity: 1, unit: "set" }],
  }) as Promise<{ id: string; refNo: string }>;
}

test("inquiry items on a phone: a list, Add & next, a line in its own window, ⋯ and Undo, saved with the inquiry", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const deal = await newInquiry(page, tag());
  await page.goto(`/inquiries/${deal.id}?panel=edit-request&id=items`);
  const win = page.getByRole("dialog", { name: "Edit items" });
  const list = win.getByRole("list", { name: "Items" });
  await expect(list.getByRole("button", { name: /^Item 1 Tablet press/ })).toContainText("1 set");
  expect(await accessibilityProblems(page), "the items list on a phone meets WCAG 2.2 AA").toEqual([]);

  // Add item (design 18 Nov): its own window, numbered; Add & next says what was added and opens the next one.
  await win.getByRole("button", { name: "Add item", exact: true }).click();
  const two = page.getByRole("dialog", { name: "New item 2" });
  await expect(two).toContainText("1 item so far");
  await expect(two.getByLabel("Description")).toBeFocused();
  await two.getByLabel("Description").fill("Blister packing machine");
  await two.getByLabel("Qty").fill("2");
  await two.getByRole("button", { name: "sets", exact: true }).click();
  expect(await accessibilityProblems(page), "a line's window meets WCAG 2.2 AA").toEqual([]);
  await two.getByRole("button", { name: /Add & next/ }).click();
  const three = page.getByRole("dialog", { name: "New item 3" });
  await expect(three.getByRole("status")).toContainText("Added 2 · Blister packing machine");
  await expect(three.getByLabel("Description")).toHaveValue("");
  // Add with nothing typed says what to fill in; × closes (nothing typed, nothing asked).
  await three.getByRole("button", { name: "Add", exact: true }).click();
  await expect(three.getByLabel("Description")).toBeFocused();
  await three.getByRole("button", { name: "Close" }).click();
  await expect(three).toBeHidden();
  await expect(list.getByRole("button", { name: /^Item 2 Blister packing machine/ })).toContainText("2 sets");

  // A saved line opens in its window; Save & next goes on to the next one.
  await list.getByRole("button", { name: /^Item 1 Tablet press/ }).click();
  const one = page.getByRole("dialog", { name: "Item 1" });
  await expect(one).toContainText("1 of 2");
  await one.getByLabel("Qty").fill("3");
  await one.getByRole("button", { name: "Save & next" }).click();
  const second = page.getByRole("dialog", { name: "Item 2" });
  await expect(second.getByLabel("Description")).toHaveValue("Blister packing machine");
  await second.getByRole("button", { name: "Close" }).click();
  await expect(list.getByRole("button", { name: /^Item 1 Tablet press/ })).toContainText("3 set");

  // + Part on a line: the window opens already under it (nothing to pick); Add puts it there and it is lit.
  await list.getByRole("button", { name: "Add a part to Item 1" }).click();
  const part = page.getByRole("dialog", { name: "New part 1.1" });
  await expect(part).toContainText("Part of 1");
  await expect(part.getByRole("combobox")).toHaveCount(0);
  await expect(part.getByRole("radiogroup")).toHaveCount(0);
  await part.getByLabel("Description").fill("Upper punch, 12 mm round");
  await part.getByLabel("Qty").fill("35");
  expect(await accessibilityProblems(page), "a part's window meets WCAG 2.2 AA").toEqual([]);
  await part.getByRole("button", { name: "Add", exact: true }).click();
  await expect(part).toBeHidden();
  await expect(list.getByRole("button", { name: /^Part 1\.1 Upper punch/ })).toContainText("35");

  // A part that should be an item: Make it an item turns the same window into the next item.
  await list.getByRole("button", { name: "Add a part to Item 2" }).click();
  const wrong = page.getByRole("dialog", { name: "New part 2.1" });
  await wrong.getByRole("button", { name: "Make it an item" }).click();
  await expect(page.getByRole("dialog", { name: "New item 3" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "New item 3" }).getByRole("button", { name: /Add & next$/ })).toBeVisible();
  await page.getByRole("dialog", { name: "New item 3" }).getByRole("button", { name: "Close" }).click();

  // ⋯: a sheet headed by the line, Add a part (with the number it gets) and Edit first; Delete, then Undo.
  await list.getByRole("button", { name: "More for Item 2" }).click();
  const sheet = page.getByRole("menu", { name: "Item 2" });
  await expect(sheet).toContainText("2 · Blister packing machine");
  await expect(sheet.getByRole("menuitem", { name: /^Add a part/ })).toContainText("2.1");
  await expect(sheet.getByRole("menuitem", { name: "Edit" })).toBeVisible();
  expect(await accessibilityProblems(page), "a line's sheet meets WCAG 2.2 AA").toEqual([]);
  await sheet.getByRole("menuitem", { name: "Delete" }).click();
  await expect(list.getByRole("button", { name: /^Item 2/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(list.getByRole("button", { name: /^Item 2 Blister packing machine/ })).toBeVisible();

  // ⋯ beside Add item: the other ways in. Paste rows opens the paste box.
  await win.getByRole("button", { name: "More ways to add" }).click();
  const ways = page.getByRole("menu", { name: "More ways to add" });
  await expect(ways.getByRole("menuitem", { name: /^Import Excel/ })).toBeVisible();
  await ways.getByRole("menuitem", { name: /^Paste rows/ }).click();
  await expect(ways).toBeHidden();
  const paste = win.getByRole("region", { name: "Paste rows" });
  await expect(paste).toBeVisible();
  await paste.getByRole("button", { name: "Close" }).click();

  // Saved with the inquiry: why first (asked in the window), then every change.
  await win.getByRole("radiogroup", { name: "Why these changes?" }).getByRole("radio", { name: "Customer changed the list" }).click();
  await win.getByRole("button", { name: /^Save \d+ changes$/ }).click();
  await expect(win).toBeHidden();
  const saved = await (await page.request.get(`/api/inquiries/${deal.id}`)).json();
  const desc = (i: { description: string; quantity: string; unit: string }) => [i.description, Number(i.quantity), i.unit];
  expect(saved.items.map(desc)).toEqual([
    ["Tablet press", 3, "set"],
    ["Upper punch, 12 mm round", 35, "sets"],
    ["Blister packing machine", 2, "sets"],
  ]);
  expect(errors).toEqual([]);
});

test("offer lines on a phone: what a line still needs is marked and can be shown alone; the price typed in its window", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const t = tag();
  const deal = await newInquiry(page, t);
  const offer = await post(page, `/inquiries/${deal.id}/factory-quotes`, {
    newFactoryName: `Phone Works ${t}`,
    receivedOn: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
    currency: "CNY",
    lines: [
      { description: "Tablet press", quantity: 1, unit: "set", unitPrice: 98000 },
      { description: "Punches and dies", quantity: 2, unit: "sets", unitPrice: 0 },
    ],
  });
  await page.goto(`/inquiries/${deal.id}/offers/${offer.id}`);
  await page.getByRole("button", { name: "Edit prices" }).click();
  const win = page.getByRole("dialog", { name: "Edit prices" });
  const list = win.getByRole("list", { name: "Lines" });
  await expect(list.getByRole("button", { name: /^Line 2 Punches and dies/ })).toContainText("No price");
  await win.getByRole("button", { name: /Needs something/ }).click();
  await expect(list.getByRole("button")).toHaveCount(2); // the line and its ⋯
  await list.getByRole("button", { name: /^Line 2 Punches and dies/ }).click();
  const line = page.getByRole("dialog", { name: "Line 2" });
  await line.getByLabel("Price CNY").fill("4500");
  await line.getByRole("button", { name: "Save", exact: true }).click();
  await expect(line).toBeHidden();
  // Nothing needs anything now: the filter goes, every line shows.
  await expect(win.getByRole("button", { name: /Needs something/ })).toHaveCount(0);
  await expect(list.getByRole("button", { name: /^Line 2 Punches and dies/ })).toContainText(/4,?500/);
  // A change asks why (design rules 18 Nov), then the save counts it.
  await win.getByRole("radiogroup", { name: "Why the change?" }).getByRole("radio", { name: "Factory changed its price" }).click();
  await win.getByRole("button", { name: "Save 1 change" }).click();
  await expect(win).toBeHidden();
  const saved = (await (await page.request.get(`/api/inquiries/${deal.id}/sourcing`)).json()).quotes.find((q: { id: string }) => q.id === offer.id);
  expect(saved.lines.map((l: { unitPrice: string }) => Number(l.unitPrice))).toEqual([98000, 4500]);
  expect(errors).toEqual([]);
});

test.describe("a narrow phone (320 px, WCAG reflow)", () => {
  test.use({ viewport: { width: 320, height: 720 }, hasTouch: true });

  test("the offer's steps fit the screen, each meets WCAG 2.2 AA, Next takes the cursor to the step's title; buttons are thumb-sized", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = watchErrors(page);
    const t = tag();
    const deal = await newInquiry(page, t);
    const offer = await post(page, `/inquiries/${deal.id}/factory-quotes`, {
      newFactoryName: `Zhejiang Wanshida Pharmaceutical Machinery ${t}`,
      reference: "WSD-2026-11-0042-REV3",
      receivedOn: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
      currency: "CNY",
      basis: "FOB",
      basisPlace: "Shanghai",
      leadDays: 45,
      lines: [{ description: "Fully automatic capsule filling machine with dust extraction and vacuum pump, 120,000 capsules/hour", model: "NJP-2000C-EXTRA", quantity: 2, unit: "sets", unitPrice: 1286000 }],
    });
    await page.goto(`/inquiries/${deal.id}/offers/${offer.id}`);
    // The page: nothing wider than the screen; the lines stack (no table to scroll sideways).
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.getByRole("button", { name: "Edit offer" }).click();
    const win = page.getByRole("dialog", { name: "Edit offer" });
    const body = win.locator("[data-step-body]");
    for (const [n, step] of ["Factory", "Prices", "Delivery & payment", "Conditions", "Changes"].entries()) {
      if (n > 0) {
        await win.getByRole("button", { name: /^Next/ }).click();
        await expect(win.getByRole("heading", { name: `${step}, step ${n + 1} of 5` })).toBeFocused();
      }
      // Nothing in the step is wider than the screen, at its top or at its bottom.
      for (const end of [0, 1]) {
        await body.evaluate((el, e) => (el.scrollTop = e ? el.scrollHeight : 0), end);
        const wide = await page.evaluate(() => {
          const vw = document.documentElement.clientWidth;
          return [...document.querySelectorAll("[role=dialog] *")]
            .filter((el) => {
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.right > vw + 1 && !el.closest(".sr-only");
            })
            .map((el) => `${el.tagName} ${(el.textContent ?? "").slice(0, 40)}`)
            .slice(0, 3);
        });
        expect(wide, `${step}: nothing past the screen's edge`).toEqual([]);
      }
      expect(await accessibilityProblems(page), `${step} meets WCAG 2.2 AA at 320 px`).toEqual([]);
    }
    // On a touch screen every button in the window is at least 32 px each way (WCAG 2.2 asks 24).
    const small = await win.getByRole("button").evaluateAll((all) =>
      all
        .filter((b) => b.getClientRects().length && !b.closest(".sr-only"))
        .map((b) => ({ name: b.getAttribute("aria-label") ?? b.textContent?.trim(), w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height }))
        .filter((b) => b.w < 32 || b.h < 32),
    );
    expect(small, "buttons smaller than 32 px").toEqual([]);
    expect(errors).toEqual([]);
  });
});

test("Quote this offer on a phone: the New quotations window fits the screen (nothing to scroll sideways) and meets WCAG 2.2 AA", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const t = tag();
  const deal = await newInquiry(page, t);
  const offer = await post(page, `/inquiries/${deal.id}/factory-quotes`, {
    newFactoryName: `Zhejiang Wanshida Pharmaceutical Machinery ${t}`,
    receivedOn: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
    currency: "USD",
    basis: "FOB",
    basisPlace: "Shanghai",
    leadDays: 30,
    lines: [{ description: "Tablet press", quantity: 1, unit: "set", unitPrice: 68400 }],
  });
  await page.goto(`/inquiries/${deal.id}/offers/${offer.id}`);
  await page.getByRole("link", { name: /Quote this offer/ }).click();
  const win = page.getByRole("dialog", { name: "New quotations" });
  await expect(win.getByRole("checkbox", { name: /Zhejiang Wanshida/ })).toBeChecked();
  // Nothing in the window is wider than the screen, and no box in it scrolls sideways.
  const wide = await win.evaluate((el) => {
    const vw = document.documentElement.clientWidth;
    return [...el.querySelectorAll("*")]
      .filter((e) => e.getBoundingClientRect().right > vw + 1 || (e.scrollWidth > e.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(e).overflowX)))
      .map((e) => `${e.tagName} ${(e.textContent ?? "").slice(0, 30)}`)
      .slice(0, 3);
  });
  expect(wide, "the window fits the phone").toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect(await accessibilityProblems(page), "New quotations on a phone meets WCAG 2.2 AA").toEqual([]);
  expect(errors).toEqual([]);
});
