import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { periodOf } from "@/lib/insights-period";
import type { CashReport } from "@/lib/types-facts";

// Reports › Profit and Reports › Cash (money, step 5): the two money tabs of the one Reports page.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api", () => ({ api: { get: vi.fn() } }));

const { ProfitSection } = await import("@/components/insights/profit-section");
const { CashSection } = await import("@/components/insights/cash-section");

const p = periodOf({}, "2026-11-14");
const line = (orders: number, sold: number, costs: number, company: number) => {
  const fromOrders = sold - costs;
  const profit = fromOrders - company;
  return { orders, sold, uncosted: 0, costs, fromOrders, company, profit, margin: sold ? Math.round((profit / sold) * 1000) / 10 : null };
};
const order = (refNo: string, sold: number, costs: number, stage = "confirmed") => ({
  orderId: refNo,
  refNo,
  customer: `Customer of ${refNo}`,
  customerId: "c",
  status: "open",
  stage,
  orderedOn: "2026-11-02",
  sold,
  costs,
  profit: sold - costs,
  margin: Math.round(((sold - costs) / sold) * 1000) / 10,
  uncosted: 0,
});
const profit = {
  currency: "USD",
  months: [{ month: "2026-10", ...line(1, 1000, 900, 150) }, { month: "2026-11", ...line(2, 3000, 2400, 100) }],
  total: line(3, 4000, 3300, 250),
  totalBefore: line(1, 2000, 1500, 100),
  orders: [order("SO-1", 1000, 1100), order("SO-2", 1000, 950, "shipped"), order("SO-3", 2000, 1250)],
  missingRates: [],
  sheets: [],
};
const cells = (row: HTMLElement) => within(row).getAllByRole("cell").map((c) => c.textContent);

describe("Reports › Profit", () => {
  const show = (page = 1) => render(<ProfitSection d={profit} p={p} sort="low" page={page} base="/reports/profit" params={{}} href={(q) => `/reports/profit?${new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => e[1] !== undefined))}`} />);

  it("says the company's profit: sold, less the orders' costs, less the company's own costs", () => {
    show();
    // The four figures at the top (the same words head the table's columns below).
    expect(screen.getByText("USD 3,300")).toBeTruthy();
    expect(screen.getByText("USD 250").closest("a")!.getAttribute("href")).toBe("/money/company-costs");
    expect(screen.getByText("USD 450")).toBeTruthy();
    expect(screen.getByText("11.3% of what was sold")).toBeTruthy();
  });

  it("by month, a month that loses money shows it with a minus and in red, and the total adds up", () => {
    show();
    const table = within(screen.getByText("By month").closest("div")!.parentElement!.parentElement!);
    const oct = table.getByText("Oct 2026").closest("tr")!;
    expect(cells(oct)).toEqual(["Oct 2026", "1", "1,000.00", "900.00", "100.00", "150.00", "− 50.00", "− 5%"]);
    expect(within(oct).getByText("− 50.00").className).toContain("text-bad");
    expect(cells(table.getByText("Total").closest("tr")!)).toEqual(["Total", "3", "4,000.00", "3,300.00", "700.00", "250.00", "450.00", "11.3%"]);
  });

  it("by order, each opens its Costs tab; a thin one is marked, a loss is red", () => {
    show();
    const row = (ref: string) => screen.getByRole("link", { name: ref }).closest("tr")!;
    expect(screen.getByRole("link", { name: "SO-1" }).getAttribute("href")).toBe("/orders/SO-1/costs");
    // (On a phone the customer is under the order's number and its own column is hidden.)
    expect(cells(row("SO-1"))).toEqual(["SO-1Customer of SO-1", "Customer of SO-1", "Confirmed", "1,000.00", "1,100.00", "− 100.00", "− 10%"]);
    expect(within(row("SO-1")).getByText("− 100.00").className).toContain("text-bad");
    expect(within(row("SO-2")).getByText("50.00").className).toContain("text-warn");
    expect(within(row("SO-3")).getByText("750.00").className).toContain("text-ok");
    expect(screen.getByRole("link", { name: "Biggest orders first" }).getAttribute("href")).toBe("/reports/profit?sort=big#orders");
  });
});

const cash: CashReport = {
  currency: "USD",
  from: "2026-09-01",
  to: "2026-11-14",
  today: "2026-11-14",
  months: [
    { month: "2026-10", customers: "5000.00", suppliers: "6000.00", bills: "300.00", company: "200.00", net: "-1500.00", cashEnd: "8500.00" },
    { month: "2026-11", customers: "4000.00", suppliers: "1000.00", bills: "0.00", company: "200.00", net: "2800.00", cashEnd: "11300.00" },
  ],
  total: { customers: "9000.00", suppliers: "7000.00", bills: "300.00", company: "400.00", net: "1300.00" },
  in: { amount: "9000.00", entries: 4 },
  out: { amount: "7700.00", entries: 9 },
  cashNow: "11300.00",
  byCurrency: [{ currency: "USD", accounts: 1, amount: "11300.00", inMain: "11300.00" }],
  accounts: [
    { id: "a1", name: "Bank of China", currency: "USD", archived: false, openedOn: null, start: "10000.00", in: "9000.00", out: "7700.00", end: "11300.00", now: "11300.00" },
    { id: "a2", name: "Office cash", currency: "CNY", archived: false, openedOn: "2026-10-05", start: "500.00", in: "0.00", out: "620.00", end: "-120.00", now: "-120.00" },
  ],
  offAccount: 0,
  missingRates: [],
};

describe("Reports › Cash", () => {
  it("by month: what came in, where it went, and what the accounts held at the end", () => {
    render(<CashSection r={cash} p={p} />);
    expect(cells(screen.getByText("Oct 2026").closest("tr")!)).toEqual(["Oct 2026", "5,000.00", "6,000.00", "300.00", "200.00", "− 1,500.00", "8,500.00"]);
    expect(within(screen.getByText("Oct 2026").closest("tr")!).getByText("− 1,500.00").className).toContain("text-bad");
    expect(cells(screen.getByText("Total").closest("tr")!)).toEqual(["Total", "9,000.00", "7,000.00", "300.00", "400.00", "1,300.00", ""]);
    expect(screen.queryByText(/on no account yet/)).toBeNull();
  });

  it("by account, each opens its cash book; while the period runs the last column is Now", () => {
    render(<CashSection r={cash} p={p} />);
    const link = screen.getByRole("link", { name: "Bank of China · USD" });
    expect(link.getAttribute("href")).toBe("/finance/cash-book?acct=a1");
    expect(cells(link.closest("tr")!)).toEqual(["Bank of China · USD", "USD 10,000.00", "9,000.00", "7,700.00", "USD 11,300.00"]);
    expect(screen.getByRole("columnheader", { name: "Now" })).toBeTruthy();
    const office = screen.getByRole("link", { name: "Office cash · CNY" }).closest("tr")!;
    expect(office.textContent).toContain("opened 05 Oct 2026");
    expect(within(office).getByText("CNY − 120.00").className).toContain("text-bad");
  });

  it("a period that is over ends with At the end; money on no account is said, with where to put it", () => {
    render(<CashSection r={{ ...cash, to: "2026-10-31", offAccount: 3 }} p={p} />);
    expect(screen.getByRole("columnheader", { name: "At the end" })).toBeTruthy();
    expect(screen.getByText(/3 payments of this period are on no account yet/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Put them on an account" }).getAttribute("href")).toBe("/finance/cash-book?acct=none");
  });
});
