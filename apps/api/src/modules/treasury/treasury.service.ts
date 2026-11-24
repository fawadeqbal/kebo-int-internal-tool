import { Injectable } from "@nestjs/common";
import { liveFile, decimalToMinor, fromDbDate, isCustomer, orderPart, toDbDate, type Prisma } from "@kebo/database";
import {
  can,
  EXPENSE_CATEGORY_LABEL,
  PAYMENT_KIND_LABEL,
  PAYMENT_METHOD_LABEL,
  PAYMENT_TITLE,
  paperDateText,
  paperNumber,
  type ExpenseCategory,
  type PaymentDirection,
  type PaymentKind,
  type PaymentList,
  type PaymentMethod,
  type PaymentRecordKind,
  type PaymentRow,
  type PaymentStatus,
  type PaymentView,
  type PaymentPaper,
  type PaperDoc,
} from "@kebo/shared";
import { convert, fromMinor, fxRate, orderRate } from "@kebo/money";
import { ForbiddenError, NotFoundError, type ISODate } from "@kebo/utils";
import { PrismaService } from "../../database/prisma.service";
import type { SessionUser } from "../../common/auth/session-user";
import { LimitsService } from "../../common/company/limits.service";
import { companySnapshot, SettingsService } from "../settings/settings.service";
import { orderAccess } from "../../common/auth/order-access";
import { customerAccess } from "../parties/customers.service";

export interface PaymentsQuery {
  from?: ISODate;
  to?: ISODate;
  dir?: PaymentDirection;
  status?: "to_verify" | "void";
  q?: string;
  order?: string;
  party?: string;
  /** Only expenses. */
  kind?: "expense";
  account?: string;
  /** A method's label ("Bank transfer"). */
  method?: string;
  page: number;
  pageSize: number;
}

/** The ledger's name for each record (ledger_entries.source_type). */
const LEDGER_SOURCE: Partial<Record<PaymentRecordKind, string>> = {
  customer: "movement",
  credit: "allocation",
  refund: "movement",
  supplier: "movement",
  expense: "expense",
  transfer: "movement",
};

