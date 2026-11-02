import { decimalToMinor, fromDbDate, fromDbDateOrNull, type Prisma } from "@kebo/database";
import { documentTotals, fromMinor, settle } from "@kebo/money";
import {
  DELIVERY_CONDITION_LABEL,
  ORDER_DOCUMENT_LABEL,
  PAYMENT_KIND_LABEL,
  PAYMENT_METHOD_LABEL,
  paperDateText,
  paperMoneyText,
  paperNumber,
  paperWordsText,
  paymentSentenceOf,
  requiredDocuments,
  SAT_RESULT_LABEL,
  SHIP_MODE_LABEL,
  type OrderDocumentKind,
  type PaperCell,
  type PaperCheck,
  type PaperColumn,
  type PaperDoc,
  type PaperFixField,
  type PaperKind,
  type PaperOptions,
  type Settings,
} from "@kebo/shared";
import type { ISODate } from "@kebo/utils";
import { orderLineNumbers } from "../orders/orders.service";

/** Everything one order's papers are made from, read in one query. */
export const paperOrderInclude = {
  lines: {
    orderBy: { sortOrder: "asc" },
    include: {
      quoteLine: {
        select: {
          requestedItemId: true,
          requestedItem: { select: { parentId: true } },
          factoryQuoteLineId: true,
          factoryQuoteLine: { select: { parentId: true } },
        },
      },
      factory: { select: { id: true, name: true, address: true } },
    },
  },
  revision: { include: { quotation: { select: { refNo: true } } } },
  payments: { where: { voidedAt: null }, orderBy: { paidOn: "asc" } },
  planItems: { orderBy: { sortOrder: "asc" } },
  factoryPaid: { where: { voidedAt: null }, orderBy: { paidOn: "asc" } },
  bankContract: true,
  shipments: { orderBy: { createdAt: "asc" } },
  documents: {
    orderBy: [{ kind: "asc" }, { updatedAt: "asc" }],
    include: { attachment: { select: { id: true, fileName: true, deletedAt: true } } },
  },
  satChecks: { orderBy: { sortOrder: "asc" } },
  checklist: {
    where: { key: null },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { doneBy: { select: { name: true } }, attachment: { select: { fileName: true, deletedAt: true } } },
  },
  papers: { orderBy: [{ version: "asc" }] },
  satEngineer: { select: { name: true } },
  inquiry: { select: { id: true, contactId: true } },
} satisfies Prisma.OrderInclude;

export type PaperOrder = Prisma.OrderGetPayload<{ include: typeof paperOrderInclude }>;

/** The party in the light-blue box. */
export type Party = PaperDoc["party"];

/** The customer's orders and payments, for the statement (only the orders the person may see). */
export interface StatementData {
  orders: { refNo: string; orderedOn: ISODate; currency: string; total: string; received: string; due: string }[];
  payments: { paidOn: ISODate; refNo: string; amount: string; currency: string }[];
}

export interface PaperCtx {
  o: PaperOrder;
  today: ISODate;
  settings: Settings;
  company: PaperDoc["company"];
  customer: Party;
  /** null: every module. */
  features: readonly string[] | null;
  options: PaperOptions;
  /** Which payment, plan item ("balance": the rest) or factory. */
  ref: string;
  /** File names of the checklist's file fields. */
  fileNames: Map<string, string>;
  statement: StatementData | null;
}

/** What a builder makes: the Make page's checks and the paper itself (title, number and company are added after). */
export interface Built {
  checks: PaperCheck[];
  doc: Omit<PaperDoc, "kind" | "title" | "numberLabel" | "number" | "company" | "party"> & { party?: Party };
  /** The "-n" of the number (the second receipt, the second factory's order). */
  n?: number | null;
}

/* ---------------------------------------------------------------- small helpers */

