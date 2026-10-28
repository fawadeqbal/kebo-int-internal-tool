import "server-only";
import {
  CHANNEL_LABEL,
  CUSTOMER_TYPE_LABEL,
  EXPENSE_CATEGORY_LABEL,
  INQUIRY_STAGE_LABEL,
  LOST_REASON_LABEL,
  ORDER_STAGE_LABEL,
  PRIORITY_LABEL,
  REVISION_STATUS_LABEL,
} from "@kebo/shared";
import { fromMinor, landedUnitCosts, toMinor } from "@kebo/money";
import { api } from "./api";
import { countryName } from "./countries";
import type { SheetCol, SheetSpec } from "./sheet-spec";
import type { DealRow, Paged } from "./types";
import type { ReportView } from "./types-deals";
import type { OrderRow, RevisionDoc } from "./types-orders";
import type { AuditRow, CustomerRow, FactoryRow } from "./types-people";
import type { CashBook, ExpenseList, Payable } from "./types-money";
import type { Receivables } from "./types-insights";

/**
 * The lists as Excel files: every row the person may see with the filters on
 * screen (not only the page shown). The API decides what each person sees.
 */

type Q = Record<string, string | undefined>;

/** Asked for something that is not there (a bad id). */
export class ExportNotFound extends Error {}
type Cell = string | number | null;

const num = (v: string | number | null | undefined): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const day = (v: string | null | undefined) => (v ? v.slice(0, 10) : null);
const when = (v: string) => v.replace("T", " ").slice(0, 16);
const text = (h: string, width = 16): SheetCol => ({ header: h, width });
const money = (h: string): SheetCol => ({ header: h, kind: "number", width: 14 });
const count = (h: string): SheetCol => ({ header: h, kind: "number", width: 10 });

/** Every page of a paged list (100 at a time, up to 10,000 rows). */
async function allPages<T>(path: string, query: Q): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; page <= 100; page++) {
    const r = await api.get<Paged<T>>(path, { ...query, page, pageSize: 100 });
    rows.push(...r.rows);
    if (rows.length >= r.total || r.rows.length === 0) break;
  }
  return rows;
}

const stamp = () => new Date().toISOString().slice(0, 10);

async function deals(q: Q): Promise<SheetSpec> {
  const stage = q.stage ?? "open";
  const rows = await allPages<DealRow>("/inquiries", { stage: stage === "all" ? undefined : stage, q: q.q, assignee: q.assignee, customerId: q.customer, sort: q.sort });
  return {
    name: `Deals ${stamp()}`,
    title: "Deals",
    columns: [
      text("Deal no.", 14),
      text("Title", 36),
      text("Customer", 28),
      text("Country", 14),
      text("Stage", 12),
      text("Priority", 10),
      text("Channel", 11),
      text("Category", 18),
      count("Items"),
      text("Handled by", 16),
      text("Received on", 12),
      text("Required by", 12),
      text("Quotation", 14),
      text("Quotation status", 14),
      money("Quotation total"),
      text("Currency", 9),
      text("Order", 14),
    ],
    rows: rows.map((d): Cell[] => [
      d.refNo,
      d.title,
      d.customer.name,
      countryName(d.customer.country),
      `${INQUIRY_STAGE_LABEL[d.stage]}${d.onHold ? " (on hold)" : ""}`,
      PRIORITY_LABEL[d.priority],
      CHANNEL_LABEL[d.channel],
      d.category,
      d.items,
      d.assignee?.name ?? null,
      day(d.createdAt),
      day(d.requiredBy),
      d.quotation ? `${d.quotation.refNo}${d.quotation.latest ? ` R${d.quotation.latest.number}` : ""}` : null,
      d.quotation?.latest ? REVISION_STATUS_LABEL[d.quotation.latest.status] : null,
      num(d.quotation?.latest?.total),
      d.quotation?.latest?.currency ?? null,
      d.order?.refNo ?? null,
    ]),
  };
}

