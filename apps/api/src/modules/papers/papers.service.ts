import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { asPayment, fromDbDate, fromDbDateOrNull, livePartsWithEntry, type Prisma, routeOf, type WithTerms } from "@kebo/database";
import { fromMinor } from "@kebo/money";
import { chargedExpenses, fxOf, positionOf as orderPositionOf } from "../billing/api";
import {
  bankContractInput,
  BANK_PAPERS,
  can,
  DOCUMENT_PAPER,
  documentDone,
  FACTORY_PRICE_PAPERS,
  inSentence,
  LIVE_PAPERS,
  ORDER_DOCUMENT_LABEL,
  planStatus,
  SENT_PAPERS,
  orderDetailsInput,
  PAPER_DOCUMENT,
  PAPER_FEATURE,
  PAPER_FIX_LABEL,
  PAPER_KINDS,
  PAPER_LABEL,
  PAPER_MADE_FROM,
  primaryShipment,
  PAPER_NUMBER_LABEL,
  PAPER_OPTION_LABEL,
  PAPER_ROUTES,
  PAPER_STATE_LABEL,
  PAPER_STEP,
  PAPER_TITLE,
  PER_FACTORY_PAPERS,
  paperNumber,
  paperOptionsOf,
  parsePaperOptions,
  documentsInUse,
  paperUsed,
  routeAsAccepted,
  packingListNo,
  routeWords,
  shipmentInput,
  shipmentUpdateInput,
  type FlowStep,
  type OrderDocumentKind,
  type PaperCheck,
  type PaperDoc,
  type PaperDraftInput,
  type PaperFixInput,
  type PaperKind,
  type PaperOptions,
  type PaperQueryInput,
  type PaperState,
  type PlanFeature,
  type SendRequestInput,
} from "@kebo/shared";
import { dateIn, DomainError, ForbiddenError, NotFoundError } from "@kebo/utils";
import { PrismaService, type Tx } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { Clock } from "../../common/time/clock.service";
import { LimitsService } from "../../common/company/limits.service";
import type { SessionUser } from "../../common/auth/session-user";
import { SettingsService } from "../settings/settings.service";
import { companySnapshot } from "../quotations/quotations.service";
import { buyerOf, partyOf } from "../orders/buyer";
import { quotedTermsPrinted } from "../orders/order-docs";
import { deleteDraft, keepAsSent, makeAgain, makeFinal, paperReady, saveDraft, startDraft } from "../documents/api";
import { requireReason } from "../../common/audit/reason";
import { EventBus } from "../../common/events/event-bus";
import { termsOf } from "../billing/api";
import { orderAccess } from "../../common/auth/order-access";
import { OrdersService } from "../orders/orders.service";
import { FlowService } from "../flow/flow.service";
import {
  BUILDERS,
  factoriesOf,
  hsMissing,
  livePlanOfPaper,
  paperOrderInclude,
  positionOf,
  receiptMark,
  reportItem,
  type PaperCtx,
  type PaperOrder,
  type StatementData,
} from "./papers-data";

type PaperRow = PaperOrder["papers"][number];

/** One paper of the order on its step page and the Documents page. */
export interface PaperListRow {
  /** Unique in the list: the kind, with the factory / payment / plan item, or the document row. */
  key: string;
  /** A paper the app makes (PaperKind), the order's own "proforma" / "packing-list", or a document-set kind someone else issues. */
  kind: string;
  source: "app" | "upload";
  label: string;
  step: FlowStep;
  state: PaperState;
  stateLabel: string;
  number: string | null;
  version: number | null;
  /** The latest made version (draft or final) of a paper the app makes: Delete the draft, Versions. */
  paperId?: string | null;
  /** The latest version is a draft. */
  draft?: boolean;
  /** One short line: what it is made from, or what it waits for. */
  sub: string;
  ref: string | null;
  /** Has a print page (View / Print, Download PDF). */
  printable: boolean;
  /** Has a Make page. */
  makeable: boolean;
  /** Printed from the data whenever opened (no draft or final). */
  live: boolean;
  /** Kept as sent (a payment request, a receipt): no draft and no Make page; `version` is the copy kept (a request's R1, R2…). */
  kept?: boolean;
  /** Part of the document set the shipment needs (the Documents page). */
  inSet: boolean;
  /** The document-set row (upload, kept elsewhere). */
  doc: { id: string; status: string; keptWhere: string | null; file: { id: string; name: string } | null; issuedOn: string | null } | null;
  /** The document-set kind to record it under (upload, kept elsewhere). */
  docKind: OrderDocumentKind | null;
}

/** Papers others issue, and where they are listed. */
const UPLOAD_STEP: Partial<Record<OrderDocumentKind, FlowStep>> = {
  bill_of_lading: "shipping",
  airway_bill: "shipping",
  certificate_of_origin: "documents",
  insurance: "documents",
  other: "documents",
};
const UPLOAD_SUB: Partial<Record<OrderDocumentKind, string>> = {
  bill_of_lading: "from the forwarder · after sailing",
  airway_bill: "from the airline",
  certificate_of_origin: "chamber of commerce in China",
  insurance: "from the insurer",
};

const asOptions = (v: Prisma.JsonValue): PaperOptions =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === "boolean")) as PaperOptions)
    : {};

/**
 * The papers the app makes from an order (see @kebo/shared workflows/papers):
 * the list per step with where each stands, the Make page's checks, the paper
 * itself (live, or the snapshot of a final version), draft → final → again,
 * and missing data typed on the Make page, saved where it belongs through the
 * same services (and rules) as everywhere else.
 *
 * Seeing papers follows the order; making them needs documents.manage; the bank
 * papers need the bank_documents module; the purchase order shows factory
 * prices, so only people who see them (sourcing.manage) get it.
 */
