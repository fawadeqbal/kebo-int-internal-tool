import { Injectable, Logger } from "@nestjs/common";
import { can } from "@kebo/shared";
import { DomainError, ForbiddenError, NotFoundError } from "@kebo/utils";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { Clock } from "../../common/time/clock.service";
import type { SessionUser } from "../../common/auth/session-user";
import { CompanyContext } from "../../common/company/company-context";
import { toInfo } from "../../common/company/companies.service";
import { LimitsService } from "../../common/company/limits.service";
import { SettingsService } from "../settings/settings.service";
import { fxOf } from "../money/position";
import { OrdersService } from "./orders.service";
import { buyerOf } from "./buyer";
import {
  buildOrderDoc,
  docNumber,
  freezeOrderDoc,
  ORDER_DOCUMENTS,
  orderDocInclude,
  ordersToRebuild,
  overlayLive,
  packingFinalNow,
  type OrderDocKind,
  type OrderDocSnapshot,
} from "./order-docs";

export { ORDER_DOCUMENTS, paymentTermsOf } from "./order-docs";
export type OrderDocumentKind = OrderDocKind;

/** Kebo's payment sentence (shared with the web for quotations). */
export { paymentSentenceOf } from "@kebo/shared";

const LABEL: Record<OrderDocKind, string> = { proforma: "Proforma invoice", "packing-list": "Packing list" };

/**
 * The order's own documents (see order-docs.ts): the proforma invoice, numbered when issued (KEB260916TN07:
 * prefix, issue date, customer letters, the handler's count this year) and final from then on; the packing
 * list, numbered from the order (SO-2026-0005 → PL-2026-0005) and final once the order is shipped.
 * A final version prints exactly as it was made; "Make again" starts the next version (a draft, made final
 * by issuing it again).
 */