const has = (c: PaperCtx, f: string) => !c.features || c.features.includes(f);
const money = (amount: string | number, currency: string): PaperCell => ({ money: Number(amount).toFixed(2), currency });
const qty = (q: Prisma.Decimal | string | number, unit?: string | null): PaperCell => ({ qty: String(Number(q.toString())), unit });
const date = (d: string | null | undefined): PaperCell => (d ? { date: d } : null);
const bullets = (text: string | null | undefined) =>
  (text ?? "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:\d+[.)]|[-•*])\s*/, "").trim())
    .filter(Boolean);

function check(
  key: string,
  label: string,
  value: string,
  ok: boolean,
  more: { required?: boolean; fix?: PaperFixField | null; href?: string | null } = {},
): PaperCheck {
  return {
    key,
    label,
    value,
    ok,
    required: more.required ?? false,
    fix: ok ? null : (more.fix ?? null),
    href: ok ? null : (more.href ?? null),
  };
}

const COL = {
  no: { key: "no", label: "Item", width: 32 } satisfies PaperColumn,
  item: { key: "item", label: "Description" } satisfies PaperColumn,
  hs: { key: "hs", label: "HS code", width: 58 } satisfies PaperColumn,
  qty: { key: "qty", label: "Qty", width: 56 } satisfies PaperColumn,
  price: { key: "price", label: "Unit price", width: 70, align: "right" } satisfies PaperColumn,
  amount: { key: "amount", label: "Amount", width: 80, align: "right" } satisfies PaperColumn,
};

const BANK_ROUTE = (c: PaperCtx) => c.o.paymentRoute === "letter_of_credit" || c.o.paymentRoute === "bank_contract";
const LC = (c: PaperCtx) => c.o.paymentRoute === "letter_of_credit";
const lcWord = (c: PaperCtx) => (LC(c) ? "LC" : "Contract");

/** The order's lines with their numbers ("1", "1.1", "2") and totals in the order's currency. */
export function linesOf(c: PaperCtx) {
  const numbers = orderLineNumbers(c.o.lines);
  const t = documentTotals(
    c.o.lines.map((l) => ({ quantity: l.quantity.toString(), unitPrice: l.unitPrice.toString() })),
    c.o.revision.discount.toString(),
  );
  return {
    lines: c.o.lines.map((l, i) => ({ ...l, no: numbers[i] ?? String(i + 1) })),
    subtotal: fromMinor(t.subtotal),
    discount: fromMinor(t.discount),
    total: fromMinor(t.total),
  };
}

/** Received and due on the order (in its currency). */
export function positionOf(c: PaperCtx) {
  const total = linesOf(c).total;
  const p = settle(
    decimalToMinor(total),
    c.o.payments
      .filter((x) => x.currency === c.o.currency)
      .map((x) => ({ amountMinor: decimalToMinor(x.amount), bankChargesMinor: decimalToMinor(x.bankCharges) })),
    Number(c.o.depositPercent),
  );
  return { total, received: fromMinor(p.settledMinor), due: fromMinor(p.outstandingMinor) };
}

/** The ports: from the shipment, else the Incoterm place (loading for E/F terms, discharge for C/D terms) and the order's port. */
function portsOf(c: PaperCtx) {
  const s = c.o.shipments[0];
  const loadingTerm = ["EXW", "FCA", "FAS", "FOB"].includes(c.o.incoterm);
  return {
    pol: s?.portOfLoading ?? (loadingTerm ? c.o.incotermPlace : null),
    pod: s?.portOfDischarge ?? c.o.portOfDischarge ?? (loadingTerm ? null : c.o.incotermPlace),
  };
}

const totalLabel = (c: PaperCtx) => `Total ${c.o.incoterm}${c.o.incotermPlace ? ` ${c.o.incotermPlace}` : ""}`;

/** The goods with what each paper shows of them: number, item, HS code, quantity, prices. */
function itemRows(c: PaperCtx, onlyGoods = false) {
  const { lines } = linesOf(c);
  return lines
    .filter((l) => !onlyGoods || l.type === "goods")
    .map((l) => ({
      line: l,
      cells: {
        no: l.no,
        item: { item: l.description, model: l.model },
        hs: l.hsCode ?? "",
        qty: qty(l.quantity, l.unit),
        price: money(l.unitPrice.toString(), c.o.currency),
        amount: money(l.lineTotal.toString(), c.o.currency),
      } as Record<string, PaperCell>,
    }));
}

/** HS codes: the column shows when asked for and some line has one; the check says how many lines have theirs. */
function hsOf(c: PaperCtx) {
  const goods = c.o.lines.filter((l) => l.type === "goods");
  const withHs = goods.filter((l) => l.hsCode).length;
  const show = c.options.showHs !== false && withHs > 0;
  const chk = check(
    "hs",
    "HS codes",
    withHs === goods.length ? "on every line" : `${withHs} of ${goods.length} lines`,
    withHs === goods.length,
    { fix: "hs" },
  );
  return {
    show,
    check: chk,
    missing: goods.filter((l) => !l.hsCode).map((l) => ({ id: l.id, description: l.description.split(/\r?\n/)[0]! })),
  };
}

const buyerCheck = (c: PaperCtx) => check("buyer", "Buyer and address", c.customer.name, !!c.customer.name, { required: true });
const linesCheck = (c: PaperCtx, n = c.o.lines.length) =>
  check("lines", "Lines", `from the order's line table · ${n} line${n === 1 ? "" : "s"}`, n > 0, { required: true });

function totalsOf(c: PaperCtx) {
  const t = linesOf(c);
  const sums = Number(t.discount)
    ? [
        { label: "Subtotal", value: money(t.subtotal, c.o.currency) },
        { label: "Discount", value: money(-Number(t.discount), c.o.currency) },
      ]
    : [];
  return { sums, total: { label: totalLabel(c), amount: Number(t.total).toFixed(2), currency: c.o.currency } };
}

/* ---------------------------------------------------------------- the papers */

function salesContract(c: PaperCtx): Built {
  const hs = hsOf(c);
  const { pol, pod } = portsOf(c);
  const route = c.o.paymentRoute;
  const b = c.o.bankContract;
  const rev = c.o.revision;
  const shipBy = fromDbDateOrNull(c.o.shipBy);
  const prices = c.options.prices !== false;
  const columns = [COL.no, COL.item, ...(hs.show ? [COL.hs] : []), COL.qty, ...(prices ? [COL.amount] : [])];
  const routeLine =
    route === "letter_of_credit"
      ? `Balance by irrevocable letter of credit${b?.customerBank ? ` through ${b.customerBank}` : ""}${b?.number ? `, LC No. ${b.number}` : ""}.`
      : route === "bank_contract"
        ? `Payment through the bank contract${b?.customerBank ? ` with ${b.customerBank}` : ""}${b?.number ? `, No. ${b.number}` : ""}.`
        : null;
  const mode = SHIP_MODE_LABEL[c.o.shipments[0]?.mode ?? "sea"].toLowerCase();
  return {
    checks: [
      buyerCheck(c),
      linesCheck(c),
      check(
        "route",
        "Payment route",
        route ? (route === "letter_of_credit" ? "LC" : route === "bank_contract" ? "Bank contract" : "Informal") : "not chosen yet",
        !!route,
        {
          required: true,
          href: "payment",
        },
      ),
      check(
        "shipment",
        "Incoterm and ports",
        [`${c.o.incoterm}${c.o.incotermPlace ? ` ${c.o.incotermPlace}` : ""}`, pol && pod ? `${pol} → ${pod}` : null]
          .filter(Boolean)
          .join(" · "),
        true,
      ),
      check("shipBy", "Ship by", shipBy ? paperDateText(shipBy) : "not set", !!shipBy, { fix: "shipBy" }),
      hs.check,
      check("warranty", "Warranty", c.settings.sales.warrantyTerms ? "from Settings" : "not set", !!c.settings.sales.warrantyTerms, {
        href: "/settings?tab=sales",
      }),
    ],
    doc: {
      date: c.today,
      meta: [{ label: "Order No.", value: c.o.refNo }],
      heading: c.o.documentTitle,
      columns,
      rows: itemRows(c).map((r) => r.cells),
      ...totalsOf(c),
      foot: null,
      boxTitle: "Terms",
      bullets: [
        paymentSentenceOf(Number(c.o.depositPercent), c.o.balanceTerms),
        ...(routeLine ? [routeLine] : []),
        ...bullets(rev.paymentTerms),
        `Shipment: by ${mode}${pol ? ` from ${pol}` : ""}${pod ? ` to ${pod}` : ""}, ${c.o.incoterm}${c.o.incotermPlace ? ` ${c.o.incotermPlace}` : ""}${shipBy ? `, latest ${paperDateText(shipBy)}` : ""}.`,
        ...(rev.leadTime ? [`Delivery: ${rev.leadTime}.`.replace(/\.\.$/, ".")] : []),
        has(c, "delivery_sat")
          ? "Inspection: FAT at the factory before shipment; SAT at the buyer's site."
          : "Inspection: FAT at the factory before shipment.",
        ...bullets(c.settings.sales.warrantyTerms),
        ...bullets(rev.deliveryTerms),
      ],
      bank: c.settings.company.bankDetails || null,
      signatures: { left: `For the seller · ${c.company.name}`, right: `For the buyer · ${c.customer.name}` },
    },
  };
}

function commercialInvoice(c: PaperCtx): Built {
  const hs = hsOf(c);
  const s = c.o.shipments[0];
  const { pol, pod } = portsOf(c);
  const blNo = s?.blNo ?? c.o.blNo;
  const vessel = s?.vessel ?? null;
  const b = c.o.bankContract;
  const lcNo = BANK_ROUTE(c) ? (b?.number ?? null) : null;
  const shipped = fromDbDateOrNull(s?.departedOn) ?? fromDbDateOrNull(c.o.shippedOn);
  const prices = c.options.prices !== false;
  const ships = has(c, "shipping");
  return {
    checks: [
      buyerCheck(c),
      linesCheck(c),
      hs.check,
      ...(BANK_ROUTE(c)
        ? [check("lc", LC(c) ? "LC number and clause" : "Bank contract number", lcNo ?? "needed", !!lcNo, { required: true, fix: "lcNo" })]
        : []),
      ...(ships
        ? [
            check(
              "vessel",
              "Vessel and ports",
              [vessel, pol && pod ? `${pol} → ${pod}` : (pol ?? pod)].filter(Boolean).join(" · ") || "needed",
              !!vessel,
              {
                required: true,
                fix: "vessel",
              },
            ),
          ]
        : []),
      check("blNo", s?.mode === "air" ? "AWB number" : "B/L number", blNo ?? "needed", !!blNo, { required: true, fix: "blNo" }),
    ],
    doc: {
      date: shipped ?? c.today,
      meta: [
        ...(BANK_ROUTE(c) ? [{ label: `${lcWord(c)} No.`, value: lcNo }] : []),
        { label: s?.mode === "air" ? "AWB No." : "B/L No.", value: blNo },
      ],
      heading: c.o.documentTitle,
      columns: [COL.no, COL.item, ...(hs.show ? [COL.hs] : []), COL.qty, ...(prices ? [COL.amount] : [])],
      rows: itemRows(c).map((r) => r.cells),
      ...totalsOf(c),
      foot: null,
      boxTitle: "Shipment and declaration",
      bullets: [
        `Shipped${vessel ? ` per ${vessel}` : ""}${pol ? ` from ${pol}` : ""}${pod ? ` to ${pod}` : ""}${shipped ? ` on ${paperDateText(shipped)}` : ""}.`,
        "Goods of Chinese origin.",
        c.options.lcStatement !== false && lcNo
          ? `We certify this invoice is true and correct and the goods are as per ${LC(c) ? "LC" : "contract"} ${lcNo}.`
          : "We certify this invoice is true and correct.",
      ],
      bank: null,
      signatures: null,
    },
  };
}

/** The factories of the order's lines, in the order they first appear. */
export function factoriesOf(o: PaperOrder) {
  return [...new Map(o.lines.flatMap((l) => (l.factory ? [[l.factory.id, l.factory] as const] : []))).values()];
}

function purchaseOrder(c: PaperCtx): Built {
  const factories = factoriesOf(c.o);
  const f = factories.find((x) => x.id === c.ref) ?? factories[0] ?? null;
  const { lines } = linesOf(c);
  const mine = lines.filter((l) => f && l.factoryId === f.id);
  const currency = mine.find((l) => l.factoryCurrency)?.factoryCurrency ?? "CNY";
  const priced = mine.filter((l) => l.factoryUnitPrice !== null);
  const total = mine.reduce((t, l) => t + Number(l.factoryUnitPrice ?? 0) * Number(l.quantity), 0);
  const readyOn = fromDbDateOrNull(c.o.readyOn);
  const tax = mine.find((l) => l.factoryTaxRate !== null && Number(l.factoryTaxRate) > 0)?.factoryTaxRate;
  const paid = c.o.factoryPaid.filter((p) => f && p.factoryId === f.id);
  return {
    n: factories.length > 1 && f ? factories.indexOf(f) + 1 : null,
    checks: [
      check("factory", "Factory", f?.name ?? "no line has a factory", !!f, { required: true, href: "factory" }),
      check("lines", "Factory lines", `${mine.length} line${mine.length === 1 ? "" : "s"} from the order's line table`, mine.length > 0, {
        required: true,
      }),
      check(
        "prices",
        "Factory prices",
        priced.length === mine.length ? `in ${currency}` : `${mine.length - priced.length} line(s) without a price`,
        mine.length > 0 && priced.length === mine.length,
        {
          required: true,
          href: "factory",
        },
      ),
      check("readyOn", "Ready date", readyOn ? paperDateText(readyOn) : "not set", !!readyOn, { fix: "readyOn" }),
    ],
    doc: {
      party: { name: f?.name ?? "Factory", address: f?.address ?? null },
      date: fromDbDateOrNull(c.o.factoryOrderedOn) ?? c.today,
      meta: [
        { label: "Our order", value: c.o.refNo },
        { label: "Ready by", value: date(readyOn) ?? "to confirm" },
      ],
      heading: c.o.documentTitle,
      columns: [COL.no, COL.item, COL.qty, COL.price, COL.amount],
      rows: mine.map((l) => ({
        no: l.no,
        item: { item: l.description, model: l.model },
        qty: qty(l.quantity, l.unit),
        price: l.factoryUnitPrice !== null ? money(l.factoryUnitPrice.toString(), currency) : "",
        amount: l.factoryUnitPrice !== null ? money(Number(l.factoryUnitPrice) * Number(l.quantity), currency) : "",
      })),
      sums: [],
      total: { label: "Total", amount: total.toFixed(2), currency },
      foot: null,
      boxTitle: "Terms",
      bullets: [
        readyOn ? { label: "Ready by:", value: date(readyOn) } : "Ready date: to be confirmed by the factory.",
        ...(tax ? [`Prices include ${Number(tax)}% tax.`] : []),
        ...paid.map((p) => ({ label: `Paid on ${paperDateText(fromDbDate(p.paidOn))}:`, value: money(p.amount.toString(), p.currency) })),
        "Balance before the goods leave the factory, after our inspection.",
        `Please quote our order number ${c.o.refNo} on every paper and on the packing.`,
        ...(c.o.shippingMarks ? [{ label: "Shipping marks:", value: `\n${c.o.shippingMarks}` }] : []),
      ],
      bank: null,
      signatures: { left: `For the buyer · ${c.company.name}`, right: `For the factory · ${f?.name ?? ""}` },
    },
  };
}

const kg = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const m3 = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 3 });

