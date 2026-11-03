import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { zipSync } from "fflate";
import {
  ATTACHMENT_KIND_LABEL,
  autoTitle,
  can,
  FLOW_STEP_LABEL,
  ORDER_DOCUMENT_KINDS,
  ORDER_DOCUMENT_LABEL,
  ORDER_FILE_GROUP_LABEL,
  ORDER_FILE_GROUPS,
  PAYMENT_KIND_LABEL,
  STEP_FILE_GROUP,
  STEP_PATH,
  VIEWABLE_FILE,
  type AttachmentKind,
  type FlowStep,
  type OrderDocumentKind,
  type OrderFileAttachInput,
  type OrderFileGroup,
  type OrderFileLink,
  type OrderFilesShareInput,
  type OrderFileSource,
  type OrderFileUpdateInput,
  type OrderFileUploadInput,
} from "@kebo/shared";
import { DomainError, ForbiddenError, NotFoundError } from "@kebo/utils";
import { PrismaService, type Tx } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { LimitsService } from "../../common/company/limits.service";
import { safeFileName, StorageService } from "../../common/storage/storage.service";
import type { SessionUser } from "../../common/auth/session-user";
import { canWorkOn, InquiriesService } from "../inquiries/inquiries.service";
import { OrdersService } from "../orders/orders.service";
import { PapersService } from "../papers/papers.service";
import { ChecklistService } from "../checklist/checklist.service";
import { FlowService } from "../flow/flow.service";
import { PaymentFilesService } from "../money/payment-files.service";
import { MoneyService } from "../money/money.service";

type Upload = { originalname: string; mimetype: string; size: number; buffer: Buffer };

/** One file of GET /orders/:id/files (keep in step with apps/web/src/lib/types-files.ts). */
export interface OrderFileView {
  /** "attachment:<uuid>", "payment:<uuid>", "factory_payment:<uuid>", "expense:<uuid>". */
  id: string;
  source: OrderFileSource;
  sourceId: string;
  name: string;
  size: number;
  type: string;
  /** What it is: the deal's file kinds (URS, drawing…), and a short note. */
  kind: AttachmentKind | null;
  kindLabel: string | null;
  note: string | null;
  attachedTo: { link: OrderFileLink; label: string; href: string };
  step: FlowStep | null;
  stepLabel: string;
  group: OrderFileGroup;
  by: { id: string; name: string } | null;
  at: string;
  /** Download (through the web app's /files routes). */
  href: string;
  /** Opens in the app (PDFs and photos); null: download only. */
  viewHref: string | null;
  version: number;
  /** Earlier versions (Replace with a newer one keeps them), newest first. */
  versions: { id: string; name: string; version: number; at: string; href: string }[];
  can: { rename: boolean; describe: boolean; attach: boolean; replace: boolean; remove: boolean };
}

/** Where a file can be attached ("Attach to…"). */
export interface AttachTarget {
  to: "paper" | "checklist" | "step";
  target: string;
  label: string;
  step: FlowStep;
}

const STEPS_OF_DOC: Partial<Record<OrderDocumentKind, FlowStep>> = {
  bill_of_lading: "shipping",
  airway_bill: "shipping",
  packing_list: "shipping",
  proforma_invoice: "payment",
  sales_contract: "payment",
};

const MAX_ZIP = 300 * 1024 * 1024;

/**
 * Documents v3: every file of an order in one list, wherever it is kept, with
 * the same tools everywhere. Reading follows the order (and each source's own
 * rule: factory offers' and factory payments' files for people who see factory
 * prices, expense receipts for managers); changing a file needs the permission
 * of what it is attached to — documents.manage for a paper's file,
 * orders.update for a checklist item's or a step's file, payments.record for a
 * payment's proof, expenses.manage for a receipt; the deal's own files follow
 * the deal (its handler, a manager, or whoever uploaded it). Every change is
 * noted in the order's history as file.* (with its step).
 */
