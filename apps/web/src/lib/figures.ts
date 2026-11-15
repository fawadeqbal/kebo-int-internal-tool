/**
 * How every figure on Home and Reports is made, in plain words: shown behind its ⓘ (HowMade), so a number can be
 * trusted and checked (audit plan, "each figure says how it is made"). One place, so a figure says the same thing
 * wherever it is shown. Each rule says what the API counts: when a rule changes there, change its words here (the
 * file is named above each group). A new line starts a new paragraph.
 */

/** The days a figure counts, and what its arrow compares them with, as phrases. */
export interface Span {
  /** "from 1 to 15 November", "from 1 Sep to 30 Nov 2026" */
  days: string;
  /** "the same days of October (1 to 15 October)", "the same length of time just before (1 Jun to 31 Aug 2026)" */
  vs: string;
}

const ORDER_RATE = (c: string) =>
  `Amounts in other currencies count in ${c} at each order's own rate, kept when the order was made, so a later rate in Settings never moves them.`;
const TODAY_RATE = (c: string) => `Other currencies count in ${c} at today's rate in Settings.`;
const ARROW = (s: Span) => `The arrow compares with ${s.vs}.`;

/* -------------------------------------------- the money (insights/facts, treasury/cash-report.service.ts) */

export const how = {
  /** order_facts: orders not cancelled, by order date, total_main. */
  sold: (s: Span, c: string) =>
    [
      `The orders with an order date ${s.days}, except cancelled ones, at what each was sold for (the order's total).`,
      ORDER_RATE(c),
      ARROW(s),
    ].join("\n"),

  /** Cash report "in": customers' money by the day it arrived, less money paid back to them (every row of the cash book). */
  collected: (s: Span, c: string) =>
    [
      `The money customers paid that arrived ${s.days}, counted on the day it arrived, less any money paid back to them. A payment not put on an account yet counts too.`,
      TODAY_RATE(c),
      ARROW(s),
    ].join("\n"),

  /** Without the cash book: what was paid on orders (allocations to orders), at each order's rate. */
  collectedOnOrders: (s: Span, c: string) =>
    [`What customers paid on orders ${s.days}, on the day each payment counted on its order.`, ORDER_RATE(c), ARROW(s)].join("\n"),

  /** Cash report "out": suppliers, bills of orders and company costs, on the day the money left. */
  paidOut: (s: Span, c: string) =>
    [
      `The money that left us ${s.days}: to suppliers, to freight and the other bills of orders, and for the company's own costs. A bill or a person paid back later counts on the day they were paid; money a supplier paid back comes off.`,
      TODAY_RATE(c),
      ARROW(s),
    ].join("\n"),

  /**
   * profit_expected_main of the orders of the span, less the costs on no order spent in the span (each at its own
   * rate). `marginBefore`: Home shows last month's whole % beside this one, and no arrow.
   */
  profit: (s: Span, c: string, marginBefore?: string) =>
    [
      `The orders with an order date ${s.days}: what they were sold for, less what they cost as known today (the factories' prices, freight and insurance to the basis they were sold on, bank charges and each order's other costs).`,
      `Then less the company's own costs spent in the same days: every cost on no order (rent, salaries, the office, and what was spent on customers and inquiries before an order), each at the rate it was paid at.`,
      `The % is that profit against what was sold on lines with a cost; a line with no cost yet is left out of the profit until it has one. ${ORDER_RATE(c)}`,
      marginBefore ? `Beside the %: ${marginBefore}'s, for the whole month.` : ARROW(s),
    ].join("\n"),

  /** profit_quote_main: what was sold less the goods and the basis costs on the quotation, for people who do not see costs. */
  grossProfit: (s: Span, c: string, marginBefore?: string) =>
    [
      `The orders with an order date ${s.days}: what they were sold for, less the goods (the factories' prices) and the freight and insurance they were sold with. The orders' other costs and the company's own costs are not taken off: you do not see costs.`,
      `The % is that profit against what was sold on lines with a cost. ${ORDER_RATE(c)}`,
      marginBefore ? `Beside the %: ${marginBefore}'s, for the whole month.` : ARROW(s),
    ].join("\n"),

  /** Cash report: open accounts' balances, today's rate. */
  cashNow: (c: string) =>
    [
      `What every open account holds today: its opening balance and every payment in and out of it since it opened, the same as on Money › Cash & bank. A closed account is left out.`,
      `${TODAY_RATE(c)} Each currency's own total is shown too.`,
    ].join("\n"),

  /* -------------------------------------------- Reports › Profit (lib/insights-data.ts loadProfit) */

  costsOfOrders: (s: Span, c: string) =>
    [
      `What the orders with an order date ${s.days} cost, as known today: the factories' prices, freight and insurance to the basis they were sold on, bank charges and each order's other costs (as on each order's Costs tab).`,
      `Only lines with a cost are counted. ${ORDER_RATE(c)}`,
    ].join("\n"),

  companyCosts: (s: Span) =>
    [
      `Every cost on no order spent ${s.days}, each at the rate it was paid at: running the company (rent, salaries, the office) and what was spent on customers and inquiries before an order.`,
      `It comes off the orders' profit to give the company's profit.`,
    ].join("\n"),

  profitOfReport: (s: Span, c: string) =>
    [
      `Sold, less the costs of the orders, less company costs: what the company made on the orders dated ${s.days}.`,
      `The % is that profit against what was sold on lines with a cost; a line with no cost yet is left out until it has one. ${ORDER_RATE(c)}`,
      ARROW(s),
    ].join("\n"),

  /* -------------------------------------------- Reports › Cash (treasury/cash-report.service.ts) */

  cameIn: (s: Span, c: string) =>
    [
      `The money customers paid that arrived ${s.days}, counted on the day it arrived, less any money paid back to them. A payment not put on an account yet counts too (the page says how many there are).`,
      TODAY_RATE(c),
    ].join("\n"),

  wentOut: (s: Span, c: string) =>
    [
      `The money that left us ${s.days}: to suppliers, to freight and the other bills of orders, and for the company's own costs. A bill or a person paid back later counts on the day they were paid; money a supplier paid back comes off.`,
      TODAY_RATE(c),
    ].join("\n"),

  net: (s: Span) => `Came in less went out, ${s.days}. Money moved between our own accounts is in neither.`,

  /* -------------------------------------------- Reports › Customers (lib/insights-data.ts loadCustomers) */

  customersWhoOrdered: (s: Span) =>
    [
      `The customers with at least one order (not cancelled) with an order date ${s.days}. New: their first order ever is in those days.`,
      ARROW(s),
    ].join("\n"),

  repeatShare: (s: Span) =>
    [
      `Of the orders dated ${s.days}, the share that came from customers who had ordered before those days began.`,
      `The arrow shows the change in points against ${s.vs}.`,
    ].join("\n"),

  averageOrder: (s: Span, c: string) =>
    [`What the orders dated ${s.days} were sold for, divided by how many there were.`, ORDER_RATE(c), ARROW(s)].join("\n"),

  /** `since`: "1 May 2026", the first day of the month six months back. */
  sleeping: (since: string, c: string) =>
    [
      `The customers whose last order is from before ${since}: no order in the last six months.`,
      `Below: what they bought from us in all, in ${c} at each order's own rate.`,
    ].join("\n"),

  /** Win rate on Reports › Overview, for people who do not see the cash: funnel of the span (inquiries that came in then). */
  winRate: (s: Span) =>
    [
      `Of the inquiries that came in ${s.days} and are decided, the share won (won ÷ won and lost). Inquiries still open are not counted.`,
      `The arrow shows the change in points against ${s.vs}.`,
    ].join("\n"),

  /* -------------------------------------------- Reports › Spending (money/accounts.service.ts spendingReport) */

  spentToSell: (s: Span, c: string) =>
    [
      `Trips, hotels, meals, gifts, samples, courier and checks spent ${s.days} on a customer, an inquiry or an order, each in ${c} at the rate it was paid at.`,
      `The company's own costs (rent, salaries, the office) are not in it: they are on Money › Company costs.`,
      ARROW(s),
    ].join("\n"),

  onDealsWon: (s: Span) => `The part of "Spent to sell" (${s.days}) that was spent on orders, or on inquiries that became an order.`,

  lostDeals: (s: Span) => `Everything spent ${s.days} on inquiries that were lost and never became an order, whatever it was spent on.`,

  per100: (s: Span, c: string) => `"Spent to sell" for every ${c} 100 that the orders dated ${s.days} were sold for.`,

  owedBack: (c: string) =>
    `What people paid from their own money and have not been paid back yet, whenever it was spent, in ${c} at the rate it was paid at. A cost on an order that was cancelled since is left out.`,

  /* -------------------------------------------- Home's cards (insights/home.service.ts, home-rules.ts) */

  standsOut:
    "Five checks worked out from the numbers, none typed and none from AI: sales against the same days of last month; customers with a part past its date; a kind of cost growing as a share of sales; a supplier late on two of its last three ready dates; quotations waiting with customers.\nA check says nothing when its rule does not fire. The red ones come first.",

  nextWeeks: (c: string) =>
    [
      `It starts from cash now. Coming in: what customers still owe, each part in the week it is due (a part already late counts in this week; a part with no date yet is not counted).`,
      `Going out: what we owe factories, each part in the week it is due; the company's monthly costs on their usual day; and bills and people to pay back, all in this week.`,
      `"Cash after" is what would be left if everyone paid on their date. In ${c}: orders at their own rate, costs at the rate they were recorded with, cash at today's rate in Settings.`,
    ].join("\n"),

  /** `months`: which months ("The last six months.", "The 12 months up to the end of the period."). */
  byMonth: (c: string, afterCompanyCosts: boolean, months = "The last six months.") =>
    [
      `${months} Each order counts in the month of its order date, at what it was sold for; cancelled orders are left out.`,
      afterCompanyCosts
        ? `Profit: what those orders make as known today, less the company's own costs spent in that month (as in "Profit this month").`
        : `Gross profit: what those orders were sold for, less the goods and the freight and insurance they were sold with.`,
      ORDER_RATE(c),
    ].join("\n"),

  ordersNow: (c: string) =>
    [
      `The open orders, by the stage each is at now, with what they were sold for. "Late to pay": an order with a part past its due date and not paid.`,
      `"Past the ready date": goods the factory promised for a day that has gone, not ready yet. ${ORDER_RATE(c)}`,
    ].join("\n"),

  inquiriesNow:
    "The open inquiries, by the stage each is at now. Quoted: a quotation was sent and the customer has not answered; its worth is what was quoted.\nWon: of the inquiries answered (won or lost) in the last three months, how many were won; beside it, the rate of the three months before.",

  customersOwe:
    "Every order that still has money to come from its customer: its total and any charges, less what was paid, in the order's own currency. The most days late first, then by the day the next part is due.",

  /** Reports › Overview: the factories' parts late or due within 7 days (billing/to-pay), and the bills that wait (money/bills). */
  toPaySoon:
    "What we owe factories with a part late or due in the next 7 days, and every bill and person to pay back that waits now, each in its own currency. The most days late first.",

  /** Reports › Overview: orders of the period still open, margin under 10 (lib/insights-data.ts loadOverview). */
  thinOfPeriod: (s: Span) =>
    `The orders dated ${s.days} that are still open, whose profit now is under 10% of what was sold on lines with a cost, the lowest first. Profit now: what the order was sold for, less what it costs as known today (as on its Costs tab).`,

  thinProfit:
    "Open orders whose profit now is under 10% of what was sold on lines with a cost, the lowest first. Profit now: what the order was sold for, less what it costs as known today (as on its Costs tab).",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "1 Sep", with the year when asked: "30 Nov 2026". */
const dayOf = (iso: string, year: boolean) =>
  `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}${year ? ` ${iso.slice(0, 4)}` : ""}`;
/** "from 1 Sep to 30 Nov 2026" ("on 3 Nov 2026" for one day; the first year too when the years differ). */
const between = (from: string, to: string) =>
  from === to ? `on ${dayOf(to, true)}` : `from ${dayOf(from, from.slice(0, 4) !== to.slice(0, 4))} to ${dayOf(to, true)}`;

/** Home: this month so far, against the same days of last month (to its last day when it is shorter). */
export function homeSpan(today: string, monthName: string, beforeName: string): Span {
  const day = Number(today.slice(8, 10));
  const lastDay = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, 0)).getUTCDate();
  const dayBefore = Math.min(day, lastDay);
  const days = (d: number, name: string) => (d === 1 ? `on 1 ${name}` : `from 1 to ${d} ${name}`);
  return { days: days(day, monthName), vs: `the same days of ${beforeName} (${days(dayBefore, beforeName).replace(/^(on|from) /, "")})` };
}

/** Reports: the period chosen, against the same length of time just before it. */
export function reportSpan(p: { from: string; to: string; prevFrom: string; prevTo: string }): Span {
  return {
    days: between(p.from, p.to),
    vs: `the same length of time just before (${between(p.prevFrom, p.prevTo).replace(/^(on|from) /, "")})`,
  };
}

/** "1 May 2026": the first day of the month six months before `today` (Reports › Customers, Sleeping). */
export function sixMonthsBack(today: string): string {
  const d = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 - 6, 1));
  return dayOf(d.toISOString().slice(0, 10), true);
}
