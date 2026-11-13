/**
 * The menu: Home, then five groups and their pages (13 Nov 2026: two levels, plain names).
 * A group has one name; a page sits in one group; nothing opens under a page. One address per
 * page: addresses did not move, only the grouping and the names changed. The group's name is the
 * first part of the path above a page's title ("Sales / Inquiries"), the page's name is its title.
 * The layout keeps only the pages a person may open (each page's own permission and plan checks);
 * a group whose pages are all hidden is hidden. The reports share one item (All reports) and switch
 * with tabs on the page; notifications open from the bell.
 */

export type ModuleKey = "sales" | "purchasing" | "money" | "reports" | "settings";

export type NavIcon = "home" | ModuleKey;

export interface NavPage {
  href: string;
  label: string;
  /** A thin line above this page: it starts the group's second kind of page (not a level, no name). */
  lineBefore?: boolean;
  /** What needs looking at (payments waiting to be verified); 0 or none: no count. */
  badge?: number;
  /** What the count is, for screen readers ("3 waiting"); default "unread". */
  badgeLabel?: string;
}

export interface NavModule {
  key: ModuleKey;
  /** The group's one name: in the menu and in the path above a page's title. */
  title: string;
  icon: NavIcon;
  pages: NavPage[];
}

/** Every page of every group, in menu order (before anyone's permissions). */
export const MODULE_PAGES: { key: ModuleKey; title: string; icon: NavIcon; pages: { href: string; label: string; lineBefore?: boolean }[] }[] = [
  {
    key: "sales",
    title: "Sales",
    icon: "sales",
    pages: [
      { href: "/inquiries", label: "Inquiries" },
      { href: "/orders", label: "Orders" },
      { href: "/orders/board", label: "Order board" },
      { href: "/operations/shipments", label: "Shipments" },
      { href: "/customers", label: "Customers" },
      { href: "/follow-ups", label: "Follow-ups" },
    ],
  },
  {
    key: "purchasing",
    title: "Purchasing",
    icon: "purchasing",
    pages: [
      { href: "/operations/purchase-orders", label: "Purchase orders" },
      { href: "/factories", label: "Suppliers" },
    ],
  },
  {
    key: "money",
    title: "Money",
    icon: "money",
    // Money, simple (14 Nov 2026): four pages. Payment requests, Invoices, To receive and the two To pay lists
    // are one page; To verify and the Ledger keep their addresses and left the menu.
    pages: [
      { href: "/money/due", label: "To receive and to pay" },
      { href: "/payments", label: "Payments" },
      { href: "/finance/cash-book", label: "Cash & bank" },
      { href: "/money/company-costs", label: "Company costs" },
    ],
  },
  {
    key: "reports",
    title: "Reports",
    icon: "reports",
    pages: [
      { href: "/finance/profit", label: "Profit & loss" },
      { href: "/finance/leaks", label: "Planned vs spent" },
      { href: "/reports", label: "All reports" },
    ],
  },
  {
    key: "settings",
    title: "Settings",
    icon: "settings",
    pages: [
      { href: "/settings/company", label: "Company" },
      { href: "/settings/address", label: "Company address" },
      { href: "/settings/sales", label: "Sales & quotations" },
      { href: "/settings/papers", label: "Document templates" },
      { href: "/settings/reminders", label: "Reminders" },
      { href: "/settings/emails", label: "Emails" },
      { href: "/settings/website-form", label: "Website form" },
      { href: "/users", label: "People", lineBefore: true },
      { href: "/access/roles", label: "Roles" },
      { href: "/access/sign-ins", label: "Sign-ins" },
      { href: "/access/sessions", label: "Sessions" },
      { href: "/audit", label: "Activity log", lineBefore: true },
    ],
  },
];

/** The address of the dashboard, the first item on its own. */
export const HOME_HREF = "/dashboard";

const ALL_PAGES = MODULE_PAGES.flatMap((m) => m.pages.map((p) => ({ ...p, module: m })));

/**
 * The page of the menu an address belongs to: the longest page address it is or is under
 * (/orders/board is Order board, /orders/123 is Orders, /reports/people/targets is All reports).
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

/** The group an address is in, by the same rule (none for the dashboard, the account page…). */
export function moduleOf(pathname: string, modules: { key: ModuleKey; pages: { href: string }[] }[]): ModuleKey | undefined {
  const all = modules.flatMap((m) => m.pages.map((p) => ({ href: p.href, key: m.key })));
  return pageOf(pathname, all)?.key;
}

/** "Money / Cash & bank": the path above a page's title (its title is the page's name). */
export function crumbsFor(href: string): { label: string; href?: string }[] {
  const p = ALL_PAGES.find((x) => x.href === href);
  if (!p) return [];
  return [{ label: p.module.title }, { label: p.label }];
}

/** The item's name, for the page's title. */
export function labelFor(href: string): string {
  return ALL_PAGES.find((x) => x.href === href)?.label ?? "";
}

/** The sum of a group's counts, shown on it while it is closed. */
export const moduleTotal = (m: { pages: { badge?: number }[] }) => m.pages.reduce((t, p) => t + (p.badge ?? 0), 0);

/**
 * The pages that pass, keeping the group's thin line: when the page that carries it is hidden the
 * next one shown carries it, and it is never above the first page shown.
 */
function visible<T extends { lineBefore?: boolean }>(pages: T[], ok: (p: T) => boolean): T[] {
  const out: T[] = [];
  let line = false;
  for (const p of pages) {
    line ||= !!p.lineBefore;
    if (!ok(p)) continue;
    out.push({ ...p, lineBefore: line && out.length > 0 });
    line = false;
  }
  return out;
}

/**
 * The groups this person sees: each page with the same permission and plan checks as the page
 * itself; a group with no page left is left out. Count: payments waiting to be verified (or sent
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
  /** Companies have their own addresses (BASE_DOMAIN): Settings › Company address. */
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
    "/money/company-costs": sourcing && managers && feature("expenses"),
    "/finance/leaks": reports && managers,
    "/finance/cash-book": sourcing && managers && feature("cash_book"),
    "/operations/purchase-orders": sourcing,
    "/settings/company": settings,
    "/settings/sales": settings,
    "/settings/reminders": settings,
    "/settings/emails": settings,
    "/settings/papers": settings,
    "/settings/address": settings && companyAddresses,
    "/users": can("users.manage"),
    "/access/roles": security,
    "/access/sessions": security,
    "/access/sign-ins": security,
  };
  // Payments waiting to be verified show on Payments, where its strip opens them.
  const badges: Record<string, Pick<NavPage, "badge" | "badgeLabel">> = {
    "/payments": { badge: approvals ?? 0, badgeLabel: approves ? "waiting to be verified" : "sent back" },
  };
  return MODULE_PAGES.map((m) => ({
    key: m.key,
    title: m.title,
    icon: m.icon,
    pages: visible(m.pages, (p) => show[p.href] ?? true).map((p) => ({ ...p, ...badges[p.href] })),
  })).filter((m) => m.pages.length > 0);
}

/** The cookie that keeps the menu's groups open as they were left (read by the layout, so the first paint is right). */
export const OPEN_COOKIE = "nav-open";
/** The cookie that keeps the menu folded to its strip of icons ("1") or open ("0"); none: open on a wide screen. */
export const FOLD_COOKIE = "nav-fold";
