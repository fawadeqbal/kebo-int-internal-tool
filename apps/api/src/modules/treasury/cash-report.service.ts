import { Injectable } from "@nestjs/common";
import { decimalToMinor, fromDbDate, toDbDate } from "@kebo/database";
import { convert, fromMinor, fxRate, type Minor } from "@kebo/money";
import { can } from "@kebo/shared";
import { ForbiddenError, type ISODate } from "@kebo/utils";
import { PrismaService } from "../../database/prisma.service";
import { Clock } from "../../common/time/clock.service";
import type { SessionUser } from "../../common/auth/session-user";
import { LimitsService } from "../../common/company/limits.service";
import { SettingsService } from "../settings/settings.service";

/** What a move on an account was for: the columns of the report. */
type Kind = "customers" | "suppliers" | "bills" | "company" | "moved";

interface Move {
  /** The account it moved through; none: recorded without one (it counts in the months, in no balance). */
  accountId: string | null;
  on: ISODate;
  /** Signed, in its own currency (the account's, when it has one): in is positive. */
  minor: Minor;
  currency: string;
  kind: Kind;
}

const KINDS = ["customers", "suppliers", "bills", "company"] as const;

/** "2026-09", "2026-10"… from the month of `from` to the month of `to`. */
function monthsBetween(from: ISODate, to: ISODate): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const last = to.slice(0, 7);
  for (;;) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (key > last) break;
    out.push(key);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/**
 * Reports › Cash (managers): the money that moved in a period. Read from the same rows as the cash book
 * (payment entries, expenses paid, bills and people paid back, moves between accounts), so an account's "now"
 * here is its balance on Cash & bank. By month: in from customers, out to suppliers, to freight and other
 * bills of orders, to company costs, and what all accounts held at the month's end. Money recorded without an
 * account counts in the months and in no balance (the page says how many). Amounts in other currencies count
 * in the main currency at today's Settings rate.
 */
