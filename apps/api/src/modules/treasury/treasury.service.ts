import { Injectable } from "@nestjs/common";
import { liveFile, decimalToMinor, fromDbDate, isCustomer, orderPart, toDbDate, type Prisma } from "@kebo/database";
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
  customer: "movement",
  credit: "allocation",
  refund: "movement",
  supplier: "movement",
  expense: "expense",
  transfer: "movement",
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
 * today: customer payment entries (one per transfer, whatever it pays), orders paid from credit, refunds, supplier
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
            include: { party: name, account: name },
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
            include: { purchaseOrder: orderRef, movement: { include: { party: name, account: name } } },
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
        ? this.prisma.db.moneyMovement.findMany({
            where: { ...pick("transfer"), direction: "move", ...(range ? { valueDate: range } : {}) },
            include: { account: name, toAccount: name },
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
        // What arrived, in the currency it arrived in (the bank statement's figure).
        amount: money(m.amount),
        currency: m.currency,
        party: customerLink(m.party),
        for: orders.map(orderLink),
        account: m.account?.name ?? null,
        reference: m.reference,
        status: statusOf(m.voidedAt),
        fromCredit: false,
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
        amount: money(a.amount),
        currency: a.movement.allocCurrency,
        party: customerLink(a.movement.party),
        for: [orderLink(a.order!)],
        account: null,
        reference: null,
        status: statusOf(a.voidedAt),
        fromCredit: true,
      });
    for (const m of refunds)
      out.push({
        kind: "refund",
        id: m.id,
        number: null,
        on: fromDbDate(m.valueDate),
        direction: "out",
        what: `Credit refunded${m.note ? `: ${m.note}` : ""}`,
        amount: money(m.amount),
        currency: m.currency,
        party: customerLink(m.party),
        for: [],
        account: m.account?.name ?? null,
        reference: null,
        status: statusOf(m.voidedAt),
        fromCredit: false,
      });
    for (const p of supplierPaid)
      out.push({
        kind: "supplier",
        id: p.id,
        number: null,
        on: fromDbDate(p.on),
        direction: "out",
        what: `${PAYMENT_KIND_LABEL[p.kind as PaymentKind]} to the supplier for ${p.purchaseOrder!.refNo}`,
        amount: money(p.share),
        currency: p.movement.currency,
        party: supplierLink(p.movement.party!),
        for: [orderLink(p.purchaseOrder!)],
        account: p.movement.account?.name ?? null,
        reference: p.movement.reference,
        status: statusOf(p.voidedAt ?? p.movement.voidedAt),
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
        on: fromDbDate(t.valueDate),
        direction: "move",
        what: `${t.account!.name} → ${t.toAccount!.name}${t.note ? `: ${t.note}` : ""}`,
        amount: money(t.amount),
        currency: t.currency,
        party: null,
        for: [],
        account: t.account!.name,
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
            { label: "Received", value: amount(m.currency, m.amount) },
            ...(m.currency !== m.allocCurrency ? [{ label: "Rate", value: `${Number(m.rate)} per ${m.allocCurrency}` }] : []),
            ...m.allocations.map((a) => ({
              label: `${PAYMENT_KIND_LABEL[a.kind as PaymentKind]} on ${a.order!.refNo}`,
              value: `${amount(m.allocCurrency, a.amount)}${a.voidedAt && !m.voidedAt ? ` · released: ${a.voidReason ?? "order cancelled"}` : ""}`,
              href: `/orders/${a.order!.id}`,
            })),
            ...(leftMinor > 0 ? [{ label: "Kept as the customer's credit", value: `${m.allocCurrency} ${(leftMinor / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`, href: `/customers/${m.partyId}` }] : []),
            ...(charges ? [{ label: "Bank charges", value: `${m.allocCurrency} ${(charges / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}` }] : []),
            { label: "Paid on", value: fromDbDate(m.valueDate) },
            { label: "Method", value: method(m.method) },
            ...(m.paidByName ? [{ label: "Paid by", value: m.paidByName }] : []),
            ...(m.note ? [{ label: "Note", value: m.note }] : []),
          ],
          file: m.files[0] ? { name: m.files[0].fileName, href: `/files/payments/${m.id}` } : null,
          recordedBy: m.recordedBy.name,
          recordedAt: m.createdAt.toISOString(),
          voided: voidOf(m.voidedAt, m.voidReason),
          orderId: one?.orderId ?? null,
          partId: one?.id ?? null,
          voidPath: !m.voidedAt && can(user, "orders.manage") ? (one ? `/payments/${one.id}/void` : `/customer-receipts/${m.id}/void`) : null,
        };
      }
      case "credit": {
        const a = await db.allocation.findUniqueOrThrow({ where: { id }, include: { order: orderRef, recordedBy: name } });
        return {
          fields: [
            { label: "For", value: `${PAYMENT_KIND_LABEL[a.kind as PaymentKind]} on ${a.order!.refNo}`, href: `/orders/${a.order!.id}` },
            { label: "Paid on", value: fromDbDate(a.on) },
            { label: "Method", value: "From the customer's credit (no money moved)" },
          ],
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
          fields: [{ label: "Refunded on", value: fromDbDate(m.valueDate) }, ...(m.note ? [{ label: "Note", value: m.note }] : [])],
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
          include: { purchaseOrder: orderRef, movement: { include: { recordedBy: name, paidBy: name, files: liveFile } } },
        });
        const p = { ...a.movement, kind: a.kind, order: a.purchaseOrder!, orderId: a.purchaseOrderId!, paidOn: a.on, voidedAt: a.voidedAt ?? a.movement.voidedAt, id: a.id };
        return {
          fields: [
            { label: "For", value: `${PAYMENT_KIND_LABEL[p.kind as PaymentKind]} on ${p.order.refNo}`, href: `/orders/${p.order.id}` },
            { label: "Paid on", value: fromDbDate(p.paidOn) },
            { label: "Method", value: method(p.method) },
            ...(p.paidBy ? [{ label: "Paid by", value: p.paidBy.name }] : []),
            ...(p.note ? [{ label: "Note", value: p.note }] : []),
          ],
          file: p.files[0] ? { name: p.files[0].fileName, href: `/files/factory-payments/${p.id}` } : null,
          recordedBy: p.recordedBy.name,
          recordedAt: p.createdAt.toISOString(),
          voided: voidOf(p.voidedAt, p.voidReason),
          orderId: p.orderId,
          voidPath: !p.voidedAt && can(user, "payments.record") ? `/factory-payments/${p.id}/void` : null,
        };
      }
      case "expense": {
        const e = await db.expense.findUniqueOrThrow({ where: { id }, include: { recordedBy: name, paidBy: name, repaidAccount: name, files: liveFile } });
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
          file: e.files[0] ? { name: e.files[0].fileName, href: `/files/expenses/${e.id}` } : null,
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
        const m = await db.moneySubmission.findUniqueOrThrow({ where: { id }, include: { submittedBy: name, decidedBy: name, files: liveFile } });
        const b = (m.body ?? {}) as Record<string, unknown>;
        return {
          fields: [
            { label: "Sent by", value: m.submittedBy.name },
            ...(typeof b.method === "string" ? [{ label: "Method", value: method(b.method) }] : []),
            ...(m.status === "sent_back" && m.reason ? [{ label: "Sent back because", value: m.reason }] : []),
            { label: "Verify it", value: "In the verification queue", href: "/approvals" },
          ],
          file: m.files[0] ? { name: m.files[0].fileName, href: `/files/submissions/${m.id}` } : null,
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