@Injectable()
export class PapersService implements OnModuleInit {
  private readonly logger = new Logger("Papers");

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly limits: LimitsService,
    private readonly settings: SettingsService,
    private readonly orders: OrdersService,
    private readonly flow: FlowService,
    private readonly events: EventBus,
  ) {}

  /** A payment recorded: its receipt is kept at once, as it prints then. */
  onModuleInit() {
    this.events.on("payment.recorded", (e) => this.keepReceipts(e.orderId));
  }

  /* ---------------------------------------------------------------- reading */

  private async order(user: SessionUser, id: string, db: PrismaService["db"] | Tx = this.prisma.db) {
    const o = await db.order.findFirst({ where: { id, ...orderAccess(user) }, include: paperOrderInclude });
    if (!o) throw new NotFoundError("Order");
    return o;
  }

  /** Whether the order can have this paper at all (module, payment route). */
  private applies(kind: PaperKind, o: WithTerms, features: readonly string[] | null) {
    const f = PAPER_FEATURE[kind];
    if (f && features && !features.includes(f)) return false;
    const routes = PAPER_ROUTES[kind];
    const route = routeOf(o);
    return !routes || (route !== null && (routes as readonly string[]).includes(route));
  }

  /** The paper may be read: its module is on, it fits the route, and the purchase order only for people who see factory prices. */
  private async mayRead(user: SessionUser, kind: PaperKind, o: WithTerms) {
    const f = PAPER_FEATURE[kind];
    if (f) await this.limits.require(f as PlanFeature);
    if (FACTORY_PRICE_PAPERS.includes(kind) && !can(user, "sourcing.manage")) throw new ForbiddenError("You cannot see factory prices.");
    if (!this.applies(kind, o, null))
      throw new DomainError(
        `The ${PAPER_LABEL[kind].toLowerCase()} is only for orders paid ${PAPER_ROUTES[kind]!.includes("bank_contract") ? "through the banks" : "by LC"}.`,
      );
  }

  private async mayMake(user: SessionUser, kind: PaperKind, o: WithTerms & { status: string }) {
    await this.mayRead(user, kind, o);
    if (!can(user, "documents.manage")) throw new ForbiddenError("You cannot make papers.");
    if (LIVE_PAPERS.includes(kind))
      throw new DomainError(`The ${PAPER_LABEL[kind].toLowerCase()} is printed from the data whenever it is opened.`);
    if (SENT_PAPERS.includes(kind))
      throw new DomainError(
        kind === "payment-request" ? "A payment request is kept when it is sent: use Send request." : "A receipt is kept when its payment is recorded.",
      );
    if (o.status === "cancelled") throw new DomainError("This order is cancelled.");
  }

  /** The buyer as on the order (frozen when the order was made; "Refresh from customer" takes it again, with a reason). */
  private async customerOf(o: PaperOrder) {
    return partyOf(await buyerOf(this.prisma.db, o, this.clock.today()));
  }

  /** The customer's orders (that the person may see) and payments, for the statement. */
  private async statementOf(user: SessionUser, customerId: string): Promise<StatementData> {
    const rows = await this.prisma.db.order.findMany({
      where: { customerId, status: { not: "cancelled" }, ...orderAccess(user) },
      orderBy: { orderedOn: "asc" },
      include: {
        allocations: livePartsWithEntry,
        receivables: { orderBy: { sortOrder: "asc" }, select: { amount: true, part: true } },
        expenses: chargedExpenses,
      },
    });
    const fx = fxOf(await this.settings.get(), await this.limits.allows("expenses"));
    return {
      orders: rows.map((o) => {
        // As on the order: what was charged to the customer is part of what they owe.
        const p = orderPositionOf(o, fx);
        return {
          refNo: o.refNo,
          orderedOn: fromDbDate(o.orderedOn),
          currency: o.currency,
          total: o.total.toFixed(2),
          charged: fromMinor(p.chargedMinor),
          received: fromMinor(p.settledMinor),
          due: fromMinor(p.dueMinor),
        };
      }),
      payments: rows
        .flatMap((o) =>
          o.allocations.map(asPayment).map((p) => ({ paidOn: fromDbDate(p.paidOn), refNo: o.refNo, amount: p.amount.toFixed(2), currency: p.currency })),
        )
        .sort((a, b) => a.paidOn.localeCompare(b.paidOn)),
    };
  }

  /** The options a paper is made with: the defaults, then what the draft saved, then what the Make page previews. */
  private optionsOf(kind: PaperKind, o: PaperOrder, saved: PaperOptions | null, preview: PaperOptions | null): PaperOptions {
    const defaults: PaperOptions = {
      prices: true,
      showHs: true,
      lcStatement: routeOf(o) === "letter_of_credit" || routeOf(o) === "bank_contract",
      stamp: true,
    };
    const keys = paperOptionsOf(kind);
    const all = { ...defaults, ...(saved ?? {}), ...(preview ?? {}) };
    return Object.fromEntries(keys.map((k) => [k, all[k] !== false])) as PaperOptions;
  }

  private async ctx(user: SessionUser | null, o: PaperOrder, kind: PaperKind | null, options: PaperOptions, ref: string): Promise<PaperCtx> {
    const [settings, features, customer] = await Promise.all([this.settings.get(), this.limits.features(), this.customerOf(o)]);
    const fileIds = o.checklist
      .flatMap((i) => Object.values((i.data ?? {}) as Record<string, string>))
      .filter((v) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v));
    const files = fileIds.length
      ? await this.prisma.db.attachment.findMany({ where: { id: { in: fileIds }, deletedAt: null }, select: { id: true, fileName: true } })
      : [];
    return {
      o,
      today: this.clock.today(),
      settings,
      company: { ...companySnapshot(settings), stamp: options.stamp === false ? null : settings.company.stamp || null },
      customer,
      features,
      options,
      ref,
      fileNames: new Map(files.map((f) => [f.id, f.fileName])),
      statement: kind === "customer-statement" && user ? await this.statementOf(user, o.customerId) : null,
      number:
        kind === "purchase-order" && /^[0-9a-f-]{36}$/i.test(ref)
          ? ((await this.prisma.db.purchaseOrder.findFirst({ where: { orderId: o.id, supplierId: ref }, select: { number: true } }))?.number ?? null)
          : null,
    };
  }

  /** The paper and its checks, made from the order as it is now. */
  private build(kind: PaperKind, c: PaperCtx): { doc: PaperDoc; checks: PaperCheck[] } {
    const b = BUILDERS[kind](c);
    const { party, ...rest } = b.doc;
    return {
      checks: b.checks,
      doc: {
        kind,
        title: PAPER_TITLE[kind],
        numberLabel: PAPER_NUMBER_LABEL[kind],
        number: c.number ?? paperNumber(c.o.refNo, kind, b.n),
        company: c.company,
        party: party ?? c.customer,
        ...rest,
      },
    };
  }

  /** The default ref: the first factory of a purchase order; "" otherwise. */
  private refOf(kind: PaperKind, o: PaperOrder, ref: string | null | undefined) {
    if (PER_FACTORY_PAPERS.includes(kind)) {
      const factories = factoriesOf(o);
      if (ref && !factories.some((f) => f.id === ref)) throw new NotFoundError("Factory on this order");
      return ref || factories[0]?.id || "";
    }
    // A receipt without a ref is the last payment's.
    if (kind === "payment-receipt") return ref || o.allocations.at(-1)?.id || "";
    if (kind === "payment-request") return ref ?? "";
    return "";
  }

  private rowsOf(o: PaperOrder, kind: PaperKind, ref: string): PaperRow[] {
    return o.papers.filter((p) => p.kind === kind && p.ref === ref).sort((a, b) => a.version - b.version);
  }

  private paperView(p: PaperRow | undefined | null) {
    return p
      ? {
          id: p.id,
          version: p.version,
          status: p.status as "draft" | "final",
          number: p.number,
          madeAt: p.madeAt.toISOString(),
          finalAt: p.finalAt?.toISOString() ?? null,
        }
      : null;
  }

  /**
   * GET /orders/:id/papers/:kind/doc — the paper to print: a final version's
   * snapshot (?v=, or the latest when it is final), else made from the order now
   * (a draft, with the DRAFT watermark), with ?opts= to preview options.
   */
  async doc(user: SessionUser, orderId: string, kind: PaperKind, q: PaperQueryInput) {
    let o = await this.order(user, orderId);
    await this.mayRead(user, kind, o);
    // A receipt not kept yet (recorded before receipts were kept, or its payment corrected since): kept now.
    if (kind === "payment-receipt" && this.receiptsToKeep(o).length) {
      await this.keepReceipts(o.id);
      o = await this.order(user, orderId);
    }
    const ref = this.refOf(kind, o, q.ref);
    const rows = this.rowsOf(o, kind, ref);
    const kept = SENT_PAPERS.includes(kind);
    const asked = q.v ? rows.find((p) => p.version === q.v) : undefined;
    if (q.v && !asked) throw new NotFoundError("Version");
    const row = asked ?? rows.at(-1) ?? null;
    const cancelled = o.status === "cancelled" ? "CANCELLED" : null;
    const head = {
      orderId: o.id,
      refNo: o.refNo,
      label: PAPER_LABEL[kind],
      live: LIVE_PAPERS.includes(kind),
      kept,
      paper: this.paperView(row),
      versions: rows.map((p) => this.paperView(p)!),
    };
    // Kept as sent: the copy, unless asked how it would print now (?now=1, before sending it again).
    if (row?.status === "final" && row.snapshot && !(q.opts !== undefined && !asked) && !(kept && q.now && !asked)) {
      // What it was about is gone (its row taken out of the plan, its payment removed): it stays, marked.
      const gone = kept && !!ref && (kind === "payment-request" ? ref !== "balance" && o.receivables.every((r) => r.id !== ref) : o.allocations.every((a) => a.id !== ref));
      return { ...head, doc: row.snapshot as unknown as PaperDoc, final: true, watermark: cancelled ?? (gone ? "CANCELLED" : null) };
    }
    const options = this.optionsOf(kind, o, row && !kept ? asOptions(row.options) : null, parsePaperOptions(kind, q.opts));
    const { doc } = this.build(kind, { ...(await this.ctx(user, o, kind, options, ref)), revision: kind === "payment-request" ? this.revisionOf(rows) : null });
    const live = LIVE_PAPERS.includes(kind);
    return { ...head, doc, final: false, watermark: cancelled ?? (live || kind === "payment-receipt" ? null : kind === "payment-request" ? "NOT SENT" : "DRAFT") };
  }

  /** A request sent before: the next one is its revision (R2…), and says which day's it replaces. */
  private revisionOf(rows: PaperRow[]) {
    const last = rows.filter((p) => p.status === "final").at(-1);
    return last ? { n: last.version + 1, replaces: dateIn(last.finalAt ?? last.madeAt, this.clock.timeZone) } : null;
  }

  /** GET /orders/:id/papers/:kind/checks — the Make page: what the paper takes from the order, options, versions. */
  async checks(user: SessionUser, orderId: string, kind: PaperKind, refIn?: string) {
    const o = await this.order(user, orderId);
    await this.mayRead(user, kind, o);
    return this.checksOf(user, o, kind, this.refOf(kind, o, refIn));
  }

  private async checksOf(user: SessionUser, o: PaperOrder, kind: PaperKind, ref: string) {
    const rows = this.rowsOf(o, kind, ref);
    const latest = rows.at(-1) ?? null;
    const options = this.optionsOf(kind, o, latest ? asOptions(latest.options) : null, null);
    const c = await this.ctx(user, o, kind, options, ref);
    const { checks, doc } = this.build(kind, c);
    const ready = checks.every((x) => x.ok || !x.required);
    return {
      orderId: o.id,
      refNo: o.refNo,
      kind,
      label: PAPER_LABEL[kind],
      step: PAPER_STEP[kind],
      madeFrom: PAPER_MADE_FROM[kind],
      number: latest?.number ?? doc.number,
      ref: ref || null,
      factories: PER_FACTORY_PAPERS.includes(kind) ? factoriesOf(o).map((f) => ({ id: f.id, name: f.name })) : null,
      live: LIVE_PAPERS.includes(kind),
      canMake: can(user, "documents.manage") && o.status !== "cancelled" && !LIVE_PAPERS.includes(kind) && !SENT_PAPERS.includes(kind),
      state: this.stateOf(latest, ready),
      ready,
      checks,
      /** Lines without an HS code, for the HS check's inputs. */
      hsLines: checks.some((x) => x.key === "hs" && !x.ok) ? hsMissing(c) : [],
      fixes: Object.fromEntries(checks.filter((x) => x.fix).map((x) => [x.key, PAPER_FIX_LABEL[x.fix!]])),
      options: paperOptionsOf(kind).map((k) => ({ key: k, label: PAPER_OPTION_LABEL[k], on: options[k] !== false })),
      paper: this.paperView(latest),
      versions: rows.map((p) => this.paperView(p)!),
      /** The buyer the paper prints (as on the order) and what differs from the customer now: "Refresh from customer". */
      buyer: kind === "purchase-order" ? null : await this.orders.buyerView(user, o.id),
      canRefreshBuyer: (can(user, "documents.manage") || can(user, "orders.update")) && o.status !== "cancelled",
      /** The quotation's own payment text against the route, when they differ (the papers with payment terms). */
      terms: this.termsOf(o, kind),
    };
  }

  /** "The quotation said 'By T/T'; the route is now LC at sight": print it or not (default not), for the papers with payment terms. */
  private termsOf(o: PaperOrder, kind: PaperKind) {
    if (kind !== "sales-contract" && kind !== "payment-request") return null;
    const text = o.revision.paymentTerms?.trim();
    const t = termsOf(o);
    if (!text || routeAsAccepted(t, o.balanceTerms)) return null;
    return { quoted: text, route: routeWords(t, o.balanceTerms), printed: quotedTermsPrinted(o) };
  }

  private stateOf(latest: PaperRow | null, ready: boolean): PaperState {
    if (latest?.status === "final") return "ready";
    if (latest) return "draft";
    return ready ? "can" : "wait";
  }

  /** GET /orders/:id/papers — every paper of the order with where it stands, for the step pages and the Documents page. */
  async list(user: SessionUser, orderId: string) {
    let o = await this.order(user, orderId);
    // Receipts not kept yet (payments from before receipts were kept, or corrected since): kept now.
    if (this.receiptsToKeep(o).length) {
      await this.keepReceipts(o.id);
      o = await this.order(user, orderId);
    }
    const features = await this.limits.features();
    const has = (f: PlanFeature) => !features || features.includes(f);
    const c = await this.ctx(user, o, null, {}, "");
    const out: PaperListRow[] = [];
    const mode = primaryShipment(o.shipments)?.mode ?? "sea";
    // Settings › Papers we use: a switched-off paper is left out, unless it is already made or recorded.
    const off = c.settings.papers.off;
    const used = (key: string) => paperUsed(off, key);
    const recordedDone = (kind: OrderDocumentKind) =>
      o.documents.some((d) => d.kind === kind && documentDone(d.status)) ||
      (kind === "proforma_invoice" ? !!o.proformaNo : kind === "packing_list" ? !!o.packedAt : false);
    const set = has("bank_documents") ? documentsInUse(routeOf(o), mode, off, recordedDone) : [];
    const docFile = (d: PaperOrder["documents"][number]) =>
      d.attachment && !d.attachment.deletedAt ? { id: d.attachment.id, name: d.attachment.fileName } : null;
    const docView = (d: PaperOrder["documents"][number] | undefined) =>
      d ? { id: d.id, status: d.status, keptWhere: d.keptWhere, file: docFile(d), issuedOn: fromDbDateOrNull(d.issuedOn) } : null;
    /** A recorded paper's state: uploaded, kept elsewhere, ready or draft, missing. */
    const docState = (d: PaperOrder["documents"][number] | undefined): PaperState =>
      !d
        ? "miss"
        : d.status === "elsewhere"
          ? "else"
          : docFile(d) && documentDone(d.status)
            ? "up"
            : d.status === "ready"
              ? "ready"
              : d.status === "draft"
                ? "draft"
                : "miss";
    const row = (r: Omit<PaperListRow, "stateLabel"> & { stateLabel?: string }): PaperListRow => ({ ...r, stateLabel: r.stateLabel ?? PAPER_STATE_LABEL[r.state] });

    // The order's own papers: final when issued (the proforma) or shipped (the packing list), Make again for the next version.
    const own = (kind: "proforma" | "packing-list") => {
      const rows = o.papers.filter((p) => p.kind === kind).sort((a, b) => a.version - b.version);
      const latest = rows.at(-1) ?? null;
      const rebuiltOn = (latest?.snapshot as { rebuiltOn?: string | null } | null)?.rebuiltOn ?? null;
      return { latest, draft: latest?.status === "draft", rebuilt: rebuiltOn ? ` · rebuilt from the data on ${rebuiltOn}` : "" };
    };
    const pi = own("proforma");
    if (used("proforma") || o.proformaNo)
      out.push(
      row({
        key: "proforma",
        kind: "proforma",
        source: "app",
        label: "Proforma invoice",
        step: "payment",
        state: !o.proformaNo ? "can" : pi.draft ? "draft" : "ready",
        number: o.proformaNo,
        version: pi.latest?.version ?? null,
        paperId: pi.latest?.id ?? null,
        draft: pi.draft,
        sub: !o.proformaNo
          ? "order lines, buyer, payment terms, bank details"
          : pi.draft
            ? `version ${pi.latest!.version} · draft: issue it to make it final`
            : `issued ${fromDbDateOrNull(o.proformaIssuedOn) ?? ""}${(pi.latest?.version ?? 1) > 1 ? ` · version ${pi.latest!.version}` : ""}${pi.rebuilt}`.trim(),
        ref: null,
        printable: true,
        makeable: false,
        live: false,
        inSet: set.includes("proforma_invoice"),
        doc: null,
        docKind: "proforma_invoice",
      }),
    );
    const goods = o.lines.filter((l) => l.type === "goods");
    const pl = own("packing-list");
    if (goods.length && (used("packing-list") || o.packedAt))
      out.push(
        row({
          key: "packing-list",
          kind: "packing-list",
          source: "app",
          label: "Packing list",
          step: "shipping",
          state: !o.packedAt ? "wait" : pl.draft ? "draft" : "ready",
          number: packingListNo(o.refNo),
          version: pl.latest?.version ?? null,
          paperId: pl.latest?.id ?? null,
          draft: pl.draft,
          sub: o.packedAt
            ? `${goods.reduce((t, l) => t + (l.packages ?? 0), 0)} packages${pl.latest ? (pl.draft ? ` · version ${pl.latest.version} draft` : ` · final${pl.latest.version > 1 ? `, version ${pl.latest.version}` : ""}${pl.rebuilt}`) : ""}`
            : "packages, weights and volume per line",
          ref: null,
          printable: true,
          makeable: false,
          live: false,
          inSet: set.includes("packing_list"),
          doc: null,
          docKind: "packing_list",
        }),
      );

    for (const kind of PAPER_KINDS) {
      if (!this.applies(kind, o, features)) continue;
      if (FACTORY_PRICE_PAPERS.includes(kind) && !can(user, "sourcing.manage")) continue;
      // Switched off: printed-from-the-data papers go; made ones stay (below).
      if (!used(kind) && LIVE_PAPERS.includes(kind)) continue;
      const base = { kind, source: "app" as const, step: PAPER_STEP[kind], printable: true, live: LIVE_PAPERS.includes(kind), kept: SENT_PAPERS.includes(kind) };
      if (kind === "payment-receipt") {
        o.allocations.map(asPayment).forEach((p, i) => {
          const copy = this.rowsOf(o, kind, p.id).at(-1) ?? null;
          out.push(
            row({
              ...base,
              key: `${kind}:${p.id}`,
              label: `${PAPER_LABEL[kind]} ${p.receiptNo ?? i + 1}`,
              state: "ready",
              // Given when the payment was recorded: never moved by a void or a back-dated payment.
              number: paperNumber(o.refNo, kind, p.receiptNo ?? i + 1),
              // Kept when the payment was recorded; version 2 and on: the payment was corrected.
              version: copy?.version ?? null,
              paperId: copy?.id ?? null,
              sub: `${p.currency} ${p.amount.toFixed(2)} · ${fromDbDate(p.paidOn)}${copy && copy.version > 1 ? " · corrected" : ""}`,
              ref: p.id,
              makeable: false,
              inSet: false,
              doc: null,
              docKind: null,
            }),
          );
        });
        continue;
      }
      if (kind === "payment-request") {
        const pos = positionOf(c);
        /** The copy kept when the request was last sent (R1, R2…), with the day. */
        const sentOf = (ref: string) => {
          const copy = this.rowsOf(o, kind, ref).filter((x) => x.status === "final").at(-1) ?? null;
          return copy ? { copy, on: dateIn(copy.finalAt ?? copy.madeAt, this.clock.timeZone) } : null;
        };
        livePlanOfPaper(o).forEach((p, i) => {
          const sent = sentOf(p.id);
          out.push(
            row({
              ...base,
              key: `${kind}:${p.id}`,
              label: `${PAPER_LABEL[kind]} · ${p.label}`,
              state: sent ? "ready" : "can",
              stateLabel: sent ? "Sent" : "Not sent",
              // Given when the plan row was made: a rebuilt plan keeps the numbers of the rows it keeps.
              number: paperNumber(o.refNo, kind, p.requestNo ?? i + 1),
              version: sent?.copy.version ?? null,
              paperId: sent?.copy.id ?? null,
              sub: `${o.currency} ${fromMinor(p.amountMinor)}${p.dueOn ? ` · due ${p.dueOn}` : ""}${sent ? ` · sent ${sent.on}${sent.copy.version > 1 ? ` (R${sent.copy.version})` : ""}` : ""}`,
              ref: p.id,
              makeable: false,
              inSet: false,
              doc: null,
              docKind: null,
            }),
          );
        });
        if (Number(pos.due) > 0 && !o.receivables.length) {
          const sent = sentOf("balance");
          out.push(
            row({
              ...base,
              key: `${kind}:balance`,
              label: PAPER_LABEL[kind],
              state: sent ? "ready" : "can",
              stateLabel: sent ? "Sent" : "Not sent",
              number: paperNumber(o.refNo, kind),
              version: sent?.copy.version ?? null,
              paperId: sent?.copy.id ?? null,
              sub: `${o.currency} ${pos.due} still due${sent ? ` · sent ${sent.on}` : ""}`,
              ref: "balance",
              makeable: false,
              inSet: false,
              doc: null,
              docKind: null,
            }),
          );
        }
        continue;
      }
      if (kind === "customer-statement") {
        out.push(
          row({
            ...base,
            key: kind,
            label: PAPER_LABEL[kind],
            state: "can",
            number: paperNumber(o.refNo, kind),
            version: null,
            sub: PAPER_MADE_FROM[kind],
            ref: null,
            makeable: false,
            inSet: false,
            doc: null,
            docKind: null,
          }),
        );
        continue;
      }
      if (
        (kind === "fat-report" || kind === "inspection-report") &&
        !reportItem(c, kind) &&
        !(kind === "inspection-report" && set.includes("inspection"))
      )
        continue;
      const docKind = PAPER_DOCUMENT[kind] ?? null;
      const refs = PER_FACTORY_PAPERS.includes(kind) ? factoriesOf(o).map((f) => ({ ref: f.id, name: f.name })) : [{ ref: "", name: "" }];
      if (PER_FACTORY_PAPERS.includes(kind) && !refs.length) continue;
      // A purchase order prints its own number (PO-2026-0044), one per supplier.
      const poNumbers =
        kind === "purchase-order"
          ? new Map((await this.prisma.db.purchaseOrder.findMany({ where: { orderId: o.id }, select: { supplierId: true, number: true } })).map((x) => [x.supplierId, x.number]))
          : null;
      for (const r of refs) {
        const rows = this.rowsOf(o, kind, r.ref);
        const latest = rows.at(-1) ?? null;
        const built = this.build(kind, {
          ...c,
          options: this.optionsOf(kind, o, latest ? asOptions(latest.options) : null, null),
          ref: r.ref,
        });
        const ready = built.checks.every((x) => x.ok || !x.required);
        const needs = built.checks.filter((x) => x.required && !x.ok).map((x) => inSentence(x.label));
        const recorded = docKind ? o.documents.find((d) => d.kind === docKind && !d.paperId && documentDone(d.status)) : undefined;
        if (!used(kind) && !latest && !recorded) continue;
        const state: PaperState = latest ? this.stateOf(latest, ready) : recorded ? docState(recorded) : this.stateOf(null, ready);
        out.push(
          row({
            ...base,
            key: r.ref ? `${kind}:${r.ref}` : kind,
            label: r.name && refs.length > 1 ? `${PAPER_LABEL[kind]} · ${r.name}` : PAPER_LABEL[kind],
            state,
            number: latest?.number ?? (recorded ? recorded.number : (poNumbers?.get(r.ref) ?? built.doc.number)),
            version: latest?.version ?? null,
            paperId: latest?.id ?? null,
            draft: latest?.status === "draft",
            sub:
              latest && state === "ready"
                ? `version ${latest.version}${latest.finalAt ? ` · ${latest.finalAt.toISOString().slice(0, 10)}` : ""}`
                : recorded && (state === "ready" || state === "up")
                  ? `recorded${recorded.issuedOn ? ` · ${fromDbDate(recorded.issuedOn)}` : ""}`
                  : state === "wait"
                    ? `needs ${needs.join(", ")}`
                    : state === "else"
                      ? `kept: ${recorded?.keptWhere ?? ""}`
                      : PAPER_MADE_FROM[kind],
            ref: r.ref || null,
            makeable: true,
            inSet: (docKind !== null && set.includes(docKind)) || BANK_PAPERS.includes(kind),
            doc: docView(recorded ?? (docKind ? o.documents.find((d) => d.kind === docKind) : undefined)),
            docKind,
          }),
        );
      }
    }

    // Papers others issue: uploaded, kept elsewhere, or missing (with the document set's module).
    if (has("bank_documents")) {
      const madeKinds = new Set<OrderDocumentKind>([
        "proforma_invoice",
        "packing_list",
        ...(Object.keys(DOCUMENT_PAPER) as OrderDocumentKind[]),
      ]);
      const others = set.filter((k) => !madeKinds.has(k));
      for (const kind of others) {
        const rows = o.documents.filter((d) => d.kind === kind);
        const d = rows.find((x) => documentDone(x.status)) ?? rows[0];
        out.push(
          row({
            key: d ? `doc:${d.id}` : `doc:${kind}`,
            kind,
            source: "upload",
            label: ORDER_DOCUMENT_LABEL[kind],
            step: UPLOAD_STEP[kind] ?? "documents",
            state: docState(d),
            // A B/L or AWB prints its shipment's number (its row's shipment, else Shipment 1); the row keeps none.
            number:
              kind === "bill_of_lading" || kind === "airway_bill"
                ? ((o.shipments.find((x) => x.id === d?.shipmentId) ?? primaryShipment(o.shipments))?.blNo ?? null)
                : (d?.number ?? null),
            version: null,
            sub: d?.status === "elsewhere" ? `kept: ${d.keptWhere ?? ""}` : (d?.note ?? UPLOAD_SUB[kind] ?? ""),
            ref: null,
            printable: false,
            makeable: false,
            live: false,
            inSet: true,
            doc: docView(d),
            docKind: kind,
          }),
        );
      }
      // Extra papers recorded on the order (not in the set, not made by the app).
      for (const d of o.documents.filter((x) => !set.includes(x.kind) && !madeKinds.has(x.kind)))
        out.push(
          row({
            key: `doc:${d.id}`,
            kind: d.kind,
            source: "upload",
            label: d.kind === "other" && d.title ? d.title : ORDER_DOCUMENT_LABEL[d.kind],
            step: UPLOAD_STEP[d.kind] ?? "documents",
            state: docState(d),
            number: d.number,
            version: null,
            sub: d.status === "elsewhere" ? `kept: ${d.keptWhere ?? ""}` : (d.note ?? ""),
            ref: null,
            printable: false,
            makeable: false,
            live: false,
            inSet: false,
            doc: docView(d),
            docKind: d.kind,
          }),
        );
    }

    return {
      orderId: o.id,
      refNo: o.refNo,
      canMake: can(user, "documents.manage") && o.status !== "cancelled",
      canRecord: can(user, "documents.manage") && has("bank_documents") && o.status !== "cancelled",
      papers: out,
    };
  }

  /* ---------------------------------------------------------------- making */

  /** The order, locked for the change, if the person may see it. */
  private async lock(tx: Tx, user: SessionUser, id: string) {
    await tx.$queryRaw`select id from orders where id = ${id}::uuid for update`;
    return this.order(user, id, tx);
  }

  private log(
    tx: Tx,
    user: SessionUser,
    o: { id: string; refNo: string },
    action: "draft" | "final" | "again" | "hs" | "delete",
    kind: PaperKind,
    summary: string,
    values: Record<string, unknown>,
  ) {
    return this.audit.record(tx, {
      userId: user.id,
      action: `paper.${action}`,
      entityType: "order",
      entityId: o.id,
      summary: `${o.refNo}: ${summary}`,
      newValues: { kind, ...values, step: PAPER_STEP[kind] },
    });
  }

  /* ---------------------------------------------------------------- kept as sent */

  /**
   * POST /orders/:id/requests/send — the payment request of a plan row is sent: exactly what it prints now is
   * kept (its number, the amount, the due date, the account so far, our bank details), and the row shows Sent.
   * Sent again (the amount or the date changed, or a new copy was asked for): the next revision (R2…), with
   * why; the first copy stays as it was. "balance": the rest due on an order that has no plan.
   */
  async sendRequest(user: SessionUser, orderId: string, input: SendRequestInput) {
    if (!can(user, "orders.update") && !can(user, "documents.manage")) throw new ForbiddenError("You cannot send payment requests.");
    const kind = "payment-request" as const;
    return this.prisma.tx(async (tx) => {
      const o = await this.lock(tx, user, orderId);
      await this.mayRead(user, kind, o);
      if (o.status === "cancelled") throw new DomainError("This order is cancelled.");
      const items = livePlanOfPaper(o);
      const item = items.find((x) => x.id === input.ref) ?? null;
      if (!item && !(input.ref === "balance" && !o.receivables.length)) throw new NotFoundError("Payment request");
      const rows = this.rowsOf(o, kind, input.ref);
      const before = this.revisionOf(rows);
      const reason = before ? requireReason(input.reason, "requestAgain", "the request is sent again") : null;
      const c = await this.ctx(user, o, kind, this.optionsOf(kind, o, null, null), input.ref);
      if (item) {
        const settled = orderPositionOf(o, fxOf(c.settings, !c.features || c.features.includes("expenses"))).settledMinor;
        const row = planStatus(items, settled, c.today, 0).find((x) => x.id === item.id)!;
        if (row.openMinor <= 0) throw new DomainError(`${item.label} is already paid: there is nothing to ask for.`);
      }
      const { doc, checks } = this.build(kind, { ...c, revision: before });
      const missing = checks.filter((x) => x.required && !x.ok);
      if (missing.length) throw new DomainError(`Still needed before it is sent: ${missing.map((x) => inSentence(x.label)).join(", ")}.`);
      const amount = doc.total?.amount ?? "0.00";
      const version = await keepAsSent(tx, {
        orderId: o.id,
        kind,
        ref: input.ref,
        number: doc.number,
        byId: user.id,
        snapshot: doc as unknown as Prisma.InputJsonValue,
        // What it asked for: the row shows "changed since it was sent" when it no longer says the same.
        options: { amount, dueOn: item?.dueOn ?? null, label: item?.label ?? "Balance due on the order" },
      });
      // Own items that send this paper tick themselves.
      await tx.orderChecklistItem.updateMany({
        where: { orderId: o.id, key: null, paper: kind, doneAt: null },
        data: { doneAt: new Date(), doneById: user.id, skippedAt: null, skipReason: null, data: { number: doc.number } },
      });
      await this.audit.record(tx, {
        userId: user.id,
        action: "paper.sent",
        entityType: "order",
        entityId: o.id,
        summary: `${o.refNo}: ${PAPER_LABEL[kind]} ${doc.number} sent${version > 1 ? ` again (R${version})` : ""}: ${o.currency} ${amount}${item?.dueOn ? `, due ${item.dueOn}` : ""}`,
        newValues: { kind, number: doc.number, version, ref: input.ref, amount, dueOn: item?.dueOn ?? null, step: PAPER_STEP[kind] },
        reason,
      });
      return { orderId: o.id, ref: input.ref, number: doc.number, revision: version };
    });
  }

  /** The order's payments whose receipt is not kept yet, or was kept before the payment was corrected. */
  private receiptsToKeep(o: PaperOrder) {
    return o.allocations.filter((a) => {
      const copy = this.rowsOf(o, "payment-receipt", a.id).at(-1);
      return !copy || JSON.stringify({ ...receiptMark(asPayment(a)) }) !== JSON.stringify(this.markOf(copy.options));
    });
  }

  private markOf(v: Prisma.JsonValue) {
    const o = (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Record<string, unknown>;
    return { amount: o.amount, bankCharges: o.bankCharges, paidOn: o.paidOn, method: o.method, reference: o.reference };
  }

  /**
   * Keeps the receipt of every payment of the order that has none yet, exactly as it prints (the account as
   * it stood once that payment counted), and again as the next version for a payment corrected since. Runs
   * when a payment is recorded, and before a receipt is read (payments from before receipts were kept).
   * Never breaks what called it.
   */
  async keepReceipts(orderId: string) {
    const kind = "payment-receipt" as const;
    try {
      await this.prisma.tx(async (tx) => {
        await tx.$queryRaw`select id from orders where id = ${orderId}::uuid for update`;
        const o = await tx.order.findUnique({ where: { id: orderId }, include: paperOrderInclude });
        if (!o) return;
        const todo = this.receiptsToKeep(o);
        if (!todo.length) return;
        const base = await this.ctx(null, o, kind, this.optionsOf(kind, o, null, null), "");
        for (const a of todo) {
          const { doc } = this.build(kind, { ...base, ref: a.id });
          await keepAsSent(tx, {
            orderId: o.id,
            kind,
            ref: a.id,
            number: doc.number,
            byId: a.recordedById,
            snapshot: doc as unknown as Prisma.InputJsonValue,
            options: receiptMark(asPayment(a)),
          });
        }
      });
    } catch (e) {
      this.logger.warn(`receipts of order ${orderId} not kept: ${(e as Error).message}`);
    }
  }

  /** POST /orders/:id/papers/:kind — save as draft (version 1, or the open draft's options). */
  async draft(user: SessionUser, orderId: string, kind: PaperKind, input: PaperDraftInput) {
    const before = await this.order(user, orderId);
    await this.mayMake(user, kind, before);
    const ref = this.refOf(kind, before, input.ref);
    await this.prisma.tx(async (tx) => {
      const o = await this.lock(tx, user, orderId);
      const latest = this.rowsOf(o, kind, ref).at(-1);
      if (latest?.status === "final") throw new DomainError(`Version ${latest.version} is final. Use Make again for a new version.`);
      const options = this.optionsOf(kind, o, latest ? asOptions(latest.options) : null, input.options);
      if (latest) {
        await saveDraft(tx, latest, options);
        await this.log(tx, user, o, "draft", kind, `${PAPER_LABEL[kind]} ${latest.number} draft saved`, {
          number: latest.number,
          version: latest.version,
          options,
        });
      } else {
        const { doc } = this.build(kind, await this.ctx(user, o, kind, options, ref));
        await startDraft(tx, { orderId, kind, ref, number: doc.number, options, byId: user.id });
        await this.log(tx, user, o, "draft", kind, `${PAPER_LABEL[kind]} ${doc.number} started as a draft`, {
          number: doc.number,
          version: 1,
          options,
        });
      }
    });
    return this.checks(user, orderId, kind, ref);
  }

  /**
   * POST /papers/:id/final — every needed check must pass. Keeps the snapshot,
   * locks the number, sets the document set's paper to ready (it ticks
   * `doc:<kind>`) and ticks the order's own Make / Send items for this paper.
   */
  async final(user: SessionUser, paperId: string, input: { options?: PaperOptions }) {
    const p = await this.prisma.db.orderPaper.findUnique({ where: { id: paperId } });
    if (!p) throw new NotFoundError("Paper");
    const kind = p.kind as PaperKind;
    const before = await this.order(user, p.orderId);
    await this.mayMake(user, kind, before);
    await this.prisma.tx(async (tx) => {
      const o = await this.lock(tx, user, p.orderId);
      const row = o.papers.find((x) => x.id === paperId)!;
      const latest = this.rowsOf(o, kind, row.ref).at(-1)!;
      if (row.status === "final") throw new DomainError(`Version ${row.version} is already final.`);
      if (latest.id !== row.id) throw new DomainError("A newer version exists.");
      const options = this.optionsOf(kind, o, asOptions(row.options), input.options ?? null);
      const { doc, checks } = this.build(kind, await this.ctx(user, o, kind, options, row.ref));
      const missing = checks.filter((x) => x.required && !x.ok);
      if (missing.length) throw new DomainError(`Still needed before it is final: ${missing.map((x) => inSentence(x.label)).join(", ")}.`);
      const now = new Date();
      const snapshot = { ...doc, number: row.number } as unknown as Prisma.InputJsonValue;
      await makeFinal(tx, row, { orderId: o.id, kind, ref: row.ref, number: row.number, byId: user.id, snapshot, options });
      // The document set's paper is ready, made by the app.
      const docKind = PAPER_DOCUMENT[kind];
      if (docKind) {
        const existing = o.documents.find((d) => d.kind === docKind && (d.paperId !== null || !documentDone(d.status))) ?? null;
        await paperReady(tx, { orderId: o.id, kind: docKind, rowId: existing?.id ?? null, paperId: row.id, number: row.number, today: this.clock.today() });
      }
      // Own items that make this paper tick themselves.
      await tx.orderChecklistItem.updateMany({
        where: { orderId: o.id, key: null, paper: kind, doneAt: null },
        data: { doneAt: now, doneById: user.id, skippedAt: null, skipReason: null, data: { number: row.number } },
      });
      await this.log(tx, user, o, "final", kind, `${PAPER_LABEL[kind]} ${row.number} made final (version ${row.version})`, {
        number: row.number,
        version: row.version,
      });
    });
    return this.checks(user, p.orderId, kind, p.ref);
  }

  /** POST /orders/:id/papers/:kind/again — a new version as a draft; the final one stays as it was printed. */
  async again(user: SessionUser, orderId: string, kind: PaperKind, refIn?: string | null) {
    const before = await this.order(user, orderId);
    await this.mayMake(user, kind, before);
    const ref = this.refOf(kind, before, refIn);
    await this.prisma.tx(async (tx) => {
      const o = await this.lock(tx, user, orderId);
      const latest = this.rowsOf(o, kind, ref).at(-1);
      if (!latest) throw new DomainError("Make the paper first.");
      if (latest.status !== "final") throw new DomainError(`Version ${latest.version} is still a draft: change it and make it final.`);
      await makeAgain(tx, latest, user.id);
      await this.log(tx, user, o, "again", kind, `${PAPER_LABEL[kind]} ${latest.number} made again (version ${latest.version + 1})`, {
        number: latest.number,
        version: latest.version + 1,
      });
    });
    return this.checks(user, orderId, kind, ref);
  }

  /** DELETE /papers/:id — a draft only (a final version stays as it was printed); the earlier final version, if any, is the paper again. */
  async removeDraft(user: SessionUser, paperId: string) {
    const p = await this.prisma.db.orderPaper.findUnique({ where: { id: paperId } });
    if (!p) throw new NotFoundError("Paper");
    const kind = p.kind as PaperKind;
    const before = await this.order(user, p.orderId);
    await this.mayMake(user, kind, before);
    await this.prisma.tx(async (tx) => {
      const o = await this.lock(tx, user, p.orderId);
      const row = o.papers.find((x) => x.id === paperId);
      if (!row) throw new NotFoundError("Paper");
      if (row.status !== "draft")
        throw new DomainError(`Version ${row.version} is final: it stays as it was printed. Make it again for a new version.`);
      await deleteDraft(tx, row);
      await this.log(tx, user, o, "delete", kind, `${PAPER_LABEL[kind]} ${row.number} draft deleted (version ${row.version})`, {
        number: row.number,
        version: row.version,
      });
    });
    return { ok: true };
  }

  /**
   * POST /orders/:id/papers/:kind/fix — missing data typed on the Make page,
   * saved where it belongs by the same services (and rules) as their own forms:
   * the shipment, the bank contract, the order's details, an order line's HS code.
   */
  async fix(user: SessionUser, orderId: string, kind: PaperKind, input: PaperFixInput, refIn?: string) {
    const o = await this.order(user, orderId);
    await this.mayRead(user, kind, o);
    const v = input.value.trim();
    // Shipment 1: the shipment the papers print.
    const ship = primaryShipment(o.shipments);
    const features = await this.limits.features();
    const shipping = !features || features.includes("shipping");
    switch (input.field) {
      case "blNo":
      case "vessel":
      case "etd":
      case "eta": {
        if (ship && shipping) await this.flow.updateShipment(user, ship.id, shipmentUpdateInput.parse({ [input.field]: v }));
        // Without the shipping module (or with no shipment yet): the B/L is saved on Shipment 1 as the Details card does.
        else if (input.field === "blNo") await this.orders.setDetails(user, orderId, orderDetailsInput.parse({ blNo: v }));
        // A new shipment: its ports from the order's terms (not sent: the API fills them).
        else await this.flow.addShipment(user, orderId, shipmentInput.parse({ mode: "sea", [input.field]: v }));
        break;
      }
      case "lcNo":
      case "ourBank":
      case "customerBank": {
        const b = o.bankContract;
        const key = input.field === "lcNo" ? "number" : input.field;
        await this.flow.saveBankContract(
          user,
          orderId,
          bankContractInput.parse({
            number: b?.number ?? "",
            status: b?.status ?? "draft",
            customerBank: b?.customerBank ?? "",
            ourBank: b?.ourBank ?? "",
            amount: b?.amount?.toFixed(2) ?? "",
            currency: b?.currency ?? "",
            openedOn: fromDbDateOrNull(b?.openedOn) ?? "",
            latestShipOn: fromDbDateOrNull(b?.latestShipOn) ?? "",
            expiresOn: fromDbDateOrNull(b?.expiresOn) ?? "",
            note: b?.note ?? "",
            [key]: v,
          }),
        );
        break;
      }
      case "readyOn": {
        // A purchase order's ready date is its factory's own (one per factory); elsewhere, every factory's.
        const factoryId = kind === "purchase-order" ? (refIn ?? o.lines.find((l) => l.factoryId)?.factoryId ?? null) : null;
        await this.orders.setDetails(
          user,
          orderId,
          orderDetailsInput.parse(factoryId ? { readyBy: [{ factoryId, readyOn: v }] } : { readyOn: v }),
        );
        break;
      }
      case "shipBy":
      case "portOfDischarge":
        await this.orders.setDetails(user, orderId, orderDetailsInput.parse({ [input.field]: v }));
        break;
      case "hs": {
        if (!can(user, "documents.manage")) throw new ForbiddenError("You cannot make papers.");
        if (v && !/^[0-9][0-9. ]{3,18}$/.test(v)) throw new DomainError("An HS code is digits, e.g. 8422.40.");
        await this.prisma.tx(async (tx) => {
          const locked = await this.lock(tx, user, orderId);
          if (locked.status === "cancelled") throw new DomainError("This order is cancelled.");
          const line = locked.lines.find((l) => l.id === input.lineId);
          if (!line) throw new NotFoundError("Line");
          await tx.orderLine.update({ where: { id: line.id }, data: { hsCode: v || null } });
          await this.log(tx, user, locked, "hs", kind, `HS code of "${line.description.split(/\r?\n/)[0]}" set to ${v || "none"}`, {
            lineId: line.id,
            hsCode: v || null,
            was: line.hsCode,
          });
        });
        break;
      }
    }
    return this.checks(user, orderId, kind, refIn);
  }
}
