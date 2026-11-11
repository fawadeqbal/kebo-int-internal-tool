import { Injectable } from "@nestjs/common";
import { fromDbDate, isCustomer, toDbDate, type Prisma } from "@kebo/database";
import {
  can,
  EXPENSE_CATEGORY_LABEL,
  PAYMENT_KIND_LABEL,
  PAYMENT_METHOD_LABEL,
  PAYMENT_RECORD_LABEL,
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
} from "@kebo/shared";
import { ForbiddenError, NotFoundError, type ISODate } from "@kebo/utils";
import { PrismaService } from "../../database/prisma.service";
import type { SessionUser } from "../../common/auth/session-user";
import { LimitsService } from "../../common/company/limits.service";
import { orderAccess } from "../orders/orders.service";
import { customerAccess } from "../parties/customers.service";

export interface PaymentsQuery {
  from?: ISODate;
  to?: ISODate;
  dir?: PaymentDirection;
  status?: "to_verify" | "void";
  q?: string;
  order?: string;
  party?: string;
  page: number;
  pageSize: number;
}

/** The ledger's name for each record (ledger_entries.source_type). */
const LEDGER_SOURCE: Partial<Record<PaymentRecordKind, string>> = {
  customer: "payment",
  receipt: "receipt",
  refund: "credit",
  supplier: "factory_payment",
  expense: "expense",
  transfer: "transfer",
};

