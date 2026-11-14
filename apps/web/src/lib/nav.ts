/**
 * The menu: Home, then the groups and their pages (13 Nov 2026: two levels, plain names).
 * A group has one name; a page sits in one group; nothing opens under a page. One address per
 * page: addresses did not move, only the grouping and the names changed. The group's name is the
 * first part of the path above a page's title ("Sales / Inquiries"), the page's name is its title.
 * The layout keeps only the pages a person may open (each page's own permission and plan checks);
 * a group whose pages are all hidden is hidden. Reports is one page (its reports are tabs on it), so
 * it is a link of its own like Home; notifications open from the bell.
 *
 * Clean-up (14 Nov 2026): Shipments is no longer a page of its own (a shipment is on its order);
 * Purchase orders has its list again, and each one a page of its own that shows it (it is still made
 * from, and changed on, its sales order); Settings is two groups, the company's own settings (managers
 * too) and the admin's (people, roles, sign-ins, sessions, email sending, the activity log).
 */

export type ModuleKey = "sales" | "purchasing" | "money" | "reports" | "company" | "admin";

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
    // Money, simple (14 Nov 2026): one page with tabs (Overview, Profit, Customers, Suppliers, Cash, People, Funnel).
    pages: [{ href: "/reports", label: "Reports" }],
  },
  {
    key: "company",
    title: "Company settings",
    icon: "company",
    pages: [
      { href: "/settings/company", label: "Company" },
      { href: "/settings/address", label: "Company address" },
      { href: "/settings/sales", label: "Sales & quotations" },
      { href: "/settings/papers", label: "Document templates" },
      { href: "/settings/reminders", label: "Reminders" },
      { href: "/settings/emails", label: "Emails" },
      { href: "/settings/website-form", label: "Website form" },
    ],
  },
  {
    key: "admin",
    title: "Admin settings",
    icon: "admin",
    pages: [
      { href: "/users", label: "People" },
      { href: "/access/roles", label: "Roles" },
      { href: "/access/sign-ins", label: "Sign-ins" },
      { href: "/access/sessions", label: "Sessions" },
      { href: "/settings/mail", label: "Email sending", lineBefore: true },
      { href: "/audit", label: "Activity log", lineBefore: true },
    ],
  },
];

/** The address of the dashboard, the first item on its own. */
export const HOME_HREF = "/dashboard";

const ALL_PAGES = MODULE_PAGES.flatMap((m) => m.pages.map((p) => ({ ...p, module: m })));

/**
 * The page of the menu an address belongs to: the longest page address it is or is under
 * (/orders/board is Order board, /orders/123 is Orders, /reports/people/targets is Reports).
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
  // A group that is one page of the same name (Reports) says its name once.
  if (isSingle(p.module)) return [{ label: p.label }];
  return [{ label: p.module.title }, { label: p.label }];
}

/** A group that is one page with the group's own name: the menu shows it as a link, not as a group to open. */
export const isSingle = (m: { title: string; pages: { label: string }[] }) => m.pages.length === 1 && m.pages[0]!.label === m.title;

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
    "/operations/purchase-orders": sourcing,
    "/money/company-costs": sourcing && managers && feature("expenses"),
    "/finance/cash-book": sourcing && managers && feature("cash_book"),
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
    "/settings/mail": security,
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
