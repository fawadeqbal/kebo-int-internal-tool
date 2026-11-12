import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { buildModules, crumbsFor, moduleOf, pageOf, MODULE_PAGES, type NavModule } from "@/lib/nav";

// The menu (ERP redesign: nine modules, standard names; Kebo ERP look): a top menu with a menu per module, the module's pages as chips, the phone drawer.
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

function shell(modules: NavModule[], opts: { open?: NavModule["key"][] } = {}) {
  return render(
    <AppShell
      modules={modules}
      companyName="Kebo International"
      user={{ name: "Fawad Iqbal", email: "fawad@example.com", role: "Super Admin" }}
      unread={5}
      canCreate
      initialOpen={opts.open}
    >
      <p>page</p>
    </AppShell>,
  );
}

beforeEach(() => {
  at.path = "/finance/cash-book";
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
    expect(pages(m, "operations")).toEqual(["Inquiries (RFQs)", "Orders", "Payment requests", "Purchase orders", "Fulfillment & logistics"]);
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

describe("the top menu", () => {
  const menu = () => within(screen.getByRole("navigation", { name: "Main" }));

  it("has Dashboard first, then one item per module: its icon over a short name, its full name for screen readers", () => {
    shell(everything());
    const items = menu().getAllByRole("listitem").filter((li) => li.parentElement?.parentElement?.tagName === "NAV");
    expect(items[0]!.textContent).toBe("Dashboard");
    expect(menu().getByRole("link", { name: "Dashboard" }).getAttribute("href")).toBe("/dashboard");
    const buttons = menu().getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Overview", "Website", "Partners", "Operations", "Revenue", "Treasury", "Finance", "Admin"]);
    expect(menu().getByRole("button", { name: /^Treasury & payments/ }).getAttribute("aria-haspopup")).toBe("menu");
  });

  it("marks the current module: soft green with a green line under it", () => {
    at.path = "/finance/cash-book";
    shell(everything());
    const treasury = menu().getByRole("button", { name: "Treasury & payments, 2 to look at" });
    expect(treasury.className).toContain("bg-primary-soft");
    expect(treasury.className).toContain("border-primary-solid");
    expect(menu().getByRole("button", { name: "Partners & CRM" }).className).not.toContain("bg-primary-soft");
  });

  it("marks the page in its module's menu: Pipelines on /orders/board, the list on a record", () => {
    at.path = "/orders/board";
    const { unmount } = shell(everything());
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Overview" }).closest("li")!);
    expect(within(screen.getByRole("menu", { name: "Overview" })).getByRole("menuitem", { current: "page" }).textContent).toBe("Pipelines");
    unmount();
    at.path = "/orders/9a1b";
    shell(everything());
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Operations & trading" }).closest("li")!);
    expect(within(screen.getByRole("menu", { name: "Operations & trading" })).getByRole("menuitem", { current: "page" }).textContent).toBe("Orders");
  });

  it("marks Dashboard on the dashboard", () => {
    at.path = "/dashboard";
    shell(everything());
    expect(menu().getByRole("link", { name: "Dashboard" }).getAttribute("aria-current")).toBe("page");
  });
});

describe("the module menus", () => {
  it("open on hover and close after the mouse leaves", () => {
    vi.useFakeTimers();
    shell(everything());
    const li = screen.getByRole("button", { name: "Partners & CRM" }).closest("li")!;
    fireEvent.mouseEnter(li);
    const m = screen.getByRole("menu", { name: "Partners & CRM" });
    expect(within(m).getAllByRole("menuitem").map((a) => a.textContent)).toEqual(["Customers", "Suppliers"]);
    fireEvent.mouseLeave(li);
    act(() => vi.advanceTimersByTime(300));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("work with the keyboard: focus opens it, ↓ goes in, ↑ ↓ move, Esc closes it back on the module", () => {
    at.path = "/finance/ledger";
    shell(everything());
    const finance = screen.getByRole("button", { name: "Finance & general ledger" });
    act(() => finance.focus());
    expect(finance.getAttribute("aria-expanded")).toBe("true");
    const m = screen.getByRole("menu", { name: "Finance & general ledger" });
    expect(finance.getAttribute("aria-controls")).toBe(m.id);
    const items = within(m).getAllByRole("menuitem");
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
    expect(finance.getAttribute("aria-expanded")).toBe("false");
    fireEvent.keyDown(finance, { key: "Enter" });
    expect(document.activeElement?.textContent).toBe("Receivables (AR)");
  });

  it("Tab in a menu closes it and moves on to the next module", () => {
    shell(everything());
    const finance = screen.getByRole("button", { name: "Finance & general ledger" });
    act(() => finance.focus());
    fireEvent.keyDown(finance, { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "System & admin" }));
    expect(screen.getByRole("menu", { name: "System & admin" })).toBeTruthy();
    expect(screen.getAllByRole("menu")).toHaveLength(1);
  });

  it("Esc closes a menu opened by hovering, wherever focus is", () => {
    shell(everything());
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Operations & trading" }).closest("li")!);
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
