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

test("inquiry items on a phone: a list, Add & next, a tap opens the item's sheet (Edit first), Delete and Undo, saved with the inquiry", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const deal = await newInquiry(page, tag());
  await page.goto(`/inquiries/${deal.id}?panel=edit-request&id=items`);
  const win = page.getByRole("dialog", { name: "Edit items" });
  const list = win.getByRole("list", { name: "Items" });
  await expect(list.getByRole("button", { name: /^Item 1 Tablet press/ })).toContainText("1 set");
  expect(await accessibilityProblems(page), "the items list on a phone meets WCAG 2.2 AA").toEqual([]);

  // + beside Find (design "Items on a small phone"): its own window, numbered; Add & next says what was added and opens the next one.
  await win.getByRole("button", { name: "Add item", exact: true }).click();
  const two = page.getByRole("dialog", { name: "New item 2" });
  await expect(two).toContainText("1 item so far");
  await expect(two.getByLabel("Description")).toBeFocused();
  await two.getByLabel("Description").fill("Blister packing machine");
  await two.getByLabel("Quantity").fill("2");
  // Unit (design 18 Nov): one dropdown — the units used here first, every unit, Other… to type your own.
  await two.getByRole("button", { name: "Unit" }).click();
  const units = page.getByRole("menu", { name: "Unit" });
  await expect(units).toContainText("Used here");
  await units.getByRole("menuitemradio", { name: "sets" }).click();
  await expect(units).toBeHidden();
  await expect(two.getByRole("button", { name: "Unit" })).toContainText("sets");
  expect(await accessibilityProblems(page), "an item's window meets WCAG 2.2 AA").toEqual([]);
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

  // A tap opens the item's sheet, never its window by itself; Edit (first) opens it; Save & next goes on to the next one.
  await list.getByRole("button", { name: /^Item 1 Tablet press/ }).click();
  const menuOne = page.getByRole("menu", { name: "Item 1" });
  await expect(menuOne.getByRole("menuitem").first()).toHaveText("Edit");
  await expect(page.getByRole("dialog", { name: "Item 1" })).toHaveCount(0);
  await menuOne.getByRole("menuitem", { name: "Edit" }).click();
  const one = page.getByRole("dialog", { name: "Item 1" });
  await expect(one).toContainText("1 of 2");
  await one.getByLabel("Quantity").fill("3");
  await one.getByRole("button", { name: "Save & next" }).click();
  const second = page.getByRole("dialog", { name: "Item 2" });
  await expect(second.getByLabel("Description")).toHaveValue("Blister packing machine");
  await second.getByRole("button", { name: "Close" }).click();
  await expect(list.getByRole("button", { name: /^Item 1 Tablet press/ })).toContainText("3 set");

  // Add a part (in the item's sheet): the window opens already under it (nothing to pick); Add puts it there and it is lit.
  await list.getByRole("button", { name: /^Item 1 Tablet press/ }).click();
  await page.getByRole("menu", { name: "Item 1" }).getByRole("menuitem", { name: /^Add a part/ }).click();
  const part = page.getByRole("dialog", { name: "New part 1.1" });
  await expect(part).toContainText("Part of 1");
  await expect(part.getByRole("combobox")).toHaveCount(0);
  await expect(part.getByRole("radiogroup")).toHaveCount(0);
  await part.getByLabel("Description").fill("Upper punch, 12 mm round");
  await part.getByLabel("Quantity").fill("35");
  // A unit not in the list: Other… turns the box into one to type in.
  await part.getByRole("button", { name: "Unit" }).click();
  await page.getByRole("menu", { name: "Unit" }).getByRole("menuitem", { name: "Other…" }).click();
  await expect(part.getByRole("textbox", { name: "Unit" })).toBeFocused();
  await part.getByRole("textbox", { name: "Unit" }).fill("bundles");
  expect(await accessibilityProblems(page), "a part's window meets WCAG 2.2 AA").toEqual([]);
  await part.getByRole("button", { name: "Add", exact: true }).click();
  await expect(part).toBeHidden();
  await expect(list.getByRole("button", { name: /^Part 1\.1 Upper punch/ })).toContainText("35 bundles");

  // A part that should be an item: Make it an item turns the same window into the next item.
  await list.getByRole("button", { name: /^Item 2 Blister packing machine/ }).click();
  await page.getByRole("menu", { name: "Item 2" }).getByRole("menuitem", { name: /^Add a part/ }).click();
  const wrong = page.getByRole("dialog", { name: "New part 2.1" });
  await wrong.getByRole("button", { name: "Make it an item" }).click();
  await expect(page.getByRole("dialog", { name: "New item 3" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "New item 3" }).getByRole("button", { name: /Add & next$/ })).toBeVisible();
  await page.getByRole("dialog", { name: "New item 3" }).getByRole("button", { name: "Close" }).click();

  // The item's sheet: headed by the item, Edit first, Add a part (with the number it gets); Delete, then Undo.
  await list.getByRole("button", { name: /^Item 2 Blister packing machine/ }).click();
  const sheet = page.getByRole("menu", { name: "Item 2" });
  // Its head (the item) with ✕ beside it, above the menu.
  await expect(page.getByText("2 · Blister packing machine")).toBeVisible();
  await expect(page.getByRole("button", { name: "Close", exact: true }).last()).toBeVisible();
  await expect(sheet.getByRole("menuitem", { name: /^Add a part/ })).toContainText("2.1");
  await expect(sheet.getByRole("menuitem", { name: "Edit" })).toBeVisible();
  expect(await accessibilityProblems(page), "an item's sheet meets WCAG 2.2 AA").toEqual([]);
  await sheet.getByRole("menuitem", { name: "Delete" }).click();
  await expect(list.getByRole("button", { name: /^Item 2/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(list.getByRole("button", { name: /^Item 2 Blister packing machine/ })).toBeVisible();

  // ⋯ beside +: the other ways in, and Select. Paste rows opens the paste box.
  await win.getByRole("button", { name: "More ways to add" }).click();
  const ways = page.getByRole("menu", { name: "More ways to add" });
  await expect(ways.getByRole("menuitem", { name: /^Import Excel/ })).toBeVisible();
  await ways.getByRole("menuitem", { name: /^Paste items/ }).click();
  await expect(ways).toBeHidden();
  const paste = win.getByRole("region", { name: "Paste items" });
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
    ["Upper punch, 12 mm round", 35, "bundles"],
    ["Blister packing machine", 2, "sets"],
  ]);
  expect(errors).toEqual([]);
});

