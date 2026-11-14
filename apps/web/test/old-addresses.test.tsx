import { describe, expect, it, vi } from "vitest";
import { companyCostsTarget, dueTarget, insightsTarget, moneyTarget, orderPaymentTarget, ordersBoardTarget, paymentsTabTarget, profitTarget, purchaseOrdersTarget, reportsOverviewQuery, reportsPrintTarget, securityTarget, settingsTarget, shipmentsTarget } from "@/lib/old-addresses";

// Every old address keeps working (design page 33): old → new, with the rest of the query.

describe("/money?tab=…", () => {
  it.each([
    ["cash", "/finance/cash-book"],
    ["expenses", "/money/company-costs"],
    ["receive", "/money/due"],
    ["owe", "/money/due?side=suppliers"],
    ["pnl", "/reports/profit"],
  ])("tab=%s → %s", (tab, to) => expect(moneyTarget({ tab })).toBe(to));

  it("keeps the filters", () => {
    expect(moneyTarget({ tab: "expenses", p: "2026-10" })).toBe("/money/company-costs?p=2026-10");
    expect(moneyTarget({ tab: "cash", acct: "none" })).toBe("/finance/cash-book?acct=none");
    expect(moneyTarget({ tab: "owe", q: "jiangsu" })).toBe("/money/due?side=suppliers&q=jiangsu");
  });

  it("without a tab: the first page this person may open, as the old page did", () => {
    expect(moneyTarget({}, { cashBook: true, expenses: true, recorders: true })).toBe("/finance/cash-book");
    expect(moneyTarget({}, { cashBook: false, expenses: true, recorders: true })).toBe("/money/company-costs");
    expect(moneyTarget({}, { cashBook: false, expenses: false, recorders: true })).toBe("/money/due");
    expect(moneyTarget({}, { cashBook: false, expenses: false, recorders: false })).toBe("/money/due?side=suppliers");
  });
});

// Money, simple (14 Nov 2026): eight Money pages became four.
describe("the Money pages that became “To receive and to pay”", () => {
  it("Invoices and To receive open the customers' side; the two To pay lists the suppliers' side", () => {
    expect(dueTarget("customers")).toBe("/money/due");
    expect(dueTarget("suppliers")).toBe("/money/due?side=suppliers");
  });

  it("keep a search, and drop the views that are gone", () => {
    expect(dueTarget("customers", { q: "lagos", view: "invoices", age: "d90_plus" })).toBe("/money/due?q=lagos");
    expect(dueTarget("suppliers", { q: "jiangsu", mine: "1" })).toBe("/money/due?side=suppliers&q=jiangsu");
  });

  it("Payments' tabs Payment requests and To pay go there too; its list stays on Payments", () => {
    expect(paymentsTabTarget({ tab: "requests" })).toBe("/money/due");
    expect(paymentsTabTarget({ tab: "to-pay", q: "pack" })).toBe("/money/due?side=suppliers&q=pack");
    expect(paymentsTabTarget({ tab: "paid" })).toBeNull();
    expect(paymentsTabTarget({ order: "o1" })).toBeNull();
  });

  it("Expenses is Company costs: a month and a kind are kept; a year or a customer is not a filter there", () => {
    expect(companyCostsTarget()).toBe("/money/company-costs");
    expect(companyCostsTarget({ p: "2026-10", category: "rent" })).toBe("/money/company-costs?p=2026-10&kind=rent");
    expect(companyCostsTarget({ p: "2026", customer: "c1", kind: "general" })).toBe("/money/company-costs");
  });

  it("a payment request and an order's invoice open the order's Payment tab", () => {
    expect(orderPaymentTarget("o1")).toBe("/orders/o1/payment");
  });
});

describe("/insights?section=…&view=…", () => {
  it.each([
    [{}, "/reports"],
    [{ section: "overview" }, "/reports"],
    [{ section: "money" }, "/reports/profit"],
    [{ section: "money", view: "pnl" }, "/reports/profit"],
    [{ section: "money", view: "leaks" }, "/reports/profit"],
    [{ section: "cash" }, "/reports/cash"],
    [{ section: "customers" }, "/reports/customers"],
    [{ section: "factories" }, "/reports/factories"],
    [{ section: "people" }, "/reports/people"],
    [{ section: "people", view: "targets" }, "/reports/people/targets"],
    [{ section: "funnel" }, "/reports/funnel"],
    [{ section: "nonsense" }, "/reports"],
  ])("%o → %s", (q, to) => expect(insightsTarget(q)).toBe(to));

  it("keeps the period and the rest", () => {
    expect(insightsTarget({ section: "customers", period: "year", chip: "late" })).toBe("/reports/customers?period=year&chip=late");
    expect(insightsTarget({ period: "month" })).toBe("/reports?period=month");
    expect(insightsTarget({ period: "custom", from: "2026-10-01", to: "2026-10-31" })).toBe("/reports?period=custom&from=2026-10-01&to=2026-10-31");
    // Profit and loss had a year and a cash view, Planned vs spent its lists: the Profit tab has neither.
    expect(insightsTarget({ section: "money", view: "pnl", year: "2025", pl: "cash", period: "year" })).toBe("/reports/profit?period=year");
    expect(insightsTarget({ section: "money", view: "leaks", leak: "orders" })).toBe("/reports/profit");
  });

  it.each([
    [{ tab: "sales" }, "/reports/funnel"],
    [{ tab: "customers" }, "/reports/customers"],
    [{ tab: "factories" }, "/reports/factories"],
    [{ tab: "profit" }, "/reports/profit"],
    [{ tab: "profit", sub: "pnl" }, "/reports/profit"],
    [{ tab: "profit", sub: "orders" }, "/reports/profit"],
    [{ tab: "targets" }, "/reports/people/targets"],
    [{ tab: "overview" }, "/reports"],
    [{ tab: "sales", from: "2026-01-01", to: "2026-03-31" }, "/reports/funnel?from=2026-01-01&to=2026-03-31&period=custom"],
  ])("the older ?tab= form %o → %s", (q, to) => expect(insightsTarget(q)).toBe(to));
});