@Injectable()
export class DocumentsService {
  private readonly logger = new Logger("Documents");

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly settings: SettingsService,
    private readonly orders: OrdersService,
    private readonly limits: LimitsService,
  ) {}

  private async ctx() {
    const settings = await this.settings.get();
    return { settings, fx: fxOf(settings, await this.limits.allows("expenses")), today: this.clock.today() };
  }

  private versionView(p: { id: string; version: number; status: string; number: string; madeAt: Date; finalAt: Date | null; snapshot: unknown }) {
    return {
      id: p.id,
      version: p.version,
      status: p.status as "draft" | "final",
      number: p.number,
      madeAt: p.madeAt.toISOString(),
      finalAt: p.finalAt?.toISOString() ?? null,
      /** Snapshotted afterwards from the data (issued before snapshots were kept). */
      rebuiltOn: (p.snapshot as OrderDocSnapshot | null)?.rebuiltOn ?? null,
    };
  }

  /**
   * GET /orders/:id/documents/:kind?v= — the document to print: a final version as it was made (?v=, else
   * the latest), else made from the order now (not issued yet, or the next version's draft).
   */
  async get(user: SessionUser, orderId: string, kind: OrderDocKind, v?: number) {
    if (!ORDER_DOCUMENTS.includes(kind)) throw new NotFoundError("Document");
    await this.orders.load(user, orderId);
    const c = await this.ctx();
    let o = await this.prisma.db.order.findUniqueOrThrow({ where: { id: orderId }, include: orderDocInclude });
    // Issued (or shipped) before snapshots were kept and not snapshotted yet: snapshot it now, from the data.
    if (o.papers.every((p) => p.kind !== kind) && (kind === "proforma" ? !!o.proformaNo : packingFinalNow(o))) {
      await this.rebuild(o.id, kind, o.createdById).catch((e) => this.logger.warn(`snapshot of ${o.refNo} ${kind}: ${(e as Error).message}`));
      o = await this.prisma.db.order.findUniqueOrThrow({ where: { id: orderId }, include: orderDocInclude });
    }
    const rows = o.papers.filter((p) => p.kind === kind);
    const asked = v ? rows.find((p) => p.version === v) : undefined;
    if (v && !asked) throw new NotFoundError("Version");
    const row = asked ?? rows.at(-1) ?? null;
    const live = buildOrderDoc(o, kind, { ...c, seeCosts: can(user, "sourcing.manage"), buyer: await buyerOf(this.prisma.db, o, c.today) });
    const final = row?.status === "final" && !!row.snapshot;
    const doc = final ? overlayLive(row.snapshot as unknown as OrderDocSnapshot, live) : { ...live, rebuiltOn: null };
    // A next version not made final yet: printed from the order now, with its number, as a draft.
    const draftVersion = !final && !!row;
    return {
      ...doc,
      draft: final ? false : draftVersion || live.draft,
      watermark: o.status === "cancelled" ? "CANCELLED" : draftVersion || (kind === "packing-list" && !o.packedAt) ? "DRAFT" : null,
      paper: row ? this.versionView(row) : null,
      versions: rows.map((p) => this.versionView(p)),
      final,
    };
  }

  private async rebuild(orderId: string, kind: OrderDocKind, byId: string) {
    const c = await this.ctx();
    await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`select id from orders where id = ${orderId}::uuid for update`;
      if (await tx.orderPaper.findFirst({ where: { orderId, kind }, select: { id: true } })) return;
      await freezeOrderDoc(tx, orderId, kind, { ...c, byId, rebuilt: true });
    });
  }

  /**
   * Proformas issued and packing lists shipped before snapshots were kept: snapshot them from the data, in
   * every company, once (run when the API starts; anything already snapshotted is left alone).
   */
  async rebuildAll() {
    const companies = await this.prisma.platform.company.findMany({ where: { status: { not: "deleted" } }, orderBy: { createdAt: "asc" } });
    let n = 0;
    for (const company of companies)
      await CompanyContext.run(toInfo(company), async () => {
        for (const o of await ordersToRebuild(this.prisma.db))
          await this.rebuild(o.id, o.kind, o.createdById).then(
            () => n++,
            (e) => this.logger.warn(`snapshot of ${o.kind} on order ${o.id} (${company.slug}): ${(e as Error).message}`),
          );
      }).catch((e) => this.logger.error(`snapshots for ${company.slug}: ${(e as Error).message}`));
    if (n) this.logger.log(`${n} proforma(s) / packing list(s) snapshotted from the data`);
    return n;
  }

  private async may(user: SessionUser) {
    if (!can(user, "orders.update")) throw new ForbiddenError("You cannot change orders.");
  }

  /** POST /orders/:id/documents/:kind/again — the next version as a draft (same number); the final one stays as it was printed. */
  async again(user: SessionUser, orderId: string, kind: OrderDocKind) {
    await this.may(user);
    await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`select id from orders where id = ${orderId}::uuid for update`;
      const o = await this.orders.load(user, orderId, tx);
      if (o.status === "cancelled") throw new DomainError("This order is cancelled.");
      const rows = await tx.orderPaper.findMany({ where: { orderId, kind }, orderBy: { version: "asc" } });
      const latest = rows.at(-1);
      if (!latest) throw new DomainError(kind === "proforma" ? "Issue the proforma first." : "The packing list is final once the order is shipped.");
      if (latest.status !== "final") throw new DomainError(`Version ${latest.version} is still a draft: issue it or delete it.`);
      await tx.orderPaper.create({
        data: { orderId, kind, ref: "", number: latest.number, version: latest.version + 1, status: "draft", options: {}, madeById: user.id },
      });
      await this.audit.record(tx, {
        userId: user.id,
        action: "paper.again",
        entityType: "order",
        entityId: orderId,
        summary: `${o.refNo}: ${LABEL[kind]} ${latest.number} made again (version ${latest.version + 1})`,
        newValues: { kind, number: latest.number, version: latest.version + 1, step: kind === "proforma" ? "payment" : "shipping" },
      });
    });
    return this.get(user, orderId, kind);
  }

  /** POST /orders/:id/documents/:kind/final — the open version made final, as it prints now. */
  async final(user: SessionUser, orderId: string, kind: OrderDocKind) {
    await this.may(user);
    const c = await this.ctx();
    await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`select id from orders where id = ${orderId}::uuid for update`;
      const o = await this.orders.load(user, orderId, tx);
      if (o.status === "cancelled") throw new DomainError("This order is cancelled.");
      const latest = await tx.orderPaper.findFirst({ where: { orderId, kind }, orderBy: { version: "desc" } });
      if (!latest || latest.status === "final")
        throw new DomainError(latest ? `Version ${latest.version} is already final.` : `Nothing to make final: use Make again for a new version.`);
      if (!docNumber(o, kind)) throw new DomainError("Issue the proforma first.");
      const version = await freezeOrderDoc(tx, orderId, kind, { ...c, byId: user.id });
      await this.audit.record(tx, {
        userId: user.id,
        action: "paper.final",
        entityType: "order",
        entityId: orderId,
        summary: `${o.refNo}: ${LABEL[kind]} ${latest.number} made final (version ${version})`,
        newValues: { kind, number: latest.number, version, step: kind === "proforma" ? "payment" : "shipping" },
      });
    });
    return this.get(user, orderId, kind);
  }

  /** DELETE /orders/:id/documents/:kind/draft — the next version's draft goes; the final one is the document again. */
  async removeDraft(user: SessionUser, orderId: string, kind: OrderDocKind) {
    await this.may(user);
    await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`select id from orders where id = ${orderId}::uuid for update`;
      const o = await this.orders.load(user, orderId, tx);
      const latest = await tx.orderPaper.findFirst({ where: { orderId, kind }, orderBy: { version: "desc" } });
      if (!latest || latest.status !== "draft") throw new DomainError("There is no draft to delete.");
      await tx.orderPaper.delete({ where: { id: latest.id } });
      await this.audit.record(tx, {
        userId: user.id,
        action: "paper.delete",
        entityType: "order",
        entityId: orderId,
        summary: `${o.refNo}: ${LABEL[kind]} ${latest.number} draft deleted (version ${latest.version})`,
        newValues: { kind, number: latest.number, version: latest.version, step: kind === "proforma" ? "payment" : "shipping" },
      });
    });
    return this.get(user, orderId, kind);
  }
}
