import { describe, expect, it } from "vitest";
import { costSentence, lateSentence, quotesSentence, salesSentence, standoutOf, supplierSentence, weeksAhead } from "../src/modules/insights/home-rules";

/**
 * Money, step 6: Home's "What stands out" and "Cash in the next four weeks". Each sentence is one comparison
 * with one rule; it is said only when the rule fires. No database: the rules are plain functions.
 */
const money = (minor: number) => `USD ${Math.round(minor / 100).toLocaleString("en-US")}`;
const usd = (n: number) => n * 100;

describe("what stands out: sales", () => {
  const big = { refNo: "SO-2026-0412", customer: "Lagos Water", sold: usd(184_200) };

  it("says sales are up against the same days of last month, and names an order that is more than half", () => {
    expect(salesSentence({ now: usd(268_000), before: usd(164_100), biggest: big, lastMonth: "October", money })).toMatchObject({
      level: "ok",
      lead: "Sales are up.",
      text: "USD 268,000 sold this month against USD 164,100 by this day in October. SO-2026-0412 (Lagos Water) is 69% of it.",
      href: "/reports/profit?period=month",
    });
    // Half or less: the order is not named.
    expect(salesSentence({ now: usd(268_000), before: usd(164_100), biggest: { ...big, sold: usd(134_000) }, lastMonth: "October", money })!.text).toBe(
      "USD 268,000 sold this month against USD 164,100 by this day in October.",
    );
  });

  it("says sales are down as a warning, without naming an order", () => {
    expect(salesSentence({ now: usd(90_000), before: usd(150_000), biggest: big, lastMonth: "October", money })).toMatchObject({
      level: "warn",
      lead: "Sales are down.",
      text: "USD 90,000 sold this month against USD 150,000 by this day in October.",
    });
  });

  it("says nothing for a change under 10%, or when nothing was sold in either month", () => {
    expect(salesSentence({ now: usd(105_000), before: usd(100_000), biggest: big, lastMonth: "October", money })).toBeNull();
    expect(salesSentence({ now: usd(91_000), before: usd(100_000), biggest: big, lastMonth: "October", money })).toBeNull();
    expect(salesSentence({ now: 0, before: 0, biggest: null, lastMonth: "October", money })).toBeNull();
  });

  it("with nothing by this day last month, says sales have started (no percentage of nothing)", () => {
    expect(salesSentence({ now: usd(40_000), before: 0, biggest: null, lastMonth: "October", money })).toMatchObject({
      lead: "Sales have started.",
      text: "USD 40,000 sold this month; nothing was sold by this day in October.",
    });
  });
});

describe("what stands out: late customers", () => {
  const karachi = { name: "Karachi Builders", amount: usd(44_800), days: 12, paidLate: 2, paid: 3 };

  it("adds up everyone late, names the oldest, and says when they paid late before", () => {
    const s = lateSentence([karachi, { name: "Accra Water", amount: usd(11_550), days: 4, paidLate: 0, paid: 1 }, { name: "Kampala Juices", amount: usd(4_950), days: 1, paidLate: 0, paid: 0 }], money);
    expect(s).toMatchObject({
      level: "bad",
      lead: "Three customers are late with USD 61,300.",
      text: "Karachi Builders is the oldest: 12 days, and they paid late on 2 of 3 orders before.",
      href: "/money/due?show=late",
    });
  });

  it("one customer, one day, no history: plain words", () => {
    expect(lateSentence([{ name: "Accra Water", amount: usd(500), days: 1, paidLate: 0, paid: 2 }], money)).toMatchObject({
      lead: "One customer is late with USD 500.",
      text: "Accra Water: 1 day.",
    });
    expect(lateSentence([], money)).toBeNull();
  });
});

describe("what stands out: a cost that grows", () => {
  const kinds = [
    { label: "Sea / air freight", now: usd(14_472), before: usd(6_728) },
    { label: "Inspection", now: usd(2_700), before: usd(1_600) },
    { label: "Rent", now: usd(3_000), before: usd(3_000) },
  ];

  it("names the kind whose share of what was sold rose most, when it rose by a point or more", () => {
    expect(costSentence({ kinds, soldNow: usd(268_000), soldBefore: usd(164_100), lastMonth: "October" })).toMatchObject({
      level: "warn",
      lead: "Sea / air freight is taking more.",
      text: "It took 5.4% of what we sold this month, 4.1% in October.",
    });
  });

  it("says nothing when no kind rose by a point, or when a month sold nothing", () => {
    expect(costSentence({ kinds: [kinds[1]!, kinds[2]!], soldNow: usd(268_000), soldBefore: usd(164_100), lastMonth: "October" })).toBeNull();
    expect(costSentence({ kinds, soldNow: usd(268_000), soldBefore: 0, lastMonth: "October" })).toBeNull();
    expect(costSentence({ kinds, soldNow: 0, soldBefore: usd(164_100), lastMonth: "October" })).toBeNull();
  });
});