function shippingAdvice(c: PaperCtx): Built {
  const s = c.o.shipments[0];
  const { pol, pod } = portsOf(c);
  const blNo = s?.blNo ?? c.o.blNo;
  const etd = fromDbDateOrNull(s?.etd);
  const eta = fromDbDateOrNull(s?.eta);
  const rows = itemRows(c, true);
  const goods = rows.map((r) => r.line);
  const sum = (f: (l: (typeof goods)[number]) => number) => goods.reduce((t, l) => t + f(l), 0);
  const air = s?.mode === "air";
  return {
    checks: [
      check("vessel", air ? "Flight" : "Vessel", s?.vessel ?? "needed", !!s?.vessel, { required: true, fix: "vessel" }),
      check("blNo", air ? "AWB number" : "B/L number", blNo ?? "needed", !!blNo, { required: true, fix: "blNo" }),
      check("etd", "ETD", etd ? paperDateText(etd) : "needed", !!etd, { required: true, fix: "etd" }),
      check("eta", "ETA", eta ? paperDateText(eta) : "not known", !!eta, { fix: "eta" }),
      check("container", "Container", s?.containerNo ?? c.o.containerNo ?? "not set", !!(s?.containerNo ?? c.o.containerNo), {
        href: "shipping#shipments",
      }),
      check(
        "packing",
        "Packages and weights",
        c.o.packedAt ? `${sum((l) => l.packages ?? 0)} packages` : "packing list not made",
        !!c.o.packedAt,
        { href: "shipping#packing" },
      ),
    ],
    doc: {
      date: c.today,
      meta: [
        { label: "Order No.", value: c.o.refNo },
        { label: air ? "AWB No." : "B/L No.", value: blNo },
      ],
      heading: c.o.documentTitle,
      columns: [
        COL.no,
        COL.item,
        COL.qty,
        { key: "packages", label: "Packages", width: 76, wrap: true },
        { key: "gross", label: "G.W. (kg)", width: 56, align: "right" },
        { key: "cbm", label: "CBM", width: 44, align: "right" },
      ],
      rows: rows.map(({ line: l, cells }) => ({
        no: cells.no!,
        item: cells.item!,
        qty: cells.qty!,
        packages: l.packages ? `${l.packages} ${l.packageType ?? ""}`.trim() : "",
        gross: l.grossWeightKg !== null ? kg(Number(l.grossWeightKg)) : "",
        cbm: l.cbm !== null ? m3(Number(l.cbm)) : "",
      })),
      sums: [],
      total: null,
      foot: {
        label: `Total: ${goods.length} item${goods.length === 1 ? "" : "s"}`,
        cells: {
          packages: String(sum((l) => l.packages ?? 0) || ""),
          gross: sum((l) => Number(l.grossWeightKg ?? 0)) ? kg(sum((l) => Number(l.grossWeightKg ?? 0))) : "",
          cbm: sum((l) => Number(l.cbm ?? 0)) ? m3(sum((l) => Number(l.cbm ?? 0))) : "",
        },
      },
      boxTitle: "Shipment",
      bullets: [
        ...(s?.vessel ? [{ label: air ? "Flight:" : "Vessel:", value: s.vessel }] : []),
        ...(blNo ? [{ label: air ? "AWB No.:" : "B/L No.:", value: blNo }] : []),
        ...(s?.containerNo || c.o.containerNo
          ? [{ label: "Container:", value: `${s?.containerNo ?? c.o.containerNo}${s?.containerType ? ` (${s.containerType})` : ""}` }]
          : []),
        ...(pol ? [{ label: "Port of loading:", value: pol }] : []),
        ...(pod ? [{ label: "Port of discharge:", value: pod }] : []),
        ...(etd ? [{ label: "ETD:", value: date(etd) }] : []),
        ...(eta ? [{ label: "ETA:", value: date(eta) }] : []),
        ...(s?.forwarder ? [{ label: "Forwarder:", value: s.forwarder }] : []),
        ...(c.o.shippingMarks ? [{ label: "Shipping marks:", value: `\n${c.o.shippingMarks}` }] : []),
      ],
      bank: null,
      signatures: null,
    },
  };
}

