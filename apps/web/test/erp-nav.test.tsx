import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { buildModules, crumbsFor, moduleOf, pageOf, MODULE_PAGES, type NavModule } from "@/lib/nav";

// The sidebar (ERP redesign: nine modules, standard names): modules with their pages, a collapsed rail with a menu per module.
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

const everything = (approvals: number | null = 2) =>
  buildModules({ can: () => true, feature: () => true, approvals, approves: true, companyAddresses: false });

/** A staff member: no money, no reports, no admin (the demo's Staff role). */
const STAFF = new Set(["inquiries.create", "money.submit"]);
const staff = () =>
  buildModules({ can: (p) => STAFF.has(p), feature: () => true, approvals: 1, approves: false, companyAddresses: false });

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
  it("are the brief's, top to bottom, for someone who may open everything (Currency & FX has no page yet)", () => {
    const m = everything();
    expect(titles(m)).toEqual([
      "Overview",
      "Public landing page",
      "Partners & CRM",
      "Operations & trading",
      "Revenue & profitability",
      "Treasury & payments",
      "Finance & general ledger",
      "System & admin",
    ]);
    expect(pages(m, "overview")).toEqual(["Follow-ups", "Pipelines", "Analytics & reports", "Audit log"]);
    expect(pages(m, "public")).toEqual(["Website form"]);
    expect(pages(m, "partners")).toEqual(["Customers", "Suppliers"]);
    expect(pages(m, "operations")).toEqual(["Inquiries (RFQs)", "Orders", "Purchase orders", "Fulfillment & logistics"]);
    expect(pages(m, "revenue")).toEqual(["Profit & loss", "Cost & expense allocation", "Variance analysis"]);
    expect(pages(m, "treasury")).toEqual(["Payments", "Verification queue", "Multi-currency vault"]);
    expect(pages(m, "finance")).toEqual(["Receivables (AR)", "Payables (AP)", "General ledger"]);
    expect(pages(m, "admin")).toEqual(["Company settings", "Sales & quotations", "Reminders", "Emails", "Order checklist", "Document templates", "Users", "Roles", "Sessions", "Sign-ins"]);
  });

  it("each page keeps its address, none of the pages not built yet is listed, and the reports share one item", () => {
    const hrefs = MODULE_PAGES.flatMap((m) => m.pages.map((p) => p.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    const labels = MODULE_PAGES.flatMap((m) => m.pages.map((p) => p.label));
    for (const later of ["Sourcing desk", "Quotations", "Work orders", "Documentation", "Currency registry", "Exchange rates", "Operating expenses"])
      expect(labels).not.toContain(later);
    expect(hrefs).toEqual(
      expect.arrayContaining([
        "/follow-ups",
        "/orders/board",
        "/reports",
        "/audit",
        "/finance/cash-book",
        "/finance/expenses",
        "/finance/to-receive",
        "/finance/ledger",
        "/finance/profit",
        "/finance/leaks",
        "/purchasing/to-pay",
        "/operations/purchase-orders",
        "/operations/shipments",
        "/approvals",
        "/settings/company",
        "/settings/papers",
        "/users",
        "/access/roles",
        "/access/sessions",
        "/access/sign-ins",
      ]),
    );
    // Tabs on the page now, and the bell: not sidebar items.
    for (const tab of ["/reports/customers", "/reports/factories", "/reports/people", "/reports/funnel", "/reports/print", "/notifications"]) expect(hrefs).not.toContain(tab);
  });

  it("Company address shows only when companies have their own addresses", () => {
    expect(pages(everything(), "admin")).not.toContain("Company address");
    const m = buildModules({ can: () => true, feature: () => true, approvals: 0, approves: true, companyAddresses: true });
    expect(pages(m, "admin")?.slice(5, 7)).toEqual(["Document templates", "Company address"]);
  });

  it("hide the pages a person may not open, and a module with none left", () => {
    const m = staff();
    expect(titles(m)).toEqual(["Overview", "Partners & CRM", "Operations & trading", "Treasury & payments"]);
    expect(pages(m, "overview")).toEqual(["Follow-ups", "Pipelines"]);
    expect(pages(m, "partners")).toEqual(["Customers"]);
    // Staff who send money for approval see their payments and the queue.
    expect(pages(m, "treasury")).toEqual(["Payments", "Verification queue"]);
    // No verification queue for someone who neither verifies nor sends money for it.
    const none = buildModules({ can: () => false, feature: () => true, approvals: null, approves: false, companyAddresses: false });
    expect(titles(none)).toEqual(["Overview", "Partners & CRM", "Operations & trading"]);
  });

  it("follow the plan: no vault, costs, reports or audit log when the plan leaves them out", () => {
    const m = buildModules({ can: () => true, feature: (f) => !["cash_book", "expenses", "insights", "audit_log"].includes(f), approvals: 0, approves: true, companyAddresses: false });
    expect(pages(m, "treasury")).toEqual(["Payments", "Verification queue"]);
    expect(pages(m, "finance")).toEqual(["Receivables (AR)", "Payables (AP)", "General ledger"]);
    expect(titles(m)).not.toContain("Revenue & profitability");
    expect(pages(m, "overview")).toEqual(["Follow-ups", "Pipelines"]);
  });

  it("a manager sees money and reports, and of System & admin only what their permissions allow", () => {
    const MANAGER = new Set(["sourcing.manage", "expenses.manage", "payments.record", "reports.view", "users.manage", "inquiries.create"]);
    const m = buildModules({ can: (p) => MANAGER.has(p), feature: () => true, approvals: 4, approves: true, companyAddresses: false });
    expect(titles(m)).toEqual(["Overview", "Partners & CRM", "Operations & trading", "Revenue & profitability", "Treasury & payments", "Finance & general ledger", "System & admin"]);
    expect(pages(m, "overview")).toEqual(["Follow-ups", "Pipelines", "Analytics & reports"]);
    expect(pages(m, "admin")).toEqual(["Users"]);
    // A recorder without expenses: receivables and payables, no money reports (they need expenses.manage).
    const recorder = buildModules({ can: (p) => ["sourcing.manage", "payments.record", "reports.view"].includes(p), feature: () => true, approvals: 0, approves: true, companyAddresses: false });
    expect(pages(recorder, "finance")).toEqual(["Receivables (AR)", "Payables (AP)"]);
    expect(pages(recorder, "revenue")).toBeUndefined();
  });

  it("know which page and module an address is in (the longest address wins)", () => {
    const all = everything();
    const flat = all.flatMap((m) => m.pages);
    expect(pageOf("/orders/board", flat)?.label).toBe("Pipelines");
    expect(pageOf("/orders/0b6c", flat)?.label).toBe("Orders");
    expect(pageOf("/reports/people/targets", flat)?.label).toBe("Analytics & reports");
    expect(pageOf("/reports", flat)?.label).toBe("Analytics & reports");
    expect(pageOf("/access/roles/manager", flat)?.label).toBe("Roles");
    expect(moduleOf("/finance/leaks", all)).toBe("revenue");
    expect(moduleOf("/orders/board", all)).toBe("overview");
    expect(moduleOf("/purchasing/to-pay", all)).toBe("finance");
    expect(moduleOf("/dashboard", all)).toBeUndefined();
    expect(crumbsFor("/finance/cash-book")).toEqual([{ label: "Treasury & payments" }, { label: "Multi-currency vault" }]);
  });
});

