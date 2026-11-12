import { Injectable, Logger } from "@nestjs/common";
import { liveFile, livePurchase, nextCount, livePart, decimalToMinor, fromDbDate, Prisma, isCustomer, isSupplier } from "@kebo/database";
import { fromMinor, payInstalments, type Minor } from "@kebo/money";
import {
  AGEING_BUCKETS,
  AGEING_BUCKET_LABEL,
  ageingBucket,
  LEDGER_ACCOUNT_GROUP,
  LEDGER_ENTRY_TYPE_LABEL,
  ledgerAccountLabel,
  parseLedgerAccount,
  planStatus,
  type AgeingBucket,
  type LedgerEntryType,
  type LedgerPartyKind,
} from "@kebo/shared";
import { addDays, DomainError, NotFoundError, todayIn, type ISODate } from "@kebo/utils";
import { PrismaService } from "../../database/prisma.service";
import { LimitsService } from "../../common/company/limits.service";
import { Clock } from "../../common/time/clock.service";
import { CompanyContext } from "../../common/company/company-context";
import { toInfo } from "../../common/company/companies.service";
import { SettingsService } from "../settings/settings.service";
import { factoryPositionsSql, positionsSql } from "../billing/api";
import { orderRate } from "../money/order-money";
import { chargedExpenses, fxOf, positionOf, type MoneyCtx } from "../billing/api";
import { livePlansOf } from "../billing/api";
import { factoryPlansOf } from "../billing/api";
import { LedgerPosting } from "./posting.service";
import { ledgerCheck, type LedgerCheck } from "./check";
import { companySnapshot } from "../quotations/quotations.service";

type Row = Prisma.LedgerEntryGetPayload<object>;

/** "By account" in the order of the board: money, who owes us and whom we owe, then sales, costs and the rest. */
const GROUP_ORDER = [
  "Money",
  "Customers",
  "Customer credit",
  "Factories",
  "Staff (to repay)",
  "Sales",
  "Goods cost",
  "Expenses",
  "Expenses recovered",
  "Exchange difference",
  "Opening balances",
];

export interface EntriesQuery {
  from?: ISODate;
  to?: ISODate;
  type?: string;
  account?: string;
  customerId?: string;
  factoryId?: string;
  userId?: string;
  orderId?: string;
  currency?: string;
  /** Rows reversed and the rows that reverse them (default: shown). */
  removed: boolean;
  /** One line per posting's side that leads it (the debit: "Bank Alfalah USD → Lahore Pharma"). */
  lead: boolean;
  page: number;
  pageSize: number;
}

const minor = (d: Prisma.Decimal | string | number | null | undefined) =>
  d === null || d === undefined ? 0 : decimalToMinor(d as Prisma.Decimal);
const money = (m: Minor) => fromMinor(m);

/** The sign of a party's balance: what a customer owes us (debit − credit); what we owe a factory or a person (credit − debit). */
const partySign = (kind: LedgerPartyKind) => (kind === "customer" ? 1 : -1);
const partyAccount = (kind: LedgerPartyKind, id: string) => `${kind}:${id}`;

/**
 * Finance › Ledger, read only: the rows as posted (with the names of what they point at), one posting with
 * what it settles and its document, a customer's, factory's or person's ledger with opening and closing balances
 * and ageing, ageing across all of them, and every account's balance. The first read of a company whose ledger
 * was never posted posts it (LedgerPosting.ensureBuilt).
 */
