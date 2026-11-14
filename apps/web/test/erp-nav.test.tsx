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
    expect(titles(m)).toEqual(["Sales", "Purchasing", "Money", "Reports", "Company settings", "Admin settings"]);
    // Clean-up (14 Nov 2026): a shipment is on its order, not a page of its own.
    expect(pages(m, "sales")).toEqual(["Inquiries", "Orders", "Order board", "Customers", "Follow-ups"]);
    // Purchase orders keep their list (each one has a page of its own that shows it).
    expect(pages(m, "purchasing")).toEqual(["Purchase orders", "Suppliers"]);
    // Money, simple (14 Nov 2026): four pages. To verify and the Ledger keep their addresses and left the menu.
    expect(pages(m, "money")).toEqual(["To receive and to pay", "Payments", "Cash & bank", "Company costs"]);
    // Reports is one page (its reports are tabs on it): the menu shows it as a link, like Home.
    expect(pages(m, "reports")).toEqual(["Reports"]);
    expect(m.filter(isSingle).map((x) => x.key)).toEqual(["reports"]);
    // Settings is two groups: the company's own (managers too), and the admin's.
    expect(pages(m, "company")).toEqual(["Company", "Sales & quotations", "Document templates", "Reminders", "Emails", "Website form"]);
    expect(pages(m, "admin")).toEqual(["People", "Roles", "Sign-ins", "Sessions", "Email sending", "Activity log"]);
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
        "/orders/board",
        "/customers",
        "/follow-ups",
        "/operations/purchase-orders",
        "/factories",
        "/money/due",
        "/payments",
        "/finance/cash-book",
        "/money/company-costs",
        "/reports",
        "/audit",
        "/settings/company",
        "/settings/address",
        "/settings/sales",
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
    for (const tab of ["/reports/profit", "/reports/customers", "/reports/factories", "/reports/cash", "/reports/people", "/reports/funnel", "/reports/print", "/finance/profit", "/finance/leaks", "/notifications", "/approvals", "/finance/ledger", "/finance/invoices", "/finance/to-receive", "/purchasing/to-pay", "/operations/shipments"])
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
    expect(titles(m)).toEqual(["Sales", "Money"]);
    expect(pages(m, "sales")).toEqual(["Inquiries", "Orders", "Order board", "Customers", "Follow-ups"]);
    expect(pages(m, "money")).toEqual(["To receive and to pay", "Payments"]);
    const none = buildModules({ can: () => false, feature: () => true, approvals: null, approves: false, companyAddresses: false });
    expect(titles(none)).toEqual(["Sales", "Money"]);
    expect(pages(none, "money")).toEqual(["To receive and to pay", "Payments"]);
  });

  it("follow the plan: no cash and bank, expenses, reports or activity log when the plan leaves them out", () => {
    const m = buildModules({ can: () => true, feature: (f) => !["cash_book", "expenses", "insights", "audit_log"].includes(f), approvals: 0, approves: true, companyAddresses: false });
    expect(pages(m, "money")).toEqual(["To receive and to pay", "Payments"]);
    expect(titles(m)).not.toContain("Reports");
    expect(pages(m, "admin")).not.toContain("Activity log");
  });

  it("a manager sees money, reports and the company's settings; of the admin's only what their permissions allow", () => {
    const MANAGER = new Set(["sourcing.manage", "expenses.manage", "payments.record", "reports.view", "settings.manage", "audit.view", "inquiries.create"]);
    const m = buildModules({ can: (p) => MANAGER.has(p), feature: () => true, approvals: 4, approves: true, companyAddresses: false });
    expect(titles(m)).toEqual(["Sales", "Purchasing", "Money", "Reports", "Company settings", "Admin settings"]);
    expect(pages(m, "reports")).toEqual(["Reports"]);
    expect(pages(m, "company")).toEqual(["Company", "Sales & quotations", "Document templates", "Reminders", "Emails", "Website form"]);
    // No people, roles, sign-ins, sessions or email sending: those are the admin's.
    expect(pages(m, "admin")).toEqual(["Activity log"]);
    // Someone who only manages people sees Admin settings alone.
    const people = buildModules({ can: (p) => p === "users.manage", feature: () => true, approvals: null, approves: false, companyAddresses: false });
    expect(titles(people)).toEqual(["Sales", "Money", "Admin settings"]);
    expect(pages(people, "admin")).toEqual(["People"]);
    // A recorder without expenses: what is to receive and to pay; Reports opens without its Profit and Cash tabs.
    const recorder = buildModules({ can: (p) => ["sourcing.manage", "payments.record", "reports.view"].includes(p), feature: () => true, approvals: 0, approves: true, companyAddresses: false });
    expect(pages(recorder, "money")).toEqual(["To receive and to pay", "Payments"]);
    expect(pages(recorder, "reports")).toEqual(["Reports"]);
  });

  it("keep the thin line between a group's two kinds of page, whatever is hidden", () => {
    // Money and Company settings are pages of one kind: no line. Admin settings has two: the people, and the record.
    expect(lines(everything(), "money")).toEqual([]);
    expect(lines(everything(), "company")).toEqual([]);
    // Admin settings has three kinds: the people and their access, how email goes out, the record.
    expect(lines(everything(), "admin")).toEqual(["Email sending", "Activity log"]);
    // Only the record is left: no line above the first page.
    const onlyLog = buildModules({ can: (p) => p === "audit.view", feature: () => true, approvals: null, approves: false, companyAddresses: false });
    expect(pages(onlyLog, "admin")).toEqual(["Activity log"]);
    expect(lines(onlyLog, "admin")).toEqual([]);
  });

  it("know which page and group an address is in (the longest address wins)", () => {
    const all = everything();
    const flat = all.flatMap((m) => m.pages);
    expect(pageOf("/orders/board", flat)?.label).toBe("Order board");
    expect(pageOf("/orders/0b6c", flat)?.label).toBe("Orders");
    expect(pageOf("/reports/people/targets", flat)?.label).toBe("Reports");
    // One name, said once above the title.
    expect(crumbsFor("/reports")).toEqual([{ label: "Reports" }]);
    expect(pageOf("/access/roles/manager", flat)?.label).toBe("Roles");
    expect(moduleOf("/reports/cash", all)).toBe("reports");
    expect(moduleOf("/orders/board", all)).toBe("sales");
    expect(moduleOf("/money/due", all)).toBe("money");
    expect(moduleOf("/audit", all)).toBe("admin");
    expect(moduleOf("/settings/sales", all)).toBe("company");
    expect(crumbsFor("/factories")).toEqual([{ label: "Purchasing" }, { label: "Suppliers" }]);
    expect(pageOf("/operations/purchase-orders/0b6c/9a1b", flat)?.label).toBe("Purchase orders");
    expect(crumbsFor("/users")).toEqual([{ label: "Admin settings" }, { label: "People" }]);
    expect(moduleOf("/factories/9a1b", all)).toBe("purchasing");
    expect(moduleOf("/dashboard", all)).toBeUndefined();
    // The path above a page's title: the group, then the page. Two levels.
    expect(crumbsFor("/finance/cash-book")).toEqual([{ label: "Money" }, { label: "Cash & bank" }]);
    expect(crumbsFor("/inquiries")).toEqual([{ label: "Sales" }, { label: "Inquiries" }]);
  });
});

