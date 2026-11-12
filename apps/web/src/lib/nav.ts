/**
 * The menu's modules and their pages (ERP redesign, 11 Nov 2026: nine modules, standard names).
 * One address per page, the module's name in the breadcrumb above the title, the item's name as the
 * title. The layout keeps only the pages a person may open (each page's own permission and plan
 * checks); a module whose pages are all hidden is hidden. Addresses did not move: only the grouping
 * and the names changed. The reports share one item (Analytics & reports) and switch with tabs on
 * the page; notifications open from the bell. Currency & FX has no page yet, so it is not listed.
 */

export type ModuleKey = "overview" | "public" | "partners" | "operations" | "revenue" | "treasury" | "finance" | "admin";

export type NavIcon = "home" | ModuleKey;

export interface NavPage {
  href: string;
  label: string;
  /** What needs looking at (payments waiting to be verified); 0 or none: no count. */
  badge?: number;
  /** What the count is, for screen readers ("3 waiting"); default "unread". */
  badgeLabel?: string;
}

export interface NavModule {
  key: ModuleKey;
  title: string;
  /** The module's one-word name in the top menu (its full title is its accessible name). */
  short: string;
  icon: NavIcon;
  pages: NavPage[];
}

/** Every page of every module, in sidebar order (before anyone's permissions). */
export const MODULE_PAGES: { key: ModuleKey; title: string; short: string; icon: NavIcon; pages: { href: string; label: string }[] }[] = [
  {
    key: "overview",
    title: "Overview",
    short: "Overview",
    icon: "overview",
    pages: [
      { href: "/follow-ups", label: "Follow-ups" },
      { href: "/orders/board", label: "Pipelines" },
      { href: "/reports", label: "Analytics & reports" },
      { href: "/audit", label: "Audit log" },
    ],
  },
  {
    key: "public",
    title: "Public landing page",
    short: "Website",
    icon: "public",
    pages: [{ href: "/settings/website-form", label: "Website form" }],
  },
  {
    key: "partners",
    title: "Partners & CRM",
    short: "Partners",
    icon: "partners",
    pages: [
      { href: "/customers", label: "Customers" },
      { href: "/factories", label: "Suppliers" },
    ],
  },
  {
    key: "operations",
    title: "Operations & trading",
    short: "Operations",
    icon: "operations",
    pages: [
      { href: "/inquiries", label: "Inquiries (RFQs)" },
      { href: "/orders", label: "Orders" },
      { href: "/operations/purchase-orders", label: "Purchase orders" },
      { href: "/operations/shipments", label: "Fulfillment & logistics" },
    ],
  },
  {
    key: "revenue",
    title: "Revenue & profitability",
    short: "Revenue",
    icon: "revenue",
    pages: [
      { href: "/finance/profit", label: "Profit & loss" },
      { href: "/finance/expenses", label: "Cost & expense allocation" },
      { href: "/finance/leaks", label: "Variance analysis" },
    ],
  },
  {
    key: "treasury",
    title: "Treasury & payments",
    short: "Treasury",
    icon: "treasury",
    pages: [
      { href: "/payments", label: "Payments" },
      { href: "/approvals", label: "Verification queue" },
      { href: "/finance/cash-book", label: "Multi-currency vault" },
    ],
  },
  {
    key: "finance",
    title: "Finance & general ledger",
    short: "Finance",
    icon: "finance",
    pages: [
      { href: "/finance/invoices", label: "Invoices" },
      { href: "/finance/to-receive", label: "Receivables (AR)" },
      { href: "/purchasing/to-pay", label: "Payables (AP)" },
      { href: "/finance/ledger", label: "General ledger" },
    ],
  },
  {
    key: "admin",
    title: "System & admin",
    short: "Admin",
    icon: "admin",
    pages: [
      { href: "/settings/company", label: "Company settings" },
      { href: "/settings/sales", label: "Sales & quotations" },
      { href: "/settings/reminders", label: "Reminders" },
      { href: "/settings/emails", label: "Emails" },
      { href: "/settings/order-checklist", label: "Order checklist" },
      { href: "/settings/papers", label: "Document templates" },
      { href: "/settings/address", label: "Company address" },
      { href: "/users", label: "Users" },
      { href: "/access/roles", label: "Roles" },
      { href: "/access/sessions", label: "Sessions" },
      { href: "/access/sign-ins", label: "Sign-ins" },
    ],
  },
];