describe("the old report pages", () => {
  it("Profit & loss, Planned vs spent and Where we lose money → Reports › Profit, for the same period", () => {
    expect(profitTarget({})).toBe("/reports/profit");
    expect(profitTarget({ period: "year", year: "2025", pl: "cash", leak: "orders" })).toBe("/reports/profit?period=year");
    expect(profitTarget({ period: "quarter" })).toBe("/reports/profit");
    expect(profitTarget({ view: "customers", from: "2026-01-01", to: "2026-06-30" })).toBe("/reports/profit?period=custom&from=2026-01-01&to=2026-06-30");
  });
  it("the Print tab → the overview, for the same period", () => {
    expect(reportsPrintTarget({})).toBe("/reports");
    expect(reportsPrintTarget({ period: "month", staff: "abc" })).toBe("/reports?period=month");
    expect(reportsPrintTarget({ period: "custom", from: "2026-10-01", to: "2026-10-31" })).toBe("/reports?period=custom&from=2026-10-01&to=2026-10-31");
  });
  it("the oldest /reports?from&to opens that period on the overview", () => {
    expect(reportsOverviewQuery({ from: "2026-01-01", to: "2026-01-31" })).toEqual({ from: "2026-01-01", to: "2026-01-31", period: "custom" });
    expect(reportsOverviewQuery({ period: "year" })).toBeNull();
    expect(reportsOverviewQuery({})).toBeNull();
  });
});

describe("/settings?tab=… (and ?section=…)", () => {
  it.each([
    [{}, "/settings/company"],
    [{ tab: "company" }, "/settings/company"],
    [{ tab: "sales" }, "/settings/sales"],
    [{ tab: "reminders" }, "/settings/reminders"],
    [{ tab: "notifications" }, "/settings/emails"],
    [{ tab: "order-checklist" }, "/settings/company"],
    [{ tab: "papers" }, "/settings/papers"],
    [{ tab: "website-form" }, "/settings/website-form"],
    [{ tab: "address" }, "/settings/address"],
    [{ section: "sales" }, "/settings/sales"],
    [{ section: "emails" }, "/settings/emails"],
    [{ tab: "nonsense" }, "/settings/company"],
  ])("%o → %s", (q, to) => expect(settingsTarget(q)).toBe(to));

  it("keeps a side panel asked for", () => {
    expect(settingsTarget({ tab: "sales", panel: "edit-currencies" })).toBe("/settings/sales?panel=edit-currencies");
  });
});

describe("/orders?view=board", () => {
  it("the board has its own page", () => {
    expect(ordersBoardTarget({ view: "board" })).toBe("/orders/board");
    expect(ordersBoardTarget({ view: "board", mine: "1" })).toBe("/orders/board?mine=1");
    // A step from the dashboard.
    expect(ordersBoardTarget({ mine: "1", stage: "payment" })).toBe("/orders/board?mine=1&stage=payment");
  });
  it("the list stays the list", () => {
    expect(ordersBoardTarget({})).toBeNull();
    expect(ordersBoardTarget({ view: "mine" })).toBeNull();
    expect(ordersBoardTarget({ status: "late" })).toBeNull();
  });
});

describe("/security/…", () => {
  it.each([
    ["/security", "/access/roles"],
    ["/security/roles/manager", "/access/roles/manager"],
    ["/security/roles/new", "/access/roles/new"],
    ["/security/sessions", "/access/sessions"],
    ["/security/sign-ins", "/access/sign-ins"],
  ])("%s → %s", (from, to) => expect(securityTarget(from)).toBe(to));

  it("next.config.ts sends them on the same way (the query goes along)", async () => {
    vi.stubGlobal("__dirname", "/");
    const config = (await import("../next.config")).default;
    const rules = await config.redirects!();
    const match = (path: string) => {
      for (const r of rules) {
        const re = new RegExp(`^${r.source.replace(/:path\*/, "(.*)")}$`);
        const m = path.match(re);
        if (m) return r.destination.replace(/:path\*/, m[1] ?? "");
      }
      return null;
    };
    for (const p of ["/security", "/security/roles/manager", "/security/sessions", "/security/sign-ins"]) expect(match(p)).toBe(securityTarget(p));
    expect(rules.filter((r) => r.source.startsWith("/security")).every((r) => r.permanent === false)).toBe(true);
  });
});

describe("the lists that left the menu in the clean-up", () => {
  it("Shipments opens the orders that are shipped; Purchase orders opens Orders; a search is kept", () => {
    expect(shipmentsTarget()).toBe("/orders?stage=shipped");
    expect(shipmentsTarget({ q: "MSKU", page: "2", status: "sailing" })).toBe("/orders?stage=shipped&q=MSKU");
    expect(purchaseOrdersTarget()).toBe("/orders");
    expect(purchaseOrdersTarget({ q: "PO-2026", status: "sent" })).toBe("/orders?q=PO-2026");
  });
});
