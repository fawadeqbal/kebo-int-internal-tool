import { roundHalfAway, type Minor } from "@kebo/money";
import type { ISODate } from "@kebo/utils";

/*
 * Home's "What stands out" and "Cash in the next four weeks", as plain functions of numbers already read:
 * each sentence is one comparison with one rule, said only when the rule fires. Nothing here reads the
 * database, so every rule is tested on its own (test/home-rules.test.ts).
 */

/** A sentence of "What stands out". */
export interface Standout {
  key: "sales" | "late" | "cost" | "supplier" | "quotes";
  /** bad: act on it · warn: look at it · ok: good news · info: to know. */
  level: "bad" | "warn" | "ok" | "info";
  /** The bold start of the sentence. */
  lead: string;
  text: string;
  href: string;
  link: string;
}

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
/** "Three", "12": a count at the start of a sentence. */
export const countWord = (n: number) => WORDS[n] ?? String(n);
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);
const pct = (part: Minor, whole: Minor) => (whole > 0 ? roundHalfAway((part / whole) * 1000) / 10 : null);
export const addDays = (day: ISODate, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10) as ISODate;
/** The first day of the month `n` months after `day`'s. */
export const monthStart = (day: ISODate, n = 0) => {
  const d = new Date(`${day.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10) as ISODate;
};

type Money = (minor: Minor) => string;

/**
 * Sales against the same days of last month: said from a change of 10%, or when last month had nothing by
 * this day. Going up, the biggest order is named when it is more than half of the month.
 */
export function salesSentence(a: { now: Minor; before: Minor; biggest: { refNo: string; customer: string; sold: Minor } | null; lastMonth: string; money: Money }): Standout | null {
  if (a.now <= 0 && a.before <= 0) return null;
  const by = `by this day in ${a.lastMonth}`;
  const share = a.biggest && a.now > 0 ? Math.round((a.biggest.sold / a.now) * 100) : 0;
  const driver = share > 50 ? ` ${a.biggest!.refNo} (${a.biggest!.customer}) is ${share}% of it.` : "";
  const to = { href: "/reports/profit?period=month", link: "Profit" };
  if (a.before <= 0) return { key: "sales", level: "ok", lead: "Sales have started.", text: `${a.money(a.now)} sold this month; nothing was sold ${by}.${driver}`, ...to };
  const change = Math.round(((a.now - a.before) / a.before) * 100);
  if (Math.abs(change) < 10) return null;
  return {
    key: "sales",
    level: change > 0 ? "ok" : "warn",
    lead: change > 0 ? "Sales are up." : "Sales are down.",
    text: `${a.money(a.now)} sold this month against ${a.money(a.before)} ${by}.${change > 0 ? driver : ""}`,
    ...to,
  };
}

/** Customers with a part past its date (the longest wait first): how many, how much, and whether the oldest paid late before. */
export function lateSentence(rows: { name: string; amount: Minor; days: number; paidLate: number; paid: number }[], money: Money): Standout | null {
  const o = rows[0];
  if (!o) return null;
  const total = rows.reduce((t, r) => t + r.amount, 0);
  const history = o.paid > 0 && o.paidLate > 0 ? `, and they paid late on ${o.paidLate} of ${o.paid} ${plural(o.paid, "order")} before` : "";
  const wait = `${o.days} ${plural(o.days, "day")}`;
  return {
    key: "late",
    level: "bad",
    lead: `${countWord(rows.length)} ${plural(rows.length, "customer is", "customers are")} late with ${money(total)}.`,
    text: rows.length === 1 ? `${o.name}: ${wait}${history}.` : `${o.name} is the oldest: ${wait}${history}.`,
    href: "/money/due?show=late",
    link: "Who owes",
  };
}

/**
 * A kind of cost as a share of what was sold, this month against last: said for the kind that rose most,
 * when it rose by a point or more. Needs sales in both months (a share of nothing says nothing).
 */
export function costSentence(a: { kinds: { label: string; now: Minor; before: Minor }[]; soldNow: Minor; soldBefore: Minor; lastMonth: string }): Standout | null {
  if (a.soldNow <= 0 || a.soldBefore <= 0) return null;
  const grown = a.kinds
    .map((k) => ({ label: k.label, now: pct(k.now, a.soldNow) ?? 0, before: pct(k.before, a.soldBefore) ?? 0 }))
    .filter((k) => k.now - k.before >= 1)
    .sort((x, y) => y.now - y.before - (x.now - x.before))[0];
  if (!grown) return null;
  return {
    key: "cost",
    level: "warn",
    lead: `${grown.label} is taking more.`,
    text: `It took ${grown.now}% of what we sold this month, ${grown.before}% in ${a.lastMonth}.`,
    href: "/reports/profit?period=month",
    link: "Costs",
  };
}

/** A supplier that missed the ready date in two or more of its last three orders. */
export function supplierSentence(s: { name: string; judged: number; late: number; lateNow: string | null; daysNow: number | null } | null | undefined): Standout | null {
  if (!s || s.late < 2) return null;
  const now = s.lateNow && s.daysNow && s.daysNow > 0 ? `; ${s.lateNow} is ${s.daysNow} ${plural(s.daysNow, "day")} late now` : "";
  return {
    key: "supplier",
    level: "warn",
    lead: `${s.name} is late again.`,
    text: `Late on the ready date in ${s.late} of its last ${s.judged} orders${now}.`,
    href: "/reports/factories",
    link: "Suppliers",
  };
}

/** Quotations with the customer: how many, what they are worth, how many were sent more than 7 days ago. */
export function quotesSentence(q: { count: number; value: Minor; old: number } | null | undefined, money: Money): Standout | null {
  if (!q || q.count <= 0) return null;
  return {
    key: "quotes",
    level: q.old > 0 ? "warn" : "info",
    lead: `${countWord(q.count)} ${plural(q.count, "quotation waits", "quotations wait")} for an answer,`,
    text: `worth ${money(q.value)}.${q.old > 0 ? ` ${countWord(q.old)} ${plural(q.old, "was", "were")} sent more than 7 days ago.` : ""}`,
    href: "/inquiries?stage=quoted",
    link: "Inquiries",
  };
}

const RANK = { bad: 0, warn: 1, ok: 2, info: 3 } as const;
/** At most five, what needs acting on first. */
export const standoutOf = (all: (Standout | null)[]) =>
  all
    .filter((s): s is Standout => s !== null)
    .sort((x, y) => RANK[x.level] - RANK[y.level])
    .slice(0, 5);

/**
 * The next four weeks from today (7 days each): what is due to come in and to go out by its date, and the
 * cash after each week. What is already late counts in the first week; what is due after the four weeks is
 * left out. A cost that repeats counts on its day this month (unless that month is in or skipped) and next.
 */
export function weeksAhead(a: {
  today: ISODate;
  cashNow: Minor;
  comingIn: { dueOn: string; minor: Minor }[];
  goingOut: { dueOn: string; minor: Minor }[];
  /** Bills known and people to pay back: they wait now. */
  waiting: Minor;
  /** The latest cost of each chain that still repeats: its day, and the month it was skipped for, if any. */
  repeating: { lastOn: string; minor: Minor; skip: string | null }[];
}) {
  const starts = [0, 7, 14, 21].map((n) => addDays(a.today, n));
  const end = addDays(a.today, 27);
  const sums = starts.map(() => ({ in: 0, out: 0 }));
  const weekOf = (day: string) => (day > end ? -1 : day < a.today ? 0 : Math.min(3, Math.floor((Date.parse(day) - Date.parse(a.today)) / (7 * 86_400_000))));
  for (const p of a.comingIn) {
    const w = weekOf(p.dueOn);
    if (w >= 0) sums[w]!.in += p.minor;
  }
  for (const p of a.goingOut) {
    const w = weekOf(p.dueOn);
    if (w >= 0) sums[w]!.out += p.minor;
  }
  sums[0]!.out += a.waiting;
  for (const r of a.repeating) {
    const day = r.lastOn.slice(8, 10);
    for (const start of [monthStart(a.today), monthStart(a.today, 1)]) {
      const mm = start.slice(0, 7);
      if (r.lastOn.slice(0, 7) >= mm || r.skip === mm) continue;
      // The 31st in a month of 30 days is its last day.
      const last = addDays(monthStart(start, 1), -1);
      const on = `${mm}-${day}` > last ? last : `${mm}-${day}`;
      const w = weekOf(on);
      if (w >= 0) sums[w]!.out += r.minor;
    }
  }
  let running = a.cashNow;
  return starts.map((from, i) => {
    running += sums[i]!.in - sums[i]!.out;
    return { from, to: addDays(from, 6), in: sums[i]!.in, out: sums[i]!.out, after: running };
  });
}