function paymentReceipt(c: PaperCtx): Built {
  const list = c.o.payments;
  const p = c.ref ? list.find((x) => x.id === c.ref) : list.at(-1);
  const pos = positionOf(c);
  return {
    n: p ? list.indexOf(p) + 1 : null,
    checks: [
      check(
        "payment",
        "Payment",
        p ? `${paperMoneyText(p.amount.toString(), p.currency)} on ${paperDateText(fromDbDate(p.paidOn))}` : "no payment recorded",
        !!p,
        { required: true, href: "payment" },
      ),
    ],
    doc: {
      date: p ? fromDbDate(p.paidOn) : c.today,
      meta: [{ label: "Order No.", value: c.o.refNo }],
      heading: null,
      columns: [
        { key: "no", label: "No.", width: 32 },
        { key: "item", label: "For" },
        { key: "ref", label: "Reference", width: 120, wrap: true },
        COL.amount,
      ],
      rows: p
        ? [
            {
              no: "1",
              item: { item: `${PAYMENT_KIND_LABEL[p.kind]} for order ${c.o.refNo}` },
              ref: p.reference ?? "",
              amount: money(p.amount.toString(), p.currency),
            },
            ...(Number(p.bankCharges)
              ? [
                  {
                    no: "2",
                    item: { item: "Bank charges on the way (counted as paid)" },
                    ref: "",
                    amount: money(p.bankCharges.toString(), p.currency),
                  },
                ]
              : []),
          ]
        : [],
      sums: [],
      total: p ? { label: "Received", amount: (Number(p.amount) + Number(p.bankCharges)).toFixed(2), currency: p.currency } : null,
      foot: null,
      boxTitle: "Account",
      bullets: p
        ? [
            `Received with thanks by ${PAYMENT_METHOD_LABEL[p.method].toLowerCase()} on ${paperDateText(fromDbDate(p.paidOn))}.`,
            { label: "Order total:", value: money(pos.total, c.o.currency) },
            { label: "Received so far:", value: money(pos.received, c.o.currency) },
            { label: "Still due:", value: money(pos.due, c.o.currency) },
          ]
        : [],
      bank: null,
      signatures: null,
    },
  };
}

