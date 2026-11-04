import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { buildModules, crumbsFor, moduleOf, pageOf, MODULE_PAGES, type NavModule } from "@/lib/nav";

// The sidebar (design page 33): modules with their pages, a collapsed rail with a menu per module.
const at = vi.hoisted(() => ({ path: "/finance/cash-book" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => at.path,
}));
vi.mock("@/app/login/actions", () => ({ logoutAction: vi.fn() }));

// The theme menu listens to the system's light or dark.
window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;

const { AppShell } = await import("@/components/shell/nav");

const everything = (approvals: number | null = 2, unread = 5) =>
  buildModules({ can: () => true, feature: () => true, approvals, approves: true, unread, companyAddresses: false });

/** A staff member: no money, no reports, no admin (the demo's Staff role). */
const STAFF = new Set(["inquiries.create", "money.submit"]);
const staff = () =>
  buildModules({ can: (p) => STAFF.has(p), feature: () => true, approvals: 1, approves: false, unread: 3, companyAddresses: false });

const titles = (m: NavModule[]) => m.map((x) => x.title);
const pages = (m: NavModule[], key: string) => m.find((x) => x.key === key)?.pages.map((p) => p.label);

function shell(modules: NavModule[], opts: { rail?: boolean; open?: NavModule["key"][] } = {}) {
  return render(
    <AppShell
      modules={modules}
      companyName="Kebo International"
      user={{ name: "Fawad Iqbal", email: "fawad@example.com", role: "Super Admin" }}
      unread={5}
      canCreate
      initialRail={opts.rail}
      initialOpen={opts.open}
    >
      <p>page</p>
    </AppShell>,
  );
}
const sidebar = () => within(screen.getByRole("complementary", { name: "Sidebar" }));

beforeEach(() => {
  at.path = "/finance/cash-book";
  document.cookie = "nav-rail=; max-age=0; path=/";
  document.cookie = "nav-open=; max-age=0; path=/";
});
afterEach(() => vi.useRealTimers());