test("offer lines on a phone: what a line still needs is marked and can be shown alone; the price typed in its line", async ({ page }) => {
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
  const list = win.getByRole("list", { name: "Items" });
  // The price is typed right in the line (asked 19 Nov): an item without one has an empty, marked box.
  const box = list.getByLabel("Unit price CNY for 2");
  await expect(box).toHaveValue("");
  await expect(list.getByLabel("Unit price CNY for 1")).toHaveValue("98,000.00");
  // What is missing, said once: the chip says it (No price), only while an item needs something.
  const chips = win.getByRole("group", { name: "Show items" });
  await chips.getByRole("button", { name: /^No price/ }).click();
  await expect(list.getByRole("button")).toHaveCount(1);
  await box.click();
  await box.pressSequentially("4500");
  await box.press("Enter");
  // Nothing needs anything now: the filter goes, every line shows.
  await expect(chips).toHaveCount(0);
  await expect(list.getByLabel("Unit price CNY for 2")).toHaveValue(/4,?500/);
  // The line's sheet still has Edit (the whole item in its window).
  await list.getByRole("button", { name: /^Item 2 Punches and dies/ }).click();
  await expect(page.getByRole("menu", { name: "Item 2" }).getByRole("menuitem", { name: "Edit" })).toBeVisible();
  await page.keyboard.press("Escape");
  // A change asks why (design rules 18 Nov), then the save counts it.
  await win.getByRole("radiogroup", { name: "Why the change?" }).getByRole("radio", { name: "Supplier changed its price" }).click();
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
    await page.getByRole("button", { name: /^More for .*offer/ }).click();
    await page.getByRole("menuitem", { name: "Edit offer" }).click();
    const win = page.getByRole("dialog", { name: "Edit offer" });
    const body = win.locator("[data-step-body]");
    for (const [n, step] of ["Supplier", "Prices", "Delivery & payment", "Warranty & conditions", "Changes"].entries()) {
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

/*
 * Design "Items on a small phone" (18 Nov 2026): on the smallest phone the items list keeps one line of tools on top
 * (Find · + · ⋯), puts the total in the window's footer beside Save (nothing floats over the items), opens an item's
 * sheet on a tap, keeps the other ways in under ⋯ (and at the end of the list only when they help), and shows the
 * matches above the keyboard while finding. On a record's page the same item line is read only, a tap shows the item.
 */
test.describe("the smallest phone (320 × 568)", () => {
  test.use({ viewport: { width: 320, height: 568 }, hasTouch: true });

  test("offer prices: Find · + · ⋯, the total beside Save, finding hides the footer, the customer's items under ⋯ and at the end, Select's bar", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = watchErrors(page);
    const t = tag();
    const me = await (await page.request.get("/api/auth/me")).json();
    const customer = await post(page, "/customers", { name: `Small Pharma ${t}`, country: "PK", contacts: [{ name: "Hina", email: `hina-${t}@small.test` }] });
    const deal = await post(page, "/inquiries", {
      customerId: customer.id,
      category: "Machinery",
      assigneeId: me.id,
      items: [
        { description: "Tablet press", quantity: 1, unit: "set" },
        { description: "Capsule filler", quantity: 1, unit: "set" },
        { description: "Blister packer", quantity: 1, unit: "set" },
      ],
    });
    const full = await (await page.request.get(`/api/inquiries/${deal.id}`)).json();
    const offer = await post(page, `/inquiries/${deal.id}/factory-quotes`, {
      newFactoryName: `Small Works ${t}`,
      receivedOn: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
      currency: "CNY",
      lines: [{ description: "Tablet press", quantity: 1, unit: "set", unitPrice: 98000, requestedItemId: full.items[0].id }],
    });
    await page.goto(`/inquiries/${deal.id}/offers/${offer.id}?panel=edit-offer&id=prices`);
    const win = page.getByRole("dialog", { name: "Edit prices" });
    const list = win.getByRole("list", { name: "Items" });
    await expect(list.getByLabel("Unit price CNY for 1")).toHaveValue("98,000.00");
    // One line of tools: Find (it says how many), +, ⋯; no Add item bar and no Copy button in the way.
    await expect(win.getByRole("searchbox", { name: "Find an item" })).toHaveAttribute("placeholder", "Find in 1 item");
    await expect(win.getByRole("button", { name: "Add item", exact: true })).toBeVisible();
    await expect(win.getByRole("button", { name: /Copy customer/ })).toHaveCount(0);
    // The total sits in the footer beside Save, not over the items; a tap shows every total.
    const footer = win.locator("[data-window-footer]");
    await expect(footer.getByRole("button", { name: /Total/ })).toContainText("CNY");
    await footer.getByRole("button", { name: /Total/ }).click();
    const totals = page.getByRole("dialog", { name: "Totals" });
    await expect(totals).toContainText(/Total · no tax|Total with tax/);
    expect(await accessibilityProblems(page), "the totals sheet meets WCAG 2.2 AA").toEqual([]);
    await totals.getByRole("button", { name: "Close" }).click();
    // Nothing wider than the screen.
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    // The customer's items this offer lacks: one quiet line at the end of the list.
    await expect(win.getByText("2 of the customer’s items are not here yet.")).toBeVisible();
    // Finding: the footer steps away, the count is in the box, Done ends it.
    const find = win.getByRole("searchbox", { name: "Find an item" });
    await find.fill("press");
    await expect(footer).toBeHidden();
    await expect(win.getByText("1 of 1", { exact: true })).toBeVisible();
    await find.fill("valve");
    await expect(win.getByRole("button", { name: /Add “valve” as an item/ })).toBeVisible();
    await find.fill("");
    await win.getByRole("button", { name: "Done" }).click();
    await expect(footer).toBeVisible();
    // ⋯: the customer's items first, then the other ways in, and Select.
    await win.getByRole("button", { name: /More ways to add/ }).click();
    const ways = page.getByRole("menu", { name: /More ways to add/ });
    await expect(ways.getByRole("menuitem").first()).toContainText("Copy the customer’s items");
    expect(await accessibilityProblems(page), "the ways in on a phone meet WCAG 2.2 AA").toEqual([]);
    await ways.getByRole("menuitem", { name: /Copy the customer’s items/ }).click();
    await expect(list.getByRole("button")).toHaveCount(4);
    await expect(win.getByText(/of the customer’s items (is|are) not here yet/)).toHaveCount(0);
    // Select: from ⋯; its bar takes the footer's place; Done ends it.
    await win.getByRole("button", { name: /More ways to add/ }).click();
    await page.getByRole("menu", { name: /More ways to add/ }).getByRole("menuitem", { name: "Select items" }).click();
    await list.getByRole("checkbox").nth(2).click();
    await list.getByRole("checkbox").nth(3).click();
    const bar = page.getByRole("toolbar", { name: "2 selected" });
    await expect(bar.getByRole("button", { name: /Delete/ })).toBeVisible();
    await bar.getByRole("button", { name: /Delete/ }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    // Deleting ends Select: Find · + · ⋯ are back.
    await expect(list.getByRole("button")).toHaveCount(2);
    await expect(win.getByRole("searchbox", { name: "Find an item" })).toBeVisible();
    // (The list back at its top: a price box half under the sticky tools is not a target to judge.)
    await list.getByLabel("Unit price CNY for 1").scrollIntoViewIfNeeded();
    expect(await accessibilityProblems(page), "the items list on the smallest phone meets WCAG 2.2 AA").toEqual([]);
    expect(errors).toEqual([]);
  });

  test("a quotation's prices: the item line with its price box, the total and margin beside Save, every figure in a sheet", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = watchErrors(page);
    const t = tag();
    const deal = await newInquiry(page, t);
    const full = await (await page.request.get(`/api/inquiries/${deal.id}`)).json();
    await post(page, `/inquiries/${deal.id}/factory-quotes`, {
      newFactoryName: `Quote Works ${t}`,
      receivedOn: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
      currency: "USD",
      basis: "FOB",
      basisPlace: "Shanghai",
      lines: [{ description: "Tablet press", quantity: 1, unit: "set", unitPrice: 50000, requestedItemId: full.items[0].id }],
    });
    await page.goto(`/inquiries/${deal.id}/quotation`);
    await page.getByRole("button", { name: "New quotations" }).first().click();
    const make = page.getByRole("dialog", { name: "New quotations" });
    await make.getByRole("button", { name: /Make the draft/ }).click();
    await expect(make).toBeHidden();
    await page.getByRole("button", { name: "Edit prices" }).filter({ visible: true }).first().click();
    const win = page.getByRole("dialog", { name: /^Prices · QUO-/ });
    // The item line, its price box in it (pricing is the work here); nothing wider than the screen.
    const items = win.getByRole("list", { name: "Option A prices" });
    await expect(items).toContainText("Tablet press");
    const price = items.getByLabel("Unit price for 1");
    // (The box selects its figure as it takes focus; then the price is typed over it.)
    await price.click();
    await page.waitForTimeout(150);
    await price.pressSequentially("60000");
    await price.blur();
    await expect(items).toContainText("60,000.00");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    // The total and margin in the footer beside Save; a tap shows every figure, the discount with them.
    const footer = win.locator("[data-window-footer]");
    await expect(footer.getByRole("button", { name: /Total/ })).toContainText("60,000.00");
    await footer.getByRole("button", { name: /Total/ }).click();
    const sheet = page.getByRole("dialog", { name: "Totals" });
    await expect(sheet.getByLabel("Discount")).toBeVisible();
    expect(await accessibilityProblems(page), "the quotation's totals on a phone meet WCAG 2.2 AA").toEqual([]);
    await sheet.getByRole("button", { name: "Close" }).click();
    expect(await accessibilityProblems(page), "the quotation's prices on the smallest phone meet WCAG 2.2 AA").toEqual([]);
    expect(errors).toEqual([]);
  });

  test("a record's page: the same item line read only, a tap shows the item, its button opens the window", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = watchErrors(page);
    const t = tag();
    const deal = await newInquiry(page, t);
    const full = await (await page.request.get(`/api/inquiries/${deal.id}`)).json();
    const offer = await post(page, `/inquiries/${deal.id}/factory-quotes`, {
      newFactoryName: `Sheet Works ${t}`,
      receivedOn: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
      currency: "CNY",
      leadTime: "35 days after the deposit",
      lines: [{ description: "Tablet press", quantity: 1, unit: "set", unitPrice: 98000, requestedItemId: full.items[0].id }],
    });
    // The inquiry: the item, and the offers that price it.
    await page.goto(`/inquiries/${deal.id}`);
    const items = page.getByRole("list", { name: "Items they asked for" });
    await items.getByRole("button", { name: /Tablet press/ }).click();
    const sheet = page.getByRole("dialog", { name: /1 · Tablet press/ });
    await expect(sheet).toContainText("Offers for it");
    await expect(sheet).toContainText(`Sheet Works ${t}`);
    expect(await accessibilityProblems(page), "an item's sheet on a phone meets WCAG 2.2 AA").toEqual([]);
    await sheet.getByRole("link", { name: "Edit items" }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole("dialog", { name: "Edit items" })).toBeVisible();
    // The offer: the item's price and tax; Edit prices opens that part only.
    await page.goto(`/inquiries/${deal.id}/offers/${offer.id}`);
    await page.getByRole("list", { name: /prices$/ }).getByRole("button", { name: /Tablet press/ }).click();
    const priced = page.getByRole("dialog", { name: /1 · Tablet press/ });
    await expect(priced).toContainText("CNY 98,000.00");
    await priced.getByRole("link", { name: "Edit prices" }).click();
    await expect(page.getByRole("dialog", { name: "Edit prices" })).toBeVisible();
    expect(errors).toEqual([]);
  });
});