function paymentRequest(c: PaperCtx): Built {
  const items = c.o.planItems;
  const pos = positionOf(c);
  const item = items.find((x) => x.id === c.ref) ?? null;
  const amount = item ? item.amount.toFixed(2) : pos.due;
  const label = item ? item.label : "Balance due on the order";
  const due = item ? fromDbDateOrNull(item.dueOn) : null;
  const number = paperNumber(c.o.refNo, "payment-request", item ? items.indexOf(item) + 1 : items.length + 1);
  return {
    n: item ? items.indexOf(item) + 1 : items.length + 1,
    checks: [
      check("amount", "Amount", paperMoneyText(amount, c.o.currency), Number(amount) > 0, { required: true }),
      check("bank", "Our bank details", c.settings.company.bankDetails ? "from Settings" : "not set", !!c.settings.company.bankDetails, {
        required: true,
        href: "/settings?tab=company",
      }),
    ],
    doc: {
      date: c.today,
      meta: [
        { label: "Order No.", value: c.o.refNo },
        { label: "Due by", value: date(due) ?? "on receipt" },
      ],
      heading: null,
      columns: [{ key: "no", label: "No.", width: 32 }, { key: "item", label: "For" }, { key: "due", label: "Due", width: 90 }, COL.amount],
      rows: [
        { no: "1", item: { item: `${label} · order ${c.o.refNo}` }, due: date(due) ?? "on receipt", amount: money(amount, c.o.currency) },
      ],
      sums: [
        { label: "Order total", value: money(pos.total, c.o.currency) },
        { label: "Received so far", value: money(pos.received, c.o.currency) },
      ],
      total: { label: "Amount due", amount: Number(amount).toFixed(2), currency: c.o.currency },
      foot: null,
      boxTitle: "Payment",
      bullets: [
        `Please pay ${paperMoneyText(amount, c.o.currency)}${due ? ` by ${paperDateText(due)}` : ""} to the account below.`,
        `Please quote ${number} with the payment.`,
        ...bullets(c.o.revision.paymentTerms),
      ],
      bank: c.settings.company.bankDetails || null,
      signatures: null,
    },
  };
}

/** The production checklist's own item a report is made from: the FAT or the inspection. */
export function reportItem(c: { o: PaperOrder }, kind: "fat-report" | "inspection-report") {
  const re = kind === "fat-report" ? /\bFAT\b|factory (acceptance |test)/i : /inspection/i;
  return (
    c.o.checklist.find((i) => i.paper === kind) ??
    c.o.checklist.find((i) => i.step === "production" && re.test(i.title ?? "") && (!i.route || i.route === c.o.paymentRoute)) ??
    null
  );
}