/** The address of the dashboard, the first item on its own. */
export const HOME_HREF = "/dashboard";

const ALL_PAGES = MODULE_PAGES.flatMap((m) => m.pages.map((p) => ({ ...p, module: m })));

/**
 * The page of the sidebar an address belongs to: the longest page address it is or is under
 * (/orders/board is Pipelines, /orders/123 is Orders, /reports/people/targets is Analytics & reports).
 */
export function pageOf<T extends { href: string }>(pathname: string, pages: T[]): T | undefined {
  let best: T | undefined;
  for (const p of pages) {
    if (pathname === p.href || pathname.startsWith(`${p.href}/`)) {
      if (!best || p.href.length > best.href.length) best = p;
    }
  }
  return best;
}

/** The module an address is in, by the same rule (none for the dashboard, the account page…). */
export function moduleOf(pathname: string, modules: { key: ModuleKey; pages: { href: string }[] }[]): ModuleKey | undefined {
  const all = modules.flatMap((m) => m.pages.map((p) => ({ href: p.href, key: m.key })));
  return pageOf(pathname, all)?.key;
}

/** "Treasury & payments › Multi-currency vault": the breadcrumb above a module page's title (its title is the item's name). */
export function crumbsFor(href: string): { label: string; href?: string }[] {
  const p = ALL_PAGES.find((x) => x.href === href);
  if (!p) return [];
  return [{ label: p.module.title }, { label: p.label }];
}

/** The item's name, for the page's title. */
export function labelFor(href: string): string {
  return ALL_PAGES.find((x) => x.href === href)?.label ?? "";
}

/** The sum of a module's counts, shown on it while it is closed. */
export const moduleTotal = (m: { pages: { badge?: number }[] }) => m.pages.reduce((t, p) => t + (p.badge ?? 0), 0);

/**
 * The modules this person sees: each page with the same permission and plan checks as the page
 * itself; a module with no page left is left out. Count: payments waiting to be verified (or sent
 * back to the person who sent them). Unread notifications show on the bell, not here.
 */
export function buildModules({
  can,
  feature,
  approvals,
  approves,
  companyAddresses,
}: {
  can: (permission: string) => boolean;
  feature: (feature: string) => boolean;
  /** Payments waiting for an approver (or sent back to someone who sends them); null: not theirs. */
  approvals: number | null;
  approves: boolean;
  /** Companies have their own addresses (BASE_DOMAIN): System & admin › Company address. */
  companyAddresses: boolean;
}): NavModule[] {
  const managers = can("expenses.manage");
  const sourcing = can("sourcing.manage");
  const reports = can("reports.view") && feature("insights");
  const settings = can("settings.manage");
  const security = can("security.manage");
  /** Who may open each page; a page not listed is open to everyone signed in. */
  const show: Record<string, boolean> = {
    "/reports": reports,
    "/audit": can("audit.view") && feature("audit_log"),
    "/settings/website-form": settings,
    "/factories": sourcing,
    "/finance/profit": reports && managers,
    "/finance/expenses": sourcing && managers && feature("expenses"),
    "/finance/leaks": reports && managers,
    "/approvals": approvals !== null,
    "/finance/cash-book": sourcing && managers && feature("cash_book"),
    "/finance/to-receive": sourcing && (managers || can("payments.record")),
    "/purchasing/to-pay": sourcing,
    "/operations/purchase-orders": sourcing,
    "/finance/ledger": can("ledger.view"),
    "/settings/company": settings,
    "/settings/sales": settings,
    "/settings/reminders": settings,
    "/settings/emails": settings,
    "/settings/order-checklist": settings,
    "/settings/papers": settings,
    "/settings/address": settings && companyAddresses,
    "/users": can("users.manage"),
    "/access/roles": security,
    "/access/sessions": security,
    "/access/sign-ins": security,
  };
  const badges: Record<string, Pick<NavPage, "badge" | "badgeLabel">> = {
    "/approvals": { badge: approvals ?? 0, badgeLabel: approves ? "waiting" : "sent back" },
  };
  return MODULE_PAGES.map((m) => ({
    key: m.key,
    title: m.title,
    short: m.short,
    icon: m.icon,
    pages: m.pages.filter((p) => show[p.href] ?? true).map((p) => ({ ...p, ...badges[p.href] })),
  })).filter((m) => m.pages.length > 0);
}

/** The cookie that keeps the menu drawer's modules open as they were left (read by the layout, so the first paint is right). */
export const OPEN_COOKIE = "nav-open";
