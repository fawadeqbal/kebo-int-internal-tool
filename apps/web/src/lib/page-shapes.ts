/**
 * Every page's shape while it loads (Fawad 21 Nov: "the skeleton should be according to our sections and
 * elements"): its parts in order, as the page draws them. One line per page; components/common/skeletons.tsx
 * draws it, every loading.tsx shows the shape of the address it is loading, and two tests keep it true:
 * test/page-shapes.test.ts (every page has a shape, every loading.tsx uses this) and the browser test
 * skeletons.spec.ts (each page's parts are the skeleton's parts, in the same order, with the same counts).
 *
 * Parts the test checks (each real piece carries the same data-part):
 *   header        PageHeader of a list, settings or a form page
 *   record-top    a record's top (PageHeader with `record`)
 *   facts:n       FactsLine with n figures (StatRow facts)
 *   tiles:n       n StatTiles
 *   tabs:n        a list's tabs (LinkTabs, TabRow chips on a phone)
 *   record-tabs:n a record's tabs
 *   filter:n      FilterCard with n choices
 *   table         a list's table (DataTable, Table, PhoneList) or its empty state
 *   record-body   RecordBody; record-body:panel with the side panel
 * Parts drawn but not checked (no data-part on the page): ~greeting, ~board:n, ~form:n, ~charts:n, ~cards:n, ~pager.
 */
export const PAGE_SHAPES: Record<string, string> = {
  "/dashboard": "~greeting · tiles:4 · table · ~cards:2",
  "/search": "header · filter:0 · table",
  "/notifications": "header · tabs:7 · filter:0 · table · ~pager",
  "/follow-ups": "header · tabs:4 · filter:3 · table",
  "/needs-you": "header · table · ~pager",
  "/approvals": "header · facts:3 · tabs:4 · filter:0 · table",
  "/audit": "header · tabs:5 · filter:2 · table · ~pager",
  "/account": "header · record-body:panel",

  "/inquiries": "header · facts:4 · tabs:8 · filter:4 · table · ~pager",
  "/inquiries/board": "header · facts:4 · filter:4 · ~board:4",
  "/inquiries/new": "header · ~form:2",
  "/inquiries/[id]": "record-top · record-tabs:5 · record-body:panel",
  "/inquiries/[id]/offers/[offerId]": "record-top · record-body:panel",
  "/inquiries/[id]/quotations/[qid]": "record-top · record-body:panel",

  "/orders": "header · facts:5 · tabs:8 · filter:2 · table · ~pager",
  "/orders/board": "header · filter:1 · ~board:4",
  "/orders/[id]": "record-top · record-tabs:9 · record-body:panel",
  "/orders/[id]/papers/[kind]": "record-top · record-tabs:9 · record-body",

  "/customers": "header · facts:4 · tabs:5 · filter:3 · table · ~pager",
  "/customers/new": "header · ~form:2",
  "/customers/[id]": "record-top · record-tabs:6 · record-body:panel",

  "/suppliers": "header · facts:4 · tabs:4 · filter:2 · table · ~pager",
  "/suppliers/new": "header · ~form:2",
  "/suppliers/[id]": "record-top · record-tabs:5 · record-body:panel",

  "/operations/purchase-orders": "header · facts:4 · tabs:6 · filter:2 · table · ~pager",
  "/operations/purchase-orders/[order]/[supplier]": "record-top · record-body:panel",
  "/operations/shipments": "header · filter:1 · ~board:4",
  "/operations/payment-requests/[order]": "record-top · record-body:panel",

  "/payments": "header · facts:3 · tabs:7 · filter:2 · table · ~pager",
  "/payments/new": "header · tabs:4 · record-body:panel",
  "/payments/[kind]/[id]": "record-top · record-body:panel",
  "/payments/requests/[order]": "record-top · record-body:panel",

  "/money/due": "header · facts:4 · tabs:3 · filter:1 · table · ~pager",
  "/money/payables": "header · facts:3 · tabs:6 · filter:0 · table · ~pager",
  "/money/company-costs": "header · facts:4 · tabs:9 · filter:0 · table",
  "/finance/cash-book": "header · facts:4 · table",
  "/finance/ledger": "header · tabs:7 · filter:3 · table · ~pager",
  "/finance/ledger/[kind]/[id]": "header · facts:5 · table",
  "/finance/invoices/[order]": "record-top · record-body:panel",
  "/finance/profit": "header · tiles:4 · ~charts:2",
  "/finance/leaks": "header · tiles:4 · ~charts:2",

  "/reports": "header · tiles:4 · ~charts:4",
  "/reports/cash": "header · tiles:4 · table",
  "/reports/profit": "header · tiles:4 · table",
  "/reports/customers": "header · table",
  "/reports/factories": "header · table",
  "/reports/funnel": "header · table",
  "/reports/people": "header · table",
  "/reports/people/targets": "header · ~form:1",
  "/reports/spending": "header · table",
  "/insights": "header · tiles:4 · ~charts:4",

  "/users": "header · facts:2 · tabs:4 · filter:0 · table",
  "/users/new": "header · ~form:1",
  "/users/[id]": "header · record-body:panel",
  "/access/roles": "header · facts:4 · table",
  "/access/roles/new": "header · facts:4 · table",
  "/access/roles/[key]": "record-top · record-body:panel",
  "/access/sessions": "header · filter:1 · table",
  "/access/sign-ins": "header · tabs:2 · filter:1 · table",

  "/settings": "header · ~form:3",
  "/settings/address": "~form:2",
};

export interface Part {
  name: string;
  n?: number;
  panel?: boolean;
}

/** "header · facts:4 · record-body:panel" → its parts. */
export function partsOf(shape: string): Part[] {
  return shape
    .split("·")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [name, arg] = s.split(":") as [string, string | undefined];
      return arg === "panel" ? { name, panel: true } : arg !== undefined ? { name, n: Number(arg) } : { name };
    });
}

const pattern = (route: string) => new RegExp(`^${route.split("/").map((s) => (/^\[.+\]$/.test(s) ? "[^/]+" : s)).join("/")}$`);
const SHAPES = Object.entries(PAGE_SHAPES).map(([route, shape]) => ({ route, shape, re: pattern(route) }));

/**
 * The shape of the page at an address: its own line, else the nearest page above it (a record's tab is its
 * record: /orders/5f…/payment is /orders/[id]; a settings page is /settings). A list's address with a query is the list.
 */
export function shapeOf(address: string): string {
  const path = address.split(/[?#]/)[0]!.replace(/\/$/, "") || "/";
  for (let p = path; p; p = p.slice(0, p.lastIndexOf("/"))) {
    const hit = SHAPES.find((s) => s.re.test(p));
    if (hit) return hit.shape;
  }
  return "header · table";
}