function report(c: PaperCtx, kind: "fat-report" | "inspection-report"): Built {
  const item = reportItem(c, kind);
  const fields = (Array.isArray(item?.fields) ? item.fields : []) as unknown as { key: string; label: string; type: string }[];
  const values = (item?.data && typeof item.data === "object" && !Array.isArray(item.data) ? item.data : {}) as Record<string, string>;
  const pairs = fields
    .filter((f) => values[f.key])
    .map((f) => ({
      label: `${f.label}:`,
      value: (f.type === "file" ? `${c.fileNames.get(values[f.key]!) ?? "file"} (kept with the order)` : values[f.key]) as PaperCell,
      type: f.type,
      key: f.key,
    }));
  const day = pairs.find((p) => p.type === "date")?.value as string | undefined;
  const result = values.result ?? values.passed ?? null;
  const done = !!item?.doneAt;
  const what = kind === "fat-report" ? "FAT" : "inspection";
  return {
    checks: [
      check(
        "item",
        kind === "fat-report" ? "The FAT item" : "The inspection item",
        item?.title ?? `no ${what} item on the Production checklist`,
        !!item,
        { required: true, href: "production" },
      ),
      check(
        "done",
        "Recorded",
        done
          ? pairs
              .filter((p) => p.type !== "file")
              .map((p) => `${p.label} ${p.value}`)
              .join(" · ") || "ticked"
          : "not ticked yet",
        done,
        { required: true, href: "production" },
      ),
      ...(item?.attachment && !item.attachment.deletedAt ? [check("file", "File", item.attachment.fileName, true)] : []),
    ],
    doc: {
      date: day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : item?.doneAt ? item.doneAt.toISOString().slice(0, 10) : c.today,
      meta: [{ label: "Order No.", value: c.o.refNo }, ...(result ? [{ label: "Result", value: result }] : [])],
      heading: c.o.documentTitle,
      columns: [COL.no, COL.item, COL.qty, { key: "result", label: "Result", width: 90, wrap: true }],
      rows: itemRows(c, true).map((r) => ({
        no: r.cells.no!,
        item: r.cells.item!,
        qty: r.cells.qty!,
        result: result ?? (done ? "Passed" : ""),
      })),
      sums: [],
      total: null,
      foot: null,
      boxTitle: kind === "fat-report" ? "Factory acceptance test" : "Inspection",
      bullets: [
        ...pairs
          .filter((p) => p.type !== "date" || p.value !== day)
          .map((p) => ({ label: p.label, value: p.type === "date" ? date(p.value as string) : p.value })),
        ...(day ? [{ label: "Date:", value: date(day) }] : []),
        ...(item?.attachment && !item.attachment.deletedAt
          ? [{ label: "File:", value: `${item.attachment.fileName} (kept with the order)` }]
          : []),
        ...(item?.note ? [item.note] : []),
        ...(item?.doneBy ? [{ label: "Recorded by:", value: item.doneBy.name }] : []),
      ],
      bank: null,
      signatures: { left: kind === "fat-report" ? "Tested by" : "Inspected by", right: "Witnessed by" },
    },
  };
}

function deliveryNote(c: PaperCtx): Built {
  const on = fromDbDateOrNull(c.o.deliveredOn);
  const condition = c.o.deliveryCondition ? DELIVERY_CONDITION_LABEL[c.o.deliveryCondition] : null;
  return {
    checks: [
      check("delivered", "Delivered on", on ? paperDateText(on) : "not recorded", !!on, { required: true, href: "delivery" }),
      check("condition", "Condition", condition ?? "not recorded", !!condition, { href: "delivery" }),
      linesCheck(c, c.o.lines.filter((l) => l.type === "goods").length),
    ],
    doc: {
      date: on ?? c.today,
      meta: [{ label: "Order No.", value: c.o.refNo }],
      heading: c.o.documentTitle,
      columns: [
        COL.no,
        COL.item,
        COL.qty,
        { key: "delivered", label: "Delivered", width: 62 },
        { key: "condition", label: "Condition", width: 82, wrap: true },
      ],
      rows: itemRows(c, true).map((r) => ({
        no: r.cells.no!,
        item: r.cells.item!,
        qty: r.cells.qty!,
        delivered: on ? r.cells.qty! : "",
        condition: condition ?? "",
      })),
      sums: [],
      total: null,
      foot: null,
      boxTitle: "Delivery",
      bullets: [
        ...(on ? [{ label: "Delivered on:", value: date(on) }] : []),
        ...(condition ? [{ label: "Condition:", value: condition }] : []),
        ...bullets(c.o.deliveryNote),
        "Received the goods above in the condition stated.",
      ],
      bank: null,
      signatures: { left: `Delivered by · ${c.company.name}`, right: `Received by · ${c.customer.name}` },
    },
  };
}

function satCertificate(c: PaperCtx): Built {
  const checks = c.o.satChecks;
  const passed = checks.filter((x) => x.result === "pass" || x.result === "not_applicable").length;
  const failed = checks.filter((x) => x.result === "fail").length;
  const on = fromDbDateOrNull(c.o.satDoneOn);
  return {
    checks: [
      check(
        "checks",
        "SAT checks",
        checks.length ? `${passed} of ${checks.length} passed${failed ? `, ${failed} failed` : ""}` : "no SAT list yet",
        checks.length > 0 && passed === checks.length,
        {
          required: true,
          href: "delivery",
        },
      ),
      check("done", "Signed off on", on ? paperDateText(on) : "not yet", !!on, { required: true, href: "delivery" }),
      check("by", "Signed by", c.o.satSignedBy ?? "not recorded", !!c.o.satSignedBy, { href: "delivery" }),
      check("warranty", "Warranty", c.settings.sales.warrantyTerms ? "from Settings" : "not set", !!c.settings.sales.warrantyTerms, {
        href: "/settings?tab=sales",
      }),
    ],
    doc: {
      date: on ?? c.today,
      meta: [{ label: "Order No.", value: c.o.refNo }],
      heading: c.o.documentTitle,
      columns: [
        { key: "no", label: "No.", width: 32 },
        { key: "check", label: "Check" },
        { key: "result", label: "Result", width: 62 },
        { key: "note", label: "Note", width: 130, wrap: true },
      ],
      rows: checks.map((x, i) => ({ no: String(i + 1), check: x.item, result: SAT_RESULT_LABEL[x.result], note: x.note ?? "" })),
      sums: [],
      total: null,
      foot: null,
      boxTitle: "Result",
      bullets: [
        ...(on ? [`Machine accepted by the customer on ${paperDateText(on)}.`] : []),
        ...(on ? [{ label: "Warranty starts:", value: date(on) }] : []),
        ...bullets(c.settings.sales.warrantyTerms),
        ...(c.o.satSignedBy ? [{ label: "Signed for the customer:", value: c.o.satSignedBy }] : []),
        ...(c.o.satEngineer ? [{ label: "Our engineer:", value: c.o.satEngineer.name }] : []),
      ],
      bank: null,
      signatures: { left: `For the seller · ${c.company.name}`, right: `For the buyer · ${c.customer.name}` },
    },
  };
}