@Injectable()
export class OrderFilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly limits: LimitsService,
    private readonly storage: StorageService,
    private readonly inquiries: InquiriesService,
    private readonly orders: OrdersService,
    private readonly papers: PapersService,
    private readonly checklist: ChecklistService,
    private readonly flow: FlowService,
    private readonly paymentFiles: PaymentFilesService,
    private readonly money: MoneyService,
  ) {}

  /* ---------------------------------------------------------------- reading */

  /** GET /orders/:id/files — every file, grouped, with what it is attached to and what the person may do with it. */
  async list(user: SessionUser, orderId: string) {
    const o = await this.orders.load(user, orderId);
    const db = this.prisma.db;
    const open = o.status !== "cancelled";
    const seeCosts = can(user, "sourcing.manage");
    const seeExpenses = can(user, "expenses.manage") && (await this.limits.allows("expenses"));
    const [inquiry, papers, steps, attachments, offers, payments, factoryPaid, expenses, docs] = await Promise.all([
      db.inquiry.findUniqueOrThrow({ where: { id: o.inquiryId }, select: { id: true, refNo: true, assigneeId: true, createdById: true } }),
      this.papers.list(user, orderId),
      this.checklist.view(user, orderId),
      db.attachment.findMany({
        where: { inquiryId: o.inquiryId, deletedAt: null, factoryQuoteId: null, OR: [{ orderId: null }, { orderId }] },
        include: { uploadedBy: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
      }),
      seeCosts
        ? db.factoryQuote.findMany({
            where: { lines: { some: { quoteLines: { some: { orderLines: { some: { orderId } } } } } } },
            select: { id: true, factory: { select: { name: true } } },
          })
        : Promise.resolve([]),
      db.payment.findMany({
        where: { orderId, voidedAt: null, fileKey: { not: null } },
        include: { recordedBy: { select: { id: true, name: true } } },
        orderBy: { paidOn: "asc" },
      }),
      seeCosts
        ? db.factoryPayment.findMany({
            where: { orderId, voidedAt: null, fileKey: { not: null } },
            include: { recordedBy: { select: { id: true, name: true } }, factory: { select: { name: true } } },
            orderBy: { paidOn: "asc" },
          })
        : Promise.resolve([]),
      seeExpenses
        ? db.expense.findMany({
            where: { orderId, receiptKey: { not: null } },
            include: { recordedBy: { select: { id: true, name: true } } },
            orderBy: { spentOn: "asc" },
          })
        : Promise.resolve([]),
      db.orderDocument.findMany({ where: { orderId, attachmentId: { not: null } } }),
    ]);
    const offerFiles = offers.length
      ? await db.attachment.findMany({
          where: { factoryQuoteId: { in: offers.map((q) => q.id) }, deletedAt: null, replacedById: null },
          include: { uploadedBy: { select: { id: true, name: true } } },
          orderBy: { createdAt: "asc" },
        })
      : [];

    // What each of the deal's files is attached to: a paper, a checklist item, a step (else the deal itself).
    const paperOf = new Map<string, { label: string; step: FlowStep }>();
    for (const r of papers.papers) if (r.doc?.file) paperOf.set(r.doc.file.id, { label: r.label, step: r.step });
    for (const d of docs)
      if (d.attachmentId && !paperOf.has(d.attachmentId))
        paperOf.set(d.attachmentId, {
          label: d.kind === "other" && d.title ? d.title : ORDER_DOCUMENT_LABEL[d.kind],
          step: STEPS_OF_DOC[d.kind] ?? "documents",
        });
    const itemOf = new Map<string, { title: string; step: FlowStep }>();
    for (const i of steps.items) {
      if (i.file) itemOf.set(i.file.id, { title: i.title, step: i.step });
      for (const f of i.fields) if (f.type === "file" && i.values[f.key]) itemOf.set(i.values[f.key]!, { title: i.title, step: i.step });
    }

    // Earlier versions (kept when replaced), for each newest file.
    const earlier = attachments.length
      ? await db.attachment.findMany({
          where: { inquiryId: o.inquiryId, deletedAt: null, replacedById: { not: null } },
          select: { id: true, fileName: true, version: true, createdAt: true, replacedById: true },
        })
      : [];
    const versionsOf = (id: string) => {
      const out: OrderFileView["versions"] = [];
      for (let cur = earlier.find((e) => e.replacedById === id); cur; cur = earlier.find((e) => e.replacedById === cur!.id)) {
        out.push({ id: cur.id, name: cur.fileName, version: cur.version, at: cur.createdAt.toISOString(), href: `/files/${cur.id}` });
        if (out.length > 50) break;
      }
      return out;
    };

    const base = `/orders/${o.id}`;
    const stepHref = (s: FlowStep) => `${base}/${STEP_PATH[s]}`;
    const files: OrderFileView[] = [];
    const isMine = (by: string) => by === user.id;
    const dealRule = canWorkOn(user, inquiry);

    for (const a of attachments.filter((x) => !x.replacedById)) {
      const paper = paperOf.get(a.id);
      const item = itemOf.get(a.id);
      const step = (paper?.step ?? item?.step ?? (a.step as FlowStep | null)) || null;
      const link: OrderFileLink = paper ? "paper" : item ? "checklist" : a.orderId ? "step" : "inquiry";
      const mayChange =
        open &&
        (link === "paper"
          ? can(user, "documents.manage")
          : link === "checklist"
            ? can(user, "orders.update")
            : link === "step"
              ? can(user, "orders.update") || isMine(a.uploadedById)
              : dealRule || isMine(a.uploadedById));
      files.push({
        id: `attachment:${a.id}`,
        source: "attachment",
        sourceId: a.id,
        name: a.fileName,
        size: a.size,
        type: a.mimeType,
        kind: a.kind as AttachmentKind,
        kindLabel: ATTACHMENT_KIND_LABEL[a.kind as AttachmentKind] ?? null,
        note: a.note,
        attachedTo:
          link === "paper"
            ? { link, label: `Paper · ${paper!.label}`, href: `${base}/documents?tab=all#papers` }
            : link === "checklist"
              ? { link, label: `Checklist · ${item!.title}`, href: stepHref(item!.step) }
              : link === "step"
                ? {
                    link,
                    label: step ? `Step · ${FLOW_STEP_LABEL[step]}` : "This order",
                    href: step ? stepHref(step) : `${base}/documents`,
                  }
                : {
                    link,
                    label: `Inquiry · ${ATTACHMENT_KIND_LABEL[a.kind as AttachmentKind] ?? "file"}`,
                    href: `/inquiries/${inquiry.id}`,
                  },
        step,
        stepLabel: step ? FLOW_STEP_LABEL[step] : "Inquiry",
        group: step ? STEP_FILE_GROUP[step] : "customer",
        by: a.uploadedBy,
        at: a.createdAt.toISOString(),
        href: `/files/${a.id}`,
        viewHref: VIEWABLE_FILE.test(a.mimeType) ? `/files/${a.id}?view=1` : null,
        version: a.version,
        versions: versionsOf(a.id),
        can: { rename: mayChange, describe: mayChange, attach: mayChange, replace: mayChange, remove: mayChange },
      });
    }

    for (const a of offerFiles)
      files.push({
        id: `attachment:${a.id}`,
        source: "attachment",
        sourceId: a.id,
        name: a.fileName,
        size: a.size,
        type: a.mimeType,
        kind: a.kind as AttachmentKind,
        kindLabel: ATTACHMENT_KIND_LABEL[a.kind as AttachmentKind] ?? null,
        note: a.note,
        attachedTo: {
          link: "offer",
          label: `Factory offer · ${offers.find((q) => q.id === a.factoryQuoteId)?.factory.name ?? "factory"}`,
          href: `/inquiries/${inquiry.id}/sourcing`,
        },
        step: null,
        stepLabel: "Inquiry",
        group: "factory",
        by: a.uploadedBy,
        at: a.createdAt.toISOString(),
        href: `/files/${a.id}`,
        viewHref: VIEWABLE_FILE.test(a.mimeType) ? `/files/${a.id}?view=1` : null,
        version: a.version,
        versions: [],
        // Kept with the factory's offer: changed there.
        can: { rename: false, describe: false, attach: false, replace: false, remove: false },
      });

    const payEdit = open && can(user, "payments.record");
    for (const p of payments) {
      const type = p.fileType ?? "application/octet-stream";
      files.push({
        id: `payment:${p.id}`,
        source: "payment",
        sourceId: p.id,
        name: p.fileName ?? "payment",
        size: p.fileSize ?? 0,
        type,
        kind: null,
        kindLabel: "Proof of payment",
        note: null,
        attachedTo: {
          link: "payment",
          label: `Payment · ${PAYMENT_KIND_LABEL[p.kind].toLowerCase()} ${day(p.paidOn)}`,
          href: stepHref("payment"),
        },
        step: "payment",
        stepLabel: FLOW_STEP_LABEL.payment,
        group: "money",
        by: p.recordedBy,
        at: p.createdAt.toISOString(),
        href: `/files/payments/${p.id}`,
        viewHref: VIEWABLE_FILE.test(type) ? `/files/payments/${p.id}?view=1` : null,
        version: 1,
        versions: [],
        can: { rename: payEdit, describe: false, attach: false, replace: payEdit, remove: payEdit },
      });
    }
    for (const p of factoryPaid) {
      const type = p.fileType ?? "application/octet-stream";
      files.push({
        id: `factory_payment:${p.id}`,
        source: "factory_payment",
        sourceId: p.id,
        name: p.fileName ?? "factory payment",
        size: p.fileSize ?? 0,
        type,
        kind: null,
        kindLabel: "Proof of payment",
        note: null,
        attachedTo: { link: "factory_payment", label: `Paid to ${p.factory.name} · ${day(p.paidOn)}`, href: stepHref("factory") },
        step: "factory",
        stepLabel: FLOW_STEP_LABEL.factory,
        group: "money",
        by: p.recordedBy,
        at: p.createdAt.toISOString(),
        href: `/files/factory-payments/${p.id}`,
        viewHref: VIEWABLE_FILE.test(type) ? `/files/factory-payments/${p.id}?view=1` : null,
        version: 1,
        versions: [],
        can: { rename: payEdit, describe: false, attach: false, replace: payEdit, remove: payEdit },
      });
    }
    const expEdit = open && seeExpenses;
    for (const e of expenses) {
      const type = e.receiptType ?? "application/octet-stream";
      const step = (e.step as FlowStep | null) ?? null;
      files.push({
        id: `expense:${e.id}`,
        source: "expense",
        sourceId: e.id,
        name: e.receiptName ?? "receipt",
        size: e.receiptSize ?? 0,
        type,
        kind: null,
        kindLabel: "Receipt",
        note: null,
        attachedTo: { link: "expense", label: `Expense · ${e.description}`, href: step ? stepHref(step) : `${base}/costs` },
        step,
        stepLabel: step ? FLOW_STEP_LABEL[step] : "Costs",
        group: "money",
        by: e.recordedBy,
        at: e.createdAt.toISOString(),
        href: `/files/expenses/${e.id}`,
        viewHref: VIEWABLE_FILE.test(type) ? `/files/expenses/${e.id}?view=1` : null,
        version: 1,
        versions: [],
        can: { rename: expEdit, describe: false, attach: false, replace: expEdit, remove: expEdit },
      });
    }

    // Groups in their order, newest last within a group (the order they came in).
    const rank = (g: OrderFileGroup) => ORDER_FILE_GROUPS.indexOf(g);
    files.sort((a, b) => rank(a.group) - rank(b.group) || a.at.localeCompare(b.at));
    const counts = Object.fromEntries(ORDER_FILE_GROUPS.map((g) => [g, files.filter((f) => f.group === g).length])) as Record<
      OrderFileGroup,
      number
    >;

    // Where a file can be attached: the papers recorded in the document set, the checklist's items, the steps.
    const targets: AttachTarget[] = [];
    if (papers.canRecord)
      for (const r of papers.papers)
        if (r.docKind && (r.source === "upload" || r.doc))
          targets.push({ to: "paper", target: r.doc ? `doc:${r.doc.id}` : r.docKind, label: r.label, step: r.step });
    if (can(user, "orders.update"))
      for (const i of steps.items)
        if (!i.key?.startsWith("doc:") && !i.key?.startsWith("bank:") && (i.key || i.id))
          targets.push({ to: "checklist", target: i.key ?? i.id!, label: i.title, step: i.step });
    for (const s of steps.steps) targets.push({ to: "step", target: s.key, label: s.label, step: s.key });

    return {
      orderId: o.id,
      refNo: o.refNo,
      dealId: inquiry.id,
      canUpload: open && (can(user, "orders.update") || can(user, "documents.manage")),
      groups: ORDER_FILE_GROUPS.map((g) => ({ key: g, label: ORDER_FILE_GROUP_LABEL[g], count: counts[g] })),
      files,
      targets,
    };
  }

  /** One file of the order as the list shows it (and so only one the person may see). */
  private async one(user: SessionUser, orderId: string, source: OrderFileSource, fileId: string) {
    const all = await this.list(user, orderId);
    const f = all.files.find((x) => x.source === source && x.sourceId === fileId);
    if (!f) throw new NotFoundError("File");
    return { f, all };
  }

  private log(
    tx: Tx,
    user: SessionUser,
    o: { id: string; refNo: string },
    action: string,
    summary: string,
    step: FlowStep | null,
    values: Record<string, unknown>,
    old?: Record<string, unknown>,
  ) {
    return this.audit.record(tx, {
      userId: user.id,
      action: `file.${action}`,
      entityType: "order",
      entityId: o.id,
      summary: `${o.refNo}: ${summary}`,
      oldValues: old,
      newValues: { ...values, ...(step ? { step } : {}) },
    });
  }

  /* ---------------------------------------------------------------- adding */

  /** POST /orders/:id/files — a file added on the order (Upload, or dropped on a step), optionally attached to a paper or a checklist item. */
  async upload(user: SessionUser, orderId: string, file: Upload, meta: OrderFileUploadInput) {
    const o = await this.orders.load(user, orderId);
    if (o.status === "cancelled") throw new DomainError("This order is cancelled.");
    if (!(can(user, "orders.update") || can(user, "documents.manage"))) throw new ForbiddenError("You cannot add files to this order.");
    const row = await this.inquiries.upload(user, o.inquiryId, file, { kind: meta.kind ?? "other", note: meta.note });
    const step = meta.step ?? null;
    await this.prisma.tx(async (tx) => {
      await tx.attachment.update({ where: { id: row.id }, data: { orderId, step } });
      await this.log(tx, user, o, "upload", `added ${row.fileName}${step ? ` to ${FLOW_STEP_LABEL[step]}` : ""}`, step, {
        file: row.fileName,
      });
    });
    if (meta.attachTo) {
      const [to, ...rest] = meta.attachTo.split(":");
      await this.attach(user, orderId, "attachment", row.id, { to: to as "paper" | "checklist", target: rest.join(":") });
    }
    return { id: `attachment:${row.id}`, sourceId: row.id, name: row.fileName };
  }

  /* ---------------------------------------------------------------- changing */

  /** PATCH /orders/:id/files/:source/:fileId — rename, say what it is. */
  async update(user: SessionUser, orderId: string, source: OrderFileSource, fileId: string, input: OrderFileUpdateInput) {
    const { f } = await this.one(user, orderId, source, fileId);
    if (input.name !== undefined && !f.can.rename) throw new ForbiddenError("You cannot rename this file.");
    if ((input.kind !== undefined || input.note !== undefined) && !f.can.describe)
      throw new ForbiddenError(source === "attachment" ? "You cannot change this file." : "Only the deal's files say what they are.");
    const o = await this.orders.load(user, orderId);
    // The name keeps its type: "B-L copy" stays a .pdf.
    const ext = /\.[^.]{1,10}$/.exec(f.name)?.[0] ?? "";
    const name =
      input.name !== undefined
        ? safeFileName(input.name.toLowerCase().endsWith(ext.toLowerCase()) ? input.name : `${input.name}${ext}`)
        : undefined;
    await this.prisma.tx(async (tx) => {
      if (source === "attachment")
        await tx.attachment.update({
          where: { id: fileId },
          data: {
            ...(name !== undefined && { fileName: name }),
            ...(input.kind !== undefined && { kind: input.kind }),
            ...(input.note !== undefined && { note: input.note }),
          },
        });
      else if (source === "payment") await tx.payment.update({ where: { id: fileId }, data: { fileName: name } });
      else if (source === "factory_payment") await tx.factoryPayment.update({ where: { id: fileId }, data: { fileName: name } });
      else await tx.expense.update({ where: { id: fileId }, data: { receiptName: name } });
      if (name !== undefined && name !== f.name)
        await this.log(tx, user, o, "rename", `renamed ${f.name} to ${name}`, f.step, { name }, { name: f.name });
      if (input.kind !== undefined || input.note !== undefined)
        await this.log(
          tx,
          user,
          o,
          "describe",
          `${name ?? f.name}: ${[input.kind ? ATTACHMENT_KIND_LABEL[input.kind] : null, input.note].filter(Boolean).join(" · ") || "described"}`,
          f.step,
          { kind: input.kind, note: input.note },
          { kind: f.kind, note: f.note },
        );
    });
    return this.list(user, orderId);
  }

  /** POST /orders/:id/files/:source/:fileId/attach — to a paper, a checklist item, or a step. */
  async attach(user: SessionUser, orderId: string, source: OrderFileSource, fileId: string, input: OrderFileAttachInput) {
    if (source !== "attachment") throw new DomainError("A payment's proof and an expense's receipt stay with what they prove.");
    const { f } = await this.one(user, orderId, source, fileId);
    if (!f.can.attach) throw new ForbiddenError("You cannot move this file.");
    const o = await this.orders.load(user, orderId);
    let label: string;
    let step: FlowStep | null;
    if (input.to === "paper") {
      // A recorded paper (doc:<row id>) gets the file; a kind of the set is recorded with it as ready.
      if (input.target.startsWith("doc:")) {
        const docId = input.target.slice(4);
        const doc = await this.prisma.db.orderDocument.findFirst({ where: { id: docId, orderId } });
        if (!doc) throw new NotFoundError("Paper");
        await this.flow.updateDocument(user, docId, {
          attachmentId: fileId,
          ...(doc.status === "missing" || doc.status === "draft" ? { status: "ready" as const, keptWhere: null } : {}),
        });
        label = doc.kind === "other" && doc.title ? doc.title : ORDER_DOCUMENT_LABEL[doc.kind];
        step = STEPS_OF_DOC[doc.kind] ?? "documents";
      } else {
        const kind = input.target as OrderDocumentKind;
        if (!(ORDER_DOCUMENT_KINDS as readonly string[]).includes(kind)) throw new DomainError("Choose a paper of this order.");
        const existing = await this.prisma.db.orderDocument.findFirst({ where: { orderId, kind }, orderBy: { updatedAt: "desc" } });
        if (existing)
          await this.flow.updateDocument(user, existing.id, {
            attachmentId: fileId,
            ...(existing.status === "missing" || existing.status === "draft" ? { status: "ready" as const, keptWhere: null } : {}),
          });
        else
          await this.flow.addDocument(user, orderId, {
            kind,
            title: null,
            number: null,
            issuedOn: null,
            status: "ready",
            shipmentId: null,
            attachmentId: fileId,
            note: null,
            keptWhere: null,
          });
        label = ORDER_DOCUMENT_LABEL[kind];
        step = STEPS_OF_DOC[kind] ?? "documents";
      }
    } else if (input.to === "checklist") {
      const isId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.target);
      if (isId) {
        const item = await this.prisma.db.orderChecklistItem.findFirst({ where: { id: input.target, orderId } });
        if (!item) throw new NotFoundError("Checklist item");
        if (item.key) await this.checklist.auto(user, orderId, item.key, { attachmentId: fileId });
        else await this.checklist.update(user, item.id, { attachmentId: fileId });
        label = item.title ?? autoTitle(item.key ?? "");
        step = item.step as FlowStep;
      } else {
        if (input.target.startsWith("doc:") || input.target.startsWith("bank:")) throw new DomainError("Attach it to the paper instead.");
        await this.checklist.auto(user, orderId, input.target, { attachmentId: fileId });
        label = autoTitle(input.target);
        step = null;
      }
    } else {
      step = input.target;
      label = FLOW_STEP_LABEL[step];
      await this.prisma.db.attachment.update({ where: { id: fileId }, data: { orderId, step } });
    }
    await this.prisma.tx((tx) =>
      this.log(tx, user, o, "attach", `attached ${f.name} to ${input.to === "step" ? `${label} (files)` : label}`, step ?? f.step, {
        file: f.name,
        to: input.to,
        target: input.target,
      }),
    );
    return this.list(user, orderId);
  }

  /**
   * POST /orders/:id/files/:source/:fileId/replace — a newer file. The deal's files keep the old one as an
   * earlier version (and everything it was attached to moves to the new one); a payment's proof and a
   * receipt are replaced as their own forms do.
   */
  async replace(user: SessionUser, orderId: string, source: OrderFileSource, fileId: string, file: Upload) {
    const { f } = await this.one(user, orderId, source, fileId);
    if (!f.can.replace) throw new ForbiddenError("You cannot replace this file.");
    if (source === "payment" || source === "factory_payment") {
      await this.paymentFiles.attach(user, source === "payment" ? "in" : "out", fileId, file);
      return this.list(user, orderId);
    }
    if (source === "expense") {
      await this.money.attachReceipt(user, fileId, file);
      return this.list(user, orderId);
    }
    const o = await this.orders.load(user, orderId);
    const old = await this.prisma.db.attachment.findUniqueOrThrow({ where: { id: fileId } });
    if (!this.storage.isAllowed(file.originalname))
      throw new DomainError("This kind of file is not allowed. Use PDF, Office, images, CAD drawings or zip files.");
    if (file.size > this.storage.maxBytes)
      throw new DomainError(`Files can be up to ${Math.round(this.storage.maxBytes / 1024 / 1024)} MB.`);
    const name = safeFileName(file.originalname);
    const key = this.storage.keyFor(`inquiries/${old.inquiryId}/${randomUUID()}-${name}`);
    await this.storage.put(key, file.buffer, file.mimetype);
    try {
      await this.prisma.tx(async (tx) => {
        const row = await tx.attachment.create({
          data: {
            inquiryId: old.inquiryId,
            orderId: old.orderId,
            step: old.step,
            fileName: name,
            mimeType: file.mimetype || "application/octet-stream",
            size: file.size,
            storageKey: key,
            kind: old.kind,
            note: old.note,
            uploadedById: user.id,
            version: old.version + 1,
          },
        });
        await tx.attachment.update({ where: { id: old.id }, data: { replacedById: row.id } });
        // Whatever the old file was attached to now has the new one.
        await tx.orderDocument.updateMany({ where: { attachmentId: old.id }, data: { attachmentId: row.id } });
        await tx.orderChecklistItem.updateMany({ where: { attachmentId: old.id }, data: { attachmentId: row.id } });
        const items = await tx.orderChecklistItem.findMany({ where: { orderId, key: null } });
        for (const i of items) {
          const data = (i.data && typeof i.data === "object" && !Array.isArray(i.data) ? i.data : {}) as Record<string, unknown>;
          if (!Object.values(data).includes(old.id)) continue;
          await tx.orderChecklistItem.update({
            where: { id: i.id },
            data: {
              data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v === old.id ? row.id : v])) as Record<string, string>,
            },
          });
        }
        await this.log(tx, user, o, "replace", `replaced ${old.fileName} with ${name} (version ${row.version}, the old one kept)`, f.step, {
          file: name,
          version: row.version,
        });
      });
    } catch (error) {
      await this.storage.delete(key).catch(() => undefined);
      throw error;
    }
    return this.list(user, orderId);
  }

  /** DELETE /orders/:id/files/:source/:fileId — asked to confirm first; noted in the history. */
  async remove(user: SessionUser, orderId: string, source: OrderFileSource, fileId: string) {
    const { f } = await this.one(user, orderId, source, fileId);
    if (!f.can.remove) throw new ForbiddenError("You cannot delete this file.");
    // A payment's proof and a receipt: removed as their own forms do (noted in the history there).
    if (source === "payment" || source === "factory_payment")
      return this.paymentFiles.remove(user, source === "payment" ? "in" : "out", fileId);
    if (source === "expense") return this.money.removeReceipt(user, fileId);
    const o = await this.orders.load(user, orderId);
    await this.prisma.tx(async (tx) => {
      await tx.attachment.update({ where: { id: fileId }, data: { deletedAt: new Date() } });
      // A paper that was only its upload is missing again; a made paper keeps its own state.
      await tx.orderDocument.updateMany({ where: { attachmentId: fileId, paperId: null, status: "ready" }, data: { status: "missing" } });
      await tx.orderDocument.updateMany({ where: { attachmentId: fileId }, data: { attachmentId: null } });
      await tx.orderChecklistItem.updateMany({ where: { attachmentId: fileId }, data: { attachmentId: null } });
      await this.log(
        tx,
        user,
        o,
        "delete",
        `deleted ${f.name} (${f.attachedTo.label})`,
        f.step,
        { file: f.name },
        { file: f.name, attachedTo: f.attachedTo.label },
      );
    });
    return { ok: true };
  }

  /* ---------------------------------------------------------------- many at once */

  /** GET /orders/:id/files.zip?files= — the chosen files (all when none), in folders by group. */
  async zip(user: SessionUser, orderId: string, refs: string[] | undefined): Promise<{ data: Uint8Array; fileName: string }> {
    const all = await this.list(user, orderId);
    const chosen = refs?.length ? all.files.filter((f) => refs.includes(f.id)) : all.files;
    if (refs?.length && chosen.length !== new Set(refs).size) throw new NotFoundError("File");
    if (!chosen.length) throw new DomainError("There are no files to download.");
    if (chosen.reduce((t, f) => t + f.size, 0) > MAX_ZIP)
      throw new DomainError("These files are over 300 MB together. Download them in smaller sets.");
    const used = new Set<string>();
    const entries: Record<string, Uint8Array> = {};
    for (const f of chosen) {
      const key = await this.keyOf(f);
      if (!key) continue;
      const chunks: Buffer[] = [];
      for await (const c of await this.storage.get(key)) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as Uint8Array));
      const folder = refs?.length && chosen.length < 2 ? "" : `${ORDER_FILE_GROUP_LABEL[f.group]}/`;
      let name = `${folder}${f.name}`;
      for (let n = 2; used.has(name.toLowerCase()); n++) name = `${folder}${f.name.replace(/(\.[^.]*)?$/, (ext) => ` (${n})${ext}`)}`;
      used.add(name.toLowerCase());
      entries[name] = new Uint8Array(Buffer.concat(chunks));
    }
    return { data: zipSync(entries, { level: 0 }), fileName: `${all.refNo} files.zip` };
  }

  private async keyOf(f: OrderFileView) {
    const db = this.prisma.db;
    if (f.source === "attachment")
      return (await db.attachment.findUnique({ where: { id: f.sourceId }, select: { storageKey: true } }))?.storageKey ?? null;
    if (f.source === "payment")
      return (await db.payment.findUnique({ where: { id: f.sourceId }, select: { fileKey: true } }))?.fileKey ?? null;
    if (f.source === "factory_payment")
      return (await db.factoryPayment.findUnique({ where: { id: f.sourceId }, select: { fileKey: true } }))?.fileKey ?? null;
    return (await db.expense.findUnique({ where: { id: f.sourceId }, select: { receiptKey: true } }))?.receiptKey ?? null;
  }

  /** POST /orders/:id/files/share — nothing is sent by the app: this only notes who shared what, how and when. */
  async share(user: SessionUser, orderId: string, input: OrderFilesShareInput) {
    const all = await this.list(user, orderId);
    const files = all.files.filter((f) => input.files.includes(f.id));
    if (files.length !== new Set(input.files).size) throw new NotFoundError("File");
    const papers = input.papers.length ? (await this.papers.list(user, orderId)).papers.filter((p) => input.papers.includes(p.key)) : [];
    if (papers.length !== new Set(input.papers).size) throw new NotFoundError("Paper");
    const o = await this.orders.load(user, orderId);
    const names = [...papers.map((p) => [p.label, p.number].filter(Boolean).join(" ")), ...files.map((f) => f.name)];
    const steps = new Set([...files.map((f) => f.step), ...papers.map((p) => p.step)].filter(Boolean));
    const step = steps.size === 1 ? ([...steps][0] as FlowStep) : "documents";
    const n = names.length;
    await this.prisma.tx((tx) =>
      this.log(
        tx,
        user,
        o,
        "share",
        `shared ${n === 1 ? names[0] : `${n} files (${names.slice(0, 3).join(", ")}${n > 3 ? ` and ${n - 3} more` : ""})`} — ${input.via === "share" ? "through the phone's share sheet" : "downloaded to send"}`,
        step,
        {
          files: files.map((f) => f.name),
          papers: papers.map((p) => p.key),
          via: input.via,
          ...(input.message ? { message: input.message } : {}),
        },
      ),
    );
    return { ok: true };
  }
}

const day = (d: Date) => d.toISOString().slice(0, 10);
