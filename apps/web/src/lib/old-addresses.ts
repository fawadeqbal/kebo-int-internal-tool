import { buildHref } from "@kebo/ui";
import { sectionOfTab } from "./insights-period";

/**
 * Where the old addresses go now that every tab is its own page (design page 33). Old links,
 * bookmarks and links in notifications and emails keep working: each old page sends people on
 * with the rest of their filters. Pure, so each mapping is tested (test/old-addresses.test.ts).
 */

type Query = Record<string, string | undefined>;

/* ------------------------------------------------------------------ /money?tab= */

const MONEY_TAB: Record<string, string> = {
  cash: "/finance/cash-book",
  expenses: "/money/company-costs",
  pnl: "/reports/profit",
};

/** Cash & accounts' tabs. Without a tab: the first this person may open, as the old page did. */
export function moneyTarget(q: Query, first?: { cashBook: boolean; expenses: boolean; recorders: boolean }): string {
  const { tab, ...rest } = q;
  // What customers owe and what we owe: the two sides of one page now.
  if (tab === "receive") return dueTarget("customers", rest);
  if (tab === "owe") return dueTarget("suppliers", rest);
  const known = tab ? MONEY_TAB[tab] : undefined;
  if (!known && !first?.cashBook && !first?.expenses) return dueTarget(first?.recorders ? "customers" : "suppliers", rest);
  return buildHref(known ?? (first?.cashBook ? MONEY_TAB.cash : MONEY_TAB.expenses)!, {}, rest);
}

/* ------------------------------------------------------------------ money, simple (14 Nov 2026) */

/** Where what customers owe and what we owe is now: one page, two sides. */
export const DUE = "/money/due";

/**
 * The pages that became "To receive and to pay": Invoices, To receive (customers), the two To pay lists
 * (suppliers). A search typed there is kept; their own views (?view=, ?age=, ?cur=) are gone.
 */
export function dueTarget(side: "customers" | "suppliers", q: Query = {}): string {
  return buildHref(DUE, {}, { side: side === "suppliers" ? "suppliers" : undefined, q: q.q });
}

/** Payments' old tabs: Payment requests and To pay are sides of "To receive and to pay"; the rest is Payments itself. */
export function paymentsTabTarget(q: Query): string | null {
  if (q.tab === "requests") return dueTarget("customers", q);
  if (q.tab === "to-pay") return dueTarget("suppliers", q);
  return null;
}

/** Expenses was one list of every cost: what is not a cost of one order is Company costs, month by month (a year or a customer's filter is dropped). */
export function companyCostsTarget(q: Query = {}): string {
  const month = /^\d{4}-\d{2}$/.test(q.p ?? q.month ?? "") ? (q.p ?? q.month) : undefined;
  return buildHref("/money/company-costs", {}, { p: month, kind: q.category });
}

/** A payment request and an order's invoice were pages of their own: the order's Payment tab holds them now. */
export const orderPaymentTarget = (orderId: string) => `/orders/${orderId}/payment`;

/* ------------------------------------------------------------------ /insights?section=&view= */

/** Insights' sections as pages: the tabs of Reports. */
export const SECTION_PATH = {
  overview: "/reports",
  money: "/reports/profit",
  customers: "/reports/customers",
  factories: "/reports/factories",
  cash: "/reports/cash",
  people: "/reports/people",
  funnel: "/reports/funnel",
} as const;
export type SectionKey = keyof typeof SECTION_PATH;

/** A section's sub-view (?view=) as its own page. */
export function viewPath(section: string | undefined, view: string | undefined): string | undefined {
  // Profit and loss by month and "where money leaks" were views of Money: Reports › Profit holds both answers now.
  if (section === "money" && (view === "pnl" || view === "leaks")) return "/reports/profit";
  if (section === "people" && view === "targets") return "/reports/people/targets";
  return undefined;
}

/** /insights?section=…&view=… and the older ?tab= forms. */
export function insightsTarget(q: Query): string {
  const { section: s, view: v, tab, sub, ...rest } = q;
  let section = s && s in SECTION_PATH ? (s as SectionKey) : "overview";
  let view = v;
  const old = sectionOfTab(tab);
  if (old) {
    section = old.section;
    view = old.view ?? (tab === "profit" && sub ? (sub === "pnl" ? "pnl" : "leaks") : undefined);
    // The oldest links gave from and to without saying they were a custom period.
    if (rest.from && rest.to && !rest.period) rest.period = "custom";
  }
  const target = viewPath(section, view) ?? SECTION_PATH[section];
  // Profit and loss had a year and a cash view, Planned vs spent its own lists: Reports › Profit has neither.
  if (target === SECTION_PATH.money) for (const k of ["year", "pl", "leak"]) delete rest[k];
  return buildHref(target, {}, rest);
}

/** The period of a report link, and nothing else (the old pages' own filters do not exist on the new ones). */
function periodOnly(q: Query): Query {
  if (q.from && q.to && (!q.period || q.period === "custom")) return { period: "custom", from: q.from, to: q.to };
  return { period: q.period === "quarter" ? undefined : q.period };
}

/**
 * Profit & loss (/finance/profit), Planned vs spent (/finance/leaks) and "Where we lose money" (/reports/money)
 * are one tab now: Reports › Profit, for the same period.
 */
export function profitTarget(q: Query): string {
  return buildHref("/reports/profit", {}, periodOnly(q));
}

/** The Print tab (/reports/print): every report has View / Print and PDF in its header, so the overview. */
export function reportsPrintTarget(q: Query): string {
  return buildHref("/reports", {}, periodOnly(q));
}

/** /reports?from&to (the oldest report links, a period): the overview for that period. */
export function reportsOverviewQuery(q: Query): Query | null {
  if (q.from && q.to && !q.period) return { ...q, period: "custom" };
  return null;
}

/* ------------------------------------------------------------------ /settings?tab= */

/** Settings' sections as pages (the group keys of the old ?tab=, or ?section=). */
export const SETTINGS_PATH: Record<string, string> = {
  company: "/settings/company",
  sales: "/settings/sales",
  reminders: "/settings/reminders",
  notifications: "/settings/emails",
  emails: "/settings/emails",
  // The order checklist is gone: its old tab opens Settings.
  "order-checklist": "/settings/company",
  papers: "/settings/papers",
  "website-form": "/settings/website-form",
  address: "/settings/address",
};

/** /settings, /settings?tab=… and /settings?section=…: that section's page (Company when none). */
export function settingsTarget(q: Query): string {
  const { tab, section, ...rest } = q;
  const key = tab ?? section;
  return buildHref((key && SETTINGS_PATH[key]) || "/settings/company", {}, rest);
}

/* ------------------------------------------------------------------ /orders?view=board */

/** The orders board was a view of /orders (?view=board, or a step from the dashboard, ?stage=…): its own page now. */
export function ordersBoardTarget(q: Query): string | null {
  const board = q.view === "board" || (!!q.stage && !q.status);
  if (!board) return null;
  const { view: _view, ...rest } = q;
  return buildHref("/orders/board", {}, rest);
}

/* ------------------------------------------------------------------ /security/… */

/** Security's pages are under People & access (next.config.ts sends /security/… on; this is the same rule, for the tests). */
export function securityTarget(path: string): string {
  if (path === "/security" || path === "/security/") return "/access/roles";
  return path.replace(/^\/security\//, "/access/");
}