@Injectable()
export class LedgerService {
  private readonly log = new Logger("Ledger");

  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: LedgerPosting,
    private readonly settings: SettingsService,
    private readonly limits: LimitsService,
    private readonly clock: Clock,
  ) {}

  private async fx(): Promise<MoneyCtx> {
    return fxOf(await this.settings.get(), await this.limits.allows("expenses"));
  }

  /** The names of the records the rows point at (accounts, customers, factories, people, orders). */
  private async names(rows: Pick<Row, "account" | "customerId" | "factoryId" | "userId" | "orderId" | "moneyAccountId">[]) {
    const ids = {
      money: new Set<string>(),
      customer: new Set<string>(),
      factory: new Set<string>(),
      user: new Set<string>(),
      order: new Set<string>(),
    };
    for (const r of rows) {
      const a = parseLedgerAccount(r.account);
      if (a.id && (a.kind === "customer" || a.kind === "credit")) ids.customer.add(a.id);
      if (a.id && a.kind === "factory") ids.factory.add(a.id);
      if (a.id && a.kind === "staff") ids.user.add(a.id);
      if (a.id && a.kind === "money") ids.money.add(a.id);
      if (r.customerId) ids.customer.add(r.customerId);
      if (r.factoryId) ids.factory.add(r.factoryId);
      if (r.userId) ids.user.add(r.userId);
      if (r.orderId) ids.order.add(r.orderId);
    }
    const db = this.prisma.db;
    const [money, customers, factories, users, orders] = await Promise.all([
      db.moneyAccount.findMany({ where: { id: { in: [...ids.money] } }, select: { id: true, name: true } }),
      db.party.findMany({ where: { ...isCustomer, id: { in: [...ids.customer] } }, select: { id: true, name: true } }),
      db.party.findMany({ where: { ...isSupplier, id: { in: [...ids.factory] } }, select: { id: true, name: true } }),
      db.user.findMany({ where: { id: { in: [...ids.user] } }, select: { id: true, name: true } }),
      db.order.findMany({ where: { id: { in: [...ids.order] } }, select: { id: true, refNo: true } }),
    ]);
    const map = (l: { id: string; name: string }[]) => new Map(l.map((x) => [x.id, x.name]));
    return {
      money: map(money),
      customer: map(customers),
      factory: map(factories),
      user: map(users),
      order: new Map(orders.map((o) => [o.id, o.refNo])),
    };
  }

  /** Who a row is with: the factory, else the person (own money), else the customer. */
  private withOf(r: Pick<Row, "account" | "customerId" | "factoryId" | "userId">, n: Awaited<ReturnType<LedgerService["names"]>>) {
    const a = parseLedgerAccount(r.account);
    if (a.kind === "factory" && a.id) return { kind: "factory" as const, id: a.id, name: n.factory.get(a.id) ?? "Factory" };
    if (a.kind === "staff" && a.id) return { kind: "staff" as const, id: a.id, name: n.user.get(a.id) ?? "Staff" };
    if ((a.kind === "customer" || a.kind === "credit") && a.id)
      return { kind: "customer" as const, id: a.id, name: n.customer.get(a.id) ?? "Customer" };
    if (r.factoryId) return { kind: "factory" as const, id: r.factoryId, name: n.factory.get(r.factoryId) ?? "Factory" };
    if (r.userId) return { kind: "staff" as const, id: r.userId, name: n.user.get(r.userId) ?? "Staff" };
    if (r.customerId) return { kind: "customer" as const, id: r.customerId, name: n.customer.get(r.customerId) ?? "Customer" };
    return null;
  }

  private where(q: Partial<EntriesQuery>): Prisma.Sql {
    const c: Prisma.Sql[] = [Prisma.sql`true`];
    if (q.from) c.push(Prisma.sql`l.date >= ${q.from}::date`);
    if (q.to) c.push(Prisma.sql`l.date <= ${q.to}::date`);
    if (q.type) c.push(Prisma.sql`l.type = ${q.type}`);
    if (q.account) c.push(q.account.endsWith(":") ? Prisma.sql`l.account like ${`${q.account}%`}` : Prisma.sql`l.account = ${q.account}`);
    if (q.customerId) c.push(Prisma.sql`l.customer_id = ${q.customerId}::uuid`);
    if (q.factoryId) c.push(Prisma.sql`l.factory_id = ${q.factoryId}::uuid`);
    if (q.userId) c.push(Prisma.sql`l.user_id = ${q.userId}::uuid`);
    if (q.orderId) c.push(Prisma.sql`l.order_id = ${q.orderId}::uuid`);
    if (q.currency) c.push(Prisma.sql`l.currency = ${q.currency}`);
    if (q.removed === false)
      c.push(Prisma.sql`l.reverses_id is null and not exists (select 1 from ledger_entries r where r.reverses_id = l.id)`);
    return Prisma.join(c, " and ");
  }

  /** The rows as posted, newest first, with totals of everything the filters keep (debits equal credits). */
  async entries(q: EntriesQuery) {
    await this.posting.ensureBuilt();
    const db = this.prisma.db;
    const where = this.where(q);
    const lead = q.lead
      ? Prisma.sql`and (case when l.reverses_id is null then (l.debit > 0 or l.debit_base > 0) else (l.credit > 0 or l.credit_base > 0) end)`
      : Prisma.empty;
    const [ids, count, totals, byCurrency] = await Promise.all([
      db.$queryRaw<{ id: string }[]>`
        select l.id from ledger_entries l where ${where} ${lead}
         order by l.date desc, l.entry_no desc, l.line
         limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`,
      db.$queryRaw<{ n: number }[]>`select count(*)::int as n from ledger_entries l where ${where} ${lead}`,
      db.$queryRaw<{ debit: string | null; credit: string | null; n: number }[]>`
        select sum(l.debit_base)::text as debit, sum(l.credit_base)::text as credit, count(distinct l.group_id)::int as n from ledger_entries l where ${where}`,
      db.$queryRaw<{ currency: string; debit: string; credit: string }[]>`
        select l.currency::text, sum(l.debit)::text as debit, sum(l.credit)::text as credit from ledger_entries l where ${where} group by 1 order by 1`,
    ]);
    const rows = await db.ledgerEntry.findMany({ where: { id: { in: ids.map((r) => r.id) } } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ordered = ids.map((r) => byId.get(r.id)!).filter(Boolean);
    // The other side of each row: the biggest row of its posting on the other side.
    const groups = await db.ledgerEntry.findMany({
      where: { groupId: { in: [...new Set(ordered.map((r) => r.groupId))] } },
      orderBy: [{ groupId: "asc" }, { line: "asc" }],
    });
    const reversed = new Set(
      (await db.ledgerEntry.findMany({ where: { reversesId: { in: ordered.map((r) => r.id) } }, select: { reversesId: true } })).map(
        (r) => r.reversesId!,
      ),
    );
    const reversedOn = new Map(
      (
        await db.ledgerEntry.findMany({
          where: { reversesId: { in: ordered.map((r) => r.id) } },
          select: { reversesId: true, date: true, reason: true },
        })
      ).map((r) => [r.reversesId!, { on: fromDbDate(r.date), reason: r.reason }]),
    );
    const n = await this.names([...ordered, ...groups]);
    const label = (account: string) => ledgerAccountLabel(account, n);
    const view = ordered.map((r) => {
      const side = minor(r.debit) > 0 || minor(r.debitBase) > 0 ? "debit" : "credit";
      // The other side: with as many lines on each side, the one in the same place (an expense charged to the customer:
      // the cost against the account, the customer against what is recovered); else the biggest.
      const isDebit = (g: Row) => minor(g.debit) > 0 || minor(g.debitBase) > 0;
      const mine = groups.filter((g) => g.groupId === r.groupId);
      const same = mine.filter((g) => isDebit(g) === (side === "debit"));
      const others = mine.filter((g) => isDebit(g) !== (side === "debit"));
      const counter =
        others.length === same.length && others.length > 1
          ? (others[same.findIndex((g) => g.id === r.id)] ?? null)
          : ([...others].sort((a, b) => minor(b.debitBase) + minor(b.creditBase) - (minor(a.debitBase) + minor(a.creditBase)))[0] ?? null);
      return {
        ...this.rowView(r, n),
        side,
        counter: counter ? { account: counter.account, label: label(counter.account) } : null,
        removed: reversed.has(r.id) ? (reversedOn.get(r.id) ?? { on: null, reason: null }) : null,
      };
    });
    const t = totals[0];
    return {
      mainCurrency: (await this.settings.get()).sales.currency,
      rows: view,
      total: count[0]?.n ?? 0,
      page: q.page,
      pageSize: q.pageSize,
      totals: {
        debit: money(minor(t?.debit)),
        credit: money(minor(t?.credit)),
        balanced: minor(t?.debit) === minor(t?.credit),
        entries: t?.n ?? 0,
      },
      byCurrency: byCurrency.map((c) => ({ currency: c.currency, debit: money(minor(c.debit)), credit: money(minor(c.credit)) })),
    };
  }

  private rowView(r: Row, n: Awaited<ReturnType<LedgerService["names"]>>) {
    return {
      id: r.id,
      entryNo: r.entryNo,
      groupId: r.groupId,
      date: fromDbDate(r.date),
      postedAt: r.postedAt,
      type: r.type,
      typeLabel: LEDGER_ENTRY_TYPE_LABEL[r.type as LedgerEntryType] ?? r.type,
      source: { type: r.sourceType, id: r.sourceId },
      ref: r.ref,
      account: r.account,
      accountLabel: ledgerAccountLabel(r.account, n),
      debit: money(minor(r.debit)),
      credit: money(minor(r.credit)),
      currency: r.currency,
      rate: r.rate === null ? null : Number(r.rate),
      debitBase: money(minor(r.debitBase)),
      creditBase: money(minor(r.creditBase)),
      with: this.withOf(r, n),
      order: r.orderId ? { id: r.orderId, refNo: n.order.get(r.orderId) ?? "" } : null,
      memo: r.memo,
      reason: r.reason,
      reversesId: r.reversesId,
      correction: r.type === "correction",
    };
  }

  /** One posting: its rows, what it settles, its document (and the file), who saved and approved it, its corrections. */
  async entry(id: string) {
    await this.posting.ensureBuilt();
    const db = this.prisma.db;
    const one = await db.ledgerEntry.findFirst({ where: { OR: [{ id }, { groupId: id }] } });
    if (!one) throw new NotFoundError("Ledger entry");
    const rows = await db.ledgerEntry.findMany({ where: { groupId: one.groupId }, orderBy: { line: "asc" } });
    const [reversals, reverses, related] = await Promise.all([
      db.ledgerEntry.findMany({
        where: { reversesId: { in: rows.map((r) => r.id) } },
        select: { groupId: true, entryNo: true, date: true, reason: true },
        distinct: ["groupId"],
      }),
      one.reversesId
        ? db.ledgerEntry.findUnique({ where: { id: one.reversesId }, select: { groupId: true, entryNo: true, date: true } })
        : Promise.resolve(null),
      db.ledgerEntry.findMany({
        where: { sourceType: one.sourceType, sourceId: one.sourceId, NOT: { groupId: one.groupId } },
        select: { groupId: true, entryNo: true, date: true, type: true, reason: true },
        distinct: ["groupId"],
        orderBy: { entryNo: "asc" },
      }),
    ]);
    const n = await this.names(rows);
    const postedBy = one.createdById
      ? await db.user.findUnique({ where: { id: one.createdById }, select: { id: true, name: true } })
      : null;
    const doc = await this.documentOf(one.sourceType, one.sourceId);
    return {
      groupId: one.groupId,
      entryNo: one.entryNo,
      date: fromDbDate(one.date),
      postedAt: one.postedAt,
      type: one.type,
      typeLabel: LEDGER_ENTRY_TYPE_LABEL[one.type as LedgerEntryType] ?? one.type,
      ref: one.ref,
      memo: one.memo,
      reason: one.reason,
      postedBy,
      rows: rows.map((r) => this.rowView(r, n)),
      totals: {
        debit: money(rows.reduce((t, r) => t + minor(r.debitBase), 0)),
        credit: money(rows.reduce((t, r) => t + minor(r.creditBase), 0)),
      },
      /** The posting that corrected or removed this one, and the one this one reverses. */
      reversedBy: reversals.map((r) => ({ groupId: r.groupId, entryNo: r.entryNo, date: fromDbDate(r.date), reason: r.reason })),
      reverses: reverses && { groupId: reverses.groupId, entryNo: reverses.entryNo, date: fromDbDate(reverses.date) },
      /** The document's other postings (its first posting, corrections, its repayment). */
      related: related.map((r) => ({ groupId: r.groupId, entryNo: r.entryNo, date: fromDbDate(r.date), type: r.type, reason: r.reason })),
      source: doc,
    };
  }

  /** The document a posting comes from: where it is, its file, who recorded and approved it, what it settles. */
  private async documentOf(type: string, sourceId: string) {
    const db = this.prisma.db;
    const base = {
      type,
      id: sourceId,
      orderId: null as string | null,
      customerId: null as string | null,
      factoryId: null as string | null,
      userId: null as string | null,
    };
    const out = {
      ...base,
      label: "",
      /** Its proof or receipt, opened at /files/<id>. */
      file: null as { id: string; name: string } | null,
      recordedBy: null as string | null,
      approvedBy: null as string | null,
      settles: null as string | null,
      removed: null as { at: Date; reason: string | null } | null,
      /** The payment on an order it is (its receipt prints from it). */
      partId: null as string | null,
    };
    const approval = async (id: string) => {
      const s = await db.moneySubmission.findFirst({
        where: { createdId: id, status: "approved" },
        select: { submittedBy: { select: { name: true } }, decidedBy: { select: { name: true } }, submittedAt: true },
      });
      return s
        ? {
            recordedBy: `${s.submittedBy.name} · sent for approval ${todayIn(this.clock.timeZone, s.submittedAt)}`,
            approvedBy: s.decidedBy?.name ?? null,
          }
        : null;
    };
    if (type === "movement") {
      const other = await db.moneyMovement.findUnique({
        where: { id: sourceId },
        include: {
          account: { select: { name: true } },
          toAccount: { select: { name: true } },
          party: { select: { name: true } },
          recordedBy: { select: { name: true } },
          files: liveFile,
          allocations: { where: { target: "purchase" }, include: { purchaseOrder: { select: { id: true, refNo: true, customerId: true } } }, take: 1 },
        },
      });
      if (other?.direction === "move")
        return {
          ...out,
          label: `${other.account?.name ?? ""} → ${other.toAccount?.name ?? ""}`,
          recordedBy: other.recordedBy.name,
          removed: other.voidedAt ? { at: other.voidedAt, reason: other.voidReason } : null,
        };
      if (other?.partyRole === "supplier") {
        const p = other.allocations[0];
        return {
          ...out,
          orderId: p?.purchaseOrderId ?? null,
          customerId: p?.purchaseOrder?.customerId ?? null,
          factoryId: other.partyId,
          label: `Payment to ${other.party?.name ?? ""} for ${p?.purchaseOrder?.refNo ?? ""}`,
          file: other.files[0] ? { id: other.files[0].id, name: other.files[0].fileName } : null,
          recordedBy: other.recordedBy.name,
          settles: p ? await this.settlesOfFactoryPayment(p.id) : null,
          removed: other.voidedAt ? { at: other.voidedAt, reason: other.voidReason } : null,
        };
      }
      const m = await db.moneyMovement.findUnique({
        where: { id: sourceId },
        include: { allocations: { where: { later: false }, select: { id: true, orderId: true, amount: true, order: { select: { refNo: true } } } }, recordedBy: { select: { name: true } } },
      });
      if (!m) return out;
      const parts = m.allocations.filter((a) => a.order);
      const one = parts.length === 1 && decimalToMinor(m.allocatable) === decimalToMinor(parts[0]!.amount) ? parts[0]! : null;
      const a = await approval(one?.id ?? m.id);
      return {
        ...out,
        // On its order when it pays one (credit left over or not); the payment on it when it pays it exactly.
        orderId: one?.orderId ?? (new Set(parts.map((p) => p.orderId)).size === 1 ? parts[0]!.orderId : null),
        partId: one?.id ?? null,
        customerId: m.partyId,
        label: m.direction === "out" ? "Credit refunded" : one ? `Payment on ${one.order!.refNo}` : "One transfer over several orders",
        file: other?.files[0] ? { id: other.files[0].id, name: other.files[0].fileName } : null,
        recordedBy: a?.recordedBy ?? m.recordedBy.name,
        approvedBy: a?.approvedBy ?? null,
        settles:
          m.direction === "out"
            ? null
            : one
              ? await this.settlesOfPayment(one.id, one.orderId!)
              : `Pays ${[...new Set(parts.map((p) => p.order!.refNo))].join(", ") || "the customer's credit"}`,
        removed: m.voidedAt ? { at: m.voidedAt, reason: m.voidReason } : null,
      };
    }
    if (type === "allocation") {
      const x = await db.allocation.findUnique({
        where: { id: sourceId },
        include: { movement: { select: { partyId: true } }, order: { select: { refNo: true } }, recordedBy: { select: { name: true } } },
      });
      if (!x) return out;
      return {
        ...out,
        customerId: x.movement.partyId,
        orderId: x.orderId,
        partId: x.later && x.target === "order" ? x.id : null,
        label: x.target === "fee" ? "Cancellation fee" : !x.later ? `Kept from cancelled ${x.order?.refNo ?? ""} as credit` : `Paid from the customer's credit for ${x.order?.refNo ?? ""}`,
        recordedBy: x.recordedBy.name,
        settles: x.later && x.orderId ? await this.settlesOfPayment(x.id, x.orderId) : null,
        removed: x.later && x.voidedAt ? { at: x.voidedAt, reason: x.voidReason } : null,
      };
    }
    if (type === "expense") {
      const e = await db.expense.findUnique({
        where: { id: sourceId },
        include: {
          files: liveFile,
          order: { select: { refNo: true } },
          factory: { select: { name: true } },
          paidBy: { select: { name: true } },
          recordedBy: { select: { name: true } },
        },
      });
      if (!e) return out;
      const a = await approval(e.id);
      const settles =
        e.borneBy === "customer" && e.order
          ? `Charged to the customer on ${e.order.refNo}`
          : e.borneBy === "factory" && e.factory
            ? `Taken off what we owe ${e.factory.name}`
            : e.ownMoney && e.paidBy
              ? e.repaidOn
                ? `Repaid to ${e.paidBy.name} on ${fromDbDate(e.repaidOn)}`
                : `We owe ${e.paidBy.name} until it is repaid`
              : null;
      return {
        ...out,
        orderId: e.orderId,
        customerId: e.customerId,
        factoryId: e.factoryId,
        userId: e.ownMoney ? e.paidById : null,
        label: e.description,
        file: e.files[0] ? { id: e.files[0].id, name: e.files[0].fileName } : null,
        recordedBy: a?.recordedBy ?? e.recordedBy.name,
        approvedBy: a?.approvedBy ?? null,
        settles,
        removed: e.voidedAt ? { at: e.voidedAt, reason: e.voidReason } : null,
      };
    }
    if (type === "order" || type === "fx_order" || type === "purchase_order" || type === "fx_factory") {
      const [orderId, factoryId] = sourceId.split(":") as [string, string | undefined];
      const o = await db.order.findUnique({
        where: { id: orderId },
        select: { id: true, refNo: true, customerId: true, status: true, cancellation: { select: { cancelledAt: true, reason: true } } },
      });
      if (!o) return out;
      return {
        ...out,
        orderId: o.id,
        customerId: o.customerId,
        factoryId: factoryId ?? null,
        label:
          type === "order"
            ? `Order ${o.refNo}`
            : type === "purchase_order"
              ? `What we owe the factory on ${o.refNo}`
              : `Exchange difference on ${o.refNo}`,
        removed: o.status === "cancelled" && o.cancellation ? { at: o.cancellation.cancelledAt, reason: o.cancellation.reason } : null,
      };
    }
    if (type === "account") {
      const a = await db.moneyAccount.findUnique({ where: { id: sourceId }, select: { name: true } });
      return { ...out, label: a ? `Opening balance of ${a.name}` : "Opening balance" };
    }
    return out;
  }

  /** The instalments of the customer's plan a payment paid (counted in date order with the others). */
  private async settlesOfPayment(paymentId: string, orderId: string) {
    const db = this.prisma.db;
    const [payments, plans] = await Promise.all([
      db.allocation.findMany({
        where: { orderId, ...livePart },
        orderBy: [{ on: "asc" }, { createdAt: "asc" }],
        select: { id: true, amount: true, bankCharges: true },
      }),
      livePlansOf(db, [orderId]),
    ]);
    const at = payments.findIndex((p) => p.id === paymentId);
    if (at < 0) return null;
    const before = payments.slice(0, at).reduce((t, p) => t + minor(p.amount) + minor(p.bankCharges), 0);
    const after = before + minor(payments[at]!.amount) + minor(payments[at]!.bankCharges);
    const items = plans.get(orderId)?.items ?? [];
    const was = payInstalments(items, before);
    const now = payInstalments(items, after);
    const touched = now.flatMap((x, i) =>
      x.paidMinor > was[i]!.paidMinor ? [`${x.item.label} (plan row ${i + 1})${x.openMinor <= 0 ? " · now paid" : " · part paid"}`] : [],
    );
    const order = await db.order.findUnique({ where: { id: orderId }, select: { refNo: true } });
    return touched.length ? `${touched.join(", ")} on ${order?.refNo ?? ""}` : null;
  }

  /** The parts of the factory's plan a payment paid. */
  private async settlesOfFactoryPayment(id: string) {
    const db = this.prisma.db;
    const part = await db.allocation.findUnique({ where: { id }, include: { movement: { select: { partyId: true, currency: true } } } });
    if (!part?.purchaseOrderId) return null;
    const p = { orderId: part.purchaseOrderId, factoryId: part.movement.partyId!, currency: part.movement.currency };
    const [paid, plan] = await Promise.all([
      db.allocation
        .findMany({
          where: { ...livePurchase, purchaseOrderId: p.orderId, movement: { partyId: p.factoryId, currency: p.currency } },
          orderBy: [{ on: "asc" }, { createdAt: "asc" }],
          select: { id: true, share: true },
        })
        .then((rows) => rows.map((x) => ({ id: x.id, amount: x.share }))),
      db.invoice.findMany({
        where: { purchaseOrderId: p.orderId, supplierId: p.factoryId, currency: p.currency },
        orderBy: { sortOrder: "asc" },
        select: { label: true, amount: true },
      }),
    ]);
    const at = paid.findIndex((x) => x.id === id);
    if (at < 0 || !plan.length) return null;
    const items = plan.map((r) => ({ label: r.label, amountMinor: minor(r.amount) }));
    const before = paid.slice(0, at).reduce((t, x) => t + minor(x.amount), 0);
    const was = payInstalments(items, before);
    const now = payInstalments(items, before + minor(paid[at]!.amount));
    const touched = now.flatMap((x, i) =>
      x.paidMinor > was[i]!.paidMinor
        ? [`${x.item.label} (their plan row ${i + 1})${x.openMinor <= 0 ? " · now paid" : " · part paid"}`]
        : [],
    );
    return touched.length ? touched.join(", ") : null;
  }

  /* ---------------------------------------------------------------- one party */

  /**
   * A customer's, factory's or person's ledger between two days: the balance before, every row with the balance
   * after it (in the party's currency and the main one), the balance at the end, and ageing. "Only open items"
   * leaves out the orders that are settled. Rows removed and their reversals are left out unless asked for (they
   * cancel out).
   */
  async party(kind: LedgerPartyKind, id: string, q: { from?: ISODate; to?: ISODate; onlyOpen: boolean; removed: boolean }) {
    await this.posting.ensureBuilt();
    const db = this.prisma.db;
    const party =
      kind === "customer"
        ? await db.party.findFirst({ where: { ...isCustomer, id }, select: { id: true, name: true, country: true } })
        : kind === "factory"
          ? await db.party.findFirst({ where: { ...isSupplier, id }, select: { id: true, name: true } })
          : await db.user.findFirst({ where: { id }, select: { id: true, name: true } });
    if (!party) throw new NotFoundError(kind === "customer" ? "Customer" : kind === "factory" ? "Factory" : "Person");
    const account = partyAccount(kind, id);
    const sign = partySign(kind);
    const today = this.clock.today();
    const to = q.to ?? today;
    const from = q.from ?? `${to.slice(0, 4)}-01-01`;
    const pairs = q.removed
      ? Prisma.empty
      : Prisma.sql`and l.reverses_id is null and not exists (select 1 from ledger_entries r where r.reverses_id = l.id)`;
    // Orders settled by the end of the period (their balance 0), for "Only open items".
    const settled = q.onlyOpen
      ? new Set(
          (
            await db.$queryRaw<{ orderId: string }[]>`
              select l.order_id as "orderId" from ledger_entries l where l.account = ${account} and l.order_id is not null and l.date <= ${to}::date
               group by l.order_id, l.currency having sum(l.debit - l.credit) = 0`
          ).map((r) => r.orderId),
        )
      : new Set<string>();
    const [openingRows, rows] = await Promise.all([
      db.$queryRaw<{ currency: string; minor: string; base: string }[]>`
        select l.currency::text, sum(l.debit - l.credit)::text as minor, sum(l.debit_base - l.credit_base)::text as base
          from ledger_entries l where l.account = ${account} and l.date < ${from}::date ${pairs} group by 1`,
      db.$queryRaw<{ id: string }[]>`
        select l.id from ledger_entries l where l.account = ${account} and l.date >= ${from}::date and l.date <= ${to}::date ${pairs}
         order by l.date, l.entry_no, l.line`,
    ]);
    const list = (await db.ledgerEntry.findMany({ where: { id: { in: rows.map((r) => r.id) } } })).sort((a, b) =>
      a.date.getTime() !== b.date.getTime() ? a.date.getTime() - b.date.getTime() : a.entryNo - b.entryNo || a.line - b.line,
    );
    const reversed = new Set(
      (await db.ledgerEntry.findMany({ where: { reversesId: { in: list.map((r) => r.id) } }, select: { reversesId: true } })).map(
        (r) => r.reversesId!,
      ),
    );
    // The other side of each row (a payment: the bank or cash account it went to), as on the entries list.
    const groupLines = await db.ledgerEntry.findMany({ where: { groupId: { in: [...new Set(list.map((r) => r.groupId))] }, account: { not: account } } });
    const n = await this.names([...list, ...groupLines]);
    const counterOf = (r: (typeof list)[number]) => {
      const debit = minor(r.debit) > 0 || minor(r.debitBase) > 0;
      const other = groupLines
        .filter((g) => g.groupId === r.groupId && (minor(g.debit) > 0 || minor(g.debitBase) > 0) !== debit)
        .sort((a, b) => minor(b.debitBase) + minor(b.creditBase) - (minor(a.debitBase) + minor(a.creditBase)))[0];
      return other ? { account: other.account, label: ledgerAccountLabel(other.account, n) } : null;
    };
    const opening = new Map(openingRows.map((r) => [r.currency, { minor: sign * minor(r.minor), base: sign * minor(r.base) }]));
    const running = new Map([...opening.entries()].map(([c, v]) => [c, { ...v }]));
    let runningBase = [...opening.values()].reduce((t, v) => t + v.base, 0);
    const openingBase = runningBase;
    const totals = { debit: 0, credit: 0, debitBase: 0, creditBase: 0 };
    const view = [];
    for (const r of list) {
      const cur = running.get(r.currency) ?? { minor: 0, base: 0 };
      cur.minor += sign * (minor(r.debit) - minor(r.credit));
      cur.base += sign * (minor(r.debitBase) - minor(r.creditBase));
      running.set(r.currency, cur);
      runningBase += sign * (minor(r.debitBase) - minor(r.creditBase));
      if (r.orderId && settled.has(r.orderId)) continue;
      totals.debit += minor(r.debit);
      totals.credit += minor(r.credit);
      totals.debitBase += minor(r.debitBase);
      totals.creditBase += minor(r.creditBase);
      view.push({ ...this.rowView(r, n), counter: counterOf(r), balance: money(cur.minor), balanceBase: money(runningBase), removed: reversed.has(r.id) });
    }
    const currencies = [...new Set([...opening.keys(), ...running.keys()])].sort();
    const credit =
      kind === "customer"
        ? await db.$queryRaw<{ currency: string; minor: string }[]>`
            select currency::text, sum(credit - debit)::text as minor from ledger_entries where account = ${`credit:${id}`} group by 1 having sum(credit - debit) <> 0`
        : [];
    return {
      party: { kind, id: party.id, name: party.name, country: "country" in party ? party.country : null },
      account,
      from,
      to,
      mainCurrency: (await this.settings.get()).sales.currency,
      /** customer: what they owe us (debit − credit); factory, staff: what we owe them (credit − debit). */
      sign: kind === "customer" ? "they owe us" : "we owe",
      currencies: currencies.map((c) => ({
        currency: c,
        opening: money(opening.get(c)?.minor ?? 0),
        closing: money(running.get(c)?.minor ?? 0),
      })),
      opening: { base: money(openingBase) },
      closing: { base: money(runningBase) },
      totals: {
        debit: money(totals.debit),
        credit: money(totals.credit),
        debitBase: money(totals.debitBase),
        creditBase: money(totals.creditBase),
      },
      rows: view,
      /** Customers: the credit we hold for them, per currency. */
      credit: credit.map((c) => ({ currency: c.currency, amount: money(minor(c.minor)) })),
      ageing: await this.partyAgeing(kind, id),
    };
  }

  /* ---------------------------------------------------------------- statements */

  /**
   * A party's statement of account between two days, in one currency, as a paper in Kebo's one document template
   * (KeboDoc): the balance before, every row with the balance after it, the balance at the end, and what is open.
   * Numbered per party and year (ST-C-2026-0003 for a customer, ST-F-… a factory, ST-S-… a person) when issued
   * (issueStatement); a preview without a number says so.
   */
  async statement(kind: LedgerPartyKind, id: string, q: { from?: ISODate; to?: ISODate; currency?: string; no?: number }) {
    const p = await this.party(kind, id, { from: q.from, to: q.to, onlyOpen: false, removed: false });
    const s = await this.settings.get();
    const db = this.prisma.db;
    const withRows = p.currencies.filter((c) => Number(c.closing) !== 0 || p.rows.some((r) => r.currency === c.currency));
    const currency =
      q.currency && p.currencies.some((c) => c.currency === q.currency)
        ? q.currency
        : (withRows[0]?.currency ?? p.currencies[0]?.currency ?? s.sales.currency);
    const cur = p.currencies.find((c) => c.currency === currency) ?? { currency, opening: "0.00", closing: "0.00" };
    const details =
      kind === "customer"
        ? await db.party.findUnique({ where: { ...isCustomer, id }, select: { name: true, country: true, address: true, taxNo: true, regNo: true } })
        : kind === "factory"
          ? await db.party.findUnique({ where: { ...isSupplier, id }, select: { name: true, address: true } })
          : await db.user.findUnique({ where: { id }, select: { name: true } });
    const letter = kind === "customer" ? "C" : kind === "factory" ? "F" : "S";
    const year = Number(p.to.slice(0, 4));
    if (q.no && q.no > (await this.statementIssued(kind, id, year))) throw new DomainError(`Statement ${q.no} of ${year} was not issued.`);
    const number = q.no ? `ST-${letter}-${year}-${String(q.no).padStart(4, "0")}` : "Draft";
    const head =
      kind === "customer"
        ? { debit: "Invoiced", credit: "Paid", total: "Balance due", box: "Open items" }
        : kind === "factory"
          ? { debit: "Paid / taken off", credit: "Ordered", total: "Closing balance · we owe you", box: "Next payments" }
          : { debit: "Repaid", credit: "Paid from own money", total: "Closing balance · we owe you", box: "Not repaid yet" };
    const cell = (v: string) => (Number(v) === 0 ? "" : { money: v, currency });
    const rows = p.rows
      .filter((r) => r.currency === currency)
      .map((r) => ({
        date: { date: r.date },
        // The document's own number when it has one (RC-, FP-, PO-, EX-…), then what it was.
        item: [/^(RC|FP|PO|EX|TR|CR)-/.test(r.ref) ? r.ref : null, r.memo].filter(Boolean).join(" · "),
        debit: cell(r.debit),
        credit: cell(r.credit),
        balance: { money: r.balance, currency },
      }));
    const ageing = p.ageing.buckets.flatMap((b) => b.items.filter((i) => i.currency === currency).map((i) => ({ ...i, bucket: b.label })));
    const bullets: (string | { label: string; value: string })[] = ageing
      .slice(0, 8)
      .map((i) => ({
        label: `${i.refNo ? `${i.refNo} · ` : ""}${i.label}${i.dueOn ? `, due ${i.dueOn}` : ""}:`,
        value: `${currency} ${Number(i.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
      }));
    if (!bullets.length) bullets.push(kind === "customer" ? "Nothing is open." : "Nothing to pay.");
    bullets.push("Please check this statement and tell us of any difference within 7 days.");
    const doc = {
      kind: "statement" as const,
      title: "STATEMENT OF ACCOUNT",
      numberLabel: "Statement No.",
      number,
      date: this.clock.today(),
      company: { ...companySnapshot(s), stamp: null },
      party: {
        name: details?.name ?? p.party.name,
        country: details && "country" in details ? details.country : null,
        address: details && "address" in details ? details.address : null,
        taxNo: details && "taxNo" in details ? details.taxNo : null,
        regNo: details && "regNo" in details ? details.regNo : null,
      },
      meta: [
        { label: "Period", value: `${p.from} – ${p.to}` },
        { label: "Currency", value: currency },
      ],
      heading: null,
      columns: [
        { key: "date", label: "Date", width: 70 },
        { key: "item", label: "Details", wrap: true },
        { key: "debit", label: head.debit, width: 92, align: "right" as const },
        { key: "credit", label: head.credit, width: 92, align: "right" as const },
        { key: "balance", label: "Balance", width: 96, align: "right" as const },
      ],
      rows: [
        { date: { date: p.from }, item: "Opening balance", debit: "", credit: "", balance: { money: cur.opening, currency } },
        ...rows,
        {
          date: { date: p.to },
          item: kind === "customer" ? "Closing balance" : "Closing balance · we owe you",
          debit: "",
          credit: "",
          balance: { money: cur.closing, currency },
        },
      ],
      sums: [],
      total: { label: head.total, amount: cur.closing, currency },
      foot: null,
      boxTitle: head.box,
      bullets,
      bank: kind === "customer" ? s.company.bankDetails || null : null,
      signatures: null,
    };
    const amount = `${currency} ${Number(cur.closing).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
    return {
      doc,
      party: p.party,
      from: p.from,
      to: p.to,
      currency,
      currencies: p.currencies.map((c) => c.currency),
      issued: !!q.no,
      share: {
        fileName: `Statement ${number} ${p.party.name}`.replace(/[^\w.() -]+/g, "-"),
        message:
          kind === "customer"
            ? `Dear ${p.party.name}, please find your statement of account for ${p.from} – ${p.to} (${number}): balance due ${amount}. Please tell us of any difference within 7 days.`
            : kind === "factory"
              ? `Dear ${p.party.name}, please find our statement of account for ${p.from} – ${p.to} (${number}): we owe you ${amount}. Please check it and tell us of any difference within 7 days.`
              : `${p.party.name}, your "to repay" statement for ${p.from} – ${p.to} (${number}): we owe you ${amount}.`,
      },
    };
  }

  /** Gives a statement its number: the next for the party in the year (ST-F-2026-0012). */
  async issueStatement(kind: LedgerPartyKind, id: string, year: number) {
    const exists =
      kind === "customer"
        ? await this.prisma.db.party.count({ where: { ...isCustomer, id } })
        : kind === "factory"
          ? await this.prisma.db.party.count({ where: { ...isSupplier, id } })
          : await this.prisma.db.user.count({ where: { id } });
    if (!exists) throw new NotFoundError(kind === "customer" ? "Customer" : kind === "factory" ? "Factory" : "Person");
    const no = await nextCount(this.prisma.db, `statement-${kind}-${id}-${year}`.slice(0, 50));
    const letter = kind === "customer" ? "C" : kind === "factory" ? "F" : "S";
    return { no, number: `ST-${letter}-${year}-${String(no).padStart(4, "0")}` };
  }

  /** The highest statement number given to a party in a year (a number asked for must have been given). */
  async statementIssued(kind: LedgerPartyKind, id: string, year: number) {
    const c = await this.prisma.db.counter.findFirst({
      where: { key: `statement-${kind}-${id}-${year}`.slice(0, 50) },
      select: { value: true },
    });
    return c?.value ?? 0;
  }

  /* ---------------------------------------------------------------- ageing */

  private emptyBuckets() {
    return Object.fromEntries(AGEING_BUCKETS.map((b) => [b, { base: 0, items: [] as AgeingItem[] }])) as Record<
      AgeingBucket,
      { base: Minor; items: AgeingItem[] }
    >;
  }

  /** What is open per party, by how late (from the plan's due dates; charges from the day they were spent; staff from the day they paid). */
  private async ageingItems(
    side: "receivable" | "payable" | "staff",
    only?: string,
  ): Promise<Map<string, { name: string; items: AgeingItem[] }>> {
    const db = this.prisma.db;
    const fx = await this.fx();
    const s = await this.settings.get();
    const today = this.clock.today();
    const out = new Map<string, { name: string; items: AgeingItem[] }>();
    const add = (pid: string, name: string, item: AgeingItem) => {
      const p = out.get(pid) ?? { name, items: [] };
      p.items.push(item);
      out.set(pid, p);
    };
    if (side === "receivable") {
      const due = (await positionsSql(db, fx)).filter((r) => r.dueMinor > 0).map((r) => r.id);
      const orders = await db.order.findMany({
        where: { id: { in: due }, ...(only ? { customerId: only } : {}) },
        select: {
          id: true,
          refNo: true,
          currency: true,
          total: true,
          depositPercent: true,
          mainCurrency: true,
          mainRate: true,
          customer: { select: { id: true, name: true } },
          allocations: { where: livePart, select: { amount: true, bankCharges: true, voidedAt: true } },
          receivables: { orderBy: { sortOrder: "asc" }, select: { amount: true, part: true } },
          expenses: chargedExpenses,
        },
      });
      const plans = await livePlansOf(
        db,
        orders.map((o) => o.id),
      );
      for (const o of orders) {
        const pos = positionOf(o, fx);
        const rate = orderRate(o, fx.main, fx.rates);
        const base = (m: Minor) => (rate ? Math.round(m / rate) : 0);
        const status = planStatus(plans.get(o.id)?.items ?? [], pos.settledMinor, today, s.reminders.dueSoonDays);
        let left = pos.dueMinor;
        for (const it of status) {
          const open = Math.min(it.openMinor, left);
          if (open <= 0) continue;
          left -= open;
          add(o.customer.id, o.customer.name, {
            orderId: o.id,
            refNo: o.refNo,
            label: it.label,
            dueOn: it.dueOn,
            currency: o.currency,
            amount: open,
            base: base(open),
          });
        }
        // What is left (charges on top of the plan): due from the day the latest one was spent.
        if (left > 0) {
          const last =
            o.expenses
              .map((e) => fromDbDate(e.spentOn))
              .sort()
              .at(-1) ?? null;
          add(o.customer.id, o.customer.name, {
            orderId: o.id,
            refNo: o.refNo,
            label: "Charged to the customer",
            dueOn: last,
            currency: o.currency,
            amount: left,
            base: base(left),
          });
        }
      }
    } else if (side === "payable") {
      const owing = (await factoryPositionsSql(db, fx)).filter((r) => r.toPayMinor > 0 && (!only || r.factoryId === only));
      const orderIds = [...new Set(owing.map((r) => r.orderId))];
      const orders = new Map(
        (await db.order.findMany({ where: { id: { in: orderIds }, status: { not: "cancelled" } }, select: { id: true, refNo: true } })).map(
          (o) => [o.id, o],
        ),
      );
      for (const orderId of orderIds) {
        const o = orders.get(orderId);
        if (!o) continue;
        const plans = await factoryPlansOf(db, orderId, s.sales.factoryAdvancePercent, today, s.reminders.dueSoonDays, fx);
        for (const p of plans) {
          if (!owing.some((r) => r.orderId === orderId && r.factoryId === p.factory.id && r.currency === p.currency)) continue;
          const rate = p.currency === fx.main ? 1 : (fx.rates[p.currency] ?? null);
          for (const r of p.rows) {
            const open = decimalToMinor(r.open as never);
            if (open <= 0) continue;
            add(p.factory.id, p.factory.name, {
              orderId,
              refNo: o.refNo,
              label: r.label,
              dueOn: r.due,
              currency: p.currency,
              amount: open,
              base: rate ? Math.round(open / rate) : 0,
            });
          }
        }
      }
    } else {
      const rows = await db.expense.findMany({
        where: { ownMoney: true, repaidOn: null, voidedAt: null, paidById: only ?? { not: null } },
        select: {
          id: true,
          amount: true,
          currency: true,
          rate: true,
          spentOn: true,
          description: true,
          order: { select: { id: true, refNo: true } },
          paidBy: { select: { id: true, name: true } },
        },
      });
      for (const e of rows) {
        if (!e.paidBy) continue;
        const m = decimalToMinor(e.amount);
        add(e.paidBy.id, e.paidBy.name, {
          orderId: e.order?.id ?? null,
          refNo: e.order?.refNo ?? null,
          label: e.description,
          dueOn: fromDbDate(e.spentOn),
          currency: e.currency,
          amount: m,
          base: e.currency === fx.main ? m : Math.round(m / Number(e.rate)),
        });
      }
    }
    return out;
  }

  private bucketsOf(items: AgeingItem[]) {
    const today = this.clock.today();
    const b = this.emptyBuckets();
    for (const it of items) {
      const k = ageingBucket(it.dueOn, today);
      b[k].base += it.base;
      b[k].items.push(it);
    }
    return AGEING_BUCKETS.map((k) => ({
      bucket: k,
      label: AGEING_BUCKET_LABEL[k],
      base: money(b[k].base),
      items: b[k].items.map((i) => ({ ...i, amount: money(i.amount), base: money(i.base) })),
    }));
  }

  private async partyAgeing(kind: LedgerPartyKind, id: string) {
    const side = kind === "customer" ? "receivable" : kind === "factory" ? "payable" : "staff";
    const items = (await this.ageingItems(side, id)).get(id)?.items ?? [];
    return { total: money(items.reduce((t, i) => t + i.base, 0)), buckets: this.bucketsOf(items) };
  }

  /** Ageing of everyone on one side: customers (to receive), factories (to pay) or people (to repay). */
  async ageing(side: "receivable" | "payable" | "staff") {
    await this.posting.ensureBuilt();
    const all = await this.ageingItems(side);
    const today = this.clock.today();
    const totals = Object.fromEntries(AGEING_BUCKETS.map((b) => [b, 0])) as Record<AgeingBucket, Minor>;
    const rows = [...all.entries()]
      .map(([id, p]) => {
        const buckets = Object.fromEntries(AGEING_BUCKETS.map((b) => [b, 0])) as Record<AgeingBucket, Minor>;
        const byCurrency = new Map<string, Minor>();
        for (const it of p.items) {
          const k = ageingBucket(it.dueOn, today);
          buckets[k] += it.base;
          totals[k] += it.base;
          byCurrency.set(it.currency, (byCurrency.get(it.currency) ?? 0) + it.amount);
        }
        return {
          party: { kind: side === "receivable" ? "customer" : side === "payable" ? "factory" : "staff", id, name: p.name },
          total: money(Object.values(buckets).reduce((t, v) => t + v, 0)),
          buckets: Object.fromEntries(AGEING_BUCKETS.map((b) => [b, money(buckets[b])])) as Record<AgeingBucket, string>,
          byCurrency: [...byCurrency.entries()].map(([currency, m]) => ({ currency, amount: money(m) })),
          late: buckets.d1_30 + buckets.d31_60 + buckets.d61_90 + buckets.d90_plus,
        };
      })
      .sort((a, b) => b.late - a.late || Number(b.total) - Number(a.total))
      .map(({ late: _late, ...r }) => r);
    return {
      side,
      today,
      mainCurrency: (await this.settings.get()).sales.currency,
      buckets: AGEING_BUCKETS.map((b) => ({ bucket: b, label: AGEING_BUCKET_LABEL[b], base: money(totals[b]) })),
      total: money(Object.values(totals).reduce((t, v) => t + v, 0)),
      rows,
    };
  }

  /* ---------------------------------------------------------------- accounts */

  /** Every account's balance (per currency, and in the main currency), grouped as "By account" shows them. */
  async accounts(q: { to?: ISODate } = {}) {
    await this.posting.ensureBuilt();
    const db = this.prisma.db;
    const rows = await db.$queryRaw<
      { account: string; currency: string; minor: string; base: string; debit: string; credit: string; n: number }[]
    >`
      select account, currency::text, sum(debit - credit)::text as minor, sum(debit_base - credit_base)::text as base,
             sum(debit_base)::text as debit, sum(credit_base)::text as credit, count(*)::int as n
        from ledger_entries ${q.to ? Prisma.sql`where date <= ${q.to}::date` : Prisma.empty}
       group by 1, 2 order by 1, 2`;
    const n = await this.names(
      rows.map((r) => ({ account: r.account, customerId: null, factoryId: null, userId: null, orderId: null, moneyAccountId: null })),
    );
    const byAccount = new Map<
      string,
      {
        account: string;
        label: string;
        kind: string;
        id: string | null;
        group: string;
        balances: { currency: string; balance: string }[];
        base: Minor;
        rows: number;
      }
    >();
    let debit = 0;
    let credit = 0;
    for (const r of rows) {
      const a = parseLedgerAccount(r.account);
      const cur = byAccount.get(r.account) ?? {
        account: r.account,
        label: ledgerAccountLabel(r.account, n),
        kind: a.kind,
        id: a.id,
        group: LEDGER_ACCOUNT_GROUP[a.kind] ?? "Other",
        balances: [],
        base: 0,
        rows: 0,
      };
      cur.balances.push({ currency: r.currency, balance: money(minor(r.minor)) });
      cur.base += minor(r.base);
      cur.rows += r.n;
      byAccount.set(r.account, cur);
      debit += minor(r.debit);
      credit += minor(r.credit);
    }
    const groups = new Map<
      string,
      {
        group: string;
        base: Minor;
        accounts: {
          account: string;
          label: string;
          kind: string;
          id: string | null;
          balances: { currency: string; balance: string }[];
          base: string;
          rows: number;
        }[];
      }
    >();
    for (const a of [...byAccount.values()].sort((x, y) => x.label.localeCompare(y.label))) {
      const g = groups.get(a.group) ?? { group: a.group, base: 0, accounts: [] };
      g.base += a.base;
      g.accounts.push({
        account: a.account,
        label: a.label,
        kind: a.kind,
        id: a.id,
        balances: a.balances,
        base: money(a.base),
        rows: a.rows,
      });
      groups.set(a.group, g);
    }
    const state = await db.ledgerState.findFirst();
    return {
      mainCurrency: (await this.settings.get()).sales.currency,
      groups: [...groups.values()]
        .sort((x, y) => GROUP_ORDER.indexOf(x.group) - GROUP_ORDER.indexOf(y.group))
        .map((g) => ({ ...g, base: money(g.base) })),
      totals: { debit: money(debit), credit: money(credit), balanced: debit === credit },
      check: state ? { checkedAt: state.checkedAt, differences: state.differences } : null,
    };
  }

  /* ---------------------------------------------------------------- the check */

  /** The ledger against today's figures, now (kept as the last check). */
  async check(): Promise<LedgerCheck & { checkedAt: Date }> {
    await this.posting.ensureBuilt();
    const result = await ledgerCheck(this.prisma.db, await this.fx());
    const checkedAt = new Date();
    const report = { checked: result.checked, differences: result.differences.slice(0, 50) } as unknown as Prisma.InputJsonValue;
    await this.prisma.db.$executeRaw`
      insert into ledger_state (checked_at, differences, report) values (${checkedAt}, ${result.differences.length}, ${JSON.stringify(report)}::jsonb)
      on conflict (company_id) do update set checked_at = excluded.checked_at, differences = excluded.differences, report = excluded.report`;
    return { ...result, checkedAt };
  }

  /**
   * The worker's nightly run, per company: anything not posted as it stands is posted (a save path that did not
   * post shows here: written to the platform log), then the check; a difference goes to the platform log.
   */
  async nightly() {
    const companies = await this.prisma.platform.company.findMany({ where: { status: { not: "deleted" } }, orderBy: { createdAt: "asc" } });
    for (const c of companies)
      await CompanyContext.run(toInfo(c), async () => {
        const fresh = !(await this.posting.built());
        const synced = await this.posting.syncAll();
        const result = await this.check();
        const fixed = fresh ? 0 : synced.posted + synced.corrected + synced.reversed;
        if (fixed)
          await this.prisma.platform.platformLog.create({
            data: {
              action: "ledger_catch_up",
              companyId: c.id,
              summary: `Ledger: the nightly run posted ${fixed} document(s) their save had not posted`,
              details: { posted: synced.posted, corrected: synced.corrected, reversed: synced.reversed } as Prisma.InputJsonValue,
            },
          });
        if (result.differences.length) {
          this.log.warn(`${c.slug}: the ledger differs from today's figures in ${result.differences.length} place(s)`);
          await this.prisma.platform.platformLog.create({
            data: {
              action: "ledger_mismatch",
              companyId: c.id,
              summary: `Ledger: ${result.differences.length} difference(s) with today's figures (${c.name})`,
              details: { checked: result.checked, differences: result.differences.slice(0, 20) } as unknown as Prisma.InputJsonValue,
            },
          });
        } else
          this.log.log(
            `${c.slug}: the ledger agrees with today's figures (${result.checked.orders} orders, ${result.checked.factoryParts} factory parts, ${result.checked.accounts} accounts)`,
          );
      }).catch((e) => this.log.error(`the nightly ledger run for ${c.slug} failed: ${(e as Error).stack ?? e}`));
  }

  /** API start: every company whose ledger was never posted gets it posted (one company at a time). */
  async onStart() {
    const companies = await this.prisma.platform.company.findMany({ where: { status: { not: "deleted" } }, orderBy: { createdAt: "asc" } });
    for (const c of companies)
      await CompanyContext.run(toInfo(c), () => this.posting.ensureBuilt()).catch((e) =>
        this.log.error(`posting the ledger of ${c.slug} failed: ${(e as Error).stack ?? e}`),
      );
  }

  /** The day before a period starts (statements' opening). */
  static dayBefore(d: ISODate) {
    return addDays(d, -1);
  }
}

interface AgeingItem {
  orderId: string | null;
  refNo: string | null;
  label: string;
  dueOn: ISODate | null;
  currency: string;
  amount: Minor;
  base: Minor;
}