describe("the modules", () => {
  it("are exactly the brief's, top to bottom, for someone who may open everything", () => {
    const m = everything();
    expect(titles(m)).toEqual(["My work", "Sales", "Orders", "Purchasing", "Finance", "Reports", "Settings", "People & access"]);
    expect(pages(m, "work")).toEqual(["Follow-ups", "Approvals", "Notifications"]);
    expect(pages(m, "sales")).toEqual(["Inquiries", "Customers"]);
    expect(pages(m, "orders")).toEqual(["Orders", "Order board"]);
    expect(pages(m, "purchasing")).toEqual(["Factories", "To pay factories"]);
    expect(pages(m, "finance")).toEqual(["To receive", "Ledger", "Cash book", "Expenses", "Profit & loss", "Leaks"]);
    expect(pages(m, "reports")).toEqual(["Overview", "Customers", "Factories", "People & targets", "Sales funnel", "Printable reports"]);
    expect(pages(m, "settings")).toEqual(["Company", "Sales & quotations", "Reminders", "Emails", "Order checklist", "Papers", "Website form"]);
    expect(pages(m, "access")).toEqual(["Users", "Roles", "Sessions", "Sign-ins", "Audit log"]);
  });

  it("each page has its own address, and none of the lists drawn as new (Quotations, Shipments, Payments in…) or Accounts", () => {
    const hrefs = MODULE_PAGES.flatMap((m) => m.pages.map((p) => p.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    const labels = MODULE_PAGES.flatMap((m) => m.pages.map((p) => p.label));
    for (const gone of ["Quotations", "Shipments", "Delivery & SAT", "Factory offers", "Payments in", "Accounts"]) expect(labels).not.toContain(gone);
    expect(hrefs).toEqual(
      expect.arrayContaining([
        "/finance/cash-book",
        "/finance/expenses",
        "/finance/to-receive",
        "/finance/ledger",
        "/finance/profit",
        "/finance/leaks",
        "/purchasing/to-pay",
        "/reports",
        "/reports/customers",
        "/reports/factories",
        "/reports/people",
        "/reports/funnel",
        "/reports/print",
        "/settings/company",
        "/access/roles",
        "/access/sessions",
        "/access/sign-ins",
        "/orders/board",
      ]),
    );
  });

  it("Company address shows only when companies have their own addresses", () => {
    const m = buildModules({ can: () => true, feature: () => true, approvals: 0, approves: true, unread: 0, companyAddresses: true });
    expect(pages(m, "settings")?.at(-1)).toBe("Company address");
  });

  it("hide the pages a person may not open, and a module with none left", () => {
    const m = staff();
    expect(titles(m)).toEqual(["My work", "Sales", "Orders"]);
    expect(pages(m, "work")).toEqual(["Follow-ups", "Approvals", "Notifications"]);
    // No approvals for someone who neither approves nor sends money for approval.
    const none = buildModules({ can: () => false, feature: () => true, approvals: null, approves: false, unread: 0, companyAddresses: false });
    expect(pages(none, "work")).toEqual(["Follow-ups", "Notifications"]);
  });

  it("follow the plan: no cash book, expenses, reports or audit log when the plan leaves them out", () => {
    const m = buildModules({ can: () => true, feature: (f) => !["cash_book", "expenses", "insights", "audit_log"].includes(f), approvals: 0, approves: true, unread: 0, companyAddresses: false });
    expect(pages(m, "finance")).toEqual(["To receive", "Ledger"]);
    expect(titles(m)).not.toContain("Reports");
    expect(pages(m, "access")).toEqual(["Users", "Roles", "Sessions", "Sign-ins"]);
  });

  it("a manager sees money and reports but not People & access or Settings without those permissions", () => {
    const MANAGER = new Set(["sourcing.manage", "expenses.manage", "payments.record", "reports.view", "users.manage", "inquiries.create"]);
    const m = buildModules({ can: (p) => MANAGER.has(p), feature: () => true, approvals: 4, approves: true, unread: 0, companyAddresses: false });
    expect(titles(m)).toEqual(["My work", "Sales", "Orders", "Purchasing", "Finance", "Reports", "People & access"]);
    expect(pages(m, "access")).toEqual(["Users"]);
    // A recorder without expenses: only To receive in Finance; money reports need expenses.manage.
    const recorder = buildModules({ can: (p) => ["sourcing.manage", "payments.record", "reports.view"].includes(p), feature: () => true, approvals: 0, approves: true, unread: 0, companyAddresses: false });
    expect(pages(recorder, "finance")).toEqual(["To receive"]);
  });

  it("know which page and module an address is in (the longest address wins)", () => {
    const all = everything();
    const flat = all.flatMap((m) => m.pages);
    expect(pageOf("/orders/board", flat)?.label).toBe("Order board");
    expect(pageOf("/orders/0b6c", flat)?.label).toBe("Orders");
    expect(pageOf("/reports/people/targets", flat)?.label).toBe("People & targets");
    expect(pageOf("/reports", flat)?.label).toBe("Overview");
    expect(pageOf("/access/roles/manager", flat)?.label).toBe("Roles");
    expect(moduleOf("/finance/leaks", all)).toBe("finance");
    expect(moduleOf("/dashboard", all)).toBeUndefined();
    expect(crumbsFor("/finance/cash-book")).toEqual([{ label: "Finance" }, { label: "Cash book" }]);
  });
});

describe("the sidebar", () => {
  it("has Home first on its own, then a button per module that opens and closes it", () => {
    shell(everything());
    const nav = sidebar();
    const main = within(nav.getByRole("navigation", { name: "Main" }));
    const items = main.getAllByRole("listitem").filter((li) => li.parentElement?.parentElement?.tagName === "NAV");
    expect(items[0]!.textContent).toBe("Home");
    expect(main.getByRole("link", { name: "Home" }).getAttribute("href")).toBe("/dashboard");
    const finance = main.getByRole("button", { name: /^Finance/ });
    expect(finance.getAttribute("aria-expanded")).toBe("true");
    const sales = main.getByRole("button", { name: /^Sales/ });
    expect(sales.getAttribute("aria-expanded")).toBe("false");
    const list = document.getElementById(sales.getAttribute("aria-controls")!)!;
    expect(list.hidden).toBe(true);
    fireEvent.click(sales);
    expect(sales.getAttribute("aria-expanded")).toBe("true");
    expect(list.hidden).toBe(false);
    expect(within(list).getByRole("link", { name: "Inquiries" }).getAttribute("href")).toBe("/inquiries");
    // Remembered for the next page load.
    expect(document.cookie).toMatch(/nav-open=[^;]*sales/);
    fireEvent.click(sales);
    expect(sales.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens the current page's module by itself and marks the page: highlight, bar and aria-current", () => {
    at.path = "/finance/cash-book";
    shell(everything());
    const current = sidebar().getByRole("link", { current: "page" });
    expect(current.textContent).toBe("Cash book");
    expect(current.className).toContain("bg-primary-soft");
    expect(current.querySelector("span[aria-hidden]")?.className).toContain("w-[3px]");
    expect(sidebar().getAllByRole("link", { current: "page" })).toHaveLength(1);
  });

  it("remembers only the modules the person opened; closing the current one keeps it closed on this page", () => {
    at.path = "/finance/cash-book";
    const { rerender } = shell(everything());
    const finance = () => sidebar().getByRole("button", { name: /^Finance/ });
    expect(finance().getAttribute("aria-expanded")).toBe("true");
    // Opened by itself: not written to the cookie.
    expect(document.cookie).not.toMatch(/nav-open=[^;]*finance/);
    fireEvent.click(finance());
    expect(finance().getAttribute("aria-expanded")).toBe("false");
    // Another module's page: Finance stays closed (it was only open because it was the current one).
    at.path = "/settings/company";
    rerender(
      <AppShell modules={everything()} companyName="Kebo International" user={{ name: "Fawad Iqbal", email: "fawad@example.com", role: "Super Admin" }}>
        <p>page</p>
      </AppShell>,
    );
    expect(finance().getAttribute("aria-expanded")).toBe("false");
    expect(sidebar().getByRole("button", { name: /^Settings/ }).getAttribute("aria-expanded")).toBe("true");
  });

  it("marks the board, not the list, on /orders/board; a record marks its list", () => {
    at.path = "/orders/board";
    const { unmount } = shell(everything());
    expect(sidebar().getByRole("link", { current: "page" }).textContent).toBe("Order board");
    unmount();
    at.path = "/orders/9a1b";
    shell(everything());
    expect(sidebar().getByRole("link", { current: "page" }).textContent).toBe("Orders");
  });

  it("keeps the modules left open (cookie), with the current one", () => {
    at.path = "/settings/company";
    shell(everything(), { open: ["sales"] });
    expect(sidebar().getByRole("button", { name: /^Sales/ }).getAttribute("aria-expanded")).toBe("true");
    expect(sidebar().getByRole("button", { name: /^Settings/ }).getAttribute("aria-expanded")).toBe("true");
    expect(sidebar().getByRole("button", { name: /^Finance/ }).getAttribute("aria-expanded")).toBe("false");
  });

  it("shows counts on the pages, and a closed module shows its children's total", () => {
    at.path = "/finance/cash-book";
    shell(everything(2, 5));
    const work = sidebar().getByRole("button", { name: /^My work/ });
    expect(work.getAttribute("aria-expanded")).toBe("false");
    expect(within(work).getByLabelText("7 to look at").textContent).toBe("7");
    fireEvent.click(work);
    // Open: the total goes, each page shows its own.
    expect(within(work).queryByLabelText("7 to look at")).toBeNull();
    expect(sidebar().getByLabelText("2 waiting").textContent).toBe("2");
    expect(sidebar().getByLabelText("5 unread").textContent).toBe("5");
  });

  it("collapses to an icon rail and back, remembered in a cookie", () => {
    shell(everything());
    expect(screen.getByRole("complementary", { name: "Sidebar" }).className).toContain("w-60");
    fireEvent.click(sidebar().getByRole("button", { name: "Collapse the sidebar" }));
    expect(screen.getByRole("complementary", { name: "Sidebar" }).className).toContain("w-16");
    expect(document.cookie).toContain("nav-rail=1");
    // The page moves over with it.
    expect(document.querySelector("[data-sidebar]")?.className).toContain("lg:pl-16");
    expect(sidebar().queryByRole("button", { name: "Collapse the sidebar" })).toBeNull();
    expect(sidebar().getByRole("button", { name: "Finance" }).getAttribute("aria-haspopup")).toBe("menu");
    fireEvent.click(sidebar().getByRole("button", { name: "Expand the sidebar" }));
    expect(screen.getByRole("complementary", { name: "Sidebar" }).className).toContain("w-60");
    expect(document.cookie).toContain("nav-rail=0");
  });

  it("starts collapsed when it was left so (no jump: the server knows from the cookie)", () => {
    shell(everything(), { rail: true });
    expect(screen.getByRole("complementary", { name: "Sidebar" }).className).toContain("w-16");
    expect(document.querySelector("[data-sidebar]")?.getAttribute("data-sidebar")).toBe("rail");
    // The current module's icon is marked; a module with counts says so.
    expect(sidebar().getByRole("button", { name: "Finance" }).className).toContain("bg-primary-soft");
    expect(sidebar().getByRole("button", { name: "My work, 7 to look at" })).toBeTruthy();
  });
});

describe("the rail's menus", () => {
  it("open on hover and close after the mouse leaves", () => {
    vi.useFakeTimers();
    shell(everything(), { rail: true });
    const wrap = sidebar().getByRole("button", { name: "Sales" }).parentElement!;
    fireEvent.mouseEnter(wrap);
    const menu = screen.getByRole("menu", { name: "Sales" });
    expect(within(menu).getAllByRole("menuitem").map((a) => a.textContent)).toEqual(["Inquiries", "Customers"]);
    fireEvent.mouseLeave(wrap);
    act(() => vi.advanceTimersByTime(300));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("work with the keyboard: focus opens it, ↓ goes in, ↑ ↓ move, Esc closes it back on the icon", () => {
    shell(everything(), { rail: true });
    const finance = sidebar().getByRole("button", { name: "Finance" });
    act(() => finance.focus());
    expect(finance.getAttribute("aria-expanded")).toBe("true");
    const menu = screen.getByRole("menu", { name: "Finance" });
    expect(finance.getAttribute("aria-controls")).toBe(menu.id);
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((a) => a.textContent)).toEqual(["To receive", "Ledger", "Cash book", "Expenses", "Profit & loss", "Leaks"]);
    expect(items[2]!.getAttribute("aria-current")).toBe("page");
    fireEvent.keyDown(finance, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1]!, { key: "ArrowUp" });
    fireEvent.keyDown(items[0]!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[5]);
    fireEvent.keyDown(items[5]!, { key: "Home" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(finance);
    // Focus put back by Esc does not open it again.
    expect(finance.getAttribute("aria-expanded")).toBe("false");
    // Enter opens it on the first page.
    fireEvent.keyDown(finance, { key: "Enter" });
    expect(document.activeElement?.textContent).toBe("To receive");
  });

  it("Tab in a menu closes it and moves on to the next module", () => {
    shell(everything(), { rail: true });
    const finance = sidebar().getByRole("button", { name: "Finance" });
    act(() => finance.focus());
    fireEvent.keyDown(finance, { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(document.activeElement).toBe(sidebar().getByRole("button", { name: "Reports" }));
    expect(screen.getByRole("menu", { name: "Reports" })).toBeTruthy();
    expect(screen.getAllByRole("menu")).toHaveLength(1);
  });

  it("Esc closes a menu opened by hovering, wherever focus is", () => {
    shell(everything(), { rail: true });
    fireEvent.mouseEnter(sidebar().getByRole("button", { name: "Orders" }).parentElement!);
    expect(screen.getByRole("menu", { name: "Orders" })).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("the phone drawer", () => {
  it("holds the same modules, with rows at least 44 px tall", () => {
    shell(staff());
    fireEvent.click(screen.getAllByRole("button", { name: /Open menu|Menu/ })[0]!);
    const drawer = within(screen.getByRole("complementary", { name: "Menu" }));
    expect(drawer.getAllByRole("button", { expanded: false }).map((b) => b.textContent?.replace(/\d+/g, ""))).toEqual(["My work", "Sales", "Orders"]);
    for (const b of drawer.getAllByRole("button", { expanded: false })) expect(b.className).toContain("min-h-11");
    expect(drawer.getByRole("link", { name: "Home" }).className).toContain("min-h-11");
    fireEvent.click(drawer.getByRole("button", { name: /^Sales/ }));
    expect(drawer.getByRole("link", { name: "Inquiries" }).className).toContain("min-h-11");
  });
});