describe("the menu down the left", () => {
  it("has Home first, then one button per group; the group of the current page is open and its page marked", () => {
    at.path = "/finance/cash-book";
    shell(everything());
    expect(menu().getByRole("link", { name: "Home" }).getAttribute("href")).toBe("/dashboard");
    // Reports is one page: a link, not a group to open.
    expect(menu().getAllByRole("button").map((b) => b.textContent?.replace(/\d+/g, ""))).toEqual(["Sales", "Purchasing", "Money", "Company settings", "Admin settings"]);
    expect(menu().getByRole("link", { name: "Reports" }).getAttribute("href")).toBe("/reports");
    expect(menu().getByRole("button", { name: "Money" }).getAttribute("aria-expanded")).toBe("true");
    expect(menu().getByRole("button", { name: "Sales" }).getAttribute("aria-expanded")).toBe("false");
    expect(menu().getByRole("link", { current: "page" }).textContent).toBe("Cash & bank");
    // Its group's name is bold; the others are not.
    expect(menu().getByRole("button", { name: "Money" }).className).toContain("font-bold");
    expect(menu().getByRole("button", { name: "Sales" }).className).not.toContain("font-bold");
  });

  it("marks the list on a record's page, and Home on the dashboard", () => {
    at.path = "/orders/9a1b";
    const { unmount } = shell(everything());
    expect(menu().getByRole("link", { current: "page" }).textContent).toBe("Orders");
    unmount();
    at.path = "/dashboard";
    shell(everything());
    expect(menu().getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBe("page");
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
    expect(menu().getByRole("button", { name: /^Money/ }).textContent).toBe("Money3");
    unmount();
    at.path = "/payments";
    shell(everything(3));
    expect(menu().getByRole("button", { name: "Money" }).textContent).toBe("Money");
    // Money added by the team and waiting to be verified opens from Payments: the count is there.
    expect(menu().getByRole("link", { name: /^Payments/ }).textContent).toBe("Payments3");
  });

  it("draws the thin line above the group's second kind of page", () => {
    at.path = "/users";
    shell(everything());
    const li = (name: string) => menu().getByRole("link", { name: new RegExp(`^${name}`) }).closest("li")!;
    expect(li("Activity log").className).toContain("before:bg-line");
    expect(li("Roles").className).not.toContain("before:bg-line");
    expect(li("People").className).not.toContain("before:bg-line");
  });
});

describe("the fold button", () => {
  it("folds the menu to the strip and opens it again, and it is remembered", () => {
    shell(everything());
    const open = screen.getByRole("complementary", { name: "Menu" });
    const folded = screen.getByRole("complementary", { name: "Menu, folded" });
    // Not chosen yet: the open menu from 1280 px, the strip under it.
    expect(open.className).toContain("xl:flex");
    expect(folded.className).toContain("xl:hidden");
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
    fireEvent.click(screen.getByRole("button", { name: "Open the menu", pressed: undefined }));
    expect(screen.getAllByRole("complementary", { name: "Menu" })).toHaveLength(2);
    expect(document.cookie).not.toContain("nav-fold");
  });
});

describe("the folded strip", () => {
  it("has Home and one icon per group, named for screen readers, the current group marked", () => {
    at.path = "/finance/cash-book";
    shell(everything(2));
    expect(strip().getByRole("link", { name: "Home" }).getAttribute("href")).toBe("/dashboard");
    expect(strip().getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Sales", "Purchasing", "Money, 2 to look at", "Company settings", "Admin settings"]);
    expect(strip().getByRole("link", { name: "Reports" }).getAttribute("href")).toBe("/reports");
    expect(strip().getByRole("button", { name: /^Money/ }).className).toContain("bg-primary-soft");
    expect(strip().getByRole("button", { name: "Sales" }).className).not.toContain("bg-primary-soft");
  });

  it("an icon shows its group's name and pages beside it on hover, and hides them after the mouse leaves", () => {
    vi.useFakeTimers();
    shell(everything());
    const li = strip().getByRole("button", { name: "Admin settings" }).closest("li")!;
    fireEvent.mouseEnter(li);
    const m = screen.getByRole("menu", { name: "Admin settings" });
    expect(within(m).getAllByRole("menuitem").map((a) => a.textContent)).toEqual(["People", "Roles", "Sign-ins", "Sessions", "Email sending", "Activity log"]);
    fireEvent.mouseLeave(li);
    act(() => vi.advanceTimersByTime(300));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("works with the keyboard: focus opens it, ↓ goes in, ↑ ↓ move, Esc closes it back on the icon", () => {
    at.path = "/money/company-costs";
    shell(everything());
    const money = strip().getByRole("button", { name: /^Money/ });
    act(() => money.focus());
    expect(money.getAttribute("aria-expanded")).toBe("true");
    const m = screen.getByRole("menu", { name: "Money" });
    expect(money.getAttribute("aria-controls")).toBe(m.id);
    const items = within(m).getAllByRole("menuitem");
    expect(items.map((a) => a.textContent?.replace(/\d+/g, ""))).toEqual(["To receive and to pay", "Payments", "Cash & bank", "Company costs"]);
    expect(items[3]!.getAttribute("aria-current")).toBe("page");
    fireEvent.keyDown(money, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1]!, { key: "ArrowUp" });
    fireEvent.keyDown(items[0]!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[3]);
    fireEvent.keyDown(items[3]!, { key: "Home" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(money);
    expect(money.getAttribute("aria-expanded")).toBe("false");
    fireEvent.keyDown(money, { key: "Enter" });
    expect(document.activeElement?.textContent).toBe("To receive and to pay");
  });

  it("Tab in a group's pages closes them and moves on to the next icon", () => {
    shell(everything());
    const money = strip().getByRole("button", { name: /^Money/ });
    act(() => money.focus());
    fireEvent.keyDown(money, { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    // Reports is a link (one page): nothing opens beside it.
    expect(document.activeElement).toBe(strip().getByRole("link", { name: "Reports" }));
    expect(screen.queryByRole("menu")).toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
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
    expect(drawer.getAllByRole("button", { expanded: false }).map((b) => b.textContent?.replace(/\d+/g, ""))).toEqual(["Sales", "Money"]);
    for (const b of drawer.getAllByRole("button", { expanded: false })) expect(b.className).toContain("min-h-11");
    expect(drawer.getByRole("link", { name: "Home" }).className).toContain("min-h-11");
    fireEvent.click(drawer.getByRole("button", { name: /^Sales/ }));
    expect(drawer.getByRole("link", { name: "Customers" }).className).toContain("min-h-11");
  });

  it("the bottom bar starts with Home", () => {
    shell(everything());
    const bar = within(screen.getByRole("navigation", { name: "Quick" }));
    expect(bar.getAllByRole("link").map((a) => a.textContent || a.getAttribute("aria-label"))).toEqual(["Home", "Inquiries", "New inquiry", "Alerts5"]);
  });
});
