import { describe, expect, it, vi } from "vitest";
import { insightsTarget, moneyTarget, ordersBoardTarget, reportsMoneyTarget, reportsOverviewQuery, securityTarget, settingsTarget } from "@/lib/old-addresses";

// Every old address keeps working (design page 33): old → new, with the rest of the query.

describe("/money?tab=…", () => {
  it.each([
    ["cash", "/finance/cash-book"],
    ["expenses", "/finance/expenses"],
    ["receive", "/finance/to-receive"],
    ["owe", "/purchasing/to-pay"],
    ["pnl", "/finance/profit"],
  ])("tab=%s → %s", (tab, to) => expect(moneyTarget({ tab })).toBe(to));

  it("keeps the filters", () => {
    expect(moneyTarget({ tab: "expenses", p: "2026", customer: "c1" })).toBe("/finance/expenses?p=2026&customer=c1");
    expect(moneyTarget({ tab: "cash", acct: "none" })).toBe("/finance/cash-book?acct=none");
    expect(moneyTarget({ tab: "owe", mine: "1" })).toBe("/purchasing/to-pay?mine=1");
  });

  it("without a tab: the first page this person may open, as the old page did", () => {
    expect(moneyTarget({}, { cashBook: true, expenses: true, recorders: true })).toBe("/finance/cash-book");
    expect(moneyTarget({}, { cashBook: false, expenses: true, recorders: true })).toBe("/finance/expenses");
    expect(moneyTarget({}, { cashBook: false, expenses: false, recorders: true })).toBe("/finance/to-receive");
    expect(moneyTarget({}, { cashBook: false, expenses: false, recorders: false })).toBe("/purchasing/to-pay");
  });
});

describe("/insights?section=…&view=…", () => {
  it.each([
    [{}, "/reports"],
    [{ section: "overview" }, "/reports"],
    [{ section: "money" }, "/finance/profit"],
    [{ section: "money", view: "pnl" }, "/finance/profit"],
    [{ section: "money", view: "leaks" }, "/finance/leaks"],
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
    expect(insightsTarget({ section: "money", view: "pnl", year: "2025", pl: "cash" })).toBe("/finance/profit?year=2025&pl=cash");
    expect(insightsTarget({ section: "money", view: "leaks", leak: "orders" })).toBe("/finance/leaks?leak=orders");
  });

  it.each([
    [{ tab: "sales" }, "/reports/funnel"],
    [{ tab: "customers" }, "/reports/customers"],
    [{ tab: "factories" }, "/reports/factories"],
    [{ tab: "profit" }, "/finance/profit"],
    [{ tab: "profit", sub: "pnl" }, "/finance/profit"],
    [{ tab: "profit", sub: "orders" }, "/finance/leaks?leak=orders"],
    [{ tab: "targets" }, "/reports/people/targets"],
    [{ tab: "overview" }, "/reports"],
    [{ tab: "sales", from: "2026-01-01", to: "2026-03-31" }, "/reports/funnel?from=2026-01-01&to=2026-03-31&period=custom"],
  ])("the older ?tab= form %o → %s", (q, to) => expect(insightsTarget(q)).toBe(to));
});

describe("/reports/money and /reports", () => {
  it("Where we lose money → Finance › Leaks", () => {
    expect(reportsMoneyTarget({})).toBe("/finance/leaks");
    expect(reportsMoneyTarget({ view: "customers", from: "2026-01-01", to: "2026-06-30" })).toBe(
      "/finance/leaks?leak=customers&period=custom&from=2026-01-01&to=2026-06-30",
    );
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