async function orders(q: Q): Promise<SheetSpec> {
  const mine = q.mine === "1" ? "true" : undefined;
  const cancelled = q.view === "cancelled";
  const rows = cancelled
    ? await api.get<OrderRow[]>("/orders", { status: "cancelled", mine })
    : [...(await api.get<OrderRow[]>("/orders", { status: "open", mine })), ...(await api.get<OrderRow[]>("/orders", { status: "closed", mine }))];
  return {
    name: `${cancelled ? "Cancelled orders" : "Orders"} ${stamp()}`,
    title: cancelled ? "Cancelled orders" : "Orders",
    columns: [
      text("Order no.", 14),
      text("Customer", 28),
      text("Country", 14),
      text("Deal", 14),
      text("Deal title", 30),
      text("Handled by", 16),
      text("Stage", 13),
      text("Ordered on", 12),
      text("Ready on", 12),
      text("Shipped on", 12),
      text("Currency", 9),
      money("Total"),
      money("Received"),
      money("Still due"),
      text("Needs now", 30),
      text("Needed by", 12),
    ],
    rows: rows.map((o): Cell[] => [
      o.refNo,
      o.customer.name,
      countryName(o.customer.country),
      o.inquiry.refNo,
      o.inquiry.title,
      o.inquiry.assignee?.name ?? null,
      o.status === "cancelled" ? "Cancelled" : ORDER_STAGE_LABEL[o.stage],
      day(o.orderedOn),
      day(o.readyOn),
      day(o.shippedOn),
      o.currency,
      num(o.total),
      num(o.received),
      num(o.due),
      o.needs?.title ?? null,
      day(o.needs?.due),
    ]),
  };
}

async function customers(q: Q): Promise<SheetSpec> {
  const rows = await allPages<CustomerRow>("/customers", { q: q.q, country: q.country });
  return {
    name: `Customers ${stamp()}`,
    title: "Customers",
    columns: [text("Customer name", 32), text("Type", 11), text("Country", 18), text("Contact name", 22), text("Position"), text("Email", 26), text("Phone", 18), text("WhatsApp", 18), text("WeChat"), count("Open deals"), count("Open orders")],
    rows: rows.map((c): Cell[] => [
      c.name,
      CUSTOMER_TYPE_LABEL[c.type],
      countryName(c.country),
      c.primaryContact?.name ?? null,
      c.primaryContact?.position ?? null,
      c.primaryContact?.email ?? null,
      c.primaryContact?.phone ?? null,
      c.primaryContact?.whatsapp ?? null,
      c.primaryContact?.wechat ?? null,
      c.openDeals,
      c.openOrders,
    ]),
  };
}

async function factories(q: Q): Promise<SheetSpec> {
  const rows = await allPages<FactoryRow>("/factories", { q: q.q, mine: q.mine === "1" ? "true" : undefined });
  return {
    name: `Factories ${stamp()}`,
    title: "Factories",
    columns: [text("Factory name", 32), text("Contact person", 22), text("Phone", 18), text("Email", 26), text("WeChat"), text("Address", 36), text("Bank details", 36), text("Notes", 30), text("Looked after by"), count("Offers")],
    rows: rows.map((f): Cell[] => [f.name, f.contactPerson, f.phone, f.email, f.wechat, f.address, f.bankDetails, f.notes, f.owner?.name ?? null, f._count.quotes]),
  };
}