const name = { select: { id: true, name: true } } as const;
/** "Sana" of "Sana Malik". */
const first = (u: { name: string } | null | undefined) => u?.name.split(" ")[0] ?? null;
/** The rows' amounts added up per currency, largest first. */
function sums(rows: { amount: string; currency: string }[]): { currency: string; amount: string }[] {
  const by = new Map<string, number>();
  for (const r of rows) by.set(r.currency, (by.get(r.currency) ?? 0) + decimalToMinor(r.amount));
  return [...by.entries()].sort((a, b) => b[1] - a[1]).map(([currency, minor]) => ({ currency, amount: (minor / 100).toFixed(2) }));
}
const orderRef = { select: { id: true, refNo: true } } as const;
const money = (d: Prisma.Decimal) => d.toFixed(2);
/** "USD 14,692.15": an amount as a page shows it. */
const amount = (currency: string, d: Prisma.Decimal) =>
  `${currency} ${Number(d).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const statusOf = (voidedAt: Date | null): PaymentStatus => (voidedAt ? "void" : "recorded");
const customerLink = (c: { id: string; name: string } | null) => (c ? { label: c.name, href: `/customers/${c.id}` } : null);
const supplierLink = (f: { id: string; name: string }) => ({ label: f.name, href: `/factories/${f.id}` });
const orderLink = (o: { id: string; refNo: string }) => ({ label: o.refNo, href: `/orders/${o.id}` });
/** A record's file as its page shows and changes it. */
const fileOf = (f: { id: string; fileName: string; mimeType: string; size: number } | undefined) =>
  f ? { id: f.id, name: f.fileName, type: f.mimeType, size: f.size, href: `/files/${f.id}` } : null;
/** A foreign amount in the main currency: amount ÷ rate (units of its currency per one of the main), or null when it is the main currency or no rate is known. */
const inMainOf = (amount: Prisma.Decimal, currency: string, main: string, rate: number | null) =>
  currency === main || !rate ? null : { amount: fromMinor(convert(decimalToMinor(amount), rate)), currency: main, rate: String(Number(rate.toFixed(6))) };

/** What this person sees and records on Treasury › Payments: the same rules as the pages that hold these records. */
interface Scope {
  customer: boolean;
  supplier: boolean;
  expense: boolean;
  transfer: boolean;
  /** Kinds of sent-for-approval money this person approves. */
  approves: ("payment" | "expense")[];
  submits: boolean;
  /** Sees every record (the ledger's readers), not only those of the deals they handle. */
  all: boolean;
}

/**
 * Treasury › Payments (read only): every payment in and out, from the records that hold them
 * today: customer payment entries (one per transfer, whatever it pays), orders paid from credit, refunds, supplier
 * payments, expenses, moves between our accounts, and what staff sent for approval. Recording
 * and removing stay with those records; this only lists them and shows one.
 */
@Injectable()
export class TreasuryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limits: LimitsService,
    private readonly settings: SettingsService,
  ) {}

  private async scope(user: SessionUser): Promise<Scope> {
    const all = can(user, "ledger.view");
    const managers = can(user, "expenses.manage") || all;
    const [expenses, cashBook] = await Promise.all([this.limits.allows("expenses"), this.limits.allows("cash_book")]);
    const approves: Scope["approves"] = [];
    if (can(user, "payments.record")) approves.push("payment");
    if (can(user, "expenses.manage") && expenses) approves.push("expense");
    return {
      customer: all || can(user, "payments.record") || can(user, "sourcing.manage") || can(user, "expenses.manage"),
      supplier: all || can(user, "sourcing.manage"),
      expense: managers && expenses,
      transfer: managers && cashBook,
      approves,
      submits: can(user, "money.submit"),
      all,
    };
  }

  private canRecord(user: SessionUser, s: Scope): PaymentList["canRecord"] {
    return {
      in: can(user, "payments.record"),
      out: can(user, "payments.record") && can(user, "sourcing.manage"),
      expense: can(user, "expenses.manage") && s.expense,
      transfer: can(user, "expenses.manage") && s.transfer,
    };
  }

  /** Whether this person opens Treasury › Payments at all. */
  async opens(user: SessionUser) {
    const s = await this.scope(user);
    return s.customer || s.supplier || s.expense || s.transfer || s.approves.length > 0 || s.submits;
  }

  async list(user: SessionUser, q: PaymentsQuery): Promise<PaymentList> {
    const s = await this.scope(user);
    if (!(s.customer || s.supplier || s.expense || s.transfer || s.approves.length || s.submits))
      throw new ForbiddenError("You do not see payments.");
    const rows = await this.rows(user, s, q);
    const term = q.q?.trim().toLowerCase();
    const found = term
      ? rows.filter((r) =>
          [r.what, r.number, r.reference, r.party?.label, r.account, ...r.for.map((f) => f.label)].some((v) =>
            v?.toLowerCase().includes(term),
          ),
        )
      : rows;
    // Each tab's count is exactly what that tab lists: the same search, account and method; removed ones only under Removed.
    const narrowed = found.filter((r) => !q.account || r.accountId === q.account).filter((r) => !q.method || r.method === q.method);
    const kept = narrowed.filter((r) => r.status !== "void");
    const counts = {
      all: kept.length,
      in: kept.filter((r) => r.direction === "in").length,
      out: kept.filter((r) => r.direction === "out").length,
      move: kept.filter((r) => r.direction === "move").length,
      to_verify: narrowed.filter((r) => r.status === "to_verify").length,
      expense: kept.filter((r) => r.kind === "expense").length,
      void: narrowed.filter((r) => r.status === "void").length,
    };
    const live = found.filter((r) => r.status === "recorded" && !r.fromCredit);
    const moneyIn = live.filter((r) => r.direction === "in");
    const moneyOut = live.filter((r) => r.direction === "out" && r.kind !== "expense");
    const totals = {
      in: sums(moneyIn),
      inCount: moneyIn.length,
      out: sums(moneyOut),
      outCount: moneyOut.length,
      toVerify: sums(found.filter((r) => r.status === "to_verify")),
      expenses: sums(live.filter((r) => r.kind === "expense")),
    };
    const accounts = [...new Map(rows.filter((r) => r.accountId && r.account).map((r) => [r.accountId!, { id: r.accountId!, name: r.account! }])).values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    const methods = [...new Set(rows.map((r) => r.method).filter((m): m is string => !!m))].sort();
    const shown = found
      .filter((r) => !q.dir || r.direction === q.dir)
      .filter((r) => !q.kind || r.kind === q.kind)
      .filter((r) => !q.account || r.accountId === q.account)
      .filter((r) => !q.method || r.method === q.method)
      .filter((r) => (q.status ? r.status === q.status : r.status !== "void"))
      // Newest first; what waits for a manager stays on top of its day.
      .sort(
        (a, b) =>
          b.on.localeCompare(a.on) || Number(b.status === "to_verify") - Number(a.status === "to_verify") || a.id.localeCompare(b.id),
      );
    const page = shown.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
    await this.numberRows(page);
    const scope = q.order
      ? ((await this.prisma.db.order.findFirst({ where: { id: q.order, ...(s.all ? {} : orderAccess(user)) }, select: { refNo: true } }))?.refNo ?? null)
      : q.party
        ? ((await this.prisma.db.party.findFirst({ where: { id: q.party }, select: { name: true } }))?.name ?? null)
        : null;
    return { rows: page, total: shown.length, page: q.page, pageSize: q.pageSize, counts, totals, accounts, methods, scope, canRecord: this.canRecord(user, s) };
  }

  /** Every row this person sees in the period and filters (numbers are added for the page shown); `only`: one record. */
  private async rows(
    user: SessionUser,
    s: Scope,
    q: Omit<PaymentsQuery, "page" | "pageSize">,
    only?: { kind: PaymentRecordKind; id: string },
  ): Promise<PaymentRow[]> {
    /** For each record: whether to read it, and the id to read when only one is wanted. */
    const pick = (...kinds: PaymentRecordKind[]) => (only ? (kinds.includes(only.kind) ? { id: only.id } : null) : {});
    const range = q.from || q.to ? { ...(q.from ? { gte: toDbDate(q.from) } : {}), ...(q.to ? { lte: toDbDate(q.to) } : {}) } : undefined;
    const access: Prisma.OrderWhereInput = s.all ? {} : orderAccess(user);
    const onOrder: Prisma.OrderWhereInput = { ...access, ...(q.order ? { id: q.order } : {}) };
    const parties: Prisma.PartyWhereInput = s.all ? {} : customerAccess(user);
    const party = q.party;
    const out: PaymentRow[] = [];

    // Customer money this person sees: on the orders of the deals they handle, or of the customers they handle.
    const seen: Prisma.MoneyMovementWhereInput = s.all ? {} : { OR: [{ allocations: { some: { order: access } } }, { party: parties }] };
    const [entries, fromCredit, refunds, supplierPaid, expenses, transfers, submissions] = await Promise.all([
      // A customer's payment entry: one transfer, listed once whatever it pays.
      s.customer && pick("customer")
        ? this.prisma.db.moneyMovement.findMany({
            where: {
              ...pick("customer"),
              direction: "in",
              party: isCustomer,
              ...seen,
              ...(range ? { valueDate: range } : {}),
              ...(party ? { partyId: party } : {}),
              ...(q.order ? { allocations: { some: { orderId: q.order, order: access } } } : {}),
            },
            include: {
              party: name,
              account: name,
              recordedBy: name,
              allocations: { where: { later: false, ...orderPart }, select: { kind: true, amount: true, voidedAt: true, order: orderRef } },
            },
          })
        : [],
      // An order paid later from the customer's credit (no money moved).
      s.customer && pick("credit")
        ? this.prisma.db.allocation.findMany({
            where: {
              ...pick("credit"),
              ...orderPart,
              later: true,
              order: onOrder,
              ...(range ? { on: range } : {}),
              ...(party ? { movement: { partyId: party } } : {}),
            },
            include: { order: orderRef, movement: { select: { allocCurrency: true, party: name } } },
          })
        : [],
      s.customer && !q.order && pick("refund")
        ? this.prisma.db.moneyMovement.findMany({
            where: {
              ...pick("refund"),
              direction: "out",
              party: { ...isCustomer, ...parties },
              ...(range ? { valueDate: range } : {}),
              ...(party ? { partyId: party } : {}),
            },
            include: { party: name, account: name, recordedBy: name },
          })
        : [],
      s.supplier && pick("supplier")
        ? this.prisma.db.allocation.findMany({
            // A supplier payment, listed as its payment on the order (its part).
            where: {
              ...pick("supplier"),
              target: "purchase",
              purchaseOrder: onOrder,
              ...(range ? { on: range } : {}),
              ...(party ? { movement: { partyId: party } } : {}),
            },
            include: { purchaseOrder: orderRef, movement: { include: { party: name, account: name, recordedBy: name } } },
          })
        : [],
      s.expense && pick("expense")
        ? this.prisma.db.expense.findMany({
            where: {
              ...pick("expense"),
              ...(q.order ? { orderId: q.order } : {}),
              AND: [
                // A bill known before it is paid is a payment on the day it is paid, and not one until then.
                range
                  ? { OR: [{ payLater: false, spentOn: range }, { payLater: true, repaidOn: range }] }
                  : { OR: [{ payLater: false }, { payLater: true, repaidOn: { not: null } }] },
                ...(party ? [{ OR: [{ customerId: party }, { factoryId: party }] }] : []),
              ],
            },
            include: {
              order: orderRef,
              inquiry: orderRef,
              customer: name,
              factory: name,
              account: { select: { id: true, name: true, kind: true } },
              repaidAccount: { select: { id: true, name: true, kind: true } },
              paidBy: name,
              recordedBy: name,
            },
          })
        : [],
      s.transfer && !q.order && !party && pick("transfer")
        ? this.prisma.db.moneyMovement.findMany({
            where: { ...pick("transfer"), direction: "move", ...(range ? { valueDate: range } : {}) },
            include: { account: name, toAccount: name, recordedBy: name },
          })
        : [],
      (s.approves.length || s.submits) && pick("submission")
        ? this.prisma.db.moneySubmission.findMany({
            where: {
              ...pick("submission"),
              status: { in: ["pending", "sent_back"] },
              ...(q.order ? { orderId: q.order } : {}),
              OR: [
                ...(s.submits ? [{ submittedById: user.id }] : []),
                ...(s.approves.length ? [{ kind: { in: s.approves }, OR: [{ orderId: null }, { order: { is: access } }] }] : []),
              ],
            },
            include: { order: { select: { id: true, refNo: true, currency: true, customer: name } }, submittedBy: name },
          })
        : [],
    ]);

    for (const m of entries) {
      const parts = m.allocations.filter((a) => a.order);
      const orders = [...new Map(parts.map((p) => [p.order!.id, p.order!])).values()];
      const one = parts.length === 1 ? parts[0]! : null;
      out.push({
        kind: "customer",
        id: m.id,
        number: null,
        on: fromDbDate(m.valueDate),
        direction: "in",
        what: one
          ? `${PAYMENT_KIND_LABEL[one.kind as PaymentKind]} for ${one.order!.refNo}${decimalToMinor(m.allocatable) > decimalToMinor(one.amount) ? ", the rest to credit" : ""}`
          : orders.length
            ? `One transfer for ${orders.map((o) => o.refNo).join(", ")}`
            : "Into the customer's credit",
        name: PAYMENT_TITLE.received(m.party?.name, one ? PAYMENT_KIND_LABEL[one.kind as PaymentKind] : null),
        // What arrived, in the currency it arrived in (the bank statement's figure).
        amount: money(m.amount),
        currency: m.currency,
        party: customerLink(m.party),
        for: orders.map(orderLink),
        account: m.account?.name ?? null,
        reference: m.reference,
        status: statusOf(m.voidedAt),
        fromCredit: false,
        method: PAYMENT_METHOD_LABEL[m.method],
        by: first(m.recordedBy),
        accountId: m.accountId,
      });
    }
    for (const a of fromCredit)
      out.push({
        kind: "credit",
        id: a.id,
        number: a.receiptNo ? paperNumber(a.order!.refNo, "payment-receipt", a.receiptNo) : null,
        on: fromDbDate(a.on),
        direction: "in",
        what: `${PAYMENT_KIND_LABEL[a.kind as PaymentKind]} from the customer's credit`,
        name: PAYMENT_TITLE.fromCredit(a.movement.party?.name, PAYMENT_KIND_LABEL[a.kind as PaymentKind]),
        amount: money(a.amount),
        currency: a.movement.allocCurrency,
        party: customerLink(a.movement.party),
        for: [orderLink(a.order!)],
        account: null,
        reference: null,
        status: statusOf(a.voidedAt),
        fromCredit: true,
        method: "From credit",
        by: null,
        accountId: null,
      });
    for (const m of refunds)
      out.push({
        kind: "refund",
        id: m.id,
        number: null,
        on: fromDbDate(m.valueDate),
        direction: "out",
        what: `Credit refunded${m.note ? `: ${m.note}` : ""}`,
        name: PAYMENT_TITLE.refund(m.party?.name),
        amount: money(m.amount),
        currency: m.currency,
        party: customerLink(m.party),
        for: [],
        account: m.account?.name ?? null,
        reference: null,
        status: statusOf(m.voidedAt),
        fromCredit: false,
        method: PAYMENT_METHOD_LABEL[m.method],
        by: first(m.recordedBy),
        accountId: m.accountId,
      });
    for (const p of supplierPaid)
      out.push({
        kind: "supplier",
        id: p.id,
        number: null,
        on: fromDbDate(p.on),
        direction: "out",
        what: `${PAYMENT_KIND_LABEL[p.kind as PaymentKind]} to the supplier for ${p.purchaseOrder!.refNo}`,
        name: PAYMENT_TITLE.paid(p.movement.party?.name, PAYMENT_KIND_LABEL[p.kind as PaymentKind]),
        amount: money(p.share),
        currency: p.movement.currency,
        party: supplierLink(p.movement.party!),
        for: [orderLink(p.purchaseOrder!)],
        account: p.movement.account?.name ?? null,
        reference: p.movement.reference,
        status: statusOf(p.voidedAt ?? p.movement.voidedAt),
        fromCredit: false,
        method: PAYMENT_METHOD_LABEL[p.movement.method],
        by: first(p.movement.recordedBy),
        accountId: p.movement.accountId,
      });
    for (const e of expenses) {
      // A bill paid later: the day and the account are those of its payment.
      const from = e.payLater ? e.repaidAccount : e.account;
      out.push({
        kind: "expense",
        id: e.id,
        number: null,
        on: fromDbDate(e.payLater && e.repaidOn ? e.repaidOn : e.spentOn),
        direction: "out",
        what: `${EXPENSE_CATEGORY_LABEL[e.category as ExpenseCategory] ?? e.category}: ${e.description}`,
        name: PAYMENT_TITLE.expense(e.description, EXPENSE_CATEGORY_LABEL[e.category as ExpenseCategory] ?? e.category),
        amount: money(e.amount),
        currency: e.currency,
        // Who was paid: the payee typed on it, else the supplier it was charged to; never the customer it was for.
        party: e.payee ? { label: e.payee, href: null } : e.factory ? supplierLink(e.factory) : null,
        for: e.order ? [orderLink(e.order)] : e.inquiry ? [{ label: e.inquiry.refNo, href: `/inquiries/${e.inquiry.id}` }] : [],
        account: e.ownMoney ? `${e.paidBy?.name ?? "Someone"}'s own money` : (from?.name ?? null),
        reference: e.reference,
        status: statusOf(e.voidedAt),
        fromCredit: false,
        method: e.ownMoney ? "Own money" : from?.kind === "cash" ? "Cash" : from ? "Bank transfer" : null,
        by: first(e.recordedBy),
        accountId: e.payLater ? e.repaidAccountId : e.accountId,
      });
    }
    for (const t of transfers)
      out.push({
        kind: "transfer",
        id: t.id,
        number: null,
        on: fromDbDate(t.valueDate),
        direction: "move",
        what: `${t.account!.name} → ${t.toAccount!.name}${t.note ? `: ${t.note}` : ""}`,
        name: PAYMENT_TITLE.transfer(t.account!.name, t.toAccount!.name),
        amount: money(t.amount),
        currency: t.currency,
        party: null,
        for: [],
        account: t.account!.name,
        reference: t.reference,
        status: statusOf(t.voidedAt),
        fromCredit: false,
        method: "Transfer",
        by: first(t.recordedBy),
        accountId: t.accountId,
      });
    for (const m of submissions) {
      const b = (m.body ?? {}) as Record<string, unknown>;
      const amount = String(b.receivedAmount ?? b.amount ?? "0");
      const currency = String(b.receivedCurrency ?? b.currency ?? m.order?.currency ?? "");
      const on = String(b.paidOn ?? b.spentOn ?? fromDbDate(m.submittedAt));
      if (range && ((q.from && on < q.from) || (q.to && on > q.to))) continue;
      out.push({
        kind: "submission",
        id: m.id,
        number: null,
        on,
        direction: m.kind === "payment" ? "in" : "out",
        what: m.kind === "payment" ? `Money received${m.order ? ` for ${m.order.refNo}` : ""}` : `Expense: ${String(b.description ?? "")}`,
        name: m.kind === "payment" ? PAYMENT_TITLE.received(m.order?.customer?.name) : PAYMENT_TITLE.expense(typeof b.description === "string" ? b.description : null),
        amount: Number(amount).toFixed(2),
        currency,
        party: m.order ? customerLink(m.order.customer) : null,
        for: m.order ? [orderLink(m.order)] : [],
        account: null,
        reference: typeof b.reference === "string" ? b.reference : null,
        status: m.status === "pending" ? "to_verify" : "sent_back",
        fromCredit: false,
        method: typeof b.method === "string" && b.method in PAYMENT_METHOD_LABEL ? PAYMENT_METHOD_LABEL[b.method as PaymentMethod] : null,
        by: first(m.submittedBy),
        accountId: typeof b.accountId === "string" ? b.accountId : null,
      });
    }
    return out;
  }

  /** The number each record was posted under in the ledger (one query for the page). */
  /** The ledger document of a row: a supplier payment is listed by its part, posted by its entry. */
  private async sourceIds(rows: PaymentRow[]) {
    const parts = rows.filter((r) => r.kind === "supplier").map((r) => r.id);
    const entries = parts.length
      ? await this.prisma.db.allocation.findMany({ where: { id: { in: parts } }, select: { id: true, movementId: true } })
      : [];
    const of = new Map(entries.map((e) => [e.id, e.movementId]));
    return (r: { kind: PaymentRecordKind; id: string }) => of.get(r.id) ?? r.id;
  }

  private async numberRows(rows: PaymentRow[]) {
    const wanted = rows.filter((r) => !r.number && LEDGER_SOURCE[r.kind]);
    if (!wanted.length) return;
    const sourceId = await this.sourceIds(wanted);
    const posted = await this.prisma.db.ledgerEntry.findMany({
      where: { OR: wanted.map((r) => ({ sourceType: LEDGER_SOURCE[r.kind]!, sourceId: sourceId(r) })), part: "" },
      select: { sourceType: true, sourceId: true, ref: true },
      distinct: ["sourceType", "sourceId"],
    });
    const ref = new Map(posted.map((p) => [`${p.sourceType}:${p.sourceId}`, p.ref]));
    for (const r of wanted) r.number = ref.get(`${LEDGER_SOURCE[r.kind]}:${sourceId(r)}`) || null;
  }

  /** One payment's page. 404 when this person does not see it. */
  async one(user: SessionUser, kind: PaymentRecordKind, id: string): Promise<PaymentView> {
    const s = await this.scope(user);
    const [row] = await this.rows(user, s, {}, { kind, id });
    if (!row) throw new NotFoundError("Payment");
    await this.numberRows([row]);
    const posting = LEDGER_SOURCE[kind]
      ? await this.prisma.db.ledgerEntry.findFirst({
          where: { sourceType: LEDGER_SOURCE[kind]!, sourceId: (await this.sourceIds([row]))(row) },
          orderBy: { postedAt: "asc" },
          select: { groupId: true },
        })
      : null;
    const detail = await this.detail(user, kind, id);
    return {
      ...row,
      // Its name in words (design rule 3: a title is never a number).
      title: row.name,
      ...detail,
      ledgerHref: posting ? `/finance/ledger?panel=entry&id=${posting.groupId}` : null,
    };
  }

  /**
   * A supplier payment's or an expense's voucher, in the one paper template the receipt uses: who was paid, what
   * for, the amount in figures and words, its main-currency value, how it was paid, and two signature lines.
   * (A customer payment prints its receipt, kept as recorded, from the order's papers.)
   */
  async paper(user: SessionUser, kind: PaymentRecordKind, id: string): Promise<PaymentPaper> {
    if (kind !== "supplier" && kind !== "expense") throw new NotFoundError("Voucher");
    const v = await this.one(user, kind, id);
    const s = await this.settings.get();
    const partyId = v.party?.href?.match(/^\/factories\/([0-9a-f-]{36})$/)?.[1];
    const details = partyId ? await this.prisma.db.party.findUnique({ where: { id: partyId }, select: { name: true, address: true, country: true } }) : null;
    const title = kind === "supplier" ? "PAYMENT VOUCHER" : "EXPENSE VOUCHER";
    const number = v.number ?? "Not numbered";
    const parts = v.parts ?? [];
    const doc: PaperDoc = {
      kind: "payment-receipt",
      title,
      numberLabel: "Voucher No.",
      number,
      date: v.on,
      company: { ...companySnapshot(s), stamp: null },
      party: { name: details?.name ?? v.party?.label ?? "—", country: details?.country ?? null, address: details?.address ?? null, label: "Paid to" },
      meta: parts.length ? [{ label: "Order No.", value: parts.map((x) => x.order).join(", ") }] : [],
      heading: null,
      columns: [
        { key: "no", label: "No.", width: 32 },
        { key: "item", label: "For" },
        { key: "ref", label: "Reference", width: 120, wrap: true },
        { key: "amount", label: "Amount", width: 110, align: "right" },
      ],
      rows: (parts.length ? parts : [{ order: "", part: v.what, amount: v.amount, currency: v.currency }]).map((x, i) => ({
        no: String(i + 1),
        item: { item: x.order ? `${x.part} · ${x.order}` : x.part, model: kind === "expense" ? v.title : null },
        ref: v.reference ?? "",
        amount: { money: x.amount, currency: x.currency },
      })),
      sums: [],
      total: { label: "Paid", amount: v.amount, currency: v.currency },
      under: v.inMain ? [{ label: `In ${v.inMain.currency} at ${v.inMain.rate} ${v.currency} per ${v.inMain.currency}`, value: { money: v.inMain.amount, currency: v.inMain.currency } }] : [],
      foot: null,
      boxTitle: "Payment",
      bullets: [
        [`Paid`, v.method ? `by ${v.method}` : null, `on ${paperDateText(v.on)}`, v.account ? `from ${v.account}` : null].filter(Boolean).join(" ") + ".",
        ...(v.paidBy ? [{ label: "Paid by:", value: v.paidBy }] : []),
        ...v.fields.map((f) => ({ label: `${f.label}:`, value: f.value })),
      ],
      bank: null,
      signatures: { left: "Prepared by", right: kind === "supplier" ? "Received by (the supplier)" : "Received by" },
    };
    return { doc, title: `${kind === "supplier" ? "Payment voucher" : "Expense voucher"} ${number}`, fileName: `${kind === "supplier" ? "Payment voucher" : "Expense voucher"} ${number}`.replace(/[^\w.() -]+/g, "-") };
  }

  /** What only one payment's page shows: its fields, proof, who recorded it, and how to remove it. */
  private async detail(
    user: SessionUser,
    kind: PaymentRecordKind,
    id: string,
  ): Promise<Omit<PaymentView, keyof PaymentRow | "title" | "ledgerHref">> {
    const db = this.prisma.db;
    const { sales } = await this.settings.get();
    const main = sales.currency;
    const voidOf = (at: Date | null, reason: string | null) => (at ? { at: at.toISOString(), reason } : null);
    const method = (m: string) => PAYMENT_METHOD_LABEL[m as PaymentMethod] ?? m;
    // The page draws what every payment has (date, who from or to, method, account, reference, who paid, the amount
    // and what it paid) the same way for every kind; `fields` holds only what is this kind's own.
    const none = { paidBy: null, inMain: null };
    switch (kind) {
      case "customer": {
        const m = await db.moneyMovement.findUniqueOrThrow({
          where: { id },
          include: {
            recordedBy: name,
            files: liveFile,
            allocations: { where: { later: false, ...orderPart }, include: { order: { select: { id: true, refNo: true } } } },
          },
        });
        const live = m.allocations.filter((a) => !a.voidedAt || m.voidedAt);
        const one = m.allocations.length === 1 && decimalToMinor(m.allocatable) === decimalToMinor(m.allocations[0]!.amount) ? m.allocations[0]! : null;
        const leftMinor = decimalToMinor(m.allocatable) - m.allocations.reduce((t, a) => t + decimalToMinor(a.amount), 0);
        const charges = live.reduce((t, a) => t + decimalToMinor(a.bankCharges), 0);
        return {
          fields: [
            ...(m.currency !== m.allocCurrency ? [{ label: "Rate", value: `${Number(m.rate)} ${m.currency} per ${m.allocCurrency}` }] : []),
            ...(charges ? [{ label: "Bank charges", value: `${m.allocCurrency} ${(charges / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}` }] : []),
            ...(leftMinor > 0 ? [{ label: "Kept as the customer's credit", value: `${m.allocCurrency} ${(leftMinor / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`, href: `/customers/${m.partyId}` }] : []),
            ...m.allocations
              .filter((a) => a.voidedAt && !m.voidedAt)
              .map((a) => ({ label: `Released from ${a.order!.refNo}`, value: a.voidReason ?? "order cancelled" })),
            ...(m.note ? [{ label: "Note", value: m.note }] : []),
          ],
          paidBy: m.paidByName ?? null,
          inMain: m.currency === m.allocCurrency ? null : { amount: m.allocatable.toFixed(2), currency: m.allocCurrency, rate: String(Number(m.rate)) },
          file: fileOf(m.files[0]),
          recordedBy: m.recordedBy.name,
          recordedAt: m.createdAt.toISOString(),
          voided: voidOf(m.voidedAt, m.voidReason),
          orderId: one?.orderId ?? null,
          partId: one?.id ?? null,
          voidPath: !m.voidedAt && can(user, "orders.manage") ? (one ? `/payments/${one.id}/void` : `/customer-receipts/${m.id}/void`) : null,
          parts: m.allocations.map((a) => ({
            order: a.order!.refNo,
            href: `/orders/${a.order!.id}`,
            part: PAYMENT_KIND_LABEL[a.kind as PaymentKind],
            amount: money(a.amount),
            currency: m.allocCurrency,
            released: !!a.voidedAt && !m.voidedAt,
          })),
        };
      }
      case "credit": {
        const a = await db.allocation.findUniqueOrThrow({ where: { id }, include: { order: orderRef, recordedBy: name } });
        return {
          fields: [{ label: "For", value: `${PAYMENT_KIND_LABEL[a.kind as PaymentKind]} on ${a.order!.refNo}`, href: `/orders/${a.order!.id}` }],
          ...none,
          file: null,
          recordedBy: a.recordedBy.name,
          recordedAt: a.createdAt.toISOString(),
          voided: voidOf(a.voidedAt, a.voidReason),
          orderId: a.orderId,
          voidPath: !a.voidedAt && can(user, "orders.manage") ? `/payments/${a.id}/void` : null,
        };
      }
      case "refund": {
        const m = await db.moneyMovement.findUniqueOrThrow({ where: { id }, include: { recordedBy: name } });
        return {
          fields: [...(m.note ? [{ label: "Note", value: m.note }] : [])],
          ...none,
          file: null,
          recordedBy: m.recordedBy.name,
          recordedAt: m.createdAt.toISOString(),
          voided: voidOf(m.voidedAt, m.voidReason),
          orderId: null,
          voidPath: !m.voidedAt && can(user, "orders.manage") ? `/customer-credits/${m.id}/void` : null,
        };
      }
      case "supplier": {
        const a = await db.allocation.findUniqueOrThrow({
          where: { id },
          include: {
            purchaseOrder: { select: { id: true, refNo: true, currency: true, mainCurrency: true, mainRate: true } },
            movement: { include: { recordedBy: name, paidBy: name, files: liveFile } },
          },
        });
        const p = { ...a.movement, kind: a.kind, order: a.purchaseOrder!, orderId: a.purchaseOrderId!, paidOn: a.on, voidedAt: a.voidedAt ?? a.movement.voidedAt, id: a.id };
        const rate = p.order.currency === p.currency ? orderRate(p.order, main, sales.exchangeRates) : fxRate(p.currency, main, main, sales.exchangeRates);
        return {
          fields: [...(p.note ? [{ label: "Note", value: p.note }] : [])],
          paidBy: p.paidBy?.name ?? null,
          inMain: inMainOf(a.share, p.currency, main, rate),
          parts: [
            {
              order: p.order.refNo,
              href: `/orders/${p.order.id}/factory`,
              part: PAYMENT_KIND_LABEL[p.kind as PaymentKind],
              amount: money(a.share),
              currency: p.currency,
              released: !!a.voidedAt && !a.movement.voidedAt,
            },
          ],
          file: fileOf(p.files[0]),
          recordedBy: p.recordedBy.name,
          recordedAt: p.createdAt.toISOString(),
          voided: voidOf(p.voidedAt, p.voidReason),
          orderId: p.orderId,
          voidPath: !p.voidedAt && can(user, "payments.record") ? `/factory-payments/${p.id}/void` : null,
        };
      }
      case "expense": {
        const e = await db.expense.findUniqueOrThrow({
          where: { id },
          include: { recordedBy: name, paidBy: name, repaidAccount: name, files: liveFile, order: orderRef, inquiry: orderRef },
        });
        const category = EXPENSE_CATEGORY_LABEL[e.category as ExpenseCategory] ?? e.category;
        const on = e.order
          ? { order: e.order.refNo, href: `/orders/${e.order.id}/costs` }
          : e.inquiry
            ? { order: e.inquiry.refNo, href: `/inquiries/${e.inquiry.id}/costs` }
            : null;
        const borne =
          e.borneBy === "customer"
            ? "The customer (added to what they owe)"
            : e.borneBy === "factory"
              ? "The supplier (taken off what we owe)"
              : "Us";
        return {
          fields: [
            { label: "Category", value: category },
            { label: "Borne by", value: borne },
            ...(e.ownMoney || e.payLater
              ? [
                  {
                    label: e.payLater ? "Paid" : "Paid back",
                    value: e.repaidOn ? `${fromDbDate(e.repaidOn)}${e.repaidAccount ? ` from ${e.repaidAccount.name}` : ""}` : "Not yet",
                  },
                ]
              : []),
            ...(e.note ? [{ label: "Note", value: e.note }] : []),
          ],
          paidBy: e.paidBy?.name ?? null,
          inMain: inMainOf(e.amount, e.currency, main, Number(e.rate)),
          parts: on ? [{ ...on, part: category, amount: money(e.amount), currency: e.currency, released: false }] : [],
          file: fileOf(e.files[0]),
          recordedBy: e.recordedBy.name,
          recordedAt: e.createdAt.toISOString(),
          voided: voidOf(e.voidedAt, e.voidReason),
          orderId: e.orderId,
          voidPath: !e.voidedAt && can(user, "expenses.manage") ? `/expenses/${e.id}/void` : null,
        };
      }
      case "transfer": {
        const m = await db.moneyMovement.findFirstOrThrow({
          where: { id, direction: "move" },
          include: { recordedBy: name, account: true, toAccount: true },
        });
        const t = { ...m, fromAccount: m.account!, toAccount: m.toAccount!, amountOut: m.amount, amountIn: m.allocatable, transferredOn: m.valueDate };
        return {
          fields: [
            { label: "From", value: `${t.fromAccount.name} · ${amount(t.fromAccount.currency, t.amountOut)}` },
            { label: "To", value: `${t.toAccount.name} · ${amount(t.toAccount.currency, t.amountIn)}` },
            ...(t.note ? [{ label: "Note", value: t.note }] : []),
          ],
          ...none,
          file: null,
          recordedBy: t.recordedBy.name,
          recordedAt: t.createdAt.toISOString(),
          voided: voidOf(t.voidedAt, t.voidReason),
          orderId: null,
          voidPath: !t.voidedAt && can(user, "expenses.manage") ? `/money/transfers/${t.id}/void` : null,
        };
      }
      case "submission": {
        const m = await db.moneySubmission.findUniqueOrThrow({ where: { id }, include: { submittedBy: name, decidedBy: name, files: liveFile } });
        const b = (m.body ?? {}) as Record<string, unknown>;
        return {
          fields: [
            { label: "Sent by", value: m.submittedBy.name },
            ...(typeof b.method === "string" ? [{ label: "Method", value: method(b.method) }] : []),
            ...(m.status === "sent_back" && m.reason ? [{ label: "Sent back because", value: m.reason }] : []),
            { label: "Verify it", value: "In the verification queue", href: "/approvals" },
          ],
          ...none,
          file: fileOf(m.files[0]),
          recordedBy: m.submittedBy.name,
          recordedAt: m.submittedAt.toISOString(),
          voided: null,
          orderId: m.orderId,
          voidPath: null,
        };
      }
    }
  }
}
