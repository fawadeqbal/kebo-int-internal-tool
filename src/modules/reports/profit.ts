import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { addDaysISO, todayISO } from "@/lib/utils/dates";
import { costLines, deals, groupBy, totals, type CostedLine, type ProfitLine } from "./profit-math";
import type { Range } from "./repository";

type Row = Record<string, unknown>;

const cents = (v: unknown) => Math.round(Number(v ?? 0) * 100);

function toLine(r: Row): ProfitLine {
  return {
    docId: String(r.doc_id),
    docNo: String(r.doc_no),
    date: String(r.date),
    customer: String(r.customer ?? "—"),
    category: String(r.category ?? "Uncategorised"),
    person: String(r.person ?? "Not assigned"),
    factory: r.factory ? String(r.factory) : null,
    quantity: Number(r.quantity ?? 0),
    lineTotalCents: cents(r.line_total),
    docSubtotalCents: cents(r.subtotal),
    docDiscountCents: cents(r.discount),
    docVatRate: Number(r.tax_rate ?? 0),
    docPricesIncludeVat: r.prices_include_vat === true,
    unitCost: r.unit_cost === null || r.unit_cost === undefined ? null : Number(r.unit_cost),
  };
}

const staffFilter = (staffId?: string): SQL => (staffId ? sql`and q.assigned_to = ${staffId}` : sql``);

/** Invoiced lines (not cancelled) issued between from and to, in `currency`. */
async function invoiceLines(from: string, to: string, currency: string, staffId?: string) {
  const res = await db.execute(sql`
    select i.id as doc_id, i.invoice_no as doc_no, i.issue_date::text as date, i.subtotal, i.discount, i.tax_rate, i.prices_include_vat,
           ii.quantity, ii.line_total, qi.unit_cost,
           coalesce(nullif(c.company_name, ''), c.contact_person) as customer,
           coalesce(nullif(q.category, ''), 'Uncategorised') as category,
           coalesce(u.name, 'Not assigned') as person,
           s.name as factory
      from invoices i
      join queries q on q.id = i.query_id
      join customers c on c.id = i.customer_id
      join invoice_items ii on ii.invoice_id = i.id
      left join quotation_items qi on qi.id = ii.quotation_item_id
      left join supplier_quote_items sqi on sqi.id = qi.supplier_quote_item_id
      left join supplier_quotes sq on sq.id = sqi.supplier_quote_id
      left join suppliers s on s.id = sq.supplier_id
      left join users u on u.id = q.assigned_to
     where i.status <> 'cancelled' and q.deleted_at is null and i.currency = ${currency}
       and i.issue_date >= ${from} and i.issue_date <= ${to} ${staffFilter(staffId)}
     order by i.issue_date, i.id, ii.sort_order`);
  return costLines((res.rows as Row[]).map(toLine));
}

/** Quotation lines: accepted in the period ("booked"), or sent and still waiting for the customer (latest version). */
async function quotationLines(kind: "accepted" | "waiting", r: Range, currency: string, staffId?: string) {
  const where =
    kind === "accepted"
      ? sql`qt.status = 'accepted' and qt.submitted_at >= ${r.from} and qt.submitted_at <= ${r.to}`
      : sql`qt.status = 'sent' and qt.version = (select max(v.version) from quotations v where v.query_id = qt.query_id and v.deleted_at is null)`;
  const res = await db.execute(sql`
    select qt.id as doc_id, qt.ref_no || ' v' || qt.version as doc_no, coalesce(qt.submitted_at, qt.created_at::date)::text as date,
           qt.subtotal, qt.discount, qt.tax_rate, qt.prices_include_vat, qi.quantity, qi.line_total, qi.unit_cost,
           coalesce(nullif(c.company_name, ''), c.contact_person) as customer,
           coalesce(nullif(q.category, ''), 'Uncategorised') as category,
           coalesce(u.name, 'Not assigned') as person,
           null as factory
      from quotations qt
      join queries q on q.id = qt.query_id
      join customers c on c.id = q.customer_id
      join quotation_items qi on qi.quotation_id = qt.id
      left join users u on u.id = q.assigned_to
     where qt.deleted_at is null and q.deleted_at is null and qt.currency = ${currency} and ${where} ${staffFilter(staffId)}
     order by qt.id, qi.sort_order`);
  return costLines((res.rows as Row[]).map(toLine));
}

/** Documents in another currency are left out of the sums; say how many. */
async function otherCurrencyInvoices(r: Range, currency: string) {
  const res = await db.execute(
    sql`select count(*)::int as n from invoices where status <> 'cancelled' and currency <> ${currency} and issue_date >= ${r.from} and issue_date <= ${r.to}`,
  );
  return Number((res.rows[0] as Row | undefined)?.n ?? 0);
}

function monthKeys(months: number) {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCMonth(start.getUTCMonth() - (months - 1));
  return Array.from({ length: months }, (_, i) => {
    const d = new Date(start);
    d.setUTCMonth(start.getUTCMonth() + i);
    return {
      key: d.toISOString().slice(0, 7),
      label: d.toLocaleString("en-US", { month: "short", timeZone: "UTC" }) + (d.getUTCMonth() === 0 || i === 0 ? ` ${String(d.getUTCFullYear()).slice(2)}` : ""),
    };
  });
}

/**
 * The executive profit picture for a period: what we made on what was invoiced,
 * what is booked (accepted quotations) and what is waiting on the customer, the
 * last 12 months, and where the profit comes from.
 */
export async function profitReport(r: Range, currency: string, staffId?: string) {
  const months = monthKeys(12);
  const trendFrom = `${months[0].key}-01`;
  const [lines, trendLines, booked, waiting, otherCurrency] = await Promise.all([
    invoiceLines(r.from, r.to, currency, staffId),
    invoiceLines(trendFrom, addDaysISO(todayISO(), 1), currency, staffId),
    quotationLines("accepted", r, currency, staffId),
    quotationLines("waiting", r, currency, staffId),
    otherCurrencyInvoices(r, currency),
  ]);
  const byMonth = (ls: CostedLine[], key: string) => ls.filter((l) => l.date.startsWith(key));
  const perDeal = deals(lines).filter((d) => d.costedRevenueCents > 0);
  return {
    currency,
    invoiced: totals(lines),
    booked: totals(booked),
    waiting: totals(waiting),
    trend: months.map((m) => {
      const t = totals(byMonth(trendLines, m.key));
      return { month: m.key, label: m.label, revenue: t.revenueCents / 100, cost: t.costCents / 100, profit: t.profitCents / 100, margin: t.marginPercent };
    }),
    byCustomer: groupBy(lines, (l) => l.customer),
    byCategory: groupBy(lines, (l) => l.category),
    byFactory: groupBy(lines, (l) => (l.costCents === null ? "No cost recorded" : (l.factory ?? "Cost typed by hand")), 10),
    byPerson: groupBy(lines, (l) => l.person),
    /** Thinnest margins first: the deals to look at. */
    thinnest: [...perDeal].sort((a, b) => (a.marginPercent ?? 0) - (b.marginPercent ?? 0)).slice(0, 5),
    /** Most profit first. */
    best: [...perDeal].sort((a, b) => b.profitCents - a.profitCents).slice(0, 5),
    otherCurrencyInvoices: otherCurrency,
  };
}

export type ProfitReport = Awaited<ReturnType<typeof profitReport>>;