async function receivables(): Promise<SheetSpec> {
  const r = await api.get<Receivables>("/money/receivables");
  return {
    name: `Owed to us ${stamp()}`,
    title: "Owed to us",
    columns: [
      text("Order no.", 14),
      text("Customer", 28),
      text("Handled by"),
      text("Stage", 13),
      text("Currency", 9),
      money("Total"),
      money("Received"),
      money("Still due"),
      money("Overdue"),
      count("Days late"),
      text("Next payment", 22),
      money("Next amount"),
      text("Next due on", 12),
      text("Last paid", 12),
    ],
    rows: r.rows.map((o): Cell[] => [
      o.refNo,
      o.customer.name,
      o.handledBy?.name ?? null,
      o.closed ? "Done" : ORDER_STAGE_LABEL[o.stage],
      o.currency,
      num(o.total),
      num(o.received),
      num(o.due),
      num(o.overdue),
      o.daysLate || null,
      o.next?.label ?? null,
      num(o.next?.open),
      day(o.next?.dueOn),
      day(o.lastPaid),
    ]),
  };
}

async function payables(q: Q): Promise<SheetSpec> {
  const rows = await api.get<Payable[]>("/money/payables", { mine: q.mine === "1" ? "true" : undefined });
  return {
    name: `To pay factories ${stamp()}`,
    title: "To pay",
    columns: [text("Factory", 30), text("Looked after by"), text("Currency", 9), money("Owed"), money("Paid"), money("To pay"), text("Orders", 40)],
    rows: rows.map((p): Cell[] => [
      p.factory.name,
      p.lookedAfterBy?.name ?? null,
      p.currency,
      num(p.owed),
      num(p.paid),
      num(p.toPay),
      p.orders.map((o) => `${o.refNo} (${o.customer}): ${o.toPay}`).join("; ") || null,
    ]),
  };
}

const CASH_KIND: Record<string, string> = { in: "Money in", factory: "Paid to factory", expense: "Expense", transfer_out: "Transfer out", transfer_in: "Transfer in" };

async function cashBook(q: Q): Promise<SheetSpec> {
  const b = await api.get<CashBook>("/money/cash-book", { from: q.from, to: q.to, account: q.account, currency: q.currency });
  const balance = !!b.account;
  return {
    name: `Cash book ${b.account ? `${b.account.name} ` : ""}${b.from} to ${b.to}`,
    title: "Cash book",
    columns: [
      text("Date", 12),
      text("Kind", 15),
      text("What", 36),
      text("Party", 24),
      text("Account", 18),
      text("Reference", 16),
      text("Currency", 9),
      money("In"),
      money("Out"),
      ...(balance ? [money("Balance")] : []),
      text("Voided", 8),
    ],
    rows: [
      ...(balance && b.opening !== null ? [[b.from, "Opening balance", null, null, b.account!.name, null, b.account!.currency, null, null, num(b.opening), null] as Cell[]] : []),
      ...b.rows.map((r): Cell[] => {
        const a = Number(r.amount);
        return [
          day(r.on),
          CASH_KIND[r.kind] ?? r.kind,
          r.what,
          r.party?.name ?? null,
          r.account?.name ?? null,
          r.reference,
          r.currency,
          a > 0 ? a : null,
          a < 0 ? -a : null,
          ...(balance ? [num(r.balance)] : []),
          r.voided ? "Voided" : null,
        ];
      }),
    ],
    foot:
      b.totals.length === 1
        ? ["Total", null, null, null, null, null, b.totals[0]!.currency, num(b.totals[0]!.in), num(b.totals[0]!.out), ...(balance ? [num(b.closing)] : []), null]
        : undefined,
  };
}