/** The LC's checks shared by the bank papers. */
function lcChecks(c: PaperCtx, need: ("lcNo" | "customerBank" | "ourBank")[]) {
  const b = c.o.bankContract;
  const out: PaperCheck[] = [
    check("lcNo", LC(c) ? "LC number" : "Contract number", b?.number ?? "needed", !!b?.number, {
      required: need.includes("lcNo"),
      fix: "lcNo",
    }),
    check("customerBank", "Customer's bank", b?.customerBank ?? "needed", !!b?.customerBank, {
      required: need.includes("customerBank"),
      fix: "customerBank",
    }),
    check("ourBank", "Our bank", b?.ourBank ?? "needed", !!b?.ourBank, { required: need.includes("ourBank"), fix: "ourBank" }),
  ];
  return out;
}

function lcAmount(c: PaperCtx) {
  const b = c.o.bankContract;
  return b?.amount !== null && b?.amount !== undefined
    ? { amount: b.amount.toFixed(2), currency: b.currency ?? c.o.currency }
    : { amount: linesOf(c).total, currency: c.o.currency };
}

function billOfExchange(c: PaperCtx): Built {
  const b = c.o.bankContract;
  const a = lcAmount(c);
  const opened = fromDbDateOrNull(b?.openedOn);
  const ci = paperNumber(c.o.refNo, "commercial-invoice");
  return {
    checks: [
      ...lcChecks(c, ["lcNo", "customerBank"]),
      check("amount", "Amount", paperMoneyText(a.amount, a.currency), Number(a.amount) > 0, { required: true }),
    ],
    doc: {
      party: { name: b?.customerBank ?? "The issuing bank" },
      date: c.today,
      meta: [
        { label: "LC No.", value: b?.number ?? null },
        { label: "Order No.", value: c.o.refNo },
      ],
      heading: null,
      columns: [COL.no, COL.item, COL.qty],
      rows: itemRows(c).map((r) => ({ no: r.cells.no!, item: r.cells.item!, qty: r.cells.qty! })),
      sums: [],
      total: { label: "Exchange for", amount: Number(a.amount).toFixed(2), currency: a.currency },
      foot: null,
      boxTitle: "Exchange",
      bullets: [
        `At ______ sight of this FIRST of Exchange (SECOND of the same tenor and date being unpaid) pay to the order of ${b?.ourBank ?? "our bank"} the sum of ${paperWordsText(a.amount, a.currency)}.`,
        `Drawn under ${b?.customerBank ?? "the issuing bank"} letter of credit No. ${b?.number ?? "______"}${opened ? ` dated ${paperDateText(opened)}` : ""}.`,
        `Value received, as per our commercial invoice ${ci}.`,
      ],
      bank: null,
      signatures: { left: `For and on behalf of ${c.company.name}`, right: "Authorised signature" },
    },
  };
}

function beneficiaryCertificate(c: PaperCtx): Built {
  const b = c.o.bankContract;
  const clauses = bullets(b?.note);
  return {
    checks: [
      ...lcChecks(c, ["lcNo"]),
      check(
        "clauses",
        "What the LC asks us to certify",
        clauses.length ? `${clauses.length} from the LC's note` : "the usual statements (none in the LC's note)",
        clauses.length > 0,
        { href: "payment" },
      ),
    ],
    doc: {
      date: c.today,
      meta: [
        { label: "LC No.", value: b?.number ?? null },
        { label: "Invoice No.", value: paperNumber(c.o.refNo, "commercial-invoice") },
      ],
      heading: c.o.documentTitle,
      columns: [COL.no, COL.item, COL.qty],
      rows: itemRows(c).map((r) => ({ no: r.cells.no!, item: r.cells.item!, qty: r.cells.qty! })),
      sums: [],
      total: null,
      foot: null,
      boxTitle: "We certify that",
      bullets: clauses.length
        ? clauses
        : [
            "One full set of non-negotiable shipping documents has been sent to the applicant after shipment.",
            "The goods are brand new, made in China, and as per the contract and the LC.",
            `The goods were shipped under LC No. ${b?.number ?? "______"}${b?.customerBank ? ` issued by ${b.customerBank}` : ""}.`,
          ],
      bank: null,
      signatures: { left: `For and on behalf of ${c.company.name}`, right: "Authorised signature" },
    },
  };
}

/** How many originals and copies of each paper go to the bank. */
const SETS: Partial<Record<OrderDocumentKind | PaperKind, [number, number]>> = {
  bill_of_lading: [3, 3],
  airway_bill: [1, 2],
  commercial_invoice: [3, 3],
  packing_list: [3, 3],
  certificate_of_origin: [1, 2],
  insurance: [2, 1],
  proforma_invoice: [1, 1],
  sales_contract: [1, 1],
  inspection: [1, 2],
  "bill-of-exchange": [2, 0],
  "beneficiary-certificate": [1, 1],
};

