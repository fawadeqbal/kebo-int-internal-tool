/**
 * The sidebar's modules and their pages (design page 33): one address per page, the module's
 * name in the breadcrumb above the title. The layout keeps only the pages a person may open
 * (each page's own permission and plan checks); a module whose pages are all hidden is hidden.
 * Lists stay where they were (/inquiries, /orders, /users…); what used to be a tab has its own
 * address under its module (/finance/cash-book, /reports/customers, /settings/company, /access/roles).
 */

export type ModuleKey = "work" | "sales" | "orders" | "purchasing" | "finance" | "reports" | "settings" | "access";

export type NavIcon =
  | "home"
  | "work"
  | "sales"
  | "orders"
  | "purchasing"
  | "finance"
  | "reports"
  | "settings"
  | "access";

export interface NavPage {
  href: string;
  label: string;
  /** What needs looking at (approvals waiting, unread notifications); 0 or none: no count. */
  badge?: number;
  /** What the count is, for screen readers ("3 waiting"); default "unread". */
  badgeLabel?: string;
}

export interface NavModule {
  key: ModuleKey;
  title: string;
  icon: NavIcon;
  pages: NavPage[];
}

/** Every page of every module, in sidebar order (before anyone's permissions). */
export const MODULE_PAGES: { key: ModuleKey; title: string; icon: NavIcon; pages: { href: string; label: string }[] }[] = [
  {
    key: "work",
    title: "My work",
    icon: "work",
    pages: [
      { href: "/follow-ups", label: "Follow-ups" },
      { href: "/approvals", label: "Approvals" },
      { href: "/notifications", label: "Notifications" },
    ],
  },
  {
    key: "sales",
    title: "Sales",
    icon: "sales",
    pages: [
      { href: "/inquiries", label: "Inquiries" },
      { href: "/customers", label: "Customers" },
    ],
  },
  {
    key: "orders",
    title: "Orders",
    icon: "orders",
    pages: [
      { href: "/orders", label: "Orders" },
      { href: "/orders/board", label: "Order board" },
    ],
  },
  {
    key: "purchasing",
    title: "Purchasing",
    icon: "purchasing",
    pages: [
      { href: "/factories", label: "Factories" },
      { href: "/purchasing/to-pay", label: "To pay factories" },
    ],
  },
  {
    key: "finance",
    title: "Finance",
    icon: "finance",
    pages: [
      { href: "/finance/to-receive", label: "To receive" },
      { href: "/finance/ledger", label: "Ledger" },
      { href: "/finance/cash-book", label: "Cash book" },
      { href: "/finance/expenses", label: "Expenses" },
      { href: "/finance/profit", label: "Profit & loss" },
      { href: "/finance/leaks", label: "Leaks" },
    ],
  },
  {
    key: "reports",
    title: "Reports",
    icon: "reports",
    pages: [
      { href: "/reports", label: "Overview" },
      { href: "/reports/customers", label: "Customers" },
      { href: "/reports/factories", label: "Factories" },
      { href: "/reports/people", label: "People & targets" },
      { href: "/reports/funnel", label: "Sales funnel" },
      { href: "/reports/print", label: "Printable reports" },
    ],
  },
  {
    key: "settings",
    title: "Settings",
    icon: "settings",
    pages: [
      { href: "/settings/company", label: "Company" },
      { href: "/settings/sales", label: "Sales & quotations" },
      { href: "/settings/reminders", label: "Reminders" },
      { href: "/settings/emails", label: "Emails" },
      { href: "/settings/order-checklist", label: "Order checklist" },
      { href: "/settings/papers", label: "Papers" },
      { href: "/settings/website-form", label: "Website form" },
      { href: "/settings/address", label: "Company address" },
    ],
  },
  {
    key: "access",
    title: "People & access",
    icon: "access",
    pages: [
      { href: "/users", label: "Users" },
      { href: "/access/roles", label: "Roles" },
      { href: "/access/sessions", label: "Sessions" },
      { href: "/access/sign-ins", label: "Sign-ins" },
      { href: "/audit", label: "Audit log" },
    ],
  },
];

/** The address of the dashboard, the first item on its own. */
export const HOME_HREF = "/dashboard";

const ALL_PAGES = MODULE_PAGES.flatMap((m) => m.pages.map((p) => ({ ...p, module: m })));

/**
 * The page of the sidebar an address belongs to: the longest page address it is or is under
 * (/orders/board is Order board, /orders/123 is Orders, /reports/people/targets is People & targets).
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

/** "Finance › Cash book": the breadcrumb above a module page's title (its title is the item's name). */
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
 * itself; a module with no page left is left out. Counts: approvals waiting (or sent back) and
 * unread notifications.
 */
export function buildModules({
  can,
  feature,
  approvals,
  approves,
  unread,
  companyAddresses,
}: {
  can: (permission: string) => boolean;
  feature: (feature: string) => boolean;
  /** Approvals waiting for an approver (or sent back to someone who sends them); null: not theirs. */
  approvals: number | null;
  approves: boolean;
  unread: number;
  /** Companies have their own addresses (BASE_DOMAIN): Settings › Company address. */
  companyAddresses: boolean;
}): NavModule[] {
  const managers = can("expenses.manage");
  const sourcing = can("sourcing.manage");
  const reports = can("reports.view") && feature("insights");
  const settings = can("settings.manage");
  const security = can("security.manage");
  const show: Record<string, boolean> = {
    "/approvals": approvals !== null,
    "/factories": sourcing,
    "/purchasing/to-pay": sourcing,
    "/finance/to-receive": sourcing && (managers || can("payments.record")),
    "/finance/ledger": can("ledger.view"),
    "/finance/cash-book": sourcing && managers && feature("cash_book"),
    "/finance/expenses": sourcing && managers && feature("expenses"),
    "/finance/profit": reports && managers,
    "/finance/leaks": reports && managers,
    "/users": can("users.manage"),
    "/access/roles": security,
    "/access/sessions": security,
    "/access/sign-ins": security,
    "/audit": can("audit.view") && feature("audit_log"),
    "/settings/address": settings && companyAddresses,
  };
  const badges: Record<string, Pick<NavPage, "badge" | "badgeLabel">> = {
    "/approvals": { badge: approvals ?? 0, badgeLabel: approves ? "waiting" : "sent back" },
    "/notifications": { badge: unread },
  };
  const allowed = (key: ModuleKey, href: string) => show[href] ?? (key === "settings" ? settings : key === "reports" ? reports : true);
  return MODULE_PAGES.map((m) => ({
    key: m.key,
    title: m.title,
    icon: m.icon,
    pages: m.pages.filter((p) => allowed(m.key, p.href)).map((p) => ({ ...p, ...badges[p.href] })),
  })).filter((m) => m.pages.length > 0);
}

/** Cookies that keep the sidebar as it was left (read by the layout, so the first paint is right). */
export const RAIL_COOKIE = "nav-rail";
export const OPEN_COOKIE = "nav-open";