async function expenses(q: Q): Promise<SheetSpec> {
  const query = { from: q.from, to: q.to, kind: q.kind, customerId: q.customer, category: q.category };
  const rows: ExpenseList["rows"] = [];
  let first: ExpenseList | null = null;
  for (let page = 1; page <= 100; page++) {
    const r = await api.get<ExpenseList>("/expenses", { ...query, page: String(page), pageSize: "100" });
    first ??= r;
    rows.push(...r.rows);
    if (rows.length >= r.listed || r.rows.length === 0) break;
  }
  const main = first?.currency ?? "";
  return {
    name: `Expenses ${q.from ?? ""} to ${q.to ?? ""}`.trim(),
    title: "Expenses",
    columns: [
      text("Date", 12),
      text("Category", 18),
      text("Description", 36),
      text("Customer", 24),
      text("Deal", 14),
      text("Order", 14),
      text("Factory", 22),
      text("Paid by"),
      text("Account", 18),
      text("Currency", 9),
      money("Amount"),
      money(`In ${main}`),
      text("Reference", 16),
      text("Note", 30),
      text("Voided", 8),
    ],
    rows: rows.map((e): Cell[] => [
      day(e.spentOn),
      EXPENSE_CATEGORY_LABEL[e.category],
      e.description,
      e.customer?.name ?? null,
      e.deal?.refNo ?? null,
      e.order?.refNo ?? null,
      e.factory?.name ?? null,
      e.paidBy?.name ?? null,
      e.account?.name ?? null,
      e.currency,
      num(e.amount),
      num(e.inMain),
      e.reference,
      e.note,
      e.voided ? "Voided" : null,
    ]),
    foot: ["Total", null, null, null, null, null, null, null, null, null, null, num(first?.total), null, null, null],
  };
}

async function audit(q: Q): Promise<SheetSpec> {
  const rows = (await allPages<AuditRow>("/audit", { entityType: q.type, userId: q.person })).slice(0, 10_000);
  return {
    name: `Audit log ${stamp()}`,
    title: "Audit log",
    columns: [text("When (UTC)", 17), text("Who", 18), text("Action", 12), text("What", 14), text("Summary", 70)],
    rows: rows.map((r): Cell[] => [when(r.createdAt), r.userName, r.action, r.entityType, r.summary]),
  };
}

/** The Insights report: one tab per table. */
async function report(q: Q): Promise<SheetSpec[]> {
  const r = await api.get<ReportView>("/reports", { from: q.from, to: q.to, staff: q.staff });
  const p = r.profit;
  const name = `Report ${r.range.from} to ${r.range.to}`;
  const cur = r.currency;
  const profitRows = (group: string, rows: ReportView["profit"]["byCustomer"]) =>
    rows.map((x): Cell[] => [group, x.key, x.orders, num(x.revenue), num(x.cost), num(x.profit), x.marginPercent, x.coveragePercent]);
  return [
    {
      name,
      title: "Funnel",
      columns: [count("Received"), count("Quoted"), count("Won"), count("Lost"), count("Win rate %"), money(`Won value ${cur}`)],
      rows: [[r.funnel.received, r.funnel.quoted, r.funnel.won, r.funnel.lost, r.funnel.winRatePercent, num(r.wonValue)]],
    },
    { name, title: "Lost reasons", columns: [text("Reason", 28), count("Deals")], rows: r.lostReasons.map((x) => [LOST_REASON_LABEL[x.reason], x.count]) },
    { name, title: "By channel", columns: [text("Channel", 16), count("Inquiries")], rows: r.byChannel.map((x) => [CHANNEL_LABEL[x.key] ?? x.key, x.count]) },
    { name, title: "By category", columns: [text("Category", 24), count("Inquiries")], rows: r.byCategory.map((x) => [x.key, x.count]) },
    { name, title: "Win rate by person", columns: [text("Person", 20), count("Won"), count("Lost"), count("Win rate %")], rows: r.people.map((x) => [x.person, x.won, x.lost, x.winRatePercent]) },
    {
      name,
      title: "Profit",
      columns: [text("Group", 12), text("Name", 28), count("Orders"), money(`Sales ${cur}`), money(`Cost ${cur}`), money(`Profit ${cur}`), count("Margin %"), count("Costed %")],
      rows: [
        ["Total", null, p.total.orders, num(p.total.revenue), num(p.total.cost), num(p.total.profit), p.total.marginPercent, p.total.coveragePercent],
        ...profitRows("Customer", p.byCustomer),
        ...profitRows("Category", p.byCategory),
        ...profitRows("Person", p.byPerson),
      ],
    },
    { name, title: "Last 12 months", columns: [text("Month", 10), count("Received"), count("Won")], rows: r.trend.map((x) => [x.month, x.received, x.won]) },
  ];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A quotation as the printed one: the customer's copy has the items and each
 * option's total; ?copy=internal adds unit prices, amounts and (for people who
 * may see them) landed costs and margin.
 */
