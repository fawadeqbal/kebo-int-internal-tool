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
  expenses: "/finance/expenses",
  receive: "/finance/to-receive",
  owe: "/purchasing/to-pay",
  pnl: "/finance/profit",
};

/** Cash & accounts' tabs. Without a tab: the first this person may open, as the old page did. */
export function moneyTarget(q: Query, first?: { cashBook: boolean; expenses: boolean; recorders: boolean }): string {
  const { tab, ...rest } = q;
  const known = tab ? MONEY_TAB[tab] : undefined;
  const path =
    known ??
    (first?.cashBook ? MONEY_TAB.cash : first?.expenses ? MONEY_TAB.expenses : first?.recorders ? MONEY_TAB.receive : MONEY_TAB.owe)!;
  return buildHref(path, {}, rest);
}

/* ------------------------------------------------------------------ /insights?section=&view= */

/** Insights' sections as pages: Reports, and Finance for the money ones. */
export const SECTION_PATH = {
  overview: "/reports",
  money: "/finance/profit",
  customers: "/reports/customers",
  factories: "/reports/factories",
  people: "/reports/people",
  funnel: "/reports/funnel",
} as const;
export type SectionKey = keyof typeof SECTION_PATH;

/** A section's sub-view (?view=) as its own page. */
export function viewPath(section: string | undefined, view: string | undefined): string | undefined {
  if (section === "money" && view === "pnl") return "/finance/profit";
  if (section === "money" && view === "leaks") return "/finance/leaks";
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
    if (view === "leaks" && sub) rest.leak = sub;
    // The oldest links gave from and to without saying they were a custom period.
    if (rest.from && rest.to && !rest.period) rest.period = "custom";
  }
  const sub_ = viewPath(section, view);
  return buildHref(sub_ ?? SECTION_PATH[section], {}, rest);
}

/** /reports/money: "Where we lose money", now Finance › Leaks. */
export function reportsMoneyTarget(q: Query): string {
  const { view, from, to, ...rest } = q;
  return buildHref("/finance/leaks", {}, { ...rest, leak: view, ...(from && to ? { period: "custom", from, to } : {}) });
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
  "order-checklist": "/settings/order-checklist",
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