function coverLetter(c: PaperCtx): Built {
  const b = c.o.bankContract;
  const mode = c.o.shipments[0]?.mode ?? "sea";
  const set = requiredDocuments(c.o.paymentRoute, mode);
  const numberOf = (kind: OrderDocumentKind) => {
    const row = c.o.documents.find((d) => d.kind === kind && d.number);
    if (row) return row.number;
    if (kind === "proforma_invoice") return c.o.proformaNo;
    if (kind === "packing_list") return paperNumber(c.o.refNo, "commercial-invoice").replace(/^CI-/, "PL-");
    if (kind === "bill_of_lading" || kind === "airway_bill") return c.o.shipments[0]?.blNo ?? c.o.blNo;
    return null;
  };
  const papers: { label: string; number: string | null; set: [number, number] }[] = [
    ...set.map((k) => ({ label: ORDER_DOCUMENT_LABEL[k], number: numberOf(k), set: SETS[k] ?? [1, 1] })),
    ...(LC(c)
      ? (["bill-of-exchange", "beneficiary-certificate"] as const).map((k) => ({
          label: k === "bill-of-exchange" ? "Bill of exchange" : "Beneficiary certificate",
          number: paperNumber(c.o.refNo, k),
          set: SETS[k]!,
        }))
      : []),
  ];
  const a = lcAmount(c);
  return {
    checks: [...lcChecks(c, ["lcNo", "ourBank"]), check("set", "The paper set", `${papers.length} papers`, papers.length > 0)],
    doc: {
      party: { name: b?.ourBank ?? "Our bank" },
      date: c.today,
      meta: [
        { label: `${lcWord(c)} No.`, value: b?.number ?? null },
        { label: "Order No.", value: c.o.refNo },
      ],
      heading: null,
      columns: [
        { key: "no", label: "No.", width: 32 },
        { key: "item", label: "Document" },
        { key: "number", label: "Number", width: 120, wrap: true },
        { key: "originals", label: "Originals", width: 60, align: "right" },
        { key: "copies", label: "Copies", width: 50, align: "right" },
      ],
      rows: papers.map((p, i) => ({
        no: String(i + 1),
        item: p.label,
        number: p.number ?? "",
        originals: String(p.set[0]),
        copies: String(p.set[1]),
      })),
      sums: [],
      total: { label: LC(c) ? "Amount drawn" : "Amount", amount: Number(a.amount).toFixed(2), currency: a.currency },
      foot: null,
      boxTitle: "Please",
      bullets: [
        `Present these documents to ${b?.customerBank ?? "the customer's bank"} under ${LC(c) ? "letter of credit" : "contract"} No. ${b?.number ?? "______"}, for ${paperMoneyText(a.amount, a.currency)}.`,
        "Send them by courier and credit the proceeds to our account below.",
        `Customer: ${c.customer.name}.`,
      ],
      bank: c.settings.company.bankDetails || null,
      signatures: { left: `For and on behalf of ${c.company.name}`, right: "Authorised signature" },
    },
  };
}

function customerStatement(c: PaperCtx): Built {
  const s = c.statement ?? { orders: [], payments: [] };
  const due = s.orders.filter((x) => x.currency === c.o.currency).reduce((t, x) => t + Number(x.due), 0);
  return {
    checks: [
      check(
        "orders",
        "Orders",
        `${s.orders.length} order${s.orders.length === 1 ? "" : "s"} · ${s.payments.length} payment${s.payments.length === 1 ? "" : "s"}`,
        s.orders.length > 0,
        { required: true },
      ),
    ],
    doc: {
      date: c.today,
      meta: [{ label: "Currency", value: c.o.currency }],
      heading: null,
      columns: [
        { key: "no", label: "No.", width: 32 },
        { key: "item", label: "Order" },
        { key: "date", label: "Date", width: 76 },
        { key: "total", label: "Total", width: 84, align: "right" },
        { key: "received", label: "Received", width: 84, align: "right" },
        { key: "due", label: "Due", width: 84, align: "right" },
      ],
      rows: s.orders.map((x, i) => ({
        no: String(i + 1),
        item: x.refNo,
        date: date(x.orderedOn),
        total: money(x.total, x.currency),
        received: money(x.received, x.currency),
        due: money(x.due, x.currency),
      })),
      sums: [],
      total: { label: `Balance due`, amount: due.toFixed(2), currency: c.o.currency },
      foot: null,
      boxTitle: "Payments received",
      bullets: s.payments.length
        ? s.payments.slice(-15).map((p) => ({ label: `${paperDateText(p.paidOn)} · ${p.refNo}:`, value: money(p.amount, p.currency) }))
        : ["No payments yet."],
      bank: c.settings.company.bankDetails || null,
      signatures: null,
    },
  };
}

export const BUILDERS: Record<PaperKind, (c: PaperCtx) => Built> = {
  "sales-contract": salesContract,
  "payment-request": paymentRequest,
  "payment-receipt": paymentReceipt,
  "customer-statement": customerStatement,
  "purchase-order": purchaseOrder,
  "fat-report": (c) => report(c, "fat-report"),
  "inspection-report": (c) => report(c, "inspection-report"),
  "commercial-invoice": commercialInvoice,
  "shipping-advice": shippingAdvice,
  "bill-of-exchange": billOfExchange,
  "beneficiary-certificate": beneficiaryCertificate,
  "bank-cover-letter": coverLetter,
  "delivery-note": deliveryNote,
  "sat-certificate": satCertificate,
};

/** The lines still without an HS code (the Make page asks for each). */
export const hsMissing = (c: PaperCtx) => hsOf(c).missing;