async function quotation(q: Q): Promise<SheetSpec> {
  if (!UUID.test(q.id ?? "")) throw new ExportNotFound();
  const r = await api.get<RevisionDoc>(`/revisions/${q.id}`);
  const internal = q.copy === "internal";
  const c = r.currency;
  const options = r.options.some((o) => o.status === "accepted") ? r.options.filter((o) => o.status === "accepted") : r.options;
  const single = options.length === 1;
  const costs = internal && options.some((o) => o.lines.some((l) => l.unitCost != null));
  const columns: SheetCol[] = [
    text("No.", 7),
    text("Description", 48),
    text("Model", 16),
    { header: "Qty", kind: "number", width: 10 },
    text("Unit", 9),
    ...(internal ? [...(costs ? [money(`Unit cost ${c}`), count("Margin %")] : []), money(`Unit price ${c}`), money(`Amount ${c}`)] : [money(`Total ${c}`)]),
  ];
  const width = columns.length;
  const pad = (cells: Cell[]): Cell[] => [...cells, ...Array<Cell>(Math.max(0, width - cells.length)).fill(null)];
  const sum = (label: string, value: string): Cell[] => pad([null, label, ...Array<Cell>(width - 3).fill(null), num(value)]).slice(0, width);
  const rows: Cell[][] = [];
  for (const o of options) {
    if (!single) rows.push(pad([null, `OPTION ${o.letter}${o.leadTime ? ` — delivery ${o.leadTime}` : ""}${internal && o.factory ? ` (${o.factory.name})` : ""}`]));
    const extra = o.costing?.extraCostMinor ?? 0;
    const landed = internal && extra ? landedUnitCosts(o.lines.map((l) => ({ unitCostMinor: l.unitCost == null ? null : toMinor(l.unitCost), quantity: l.quantity })), extra) : null;
    o.lines.forEach((l, i) => {
      const cost = landed?.[i] != null ? fromMinor(landed[i]!) : l.unitCost;
      const margin = cost != null && Number(l.unitPrice) ? Math.round(((Number(l.unitPrice) - Number(cost)) / Number(l.unitPrice)) * 1000) / 10 : null;
      rows.push([
        l.no,
        l.description,
        l.model,
        num(l.quantity),
        l.unit,
        ...(internal ? [...(costs ? [num(cost), margin] : []), num(l.unitPrice), num(l.lineTotal)] : []),
      ]);
    });
    if (internal || Number(o.discount)) {
      rows.push(sum(single ? "Subtotal" : `Option ${o.letter} subtotal`, o.subtotal));
      if (Number(o.discount)) rows.push(sum("Discount", String(-Number(o.discount))));
    }
    rows.push(sum(`${single ? "" : `Option ${o.letter} `}Total ${r.incoterm}${r.incotermPlace ? ` ${r.incotermPlace}` : ""} (${c})`, o.total));
  }
  const no = `${r.quotation.refNo}-R${r.number}`;
  return { name: `Quotation ${no}${internal ? " (internal)" : ""}`, title: `Quotation ${no}`, columns, rows };
}

export const EXPORTS = {
  deals,
  orders,
  customers,
  factories,
  receivables,
  payables,
  "cash-book": cashBook,
  expenses,
  audit,
  report,
  quotation,
} satisfies Record<string, (q: Q) => Promise<SheetSpec | SheetSpec[]>>;

export type ExportKind = keyof typeof EXPORTS;