const name = { select: { id: true, name: true } } as const;
const orderRef = { select: { id: true, refNo: true } } as const;
const money = (d: Prisma.Decimal) => d.toFixed(2);
/** "USD 14,692.15": an amount as a page shows it. */
const amount = (currency: string, d: Prisma.Decimal) =>
  `${currency} ${Number(d).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const statusOf = (voidedAt: Date | null): PaymentStatus => (voidedAt ? "void" : "recorded");
const customerLink = (c: { id: string; name: string } | null) => (c ? { label: c.name, href: `/customers/${c.id}` } : null);
const supplierLink = (f: { id: string; name: string }) => ({ label: f.name, href: `/factories/${f.id}` });
const orderLink = (o: { id: string; refNo: string }) => ({ label: o.refNo, href: `/orders/${o.id}` });

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
 * today: customer payments, one transfer over several orders, refunds of credit, supplier
 * payments, expenses, moves between our accounts, and what staff sent for approval. Recording
 * and removing stay with those records; this only lists them and shows one.
 */
@Injectable()
export class TreasuryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limits: LimitsService,
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
    const counts = {
      all: found.length,
      in: found.filter((r) => r.direction === "in").length,
      out: found.filter((r) => r.direction === "out").length,
      move: found.filter((r) => r.direction === "move").length,
      to_verify: found.filter((r) => r.status === "to_verify").length,
    };
    const shown = found
      .filter((r) => !q.dir || r.direction === q.dir)
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
    return { rows: page, total: shown.length, page: q.page, pageSize: q.pageSize, counts, scope, canRecord: this.canRecord(user, s) };
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

    const [payments, receipts, refunds, supplierPaid, expenses, transfers, submissions] = await Promise.all([
      // A customer's payment on one order; one transfer over several orders is listed once, as its receipt.
      s.customer && pick("customer")
        ? this.prisma.db.payment.findMany({
            where: {
              ...pick("customer"),
              receiptId: null,
              order: onOrder,
              ...(range ? { paidOn: range } : {}),
              ...(party ? { customerId: party } : {}),
            },
            include: { order: orderRef, customer: name, account: name },
          })
        : [],
      s.customer && pick("receipt")
        ? this.prisma.db.customerReceipt.findMany({
            where: {
              ...pick("receipt"),
              customer: { ...isCustomer, ...parties },
              ...(range ? { paidOn: range } : {}),
              ...(party ? { customerId: party } : {}),
              ...(q.order ? { payments: { some: { orderId: q.order } } } : {}),
            },
            include: { customer: name, account: name, payments: { select: { order: orderRef } } },
          })
        : [],
      s.customer && !q.order && pick("refund")
        ? this.prisma.db.customerCredit.findMany({
            where: {
              ...pick("refund"),
              kind: "refund",
              customer: { ...isCustomer, ...parties },
              ...(range ? { on: range } : {}),
              ...(party ? { customerId: party } : {}),
            },
            include: { customer: name, account: name },
          })
        : [],
      s.supplier && pick("supplier")
        ? this.prisma.db.factoryPayment.findMany({
            where: { ...pick("supplier"), order: onOrder, ...(range ? { paidOn: range } : {}), ...(party ? { factoryId: party } : {}) },
            include: { order: orderRef, factory: name, account: name },
          })
        : [],
      s.expense && pick("expense")
        ? this.prisma.db.expense.findMany({
            where: {
              ...pick("expense"),
              ...(range ? { spentOn: range } : {}),
              ...(q.order ? { orderId: q.order } : {}),
              ...(party ? { OR: [{ customerId: party }, { factoryId: party }] } : {}),
            },
            include: { order: orderRef, inquiry: orderRef, customer: name, factory: name, account: name, paidBy: name },
          })
        : [],
      s.transfer && !q.order && !party && pick("transfer")
        ? this.prisma.db.moneyTransfer.findMany({
            where: { ...pick("transfer"), ...(range ? { transferredOn: range } : {}) },
            include: { fromAccount: { select: { id: true, name: true, currency: true } }, toAccount: name },
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
            include: { order: { select: { id: true, refNo: true, currency: true, customer: name } } },
          })
        : [],
    ]);

    for (const p of payments)
      out.push({
        kind: "customer",
        id: p.id,
        number: p.receiptNo ? paperNumber(p.order.refNo, "payment-receipt", p.receiptNo) : null,
        on: fromDbDate(p.paidOn),
        direction: "in",
        what:
          p.method === "credit"
            ? `${PAYMENT_KIND_LABEL[p.kind]} from the customer's credit`
            : `${PAYMENT_KIND_LABEL[p.kind]} for ${p.order.refNo}`,
        // What arrived, in the currency it arrived in (the bank statement's figure).
        amount: money(p.receivedAmount),
        currency: p.receivedCurrency,
        party: customerLink(p.customer),
        for: [orderLink(p.order)],
        account: p.account?.name ?? null,
        reference: p.reference,
        status: statusOf(p.voidedAt),
        fromCredit: p.method === "credit",
      });
    for (const r of receipts) {
      const orders = [...new Map(r.payments.map((p) => [p.order.id, p.order])).values()];
      out.push({
        kind: "receipt",
        id: r.id,
        number: null,
        on: fromDbDate(r.paidOn),
        direction: "in",
        what: orders.length ? `One transfer for ${orders.map((o) => o.refNo).join(", ")}` : "Into the customer's credit",
        amount: money(r.receivedAmount),
        currency: r.receivedCurrency,
        party: customerLink(r.customer),
        for: orders.map(orderLink),
        account: r.account?.name ?? null,
        reference: r.reference,
        status: statusOf(r.voidedAt),
        fromCredit: false,
      });
    }
    for (const c of refunds)
      out.push({
        kind: "refund",
        id: c.id,
        number: null,
        on: fromDbDate(c.on),
        direction: "out",
        what: `Credit refunded${c.note ? `: ${c.note}` : ""}`,
        amount: money(c.amount),
        currency: c.currency,
        party: customerLink(c.customer),
        for: [],
        account: c.account?.name ?? null,
        reference: null,
        status: statusOf(c.voidedAt),
        fromCredit: false,
      });
    for (const p of supplierPaid)
      out.push({
        kind: "supplier",
        id: p.id,
        number: null,
        on: fromDbDate(p.paidOn),
        direction: "out",
        what: `${PAYMENT_KIND_LABEL[p.kind]} to the supplier for ${p.order.refNo}`,
        amount: money(p.amount),
        currency: p.currency,
        party: supplierLink(p.factory),
        for: [orderLink(p.order)],
        account: p.account?.name ?? null,
        reference: p.reference,
        status: statusOf(p.voidedAt),
        fromCredit: false,
      });
    for (const e of expenses)
      out.push({
        kind: "expense",
        id: e.id,
        number: null,
        on: fromDbDate(e.spentOn),
        direction: "out",
        what: `${EXPENSE_CATEGORY_LABEL[e.category as ExpenseCategory] ?? e.category}: ${e.description}`,
        amount: money(e.amount),
        currency: e.currency,
        party: e.factory ? supplierLink(e.factory) : customerLink(e.customer),
        for: e.order ? [orderLink(e.order)] : e.inquiry ? [{ label: e.inquiry.refNo, href: `/inquiries/${e.inquiry.id}` }] : [],
        account: e.ownMoney ? `${e.paidBy?.name ?? "Someone"}'s own money` : (e.account?.name ?? null),
        reference: e.reference,
        status: statusOf(e.voidedAt),
        fromCredit: false,
      });
    for (const t of transfers)
      out.push({
        kind: "transfer",
        id: t.id,
        number: null,
        on: fromDbDate(t.transferredOn),
        direction: "move",
        what: `${t.fromAccount.name} → ${t.toAccount.name}${t.note ? `: ${t.note}` : ""}`,
        amount: money(t.amountOut),
        currency: t.fromAccount.currency,
        party: null,
        for: [],
        account: t.fromAccount.name,
        reference: t.reference,
        status: statusOf(t.voidedAt),
        fromCredit: false,
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
        amount: Number(amount).toFixed(2),
        currency,
        party: m.order ? customerLink(m.order.customer) : null,
        for: m.order ? [orderLink(m.order)] : [],
        account: null,
        reference: typeof b.reference === "string" ? b.reference : null,
        status: m.status === "pending" ? "to_verify" : "sent_back",
        fromCredit: false,
      });
    }
    return out;
  }

  /** The number each record was posted under in the ledger (one query for the page). */
  private async numberRows(rows: PaymentRow[]) {
    const wanted = rows.filter((r) => !r.number && LEDGER_SOURCE[r.kind]);
    if (!wanted.length) return;
    const posted = await this.prisma.db.ledgerEntry.findMany({
      where: { OR: wanted.map((r) => ({ sourceType: LEDGER_SOURCE[r.kind]!, sourceId: r.id })), part: "" },
      select: { sourceType: true, sourceId: true, ref: true },
      distinct: ["sourceType", "sourceId"],
    });
    const ref = new Map(posted.map((p) => [`${p.sourceType}:${p.sourceId}`, p.ref]));
    for (const r of wanted) r.number = ref.get(`${LEDGER_SOURCE[r.kind]}:${r.id}`) || null;
  }

  /** One payment's page. 404 when this person does not see it. */
  async one(user: SessionUser, kind: PaymentRecordKind, id: string): Promise<PaymentView> {
    const s = await this.scope(user);
    const [row] = await this.rows(user, s, {}, { kind, id });
    if (!row) throw new NotFoundError("Payment");
    await this.numberRows([row]);
    const posting = LEDGER_SOURCE[kind]
      ? await this.prisma.db.ledgerEntry.findFirst({
          where: { sourceType: LEDGER_SOURCE[kind]!, sourceId: id },
          orderBy: { postedAt: "asc" },
          select: { groupId: true },
        })
      : null;
    const detail = await this.detail(user, kind, id);
    return {
      ...row,
      title: `${PAYMENT_RECORD_LABEL[kind]} · ${row.currency} ${Number(row.amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      ...detail,
      ledgerHref: posting ? `/finance/ledger?panel=entry&id=${posting.groupId}` : null,
    };
  }

  /** What only one payment's page shows: its fields, proof, who recorded it, and how to remove it. */
  private async detail(
    user: SessionUser,
    kind: PaymentRecordKind,
    id: string,
  ): Promise<Omit<PaymentView, keyof PaymentRow | "title" | "ledgerHref">> {
    const db = this.prisma.db;
    const voidOf = (at: Date | null, reason: string | null) => (at ? { at: at.toISOString(), reason } : null);
    const method = (m: string) => PAYMENT_METHOD_LABEL[m as PaymentMethod] ?? m;
    switch (kind) {
      case "customer": {
        const p = await db.payment.findUniqueOrThrow({
          where: { id },
          include: { order: { select: { refNo: true, currency: true } }, recordedBy: name, receipt: false },
        });
        const counted = p.receivedCurrency !== p.currency;
        return {
          fields: [
            { label: "For", value: `${PAYMENT_KIND_LABEL[p.kind as PaymentKind]} on ${p.order.refNo}`, href: `/orders/${p.orderId}` },
            { label: "Received", value: amount(p.receivedCurrency, p.receivedAmount) },
            ...(counted ? [{ label: "Counts on the order as", value: `${amount(p.currency, p.amount)} at ${Number(p.rate)}` }] : []),
            ...(Number(p.bankCharges) ? [{ label: "Bank charges", value: amount(p.currency, p.bankCharges) }] : []),
            { label: "Paid on", value: fromDbDate(p.paidOn) },
            { label: "Method", value: method(p.method) },
            ...(p.paidByName ? [{ label: "Paid by", value: p.paidByName }] : []),
            ...(p.note ? [{ label: "Note", value: p.note }] : []),
          ],
          file: p.fileKey ? { name: p.fileName ?? "Proof", href: `/files/payments/${p.id}` } : null,
          recordedBy: p.recordedBy.name,
          recordedAt: p.createdAt.toISOString(),
          voided: voidOf(p.voidedAt, p.voidReason),
          orderId: p.orderId,
          voidPath: !p.voidedAt && !p.receiptId && can(user, "orders.manage") ? `/payments/${p.id}/void` : null,
        };
      }
      case "receipt": {
        const r = await db.customerReceipt.findUniqueOrThrow({
          where: { id },
          include: { recordedBy: name, payments: { where: { voidedAt: null }, select: { amount: true, order: orderRef } } },
        });
        return {
          fields: [
            { label: "Received", value: amount(r.receivedCurrency, r.receivedAmount) },
            ...(r.receivedCurrency !== r.currency ? [{ label: "Rate", value: `${Number(r.rate)} per ${r.currency}` }] : []),
            ...r.payments.map((p) => ({
              label: `On ${p.order.refNo}`,
              value: amount(r.currency, p.amount),
              href: `/orders/${p.order.id}`,
            })),
            { label: "Paid on", value: fromDbDate(r.paidOn) },
            { label: "Method", value: method(r.method) },
            ...(r.paidByName ? [{ label: "Paid by", value: r.paidByName }] : []),
            ...(r.note ? [{ label: "Note", value: r.note }] : []),
          ],
          file: null,
          recordedBy: r.recordedBy.name,
          recordedAt: r.createdAt.toISOString(),
          voided: voidOf(r.voidedAt, r.voidReason),
          orderId: null,
          voidPath: !r.voidedAt && can(user, "orders.manage") ? `/customer-receipts/${r.id}/void` : null,
        };
      }
      case "refund": {
        const c = await db.customerCredit.findUniqueOrThrow({ where: { id }, include: { recordedBy: name } });
        return {
          fields: [{ label: "Refunded on", value: fromDbDate(c.on) }, ...(c.note ? [{ label: "Note", value: c.note }] : [])],
          file: null,
          recordedBy: c.recordedBy.name,
          recordedAt: c.createdAt.toISOString(),
          voided: voidOf(c.voidedAt, c.voidReason),
          orderId: c.orderId,
          voidPath: !c.voidedAt && can(user, "orders.manage") ? `/customer-credits/${c.id}/void` : null,
        };
      }
      case "supplier": {
        const p = await db.factoryPayment.findUniqueOrThrow({
          where: { id },
          include: { order: orderRef, recordedBy: name, paidBy: name },
        });
        return {
          fields: [
            { label: "For", value: `${PAYMENT_KIND_LABEL[p.kind as PaymentKind]} on ${p.order.refNo}`, href: `/orders/${p.order.id}` },
            { label: "Paid on", value: fromDbDate(p.paidOn) },
            { label: "Method", value: method(p.method) },
            ...(p.paidBy ? [{ label: "Paid by", value: p.paidBy.name }] : []),
            ...(p.note ? [{ label: "Note", value: p.note }] : []),
          ],
          file: p.fileKey ? { name: p.fileName ?? "Proof", href: `/files/factory-payments/${p.id}` } : null,
          recordedBy: p.recordedBy.name,
          recordedAt: p.createdAt.toISOString(),
          voided: voidOf(p.voidedAt, p.voidReason),
          orderId: p.orderId,
          voidPath: !p.voidedAt && can(user, "payments.record") ? `/factory-payments/${p.id}/void` : null,
        };
      }
      case "expense": {
        const e = await db.expense.findUniqueOrThrow({ where: { id }, include: { recordedBy: name, paidBy: name, repaidAccount: name } });
        const borne =
          e.borneBy === "customer"
            ? "The customer (added to what they owe)"
            : e.borneBy === "factory"
              ? "The supplier (taken off what we owe)"
              : "Us";
        return {
          fields: [
            { label: "Spent on", value: fromDbDate(e.spentOn) },
            { label: "Category", value: EXPENSE_CATEGORY_LABEL[e.category as ExpenseCategory] ?? e.category },
            { label: "Borne by", value: borne },
            ...(e.paidBy ? [{ label: "Paid by", value: e.paidBy.name }] : []),
            ...(e.ownMoney
              ? [
                  {
                    label: "Paid back",
                    value: e.repaidOn ? `${fromDbDate(e.repaidOn)}${e.repaidAccount ? ` from ${e.repaidAccount.name}` : ""}` : "Not yet",
                  },
                ]
              : []),
            ...(e.note ? [{ label: "Note", value: e.note }] : []),
          ],
          file: e.receiptKey ? { name: e.receiptName ?? "Receipt", href: `/files/expenses/${e.id}` } : null,
          recordedBy: e.recordedBy.name,
          recordedAt: e.createdAt.toISOString(),
          voided: voidOf(e.voidedAt, e.voidReason),
          orderId: e.orderId,
          voidPath: !e.voidedAt && can(user, "expenses.manage") ? `/expenses/${e.id}/void` : null,
        };
      }
      case "transfer": {
        const t = await db.moneyTransfer.findUniqueOrThrow({
          where: { id },
          include: { recordedBy: name, fromAccount: true, toAccount: true },
        });
        return {
          fields: [
            { label: "From", value: `${t.fromAccount.name} · ${amount(t.fromAccount.currency, t.amountOut)}` },
            { label: "To", value: `${t.toAccount.name} · ${amount(t.toAccount.currency, t.amountIn)}` },
            { label: "Moved on", value: fromDbDate(t.transferredOn) },
            ...(t.note ? [{ label: "Note", value: t.note }] : []),
          ],
          file: null,
          recordedBy: t.recordedBy.name,
          recordedAt: t.createdAt.toISOString(),
          voided: voidOf(t.voidedAt, t.voidReason),
          orderId: null,
          voidPath: !t.voidedAt && can(user, "expenses.manage") ? `/money/transfers/${t.id}/void` : null,
        };
      }
      case "submission": {
        const m = await db.moneySubmission.findUniqueOrThrow({ where: { id }, include: { submittedBy: name, decidedBy: name } });
        const b = (m.body ?? {}) as Record<string, unknown>;
        return {
          fields: [
            { label: "Sent by", value: m.submittedBy.name },
            ...(typeof b.method === "string" ? [{ label: "Method", value: method(b.method) }] : []),
            ...(m.status === "sent_back" && m.reason ? [{ label: "Sent back because", value: m.reason }] : []),
            { label: "Verify it", value: "In the verification queue", href: "/approvals" },
          ],
          file: m.fileKey ? { name: m.fileName ?? "Proof", href: `/files/submissions/${m.id}` } : null,
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
