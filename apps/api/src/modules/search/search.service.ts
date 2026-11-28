import { Injectable } from "@nestjs/common";
import { formatMinor, toMinor } from "@kebo/money";
import { isCustomer, isSupplier, type Prisma } from "@kebo/database";
import {
  can,
  INQUIRY_STAGE_LABEL,
  INQUIRY_STAGE_TONE,
  ORDER_STAGE_LABEL,
  ORDER_STAGE_TONE,
  PAPER_PREFIX,
  PAPER_STEP,
  REVISION_STATUS_LABEL,
  REVISION_STATUS_TONE,
  SEARCH_KINDS,
  type PaperKind,
  type SearchKind,
  type SearchQuery,
  type SearchResult,
  orderTabPath,
} from "@kebo/shared";
import { PrismaService } from "../../database/prisma.service";
import type { SessionUser } from "../../common/auth/session-user";
import { orderAccess } from "../../common/auth/order-access";
import { inquiryAccess } from "../inquiries/inquiries.service";
import { customerAccess } from "../parties/customers.service";
import { TreasuryService } from "../treasury/treasury.service";

type Group = SearchResult["groups"][number];
const like = (v: string) => ({ contains: v, mode: "insensitive" as const });
const same = (v: string) => ({ equals: v, mode: "insensitive" as const });
const regions = new Intl.DisplayNames(["en"], { type: "region" });
const countryName = (code: string | null) => {
  if (!code) return null;
  try {
    return regions.of(code) ?? code;
  } catch {
    return code;
  }
};
/** "13 Nov": a day as a result's line says it. */
const dayMonth = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const line = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(" · ");

/** The best first: the words found whole, then at the start, then anywhere; ties keep the list's order. */
function best<T>(rows: T[], term: string, text: (r: T) => string[]): T[] {
  const t = term.toLowerCase();
  const score = (r: T) => {
    const words = text(r).map((x) => x.toLowerCase());
    if (words.some((x) => x === t)) return 0;
    if (words.some((x) => x.startsWith(t))) return 1;
    return 2;
  };
  return rows.map((r, i) => ({ r, i, s: score(r) })).sort((a, b) => a.s - b.s || a.i - b.i).map((x) => x.r);
}

/** The order tab each paper is listed on (the purchase order's own number has its own page). */
const PAPER_TAB: Record<string, string> = {
  ...Object.fromEntries(Object.entries(PAPER_PREFIX).map(([kind, prefix]) => [prefix, PAPER_STEP[kind as PaperKind]])),
  // A supplier payment's number (FP-2026-0004-1) and the packing list (PL-2026-0004).
  FP: "factory",
  PL: "packing",
};