describe("the sidebar", () => {
  it("has Dashboard first on its own, then a button per module that opens and closes it", () => {
    shell(everything());
    const nav = sidebar();
    const main = within(nav.getByRole("navigation", { name: "Main" }));
    const items = main.getAllByRole("listitem").filter((li) => li.parentElement?.parentElement?.tagName === "NAV");
    expect(items[0]!.textContent).toBe("Dashboard");
    expect(main.getByRole("link", { name: "Dashboard" }).getAttribute("href")).toBe("/dashboard");
    const treasury = main.getByRole("button", { name: /^Treasury/ });
    expect(treasury.getAttribute("aria-expanded")).toBe("true");
    const sales = main.getByRole("button", { name: /^Partners/ });
    expect(sales.getAttribute("aria-expanded")).toBe("false");
    const list = document.getElementById(sales.getAttribute("aria-controls")!)!;
    expect(list.hidden).toBe(true);
    fireEvent.click(sales);
    expect(sales.getAttribute("aria-expanded")).toBe("true");
    expect(list.hidden).toBe(false);
    expect(within(list).getByRole("link", { name: "Customers" }).getAttribute("href")).toBe("/customers");
    // Remembered for the next page load.
    expect(document.cookie).toMatch(/nav-open=[^;]*partners/);
    fireEvent.click(sales);
    expect(sales.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens the current page's module by itself and marks the page: highlight, bar and aria-current", () => {
    at.path = "/finance/cash-book";
    shell(everything());
    const current = sidebar().getByRole("link", { current: "page" });
    expect(current.textContent).toBe("Multi-currency vault");
    expect(current.className).toContain("bg-primary-soft");
    expect(current.querySelector("span[aria-hidden]")?.className).toContain("w-[3px]");
    expect(sidebar().getAllByRole("link", { current: "page" })).toHaveLength(1);
  });

  it("remembers only the modules the person opened; closing the current one keeps it closed on this page", () => {
    at.path = "/finance/cash-book";
    const { rerender } = shell(everything());
    const finance = () => sidebar().getByRole("button", { name: /^Treasury/ });
    expect(finance().getAttribute("aria-expanded")).toBe("true");
    // Opened by itself: not written to the cookie.
    expect(document.cookie).not.toMatch(/nav-open=[^;]*treasury/);
    fireEvent.click(finance());
    expect(finance().getAttribute("aria-expanded")).toBe("false");
    // Another module's page: Treasury stays closed (it was only open because it was the current one).
    at.path = "/settings/company";
    rerender(
      <AppShell modules={everything()} companyName="Kebo International" user={{ name: "Fawad Iqbal", email: "fawad@example.com", role: "Super Admin" }}>
        <p>page</p>
      </AppShell>,
    );
    expect(finance().getAttribute("aria-expanded")).toBe("false");
    expect(sidebar().getByRole("button", { name: /^System/ }).getAttribute("aria-expanded")).toBe("true");
  });

  it("marks Pipelines, not the list, on /orders/board; a record marks its list", () => {
    at.path = "/orders/board";
    const { unmount } = shell(everything());
    expect(sidebar().getByRole("link", { current: "page" }).textContent).toBe("Pipelines");
    unmount();
    at.path = "/orders/9a1b";
    shell(everything());
    expect(sidebar().getByRole("link", { current: "page" }).textContent).toBe("Orders");
  });

  it("keeps the modules left open (cookie), with the current one", () => {
    at.path = "/settings/company";
    shell(everything(), { open: ["partners"] });
    expect(sidebar().getByRole("button", { name: /^Partners/ }).getAttribute("aria-expanded")).toBe("true");
    expect(sidebar().getByRole("button", { name: /^System/ }).getAttribute("aria-expanded")).toBe("true");
    expect(sidebar().getByRole("button", { name: /^Finance/ }).getAttribute("aria-expanded")).toBe("false");
  });

  it("shows counts on the pages, and a closed module shows its children's total", () => {
    at.path = "/customers";
    shell(everything(2));
    const work = sidebar().getByRole("button", { name: /^Treasury/ });
    expect(work.getAttribute("aria-expanded")).toBe("false");
    expect(within(work).getByLabelText("2 to look at").textContent).toBe("2");
    fireEvent.click(work);
    // Open: the total goes, the page shows its own.
    expect(within(work).queryByLabelText("2 to look at")).toBeNull();
    expect(sidebar().getByLabelText("2 waiting").textContent).toBe("2");
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
    expect(sidebar().getByRole("button", { name: "Finance & general ledger" }).getAttribute("aria-haspopup")).toBe("menu");
    fireEvent.click(sidebar().getByRole("button", { name: "Expand the sidebar" }));
    expect(screen.getByRole("complementary", { name: "Sidebar" }).className).toContain("w-60");
    expect(document.cookie).toContain("nav-rail=0");
  });

  it("starts collapsed when it was left so (no jump: the server knows from the cookie)", () => {
    shell(everything(), { rail: true });
    expect(screen.getByRole("complementary", { name: "Sidebar" }).className).toContain("w-16");
    expect(document.querySelector("[data-sidebar]")?.getAttribute("data-sidebar")).toBe("rail");
    // The current module's icon is marked; a module with counts says so.
    expect(sidebar().getByRole("button", { name: "Treasury & payments, 2 to look at" }).className).toContain("bg-primary-soft");
  });
});

describe("the rail's menus", () => {
  it("open on hover and close after the mouse leaves", () => {
    vi.useFakeTimers();
    shell(everything(), { rail: true });
    const wrap = sidebar().getByRole("button", { name: "Partners & CRM" }).parentElement!;
    fireEvent.mouseEnter(wrap);
    const menu = screen.getByRole("menu", { name: "Partners & CRM" });
    expect(within(menu).getAllByRole("menuitem").map((a) => a.textContent)).toEqual(["Customers", "Suppliers"]);
    fireEvent.mouseLeave(wrap);
    act(() => vi.advanceTimersByTime(300));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("work with the keyboard: focus opens it, ↓ goes in, ↑ ↓ move, Esc closes it back on the icon", () => {
    at.path = "/finance/ledger";
    shell(everything(), { rail: true });
    const finance = sidebar().getByRole("button", { name: "Finance & general ledger" });
    act(() => finance.focus());
    expect(finance.getAttribute("aria-expanded")).toBe("true");
    const menu = screen.getByRole("menu", { name: "Finance & general ledger" });
    expect(finance.getAttribute("aria-controls")).toBe(menu.id);
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((a) => a.textContent)).toEqual(["Receivables (AR)", "Payables (AP)", "General ledger"]);
    expect(items[2]!.getAttribute("aria-current")).toBe("page");
    fireEvent.keyDown(finance, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1]!, { key: "ArrowUp" });
    fireEvent.keyDown(items[0]!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(items[2]!, { key: "Home" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(finance);
    // Focus put back by Esc does not open it again.
    expect(finance.getAttribute("aria-expanded")).toBe("false");
    // Enter opens it on the first page.
    fireEvent.keyDown(finance, { key: "Enter" });
    expect(document.activeElement?.textContent).toBe("Receivables (AR)");
  });

  it("Tab in a menu closes it and moves on to the next module", () => {
    shell(everything(), { rail: true });
    const finance = sidebar().getByRole("button", { name: "Finance & general ledger" });
    act(() => finance.focus());
    fireEvent.keyDown(finance, { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(document.activeElement).toBe(sidebar().getByRole("button", { name: "System & admin" }));
    expect(screen.getByRole("menu", { name: "System & admin" })).toBeTruthy();
    expect(screen.getAllByRole("menu")).toHaveLength(1);
  });

  it("Esc closes a menu opened by hovering, wherever focus is", () => {
    shell(everything(), { rail: true });
    fireEvent.mouseEnter(sidebar().getByRole("button", { name: "Operations & trading" }).parentElement!);
    expect(screen.getByRole("menu", { name: "Operations & trading" })).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("the phone drawer", () => {
  it("holds the same modules, with rows at least 44 px tall", () => {
    shell(staff());
    fireEvent.click(screen.getAllByRole("button", { name: /Open menu|Menu/ })[0]!);
    const drawer = within(screen.getByRole("complementary", { name: "Menu" }));
    expect(drawer.getAllByRole("button", { expanded: false }).map((b) => b.textContent?.replace(/\d+/g, ""))).toEqual(["Overview", "Partners & CRM", "Operations & trading", "Treasury & payments"]);
    for (const b of drawer.getAllByRole("button", { expanded: false })) expect(b.className).toContain("min-h-11");
    expect(drawer.getByRole("link", { name: "Dashboard" }).className).toContain("min-h-11");
    fireEvent.click(drawer.getByRole("button", { name: /^Partners/ }));
    expect(drawer.getByRole("link", { name: "Customers" }).className).toContain("min-h-11");
  });
});
