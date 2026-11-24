import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { buildModules, crumbsFor, isSingle, moduleOf, pageOf, MODULE_PAGES, type NavModule } from "@/lib/nav";

// The menu (13 Nov 2026): Home and five groups with plain names, two levels; down the left on a desktop, folding
// to a strip of icons; over the page on a phone.
const at = vi.hoisted(() => ({ path: "/finance/cash-book" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => at.path,
}));
vi.mock("@/app/login/actions", () => ({ logoutAction: vi.fn() }));

// The shell asks the window whether it is wide (the fold button) and light or dark (the look).
const wide = { on: true };
window.matchMedia = ((q: string) => ({ matches: q.includes("min-width") ? wide.on : false, media: q, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;

const { AppShell } = await import("@/components/shell/nav");

const everything = (approvals: number | null = 2) =>
  buildModules({ can: () => true, feature: () => true, approvals, approves: true, companyAddresses: false });

/** A staff member: no money, no reports, no settings (the demo's Staff role). */
const STAFF = new Set(["inquiries.create", "money.submit"]);
const staff = () =>
  buildModules({ can: (p) => STAFF.has(p), feature: () => true, approvals: 1, approves: false, companyAddresses: false });

const titles = (m: NavModule[]) => m.map((x) => x.title);
const pages = (m: NavModule[], key: string) => m.find((x) => x.key === key)?.pages.map((p) => p.label);
/** The pages that carry the thin line above them. */
const lines = (m: NavModule[], key: string) => m.find((x) => x.key === key)?.pages.filter((p) => p.lineBefore).map((p) => p.label);

function shell(modules: NavModule[], opts: { open?: NavModule["key"][]; fold?: boolean | null; newItems?: { href: string; label: string }[] } = {}) {
  return render(
    <AppShell
      modules={modules}
      companyName="Kebo International"
      user={{ name: "Fawad Iqbal", email: "fawad@example.com", role: "Super Admin" }}
      unread={5}
      canCreate
      initialOpen={opts.open}
      initialFold={opts.fold ?? null}
      newItems={opts.newItems}
    >
      <p>page</p>
    </AppShell>,
  );
}

/** The open menu beside the page, and the folded strip (both are in the page; the screen's width shows one). */
const menu = () => within(screen.getByRole("complementary", { name: "Menu" }));
const strip = () => within(screen.getByRole("complementary", { name: "Menu, folded" }));

beforeEach(() => {
  at.path = "/finance/cash-book";
  wide.on = true;
  document.cookie = "nav-open=; max-age=0; path=/";
  document.cookie = "nav-fold=; max-age=0; path=/";
});
afterEach(() => vi.useRealTimers());

describe("the groups", () => {
  it("are six, with plain names, for someone who may open everything", () => {
    const m = everything();
    expect(titles(m)).toEqual(["Sales", "Purchasing", "Finance", "Reports", "Company settings", "Admin settings"]);
    // Clean-up (14 Nov 2026): a shipment is on its order, not a page of its own.
    // The order list and the board are two views of one page (a switch on it): one item.
    expect(pages(m, "sales")).toEqual(["Inquiries", "Sales orders", "Customers", "Follow-ups"]);
    // Purchase orders keep their list (each one has a page of its own that shows it).
    expect(pages(m, "purchasing")).toEqual(["Purchase orders", "Suppliers"]);
    // Money, simple (14 Nov 2026): four pages. To verify and the Ledger keep their addresses and left the menu.
    expect(pages(m, "money")).toEqual(["Receivables", "Payables", "Payments", "Cash & bank", "Expenses"]);
    // Reports is a group (22 Nov 2026): each report a page; money ones first.
    expect(pages(m, "reports")).toEqual(["Overview", "Profit & loss", "Cash flow", "Expenses", "Customers", "Suppliers", "Sales team", "Sales funnel"]);
    expect(m.filter(isSingle)).toEqual([]);
    // Settings is two groups: the company's own (managers too), and the admin's.
    expect(pages(m, "company")).toEqual(["Company", "Sales & quotations", "Closed months", "Document templates", "Reminders", "Emails", "Website form"]);
    expect(pages(m, "admin")).toEqual(["Staff", "Roles", "Login history", "Active sessions", "Email sending", "Audit log"]);
  });

  it("have one name each, and two levels: a group and its pages", () => {
    for (const m of MODULE_PAGES) {
      expect(Object.keys(m).sort()).toEqual(["icon", "key", "pages", "title"]);
      for (const p of m.pages) expect(Object.keys(p).filter((k) => k !== "lineBefore").sort()).toEqual(["href", "label"]);
    }
  });

  it("each page keeps its address, and no page is listed twice", () => {
    const hrefs = MODULE_PAGES.flatMap((m) => m.pages.map((p) => p.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect([...hrefs].sort()).toEqual(
      [
        "/inquiries",
        "/orders",
        "/customers",
        "/follow-ups",
        "/operations/purchase-orders",
        "/suppliers",
        "/money/due",
        "/money/payables",
        "/payments",
        "/finance/cash-book",
        "/money/company-costs",
        "/reports",
        "/reports/profit",
        "/reports/cash",
        "/reports/spending",
        "/reports/customers",
        "/reports/factories",
        "/reports/people",
        "/reports/funnel",
        "/audit",
        "/settings/company",
        "/settings/address",
        "/settings/sales",
        "/settings/books",
        "/settings/papers",
        "/settings/reminders",
        "/settings/emails",
        "/settings/website-form",
        "/users",
        "/access/roles",
        "/access/sign-ins",
        "/access/sessions",
        "/settings/mail",
      ].sort(),
    );
    // Tabs on the page, the bell, and the pages that left the menu: not menu items.
    for (const tab of ["/reports/print", "/reports/people/targets", "/finance/profit", "/finance/leaks", "/notifications", "/approvals", "/finance/ledger", "/finance/invoices", "/finance/to-receive", "/purchasing/to-pay", "/operations/shipments", "/orders/board"])
      expect(hrefs).not.toContain(tab);
  });

  it("Company address shows only when companies have their own addresses", () => {
    expect(pages(everything(), "company")).not.toContain("Company address");
    const m = buildModules({ can: () => true, feature: () => true, approvals: 0, approves: true, companyAddresses: true });
    expect(pages(m, "company")?.slice(0, 2)).toEqual(["Company", "Company address"]);
  });

  it("hide the pages a person may not open, and a group with none left", () => {
    const m = staff();
    // What customers owe on the orders a person sees, and Payments, are open to everyone who sees orders.
    expect(titles(m)).toEqual(["Sales", "Finance"]);
    expect(pages(m, "sales")).toEqual(["Inquiries", "Sales orders", "Customers", "Follow-ups"]);
    expect(pages(m, "money")).toEqual(["Receivables", "Payments"]);
    const none = buildModules({ can: () => false, feature: () => true, approvals: null, approves: false, companyAddresses: false });
    expect(titles(none)).toEqual(["Sales", "Finance"]);
    expect(pages(none, "money")).toEqual(["Receivables", "Payments"]);
  });

  it("follow the plan: no cash and bank, expenses, reports or activity log when the plan leaves them out", () => {
    const m = buildModules({ can: () => true, feature: (f) => !["cash_book", "expenses", "insights", "audit_log"].includes(f), approvals: 0, approves: true, companyAddresses: false });
    expect(pages(m, "money")).toEqual(["Receivables", "Payables", "Payments"]);
    expect(titles(m)).not.toContain("Reports");
    expect(pages(m, "admin")).not.toContain("Activity log");
  });

  it("a manager sees money, reports and the company's settings; of the admin's only what their permissions allow", () => {
    const MANAGER = new Set(["sourcing.manage", "expenses.manage", "payments.record", "reports.view", "settings.manage", "audit.view", "inquiries.create"]);
    const m = buildModules({ can: (p) => MANAGER.has(p), feature: () => true, approvals: 4, approves: true, companyAddresses: false });
    expect(titles(m)).toEqual(["Sales", "Purchasing", "Finance", "Reports", "Company settings", "Admin settings"]);
    expect(pages(m, "reports")).toEqual(["Overview", "Profit & loss", "Cash flow", "Expenses", "Customers", "Suppliers", "Sales team", "Sales funnel"]);
    // The company's web address and its website form are the admin's too: a manager does not see them.
    expect(pages(m, "company")).toEqual(["Company", "Sales & quotations", "Closed months", "Document templates", "Reminders", "Emails"]);
    const withAddresses = buildModules({ can: (p) => MANAGER.has(p), feature: () => true, approvals: 0, approves: true, companyAddresses: true });
    expect(pages(withAddresses, "company")).toEqual(["Company", "Sales & quotations", "Closed months", "Document templates", "Reminders", "Emails"]);
    // No people, roles, sign-ins, sessions or email sending: those are the admin's.
    expect(pages(m, "admin")).toEqual(["Audit log"]);
    // Someone who only manages people sees Admin settings alone.
    const people = buildModules({ can: (p) => p === "users.manage", feature: () => true, approvals: null, approves: false, companyAddresses: false });
    expect(titles(people)).toEqual(["Sales", "Finance", "Admin settings"]);
    expect(pages(people, "admin")).toEqual(["Staff"]);
    // A recorder without expenses: receivables and payables; Reports without Profit & loss, Cash flow and Expenses.
    const recorder = buildModules({ can: (p) => ["sourcing.manage", "payments.record", "reports.view"].includes(p), feature: () => true, approvals: 0, approves: true, companyAddresses: false });
    expect(pages(recorder, "money")).toEqual(["Receivables", "Payables", "Payments"]);
    expect(pages(recorder, "reports")).toEqual(["Overview", "Customers", "Suppliers", "Sales team", "Sales funnel"]);
    // The money reports are hidden: the line stays between Overview and the sales reports.
    expect(lines(recorder, "reports")).toEqual(["Customers"]);
  });

  it("keep the thin item between a group's two kinds of page, whatever is hidden", () => {
    // Money and Company settings are pages of one kind: no line. Admin settings has two: the people, and the record.
    expect(lines(everything(), "money")).toEqual([]);
    expect(lines(everything(), "company")).toEqual([]);
    // Admin settings has three kinds: the people and their access, how email goes out, the record.
    expect(lines(everything(), "admin")).toEqual(["Email sending", "Audit log"]);
    // Reports: the money reports, then the sales ones.
    expect(lines(everything(), "reports")).toEqual(["Customers"]);
    // Only the record is left: no line above the first page.
    const onlyLog = buildModules({ can: (p) => p === "audit.view", feature: () => true, approvals: null, approves: false, companyAddresses: false });
    expect(pages(onlyLog, "admin")).toEqual(["Audit log"]);
    expect(lines(onlyLog, "admin")).toEqual([]);
  });

  it("know which page and group an address is in (the longest address wins)", () => {
    const all = everything();
    const flat = all.flatMap((m) => m.pages);
    // The board is a view of Orders: the same item is marked.
    expect(pageOf("/orders/board", flat)?.label).toBe("Sales orders");
    expect(pageOf("/orders/0b6c", flat)?.label).toBe("Sales orders");
    expect(pageOf("/reports/people/targets", flat)?.label).toBe("Sales team");
    expect(crumbsFor("/reports")).toEqual([{ label: "Reports" }, { label: "Overview" }]);
    expect(crumbsFor("/reports/profit")).toEqual([{ label: "Reports" }, { label: "Profit & loss" }]);
    expect(pageOf("/access/roles/manager", flat)?.label).toBe("Roles");
    expect(moduleOf("/reports/cash", all)).toBe("reports");
    expect(moduleOf("/orders/board", all)).toBe("sales");
    expect(moduleOf("/money/due", all)).toBe("money");
    expect(moduleOf("/audit", all)).toBe("admin");
    expect(moduleOf("/settings/sales", all)).toBe("company");
    expect(crumbsFor("/suppliers")).toEqual([{ label: "Purchasing" }, { label: "Suppliers" }]);
    expect(pageOf("/operations/purchase-orders/0b6c/9a1b", flat)?.label).toBe("Purchase orders");
    expect(crumbsFor("/users")).toEqual([{ label: "Admin settings" }, { label: "Staff" }]);
    expect(moduleOf("/suppliers/9a1b", all)).toBe("purchasing");
    expect(moduleOf("/dashboard", all)).toBeUndefined();
    // The path above a page's title: the group, then the page. Two levels.
    expect(crumbsFor("/finance/cash-book")).toEqual([{ label: "Finance" }, { label: "Cash & bank" }]);
    expect(crumbsFor("/inquiries")).toEqual([{ label: "Sales" }, { label: "Inquiries" }]);
  });
});

describe("the menu down the left", () => {
  it("has Home first, then one button per group; the group of the current page is open and its page marked", () => {
    at.path = "/finance/cash-book";
    shell(everything());
    expect(menu().getByRole("link", { name: "Dashboard" }).getAttribute("href")).toBe("/dashboard");
    // Reports is a group like the others (22 Nov 2026).
    expect(menu().getAllByRole("button").map((b) => b.textContent?.replace(/\d+/g, ""))).toEqual(["Sales", "Purchasing", "Finance", "Reports", "Company settings", "Admin settings"]);
    // Two parts, each with its small heading.
    expect(menu().getByText("Workspace")).toBeTruthy();
    expect(menu().getByText("Settings")).toBeTruthy();
    expect(menu().getByRole("button", { name: "Finance" }).getAttribute("aria-expanded")).toBe("true");
    expect(menu().getByRole("button", { name: "Sales" }).getAttribute("aria-expanded")).toBe("false");
    expect(menu().getByRole("link", { current: "page" }).textContent).toBe("Cash & bank");
    // Its group's name is bold; the others are not.
    expect(menu().getByRole("button", { name: "Finance" }).className).toContain("font-bold");
    expect(menu().getByRole("button", { name: "Sales" }).className).not.toContain("font-bold");
  }, 20_000); // The first render of the whole shell: slow on a busy CI runner.

  it("marks the list on a record's page, and Home on the dashboard", () => {
    at.path = "/orders/9a1b";
    const { unmount } = shell(everything());
    expect(menu().getByRole("link", { current: "page" }).textContent).toBe("Sales orders");
    unmount();
    at.path = "/dashboard";
    shell(everything());
    expect(menu().getByRole("link", { name: "Dashboard" }).getAttribute("aria-current")).toBe("page");
    for (const b of menu().getAllByRole("button")) expect(b.getAttribute("aria-expanded")).toBe("false");
  });

  it("a click on a group opens or closes it, and it is remembered", () => {
    at.path = "/inquiries";
    shell(everything());
    const company = menu().getByRole("button", { name: "Company settings" });
    fireEvent.click(company);
    expect(company.getAttribute("aria-expanded")).toBe("true");
    expect(menu().getByRole("link", { name: "Sales & quotations" })).toBeTruthy();
    // Sales stays open: two groups can be open at once.
    expect(menu().getByRole("button", { name: "Sales" }).getAttribute("aria-expanded")).toBe("true");
    expect(document.cookie).toContain("nav-open=company");
    fireEvent.click(company);
    expect(company.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows what waits: on the page when its group is open, on the group when it is closed", () => {
    at.path = "/inquiries";
    const { unmount } = shell(everything(3));
    expect(menu().getByRole("button", { name: /^Finance/ }).textContent).toBe("Finance3");
    unmount();
    at.path = "/payments";
    shell(everything(3));
    expect(menu().getByRole("button", { name: "Finance" }).textContent).toBe("Finance");
    // Money added by the team and waiting to be verified opens from Payments: the count is there.
    expect(menu().getByRole("link", { name: /^Payments/ }).textContent).toBe("Payments3");
  });

  it("draws the thin line above the group's second kind of page", () => {
    at.path = "/users";
    shell(everything());
    const li = (name: string) => menu().getByRole("link", { name: new RegExp(`^${name}`) }).closest("li")!;
    expect(li("Audit log").className).toContain("before:bg-line");
    expect(li("Roles").className).not.toContain("before:bg-line");
    expect(li("Staff").className).not.toContain("before:bg-line");
    // The pages hang on one thin guide line; the page you are on marks it in green.
    expect(li("Staff").closest("ul")!.className).toContain("border-l");
    expect(menu().getByRole("link", { name: "Staff" }).className).toContain("before:bg-primary");
  });
});

describe("the fold button", () => {
  it("folds the menu to the strip and opens it again, and it is remembered", () => {
    shell(everything());
    const open = screen.getByRole("complementary", { name: "Menu" });
    const folded = screen.getByRole("complementary", { name: "Menu, folded" });
    // Not chosen yet: the open menu from 1440 px, the strip under it (a 1280 px laptop keeps the room for the page).
    expect(open.className).toContain("min-[1440px]:flex");
    expect(folded.className).toContain("md:max-[1439.98px]:flex");
    expect(open.closest("[data-menu]")!.getAttribute("data-menu")).toBe("auto");
    fireEvent.click(screen.getByRole("button", { name: "Fold the menu" }));
    expect(open.className.split(" ")).toContain("hidden");
    expect(open.className).not.toContain("xl:flex");
    expect(folded.className).not.toContain("xl:hidden");
    expect(document.cookie).toContain("nav-fold=1");
    // The lists read this to know how much room the page has.
    expect(open.closest("[data-menu]")!.getAttribute("data-menu")).toBe("folded");
    fireEvent.click(screen.getByRole("button", { name: "Open the menu", pressed: true }));
    expect(open.className).toContain("xl:flex");
    expect(document.cookie).toContain("nav-fold=0");
    expect(open.closest("[data-menu]")!.getAttribute("data-menu")).toBe("open");
  });

  it("starts folded when it was left folded", () => {
    shell(everything(), { fold: true });
    expect(screen.getByRole("complementary", { name: "Menu" }).className.split(" ")).toContain("hidden");
    expect(screen.getByRole("button", { name: "Open the menu", pressed: true })).toBeTruthy();
  });

  it("on a screen under 1280 px opens the whole menu over the page instead", () => {
    wide.on = false;
    shell(everything());
    expect(screen.getAllByRole("complementary", { name: "Menu" })).toHaveLength(1);
    fireEvent.click(screen.getAllByRole("button", { name: "Open the menu" })[0]!);
    expect(screen.getAllByRole("complementary", { name: "Menu" })).toHaveLength(2);
    expect(document.cookie).not.toContain("nav-fold");
  });

  it("on a 1280–1439 px laptop, opening the menu from the strip keeps it open beside the page", () => {
    document.cookie = "nav-fold=; max-age=0";
    shell(everything());
    // The button that pins it (pressed: shown folded); the other "Open the menu" opens it over the page under 1280 px.
    fireEvent.click(screen.getAllByRole("button", { name: "Open the menu", pressed: true })[0]!);
    const open = screen.getByRole("complementary", { name: "Menu" });
    expect(open.className).toContain("xl:flex");
    expect(open.className).not.toContain("min-[1440px]");
    expect(document.cookie).toContain("nav-fold=0");
  });
});

describe("the folded strip", () => {
  it("has Home and one icon per group, named for screen readers, the current group marked", () => {
    at.path = "/finance/cash-book";
    shell(everything(2));
    expect(strip().getByRole("link", { name: "Dashboard" }).getAttribute("href")).toBe("/dashboard");
    expect(strip().getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Sales", "Purchasing", "Finance, 2 to look at", "Reports", "Company settings", "Admin settings"]);
    expect(strip().getByRole("button", { name: /^Finance/ }).className).toContain("bg-primary-soft");
    expect(strip().getByRole("button", { name: "Sales" }).className).not.toContain("bg-primary-soft");
  });

  it("an icon shows its group's name and pages beside it on hover, and hides them after the mouse leaves", () => {
    vi.useFakeTimers();
    shell(everything());
    const li = strip().getByRole("button", { name: "Admin settings" }).closest("li")!;
    fireEvent.mouseEnter(li);
    const m = screen.getByRole("menu", { name: "Admin settings" });
    expect(within(m).getAllByRole("menuitem").map((a) => a.textContent)).toEqual(["Staff", "Roles", "Login history", "Active sessions", "Email sending", "Audit log"]);
    fireEvent.mouseLeave(li);
    act(() => vi.advanceTimersByTime(300));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("works with the keyboard: focus opens it, ↓ goes in, ↑ ↓ move, Esc closes it back on the icon", () => {
    at.path = "/money/company-costs";
    shell(everything());
    const money = strip().getByRole("button", { name: /^Finance/ });
    act(() => money.focus());
    expect(money.getAttribute("aria-expanded")).toBe("true");
    const m = screen.getByRole("menu", { name: "Finance" });
    expect(money.getAttribute("aria-controls")).toBe(m.id);
    const items = within(m).getAllByRole("menuitem");
    expect(items.map((a) => a.textContent?.replace(/\d+/g, ""))).toEqual(["Receivables", "Payables", "Payments", "Cash & bank", "Expenses"]);
    expect(items[4]!.getAttribute("aria-current")).toBe("page");
    fireEvent.keyDown(money, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1]!, { key: "ArrowUp" });
    fireEvent.keyDown(items[0]!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[4]);
    fireEvent.keyDown(items[4]!, { key: "Home" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(money);
    expect(money.getAttribute("aria-expanded")).toBe("false");
    fireEvent.keyDown(money, { key: "Enter" });
    expect(document.activeElement?.textContent).toBe("Receivables");
  });

  it("Tab in a group's pages closes them and moves on to the next icon", () => {
    shell(everything());
    const money = strip().getByRole("button", { name: /^Finance/ });
    act(() => money.focus());
    fireEvent.keyDown(money, { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(document.activeElement).toBe(strip().getByRole("button", { name: "Reports" }));
    // Finance's pages closed; Reports, now in focus, shows its own.
    expect(screen.queryByRole("menu", { name: "Finance" })).toBeNull();
  });
});

describe("the row at the top", () => {
  it("New lists what this person may make; without anything, there is no New", () => {
    const { unmount } = shell(everything(), {
      newItems: [
        { href: "/inquiries?panel=new-inquiry", label: "Inquiry" },
        { href: "/payments/new", label: "Payment received" },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    const m = within(screen.getByRole("menu"));
    expect(m.getAllByRole("menuitem").map((a) => `${a.textContent} ${a.getAttribute("href")}`)).toEqual(["Inquiry /inquiries?panel=new-inquiry", "Payment received /payments/new"]);
    unmount();
    shell(staff());
    expect(screen.queryByRole("button", { name: "New" })).toBeNull();
  });

  it("the account menu has the name, the role with the company's full name, My account, the look and Sign out", () => {
    shell(everything());
    fireEvent.click(screen.getByRole("button", { name: /account menu/ }));
    const m = screen.getByRole("menu");
    expect(m.textContent).toContain("Super Admin · Kebo International");
    expect(within(m).getByRole("menuitem", { name: "My account" }).getAttribute("href")).toBe("/account");
    expect(within(m).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Light", "Dark", "Auto"]);
    // Choosing a look does not close the menu.
    fireEvent.click(within(m).getByRole("radio", { name: "Dark" }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(within(screen.getByRole("menu")).getByRole("radio", { name: "Dark" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(screen.getByRole("menu")).getByRole("radio", { name: "Light" }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Sign out" })).toBeTruthy();
  });
});

describe("the menu over the page (phone)", () => {
  it("holds the same groups, with rows at least 44 px tall", () => {
    at.path = "/dashboard";
    shell(staff());
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const drawer = within(screen.getAllByRole("complementary", { name: "Menu" })[1]!);
    expect(drawer.getAllByRole("button", { expanded: false }).map((b) => b.textContent?.replace(/\d+/g, ""))).toEqual(["Sales", "Finance"]);
    for (const b of drawer.getAllByRole("button", { expanded: false })) expect(b.className).toContain("min-h-13");
    expect(drawer.getByRole("link", { name: "Dashboard" }).className).toContain("min-h-13");
    fireEvent.click(drawer.getByRole("button", { name: /^Sales/ }));
    expect(drawer.getByRole("link", { name: "Customers" }).className).toContain("min-h-11");
  });

  it("the bottom bar starts with Dashboard", () => {
    shell(everything());
    const bar = within(screen.getByRole("navigation", { name: "Quick" }));
    expect(bar.getAllByRole("link").map((a) => a.textContent || a.getAttribute("aria-label"))).toEqual(["Dashboard", "Inquiries", "New inquiry", "Alerts5"]);
  });
});
