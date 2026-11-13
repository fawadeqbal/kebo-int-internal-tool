import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { HomeFigures, Receivables, Reminders } from "@/lib/types-insights";

// Home (money, step 6): the cards of the board, each from figures already read.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { CustomersOwe, InquiriesNow, MonthFigures, NeedsYou, NextWeeks, OrdersNow, StandsOut, ThinProfit } = await import("@/components/home/board");

const h: HomeFigures = {
  currency: "USD",
  today: "2026-11-20",
  seeMoney: true,
  seeProfit: true,
  month: {
    name: "November",
    before: "October",
    sold: { now: "268000.00", before: "164100.00", orders: 4 },
    collected: { now: "96410.00", before: "168150.00", payments: 5 },
    profit: { now: "50523.00", margin: 18.9, marginBefore: 18, afterCompanyCosts: true },
    cash: { total: "209140.00", byCurrency: [{ currency: "USD", accounts: 2, amount: "158811.00", inMain: "158811.00" }, { currency: "CNY", accounts: 2, amount: "321297.00", inMain: "44317.00" }] },
  },
  standout: [
    { key: "late", level: "bad", lead: "Three customers are late with USD 61,300.", text: "Karachi Builders is the oldest: 12 days.", href: "/money/due?show=late", link: "Who owes" },
    { key: "sales", level: "ok", lead: "Sales are up.", text: "USD 268,000 sold this month against USD 164,100 by this day in October.", href: "/reports/profit?period=month", link: "Profit" },
  ],
  weeks: [
    { from: "2026-11-20", to: "2026-11-26", in: "70000.00", out: "12650.00", after: "266490.00" },
    { from: "2026-11-27", to: "2026-12-03", in: "31997.00", out: "1460.00", after: "297027.00" },
    { from: "2026-12-04", to: "2026-12-10", in: "0.00", out: "320000.00", after: "-22973.00" },
    { from: "2026-12-11", to: "2026-12-17", in: "128940.00", out: "43572.00", after: "62395.00" },
  ],
  months: [],
  orders: {
    open: 12,
    value: "739410.00",
    stages: [
      { key: "confirmed", label: "Confirmed", count: 3, value: "129710.00", note: "1 late to pay", level: "bad" },
      { key: "in_production", label: "In production", count: 5, value: "421300.00", note: "2 ready in the next 14 days", level: null },
      { key: "shipped", label: "Shipped", count: 4, value: "188400.00", note: "on the way", level: null },
      { key: "done", label: "Delivered", count: 0, value: "0.00", note: "paid, to close", level: null },
    ],
  },
  thin: {
    count: 6,
    rows: [
      { orderId: "o1", refNo: "SO-2026-0391", customer: "Karachi Builders", sold: "64000.00", costs: "64774.00", profit: "-774.00", margin: -1.2 },
      { orderId: "o2", refNo: "SO-2026-0398", customer: "Accra Water", sold: "38500.00", costs: "36920.00", profit: "1580.00", margin: 4.1 },
    ],
    others: 11,
    othersFrom: 15.2,
  },
  inquiries: {
    open: 20,
    stages: [
      { key: "new", label: "New", count: 6, value: null, note: "not asked from factories yet", level: null },
      { key: "sourcing", label: "Waiting for prices", count: 9, value: null, note: "2 waiting more than 7 days", level: "warn" },
      { key: "quoted", label: "Quoted", count: 5, value: "280400.00", note: "2 sent more than 7 days ago", level: "warn" },
    ],
    won: { won: 9, answered: 21, rate: 42.9, rateBefore: 38 },
  },
};
const link = (name: string | RegExp) => screen.getByRole("link", { name });

describe("Home: the month and what stands out", () => {
  it("four figures, each opening the report behind it", () => {
    render(<MonthFigures h={h} />);
    expect(link(/Sold this month/).getAttribute("href")).toBe("/reports/profit?period=month");
    expect(link(/Sold this month/).textContent).toContain("USD 268,000");
    expect(link(/Collected this month/).textContent).toContain("5 payments");
    expect(link(/Profit this month/).textContent).toContain("18.9% · October 18%");
    expect(link(/Cash now/).textContent).toContain("USD 158,811 · CNY 321,297");
    expect(link(/Cash now/).getAttribute("href")).toBe("/finance/cash-book");
  });

  it("someone who does not see money gets the figures they may see", () => {
    render(<MonthFigures h={{ ...h, seeProfit: false, month: { ...h.month, collected: null, cash: null, profit: { ...h.month.profit, afterCompanyCosts: false } } }} />);
    expect(screen.queryByText("Collected this month")).toBeNull();
    expect(screen.queryByText("Cash now")).toBeNull();
    expect(screen.getByText("Gross profit this month")).toBeTruthy();
  });

  it("the sentences are shown as given, each with the page behind it; with none, it says so", () => {
    const { unmount } = render(<StandsOut h={h} />);
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.querySelector("strong")!.textContent)).toEqual(["Three customers are late with USD 61,300.", "Sales are up."]);
    expect(within(items[0]!).getByRole("link").getAttribute("href")).toBe("/money/due?show=late");
    unmount();
    render(<StandsOut h={{ ...h, standout: [] }} />);
    expect(screen.getByText(/Nothing unusual/)).toBeTruthy();
  });
});