@Injectable()
export class CashReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly limits: LimitsService,
    private readonly settings: SettingsService,
  ) {}

  async report(user: SessionUser, q: { from: ISODate; to: ISODate }) {
    if (!can(user, "expenses.manage")) throw new ForbiddenError("Only managers can see the cash report.");
    const today = this.clock.today();
    const to = q.to < today ? q.to : today;
    const from = q.from <= to ? q.from : to;
    const { sales } = await this.settings.get();
    const main = sales.currency;
    const missing = new Set<string>();
    const inMain = (minor: Minor, currency: string): Minor => {
      const r = fxRate(currency, main, main, sales.exchangeRates);
      if (r === null) {
        missing.add(currency);
        return 0;
      }
      return convert(minor, r);
    };
    const upTo = { lte: toDbDate(today) };
    const expensesOn = await this.limits.allows("expenses");
    const db = this.prisma.db;
    const [accounts, entries, paid, repaid, offIn, offOut, offCosts] = await Promise.all([
      db.moneyAccount.findMany({ orderBy: [{ currency: "asc" }, { name: "asc" }] }),
      db.moneyMovement.findMany({
        where: { voidedAt: null, valueDate: upTo },
        select: { direction: true, partyRole: true, amount: true, currency: true, allocatable: true, allocCurrency: true, accountId: true, toAccountId: true, valueDate: true },
      }),
      // Paid when it was spent: from an account, or with no account said (not someone's own money, not a bill for later).
      expensesOn
        ? db.expense.findMany({
            where: { voidedAt: null, spentOn: upTo, OR: [{ accountId: { not: null } }, { ownMoney: false, payLater: false }] },
            select: { amount: true, currency: true, accountId: true, spentOn: true, orderId: true },
          })
        : Promise.resolve([]),
      // A bill paid later, or someone paid back: the money left on that day.
      expensesOn
        ? db.expense.findMany({
            where: { voidedAt: null, repaidOn: upTo },
            select: { amount: true, currency: true, repaidAccountId: true, repaidOn: true, orderId: true },
          })
        : Promise.resolve([]),
      // Money of the period that is on no account yet: it is in no balance here, so the page says so.
      db.moneyMovement.count({ where: { voidedAt: null, accountId: null, direction: "in", valueDate: { gte: toDbDate(from), lte: toDbDate(to) } } }),
      db.moneyMovement.count({ where: { voidedAt: null, accountId: null, direction: "out", valueDate: { gte: toDbDate(from), lte: toDbDate(to) } } }),
      expensesOn
        ? db.expense.count({ where: { voidedAt: null, accountId: null, ownMoney: false, payLater: false, spentOn: { gte: toDbDate(from), lte: toDbDate(to) } } })
        : Promise.resolve(0),
    ]);

    const moves: Move[] = [];
    for (const e of entries) {
      const on = fromDbDate(e.valueDate);
      if (e.direction === "move") {
        if (e.accountId) moves.push({ accountId: e.accountId, on, minor: -decimalToMinor(e.amount), currency: e.currency, kind: "moved" });
        if (e.toAccountId) moves.push({ accountId: e.toAccountId, on, minor: decimalToMinor(e.allocatable), currency: e.allocCurrency, kind: "moved" });
        continue;
      }
      const sign = e.direction === "in" ? 1 : -1;
      // Money back to a customer comes off what customers paid; a supplier's money back comes off what we paid them.
      moves.push({ accountId: e.accountId, on, minor: sign * decimalToMinor(e.amount), currency: e.currency, kind: e.partyRole === "supplier" ? "suppliers" : "customers" });
    }
    for (const e of paid)
      moves.push({ accountId: e.accountId, on: fromDbDate(e.spentOn), minor: -decimalToMinor(e.amount), currency: e.currency, kind: e.orderId ? "bills" : "company" });
    for (const e of repaid)
      moves.push({ accountId: e.repaidAccountId, on: fromDbDate(e.repaidOn!), minor: -decimalToMinor(e.amount), currency: e.currency, kind: e.orderId ? "bills" : "company" });

    const byId = new Map(accounts.map((a) => [a.id, { ...a, openedOn: fromDbDate(a.openingOn), opening: decimalToMinor(a.openingBalance) }]));
    // As on the cash book: an account counts what moved on or after its opening day.
    const onAccount = moves.filter((m): m is Move & { accountId: string } => {
      const a = m.accountId ? byId.get(m.accountId) : undefined;
      return !!a && m.on >= a.openedOn;
    });

    const months = monthsBetween(from, to);
    const empty = () => ({ customers: 0, suppliers: 0, bills: 0, company: 0 });
    const perMonth = new Map(months.map((m) => [m, empty()]));
    const perAccount = new Map(accounts.map((a) => [a.id, { before: 0, in: 0, out: 0, after: 0 }]));
    let entriesIn = 0;
    let entriesOut = 0;
    for (const m of onAccount) {
      const a = perAccount.get(m.accountId)!;
      if (m.on < from) a.before += m.minor;
      else if (m.on > to) a.after += m.minor;
      else if (m.minor >= 0) a.in += m.minor;
      else a.out -= m.minor;
    }
    // The months count every amount that moved, on an account or not.
    for (const m of moves) {
      if (m.kind === "moved" || m.on < from || m.on > to) continue;
      perMonth.get(m.on.slice(0, 7))![m.kind] += inMain(m.minor, m.currency);
      if (m.minor >= 0) entriesIn += 1;
      else entriesOut += 1;
    }
    /** What every account held at the end of a day, in the main currency. */
    const heldOn = (day: ISODate) => {
      let t = 0;
      for (const a of byId.values()) {
        if (a.archivedAt || a.openedOn > day) continue;
        let bal = a.opening;
        for (const m of onAccount) if (m.accountId === a.id && m.on <= day) bal += m.minor;
        t += inMain(bal, a.currency);
      }
      return t;
    };
    const monthEnd = (ym: string): ISODate => {
      const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0));
      return d.toISOString().slice(0, 10) as ISODate;
    };

    const total = empty();
    const monthRows = months.map((m) => {
      const x = perMonth.get(m)!;
      for (const k of KINDS) total[k] += x[k];
      const end = monthEnd(m);
      return {
        month: m,
        customers: fromMinor(x.customers),
        suppliers: fromMinor(-x.suppliers),
        bills: fromMinor(-x.bills),
        company: fromMinor(-x.company),
        net: fromMinor(x.customers + x.suppliers + x.bills + x.company),
        cashEnd: fromMinor(heldOn(end < to ? end : to)),
      };
    });
    const accountRows = [...byId.values()]
      .map((a) => {
        const x = perAccount.get(a.id)!;
        // Opened inside the period: it starts with what was in it that day.
        const start = a.opening + x.before;
        const end = start + x.in - x.out;
        return {
          id: a.id,
          name: a.name,
          currency: a.currency,
          archived: Boolean(a.archivedAt),
          openedOn: a.openedOn > from ? a.openedOn : null,
          start: fromMinor(start),
          in: fromMinor(x.in),
          out: fromMinor(x.out),
          end: fromMinor(end),
          now: fromMinor(end + x.after),
        };
      })
      // A closed account with nothing in it and nothing moving is not listed.
      .filter((a) => !a.archived || Number(a.in) !== 0 || Number(a.out) !== 0 || Number(a.end) !== 0)
      // The main currency's accounts first, then by currency and name (as they were read).
      .sort((x, y) => Number(y.currency === main) - Number(x.currency === main));

    // Cash now, a line per currency (closed accounts are left out, as on Cash & bank).
    const held = new Map<string, { minor: Minor; accounts: number }>();
    for (const a of byId.values()) {
      if (a.archivedAt) continue;
      const x = perAccount.get(a.id)!;
      const h = held.get(a.currency) ?? { minor: 0, accounts: 0 };
      h.minor += a.opening + x.before + x.in - x.out + x.after;
      h.accounts += 1;
      held.set(a.currency, h);
    }
    const byCurrency = [...held.entries()]
      .map(([currency, h]) => ({ currency, accounts: h.accounts, amount: fromMinor(h.minor), inMain: fromMinor(inMain(h.minor, currency)) }))
      .sort((x, y) => (x.currency === main ? -1 : y.currency === main ? 1 : Number(y.inMain) - Number(x.inMain)));
    const net = total.customers + total.suppliers + total.bills + total.company;
    return {
      currency: main,
      from,
      to,
      today,
      months: monthRows,
      total: {
        customers: fromMinor(total.customers),
        suppliers: fromMinor(-total.suppliers),
        bills: fromMinor(-total.bills),
        company: fromMinor(-total.company),
        net: fromMinor(net),
      },
      in: { amount: fromMinor(total.customers), entries: entriesIn },
      out: { amount: fromMinor(-(total.suppliers + total.bills + total.company)), entries: entriesOut },
      cashNow: fromMinor(byCurrency.reduce((t, x) => t + Math.round(Number(x.inMain) * 100), 0)),
      byCurrency,
      accounts: accountRows,
      /** Payments and costs of the period on no account yet (they are in no balance above). */
      offAccount: offIn + offOut + offCosts,
      missingRates: [...missing].sort(),
    };
  }
}