/**
 * Search everything (design "search everything"). Each kind is searched in the fields its own list searches
 * and only as far as this person may see it there: a customer they handle, a deal they handle or every one,
 * suppliers and purchase orders with supplier money, payments as Treasury › Payments shows them. A number
 * typed whole is matched to its record so Enter opens it.
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly treasury: TreasuryService,
  ) {}

  async find(user: SessionUser, q: SearchQuery): Promise<SearchResult> {
    const term = q.q.trim();
    if (term.length < 2) return { q: term, exact: null, groups: [] };
    const take = q.limit;
    const kinds = SEARCH_KINDS.filter((k) => !q.kind || q.kind === k).filter((k) => this.sees(user, k));
    const look: Record<SearchKind, () => Promise<Group>> = {
      customers: () => this.customers(user, term, take),
      suppliers: () => this.suppliers(term, take),
      inquiries: () => this.inquiries(user, term, take),
      quotations: () => this.quotations(user, term, take),
      orders: () => this.orders(user, term, take),
      purchase_orders: () => this.purchaseOrders(user, term, take),
      payments: () => this.payments(user, term, take),
    };
    const [exact, ...groups] = await Promise.all([this.exact(user, term), ...kinds.map((k) => look[k]())]);
    return { q: term, exact, groups: groups.filter((g) => g.total > 0) };
  }

  /** Kinds this person has a list of. */
  private sees(user: SessionUser, kind: SearchKind) {
    if (kind === "suppliers" || kind === "purchase_orders") return can(user, "sourcing.manage");
    return true;
  }

  private async customers(user: SessionUser, t: string, take: number): Promise<Group> {
    const digits = t.replace(/[^\d+]/g, "");
    // The person's own access and the words: both must hold (AND, so one OR does not replace the other).
    const where: Prisma.PartyWhereInput = {
      ...isCustomer,
      deletedAt: null,
      AND: [customerAccess(user)],
      OR: [
        { name: like(t) },
        { taxNo: like(t) },
        { customerCode: same(t) },
        { contacts: { some: { deletedAt: null, OR: [{ name: like(t) }, { email: like(t) }, ...(digits.replace("+", "").length >= 4 ? [{ phone: { contains: digits } }] : [])] } } },
      ],
    };
    const [rows, total] = await Promise.all([
      take
        ? this.prisma.db.party.findMany({
            where,
            orderBy: { name: "asc" },
            take: take * 4,
            select: {
              id: true,
              name: true,
              country: true,
              contacts: { where: { deletedAt: null }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], take: 1, select: { name: true, phone: true } },
              _count: { select: { orders: { where: { status: { not: "cancelled" } } } } },
            },
          })
        : [],
      this.prisma.db.party.count({ where }),
    ]);
    const items = best(rows, t, (r) => [r.name]).slice(0, take);
    return {
      kind: "customers",
      total,
      items: items.map((r) => ({
        kind: "customers",
        id: r.id,
        title: r.name,
        ref: null,
        sub: line(countryName(r.country), r.contacts[0]?.name, r.contacts[0]?.phone, `${r._count.orders} order${r._count.orders === 1 ? "" : "s"}`),
        badge: null,
        href: `/customers/${r.id}`,
      })),
    };
  }

  private async suppliers(t: string, take: number): Promise<Group> {
    const where: Prisma.PartyWhereInput = {
      ...isSupplier,
      deletedAt: null,
      OR: [
        { name: like(t) },
        { supplierCode: same(t) },
        { contacts: { some: { deletedAt: null, OR: [{ name: like(t) }, { wechat: like(t) }, { email: like(t) }, { phone: { contains: t } }] } } },
      ],
    };
    const [rows, total] = await Promise.all([
      take
        ? this.prisma.db.party.findMany({
            where,
            orderBy: { name: "asc" },
            take: take * 4,
            select: {
              id: true,
              name: true,
              country: true,
              owner: { select: { name: true } },
              contacts: { where: { deletedAt: null }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], take: 1, select: { name: true } },
            },
          })
        : [],
      this.prisma.db.party.count({ where }),
    ]);
    return {
      kind: "suppliers",
      total,
      items: best(rows, t, (r) => [r.name])
        .slice(0, take)
        .map((r) => ({
          kind: "suppliers",
          id: r.id,
          title: r.name,
          ref: null,
          sub: line(countryName(r.country), r.contacts[0]?.name, r.owner ? `looked after by ${r.owner.name}` : null),
          badge: null,
          href: `/factories/${r.id}`,
        })),
    };
  }

  private async inquiries(user: SessionUser, t: string, take: number): Promise<Group> {
    const where: Prisma.InquiryWhereInput = {
      deletedAt: null,
      AND: [inquiryAccess(user)],
      OR: [
        { refNo: like(t) },
        { title: like(t) },
        { category: like(t) },
        { customer: { name: like(t) } },
        { contact: { name: like(t) } },
        { items: { some: { OR: [{ description: like(t) }, { model: like(t) }] } } },
      ],
    };
    const [rows, total] = await Promise.all([
      take
        ? this.prisma.db.inquiry.findMany({
            where,
            orderBy: { createdAt: "desc" },
            take: take * 4,
            select: { id: true, refNo: true, title: true, stage: true, onHold: true, createdAt: true, customer: { select: { name: true } } },
          })
        : [],
      this.prisma.db.inquiry.count({ where }),
    ]);
    return {
      kind: "inquiries",
      total,
      items: best(rows, t, (r) => [r.refNo, r.title])
        .slice(0, take)
        .map((r) => ({
          kind: "inquiries",
          id: r.id,
          title: r.title,
          ref: r.refNo,
          sub: line(r.customer?.name, `came ${dayMonth(r.createdAt)}`),
          badge: r.onHold && r.stage !== "won" && r.stage !== "lost" ? { label: "On hold", tone: "neutral" } : { label: INQUIRY_STAGE_LABEL[r.stage], tone: INQUIRY_STAGE_TONE[r.stage] },
          href: `/inquiries/${r.id}`,
        })),
    };
  }

  private async quotations(user: SessionUser, t: string, take: number): Promise<Group> {
    // "QUO-2026-0051 R2": the quotation's own number without its revision.
    const number = t.replace(/\s+R\d+$/i, "");
    const where: Prisma.QuotationWhereInput = {
      inquiry: { deletedAt: null, ...inquiryAccess(user) },
      revisions: { some: {} },
      OR: [{ refNo: like(number) }, { inquiry: { OR: [{ refNo: like(t) }, { title: like(t) }, { customer: { name: like(t) } }] } }],
    };
    const [rows, total] = await Promise.all([
      take
        ? this.prisma.db.quotation.findMany({
            where,
            orderBy: { createdAt: "desc" },
            take: take * 4,
            select: {
              id: true,
              refNo: true,
              inquiryId: true,
              inquiry: { select: { title: true, customer: { select: { name: true } } } },
              revisions: { orderBy: { number: "desc" }, take: 1, select: { number: true, status: true, sentOn: true } },
            },
          })
        : [],
      this.prisma.db.quotation.count({ where }),
    ]);
    return {
      kind: "quotations",
      total,
      items: best(rows, number, (r) => [r.refNo, r.inquiry.title])
        .slice(0, take)
        .map((r) => {
          const rev = r.revisions[0]!;
          return {
            kind: "quotations",
            id: r.id,
            title: r.inquiry.title,
            ref: `${r.refNo} R${rev.number}`,
            sub: line(r.inquiry.customer?.name, rev.sentOn ? `sent ${dayMonth(rev.sentOn)}` : null),
            badge: { label: REVISION_STATUS_LABEL[rev.status], tone: REVISION_STATUS_TONE[rev.status] },
            href: `/inquiries/${r.inquiryId}/quotation`,
          };
        }),
    };
  }

  private async orders(user: SessionUser, t: string, take: number): Promise<Group> {
    const where: Prisma.OrderWhereInput = {
      AND: [orderAccess(user)],
      OR: [
        { refNo: like(t) },
        { documentTitle: like(t) },
        { customer: { name: like(t) } },
        { inquiry: { refNo: like(t) } },
        { inquiry: { title: like(t) } },
        { purchaseOrders: { some: { number: like(t) } } },
        { shipments: { some: { containerNo: like(t) } } },
      ],
    };
    const [rows, total] = await Promise.all([
      take
        ? this.prisma.db.order.findMany({
            where,
            orderBy: { createdAt: "desc" },
            take: take * 4,
            select: {
              id: true,
              refNo: true,
              stage: true,
              status: true,
              total: true,
              currency: true,
              documentTitle: true,
              customer: { select: { name: true } },
              inquiry: { select: { title: true } },
            },
          })
        : [],
      this.prisma.db.order.count({ where }),
    ]);
    return {
      kind: "orders",
      total,
      items: best(rows, t, (r) => [r.refNo, r.documentTitle ?? r.inquiry.title])
        .slice(0, take)
        .map((r) => ({
          kind: "orders",
          id: r.id,
          title: r.documentTitle ?? r.inquiry.title,
          ref: r.refNo,
          sub: line(r.customer.name, formatMinor(toMinor(r.total.toFixed(2)), r.currency)),
          badge: r.status === "cancelled" ? { label: "Cancelled", tone: "neutral" } : { label: ORDER_STAGE_LABEL[r.stage], tone: ORDER_STAGE_TONE[r.stage] },
          href: `/orders/${r.id}`,
        })),
    };
  }

  private async purchaseOrders(user: SessionUser, t: string, take: number): Promise<Group> {
    const where: Prisma.PurchaseOrderWhereInput = {
      order: orderAccess(user),
      OR: [{ number: like(t) }, { supplierRef: like(t) }, { supplier: { name: like(t) } }, { order: { refNo: like(t) } }],
    };
    const [rows, total] = await Promise.all([
      take
        ? this.prisma.db.purchaseOrder.findMany({
            where,
            orderBy: { createdAt: "desc" },
            take: take * 4,
            select: { id: true, number: true, orderId: true, supplierId: true, sentOn: true, supplier: { select: { name: true } }, order: { select: { refNo: true, customer: { select: { name: true } } } } },
          })
        : [],
      this.prisma.db.purchaseOrder.count({ where }),
    ]);
    return {
      kind: "purchase_orders",
      total,
      items: best(rows, t, (r) => [r.number, r.supplier.name])
        .slice(0, take)
        .map((r) => ({
          kind: "purchase_orders",
          id: r.id,
          title: r.supplier.name,
          ref: r.number,
          sub: line(`for ${r.order.refNo}`, r.order.customer.name),
          badge: r.sentOn ? { label: `Sent ${dayMonth(r.sentOn)}`, tone: "ok" } : { label: "Not sent", tone: "neutral" },
          href: `/operations/purchase-orders/${r.orderId}/${r.supplierId}`,
        })),
    };
  }

  /** Payments as Treasury › Payments lists them for this person, searched the same way. */
  private async payments(user: SessionUser, t: string, take: number): Promise<Group> {
    if (!(await this.treasury.opens(user))) return { kind: "payments", total: 0, items: [] };
    const list = await this.treasury.list(user, { q: t, page: 1, pageSize: Math.max(take, 1) });
    return {
      kind: "payments",
      total: list.total,
      items: list.rows.slice(0, take).map((r) => ({
        kind: "payments",
        id: r.id,
        // What it was and who: "USD 3,000.00 from Gulf Foods"; its number apart, then the day and what for.
        title: line(formatMinor(toMinor(r.amount), r.currency), r.party ? `${r.direction === "in" ? "from" : "to"} ${r.party.label}` : null),
        ref: r.number,
        sub: line(dayMonth(new Date(`${r.on}T00:00:00Z`)), r.what),
        badge: r.status === "void" ? { label: "Removed", tone: "neutral" } : r.status === "to_verify" ? { label: "To verify", tone: "warn" } : null,
        href: `/payments/${r.kind}/${r.id}`,
      })),
    };
  }

  /** A number typed whole: its record, when this person may open it. */
  private async exact(user: SessionUser, term: string): Promise<SearchResult["exact"]> {
    const t = term.toUpperCase().replace(/\s+/g, " ").trim();
    // A paper's number has a count after it (PR-2026-0004-2); a quotation, its letter (QUO-2026-0531-B).
    const m = /^([A-Z]{2,4})-(\d{4}-\d{3,})(?:-(\d+|[A-Z]{1,3}))?(?: R\d+)?$/.exec(t);
    if (!m) return null;
    const [, prefix, tail, suffix] = m;
    if (prefix === "RFQ") {
      const i = await this.prisma.db.inquiry.findFirst({ where: { refNo: same(`RFQ-${tail}`), deletedAt: null, ...inquiryAccess(user) }, select: { id: true, refNo: true } });
      return i && { kind: "inquiries", label: i.refNo, href: `/inquiries/${i.id}` };
    }
    if (prefix === "QUO") {
      // QUO-2026-0531-B: that quotation. QUO-2026-0531: an older quotation with that number, else the inquiry's
      // quotations (A first), which all carry it.
      const seen = { inquiry: { deletedAt: null, ...inquiryAccess(user) } };
      const qt =
        (await this.prisma.db.quotation.findFirst({ where: { ...seen, refNo: same(suffix ? `QUO-${tail}-${suffix}` : `QUO-${tail}`) }, select: { refNo: true, inquiryId: true } })) ??
        (suffix
          ? null
          : await this.prisma.db.quotation.findFirst({
              where: { ...seen, refNo: { startsWith: `QUO-${tail}-`, mode: "insensitive" } },
              orderBy: { createdAt: "asc" },
              select: { refNo: true, inquiryId: true },
            }));
      return qt && { kind: "quotations", label: qt.refNo, href: `/inquiries/${qt.inquiryId}/quotation` };
    }
    if (prefix === "PO" && can(user, "sourcing.manage")) {
      const po = await this.prisma.db.purchaseOrder.findFirst({ where: { number: same(`PO-${tail}`), order: orderAccess(user) }, select: { number: true, orderId: true, supplierId: true } });
      if (po) return { kind: "purchase_orders", label: po.number, href: `/operations/purchase-orders/${po.orderId}/${po.supplierId}` };
    }
    // The order itself (SO-2026-0004), or one of its papers (PR-2026-0004-2, RC-…, CI-…): its tab.
    const order = await this.prisma.db.order.findFirst({ where: { ...orderAccess(user), refNo: { endsWith: `-${tail}` } }, select: { id: true, refNo: true } });
    if (!order) return null;
    if (order.refNo.toUpperCase() === `${prefix}-${tail}`) return { kind: "orders", label: order.refNo, href: `/orders/${order.id}` };
    const tab = PAPER_TAB[prefix!];
    if (!tab) return null;
    return { kind: tab === "factory" && prefix === "FP" ? "payments" : "orders", label: t, href: `/orders/${order.id}/${orderTabPath(tab)}` };
  }
}