describe("Home: what needs you", () => {
  const item = (n: number, level = "warn") => ({ key: `k${n}`, kind: "money" as const, level: level as Reminders["items"][number]["level"], title: `Thing ${n} by 2026-11-0${n}`, detail: n === 1 ? "USD 44,800.00 · 12 days late" : null, due: null, href: `/orders/o${n}/payment`, action: n === 1 ? "Record payment" : "Open the order", who: null });

  it("the five most urgent, each with its button, and the rest behind one link", () => {
    render(<NeedsYou r={{ items: [1, 2, 3, 4, 5, 6, 7].map((n) => item(n)), counts: { total: 7, bad: 0, hidden: 0 } }} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(link("Record payment").getAttribute("href")).toBe("/orders/o1/payment");
    expect(screen.getByText(/Thing 1 by 01 Nov/)).toBeTruthy();
    expect(link(/2 more/).getAttribute("href")).toBe("/notifications");
  });

  it("with nothing waiting, it says so", () => {
    render(<NeedsYou r={{ items: [], counts: { total: 0, bad: 0, hidden: 0 } }} />);
    expect(screen.getByText("Nothing needs you right now.")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("Home: cash, orders, inquiries", () => {
  it("the four weeks name the lowest point, in red when the cash would run out", () => {
    render(<NextWeeks h={h} />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell").map((c) => c.textContent))).toEqual([
      ["20 – 26 Nov", "70,000", "12,650", "266,490"],
      ["27 Nov – 3 Dec", "31,997", "1,460", "297,027"],
      ["4 – 10 Dec", "0", "320,000", "− 22,973"],
      ["11 – 17 Dec", "128,940", "43,572", "62,395"],
    ]);
    const lowest = screen.getByText("− USD 22,973");
    expect(lowest.className).toContain("text-bad");
    expect(lowest.parentElement!.textContent).toContain("in the week of 4 Dec");
    expect(link(/To receive and to pay/).getAttribute("href")).toBe("/money/due");
  });

  it("is left out for someone who does not see the cash", () => {
    const { container } = render(<NextWeeks h={{ ...h, weeks: null }} />);
    expect(container.textContent).toBe("");
  });

  it("orders by stage: how many, what to know (red when late), what they are worth", () => {
    render(<OrdersNow h={h} />);
    expect(screen.getByText("12 open · USD 739,410")).toBeTruthy();
    expect(screen.getByText("1 late to pay").className).toContain("text-bad");
    expect(screen.getByText("USD 421,300")).toBeTruthy();
    // An empty stage says none and shows no amount.
    const delivered = screen.getByText("Delivered").closest("a")!;
    expect(delivered.textContent).toBe("Delivered0none");
  });

  it("inquiries by stage, with the share won of those answered", () => {
    render(<InquiriesNow h={h} />);
    expect(screen.getByText("2 waiting more than 7 days").className).toContain("text-warn");
    expect(screen.getByText("Quoted").closest("a")!.getAttribute("href")).toBe("/inquiries?stage=quoted");
    expect(screen.getByText(/Won in the last three months/).textContent).toBe("Won in the last three months: 9 of 21 answered · 42.9%, was 38%.");
  });
});

describe("Home: who owes, and thin orders", () => {
  const row = (id: string, name: string, due: string, daysLate: number, dueOn: string | null) => ({ id, refNo: `SO-${id}`, customer: { id: `c${id}`, name }, handledBy: null, stage: "confirmed" as const, closed: false, currency: "USD", total: "100000.00", received: "0.00", due, overdue: daysLate > 0 ? due : "0.00", daysLate, next: { label: "Deposit", open: due, dueOn, status: "open" }, lastPaid: null });
  const owed: Receivables = {
    rows: [row("3", "Lagos Water", "128940.00", 0, "2026-12-05"), row("1", "Karachi Builders", "44800.00", 12, "2026-11-08"), row("2", "Accra Water", "11550.00", 4, "2026-11-16"), row("4", "Kampala Juices", "13650.00", 0, "2026-11-20"), row("5", "Peshawar Mills", "9000.00", 0, null)],
    totals: [{ currency: "USD", due: "207940.00", overdue: "56350.00" }],
  };

  it("late customers first (the oldest first), then by the next date; four lines and a link to all", () => {
    render(<CustomersOwe r={owed} />);
    const names = screen.getAllByRole("listitem").map((li) => li.querySelector("span span")!.textContent);
    expect(names).toEqual(["Karachi Builders", "Accra Water", "Kampala Juices", "Lagos Water"]);
    expect(screen.getByText("USD 44,800").className).toContain("text-bad");
    expect(screen.getByText("SO-1 · 12 days late")).toBeTruthy();
    expect(link(/All 5/).getAttribute("href")).toBe("/money/due");
    expect(screen.getByText("Karachi Builders").closest("a")!.getAttribute("href")).toBe("/orders/1/payment");
  });

  it("thin orders open their Costs tab; a loss shows its costs against what was sold", () => {
    render(<ThinProfit h={h} />);
    expect(screen.getByText("SO-2026-0391 · Karachi Builders").closest("a")!.getAttribute("href")).toBe("/orders/o1/costs");
    expect(screen.getByText("costs USD 64,774 on USD 64,000")).toBeTruthy();
    expect(screen.getByText("− USD 774").className).toContain("text-bad");
    expect(screen.getByText("profit 4.1% of the order")).toBeTruthy();
    expect(screen.getByText("USD 1,580").className).toContain("text-warn");
    expect(screen.getByText(/4 more under 10%\. The other 11 open orders make 10% or more\./)).toBeTruthy();
  });
});