describe("what stands out: a supplier late again, and quotations waiting", () => {
  it("a supplier is named from two missed ready dates in its last three", () => {
    expect(supplierSentence({ name: "Henan Pack", judged: 3, late: 2, lateNow: "SO-2026-0405", daysNow: 2 })).toMatchObject({
      level: "warn",
      lead: "Henan Pack is late again.",
      text: "Late on the ready date in 2 of its last 3 orders; SO-2026-0405 is 2 days late now.",
    });
    expect(supplierSentence({ name: "Henan Pack", judged: 2, late: 2, lateNow: null, daysNow: null })!.text).toBe("Late on the ready date in 2 of its last 2 orders.");
    expect(supplierSentence({ name: "Henan Pack", judged: 3, late: 1, lateNow: "SO-2026-0405", daysNow: 2 })).toBeNull();
    expect(supplierSentence(undefined)).toBeNull();
  });

  it("quotations: to know when fresh, to look at when some were sent more than a week ago", () => {
    expect(quotesSentence({ count: 5, value: usd(280_400), old: 2 }, money)).toMatchObject({
      level: "warn",
      lead: "Five quotations wait for an answer,",
      text: "worth USD 280,400. Two were sent more than 7 days ago.",
    });
    expect(quotesSentence({ count: 1, value: usd(9_000), old: 0 }, money)).toMatchObject({ level: "info", lead: "One quotation waits for an answer,", text: "worth USD 9,000." });
    expect(quotesSentence({ count: 12, value: usd(1), old: 1 }, money)!.lead).toBe("12 quotations wait for an answer,");
    expect(quotesSentence({ count: 0, value: 0, old: 0 }, money)).toBeNull();
  });

  it("at most five are shown, what needs acting on first", () => {
    const all = standoutOf([
      quotesSentence({ count: 1, value: usd(9_000), old: 0 }, money),
      salesSentence({ now: usd(200), before: usd(100), biggest: null, lastMonth: "October", money }),
      null,
      supplierSentence({ name: "Henan Pack", judged: 3, late: 2, lateNow: null, daysNow: null }),
      lateSentence([{ name: "Accra Water", amount: usd(500), days: 1, paidLate: 0, paid: 0 }], money),
    ]);
    expect(all.map((s) => `${s.level} ${s.key}`)).toEqual(["bad late", "warn supplier", "ok sales", "info quotes"]);
  });
});

describe("cash in the next four weeks", () => {
  const base = { today: "2026-11-20" as const, cashNow: usd(209_140), comingIn: [], goingOut: [], waiting: 0, repeating: [] };

  it("is four weeks of seven days from today, and each week's cash is the one before, plus in, less out", () => {
    const w = weeksAhead({
      ...base,
      comingIn: [
        { dueOn: "2026-11-20", minor: usd(70_000) },
        { dueOn: "2026-11-27", minor: usd(31_997) },
        { dueOn: "2026-12-05", minor: usd(128_940) },
      ],
      goingOut: [
        { dueOn: "2026-11-26", minor: usd(12_650) },
        { dueOn: "2026-12-10", minor: usd(78_620) },
        { dueOn: "2026-12-17", minor: usd(43_572) },
      ],
    });
    expect(w.map((x) => `${x.from}..${x.to}`)).toEqual(["2026-11-20..2026-11-26", "2026-11-27..2026-12-03", "2026-12-04..2026-12-10", "2026-12-11..2026-12-17"]);
    expect(w.map((x) => [x.in / 100, x.out / 100, x.after / 100])).toEqual([
      [70_000, 12_650, 266_490],
      [31_997, 0, 298_487],
      [128_940, 78_620, 348_807],
      [0, 43_572, 305_235],
    ]);
  });

  it("what is already late counts this week; what is due after the four weeks is left out", () => {
    const w = weeksAhead({
      ...base,
      comingIn: [
        { dueOn: "2026-11-08", minor: usd(44_800) },
        { dueOn: "2026-12-18", minor: usd(999_999) },
      ],
      goingOut: [{ dueOn: "2026-11-16", minor: usd(7_600) }],
      waiting: usd(6_400),
    });
    expect([w[0]!.in, w[0]!.out]).toEqual([usd(44_800), usd(14_000)]);
    expect(w.slice(1).every((x) => x.in === 0 && x.out === 0)).toBe(true);
    expect(w[3]!.after).toBe(usd(209_140 + 44_800 - 14_000));
  });

  it("a cost that repeats counts on its day: this month if it is not in yet, and next month", () => {
    const rent = { lastOn: "2026-10-25", minor: usd(3_000), skip: null };
    // The 25th of November is in the first week, the 25th of December is after the four weeks.
    expect(weeksAhead({ ...base, repeating: [rent] }).map((x) => x.out / 100)).toEqual([3_000, 0, 0, 0]);
    // Already in for November (its latest is this month's): only December's, here on the 5th.
    expect(weeksAhead({ ...base, repeating: [{ lastOn: "2026-11-05", minor: usd(8_000), skip: null }] }).map((x) => x.out / 100)).toEqual([0, 0, 8_000, 0]);
    // November was skipped; a day already past this month counts this week.
    expect(weeksAhead({ ...base, repeating: [{ ...rent, skip: "2026-11" }] }).map((x) => x.out / 100)).toEqual([0, 0, 0, 0]);
    expect(weeksAhead({ ...base, repeating: [{ lastOn: "2026-10-03", minor: usd(500), skip: null }] }).map((x) => x.out / 100)).toEqual([500, 500, 0, 0]);
  });

  it("the 31st comes on the last day of a shorter month", () => {
    const w = weeksAhead({ ...base, today: "2026-11-25", repeating: [{ lastOn: "2026-10-31", minor: usd(100), skip: null }] });
    expect(w.map((x) => x.out / 100)).toEqual([100, 0, 0, 0]);
  });
});
