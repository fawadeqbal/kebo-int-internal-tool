import { randomUUID } from "node:crypto";
import { liveFile, isCustomer } from "@kebo/database";
import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@kebo/database";
import { formatMinor, fromMinor, toMinor } from "@kebo/money";
import { can, expenseInput, paymentInput, type ExpenseInput, type PaymentInput } from "@kebo/shared";
import { ConflictError, DomainError, ForbiddenError, NotFoundError } from "@kebo/utils";
import { z } from "zod";
import { removeProof, setProof } from "../../common/storage/proofs";
import { PrismaService, type Tx } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { LimitsService } from "../../common/company/limits.service";
import { safeFileName, StorageService } from "../../common/storage/storage.service";
import type { SessionUser } from "../../common/auth/session-user";
import { orderAccess } from "../../common/auth/order-access";
import { CustomerPaymentsService } from "../treasury/customer-payments.service";
import { MoneyService } from "../money/money.service";
import { NotificationsService } from "../notifications/notifications.service";
import { inquiryAccess } from "../inquiries/inquiries.service";
import { customerAccess } from "../parties/customers.service";

export const SUBMISSION_KINDS = ["payment", "expense"] as const;
export type SubmissionKind = (typeof SUBMISSION_KINDS)[number];
export const SUBMISSION_STATUSES = ["pending", "approved", "sent_back", "withdrawn"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

/** The same files as a payment's proof or an expense's receipt. */
const EXTENSIONS = new Set(["pdf", "jpg", "jpeg", "png", "webp", "gif", "heic"]);

/** What it is, in words: "money received" / "expense". */
const KIND_WORDS: Record<SubmissionKind, string> = { payment: "money received", expense: "expense" };

/** The list for approvers; the submitter's own list. */
export const links = { approvals: "/approvals", mine: "/approvals?mine=true", order: (id: string) => `/orders/${id}` };

const include = {
  order: {
    select: {
      id: true,
      refNo: true,
      customer: { select: { id: true, name: true } },
      inquiry: { select: { assigneeId: true, createdById: true } },
    },
  },
  submittedBy: { select: { id: true, name: true } },
  decidedBy: { select: { id: true, name: true } },
  /** The photo sent with it (one live file). */
  files: liveFile,
} satisfies Prisma.MoneySubmissionInclude;
type Row = Prisma.MoneySubmissionGetPayload<{ include: typeof include }>;

/** A body that failed its check: the same 422 and field errors the usual endpoint gives. */
const parseBody = <S extends z.ZodType>(schema: S, body: unknown): z.infer<S> => schema.parse(body ?? {});

/**
 * Money received and expenses a person adds for a manager to approve (money.submit). While waiting they
 * are only a row here: no payment, expense, credit or money figure changes. Approving records it with the
 * usual code (CustomerPaymentsService.record, MoneyService.createExpense) as the approver, so plan allocation,
 * receipt numbers, credit and the history behave exactly as if the approver had recorded it; then the
 * photo moves to what was made. Who may approve: payments.record for money received, expenses.manage
 * (with the expenses feature) for expenses — the people who may record them directly.
 */
@Injectable()
export class ApprovalsService {
  private readonly log = new Logger("Approvals");

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly limits: LimitsService,
    private readonly storage: StorageService,
    private readonly payments: CustomerPaymentsService,
    private readonly money: MoneyService,
    private readonly notifications: NotificationsService,
  ) {}

  /* ---------------------------------------------------------------- who */

  /** The kinds this person approves. */
  private async kindsFor(user: SessionUser): Promise<SubmissionKind[]> {
    const out: SubmissionKind[] = [];
    if (can(user, "payments.record")) out.push("payment");
    if (can(user, "expenses.manage") && (await this.limits.allows("expenses"))) out.push("expense");
    return out;
  }

  /** Whether this person approves this one: its kind, and its order is one they see. */
  private async approves(user: SessionUser, row: { kind: string; orderId: string | null }) {
    if (!(await this.kindsFor(user)).includes(row.kind as SubmissionKind)) return false;
    if (!row.orderId) return true;
    return (await this.prisma.db.order.count({ where: { id: row.orderId, ...orderAccess(user) } })) > 0;
  }

  /** The people told one is waiting: those who approve its kind and see its order. */
  private async approverIds(kind: SubmissionKind, order: Row["order"]) {
    const permission = kind === "payment" ? "payments.record" : "expenses.manage";
    const people = await this.prisma.db.user.findMany({
      where: {
        isActive: true,
        isSystem: false,
        platformAdminId: null,
        access: { OR: [{ superAdmin: true }, { permissions: { has: permission } }] },
      },
      select: { id: true, access: { select: { superAdmin: true, permissions: true } } },
    });
    return people
      .filter(
        (u) =>
          u.access.superAdmin ||
          u.access.permissions.includes("inquiries.viewAll") ||
          !order ||
          u.id === order.inquiry.assigneeId ||
          u.id === order.inquiry.createdById,
      )
      .map((u) => u.id);
  }

  private async find(id: string, db: PrismaService["db"] | Tx = this.prisma.db): Promise<Row> {
    const row = await db.moneySubmission.findUnique({ where: { id }, include });
    if (!row) throw new NotFoundError("Submission");
    return row;
  }

  /** The submitter or an approver may see it; anyone else is told it is not there. */
  /** Whether the person may open a submission's photo: its submitter or someone who approves it. */
  async mayOpen(user: SessionUser, id: string) {
    await this.visible(user, id);
  }

  private async visible(user: SessionUser, id: string) {
    const row = await this.find(id);
    const mine = row.submittedById === user.id;
    const approver = await this.approves(user, row);
    if (!mine && !approver) throw new NotFoundError("Submission");
    return { row, mine, approver };
  }

  /** Approving and sending back: approvers only (the submitter alone is refused, others are told it is not there). */
  private async forApprover(user: SessionUser, id: string) {
    const v = await this.visible(user, id);
    if (!v.approver)
      throw new ForbiddenError(`Only someone who records ${v.row.kind === "payment" ? "payments" : "expenses"} can approve this.`);
    return v.row;
  }

  /** Changing it (photo, body, withdrawing): the submitter only. */
  private async forSubmitter(user: SessionUser, id: string, statuses: SubmissionStatus[]) {
    const v = await this.visible(user, id);
    if (!v.mine) throw new ForbiddenError("Only the person who added it can change it.");
    if (!statuses.includes(v.row.status as SubmissionStatus)) throw new ConflictError(this.closedMessage(v.row.status));
    return v.row;
  }

  private closedMessage(status: string) {
    return status === "approved"
      ? "This was already approved."
      : status === "withdrawn"
        ? "This was withdrawn."
        : status === "sent_back"
          ? "This was sent back. Change it and send it again."
          : "This is waiting for approval.";
  }

  /* ---------------------------------------------------------------- the view */

  private summary(kind: string, body: Prisma.JsonValue) {
    const b = (body ?? {}) as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) : null);
    if (kind === "payment") {
      const amount = num(b.receivedAmount) ?? num(b.amount);
      return {
        amount: amount === null ? null : fromMinor(toMinor(amount)),
        currency: ((b.receivedCurrency as string | null | undefined) ?? (b.currency as string | undefined)) || null,
        paidOn: (b.paidOn as string | undefined) ?? null,
        spentOn: null,
        method: (b.method as string | undefined) ?? null,
        reference: (b.reference as string | null | undefined) ?? null,
        category: null,
        description: null,
      };
    }
    const amount = num(b.amount);
    return {
      amount: amount === null ? null : fromMinor(toMinor(amount)),
      currency: (b.currency as string | undefined) ?? null,
      paidOn: null,
      spentOn: (b.spentOn as string | undefined) ?? null,
      method: null,
      reference: (b.reference as string | null | undefined) ?? null,
      category: (b.category as string | undefined) ?? null,
      description: (b.description as string | undefined) ?? null,
    };
  }

  /** Customers named in expense bodies without an order, for the list. */
  private async customersOf(rows: Row[]) {
    const ids = new Set<string>();
    const inquiries = new Set<string>();
    for (const r of rows) {
      if (r.order) continue;
      const b = (r.body ?? {}) as Record<string, unknown>;
      if (typeof b.customerId === "string") ids.add(b.customerId);
      else if (typeof b.inquiryId === "string") inquiries.add(b.inquiryId);
    }
    const byInquiry = new Map<string, { id: string; name: string; refNo: string }>();
    if (inquiries.size) {
      for (const i of await this.prisma.db.inquiry.findMany({
        where: { id: { in: [...inquiries] } },
        select: { id: true, refNo: true, customer: { select: { id: true, name: true } } },
      }))
        byInquiry.set(i.id, { ...i.customer, refNo: i.refNo });
    }
    const customers = new Map(
      ids.size
        ? (await this.prisma.db.party.findMany({ where: { ...isCustomer, id: { in: [...ids] } }, select: { id: true, name: true } })).map((c) => [
            c.id,
            c,
          ])
        : [],
    );
    return { customers, byInquiry };
  }

  private async views(user: SessionUser, rows: Row[]) {
    const kinds = await this.kindsFor(user);
    const { customers, byInquiry } = await this.customersOf(rows);
    return rows.map((r) => {
      const b = (r.body ?? {}) as Record<string, unknown>;
      const deal = !r.order && typeof b.inquiryId === "string" ? (byInquiry.get(b.inquiryId) ?? null) : null;
      const customer =
        r.order?.customer ??
        (typeof b.customerId === "string" ? (customers.get(b.customerId) ?? null) : deal ? { id: deal.id, name: deal.name } : null);
      const mine = r.submittedById === user.id;
      const open = r.status === "pending" || r.status === "sent_back";
      // Listed for an approver only when they see its order, so the kind is enough here.
      const approver = kinds.includes(r.kind as SubmissionKind);
      return {
        id: r.id,
        kind: r.kind as SubmissionKind,
        status: r.status as SubmissionStatus,
        /** The customer is their name (the phone app reads `order.customer` as text). */
        order: r.order ? { id: r.order.id, refNo: r.order.refNo, customer: r.order.customer.name } : null,
        customer,
        deal: deal ? { id: b.inquiryId as string, refNo: deal.refNo } : null,
        ...this.summary(r.kind, r.body),
        /** Exactly what the usual endpoint takes (POST /orders/:id/payments or POST /expenses). */
        body: b,
        submittedBy: r.submittedBy,
        submittedAt: r.submittedAt,
        hasFile: r.files.length > 0,
        file: r.files[0] ? { id: r.files[0].id, name: r.files[0].fileName, type: r.files[0].mimeType, size: r.files[0].size } : null,
        reason: r.reason,
        decidedBy: r.decidedBy,
        decidedAt: r.decidedAt,
        /** The payment or expense made when it was approved. */
        createdId: r.createdId,
        can: {
          approve: approver && r.status === "pending",
          sendBack: approver && r.status === "pending",
          edit: mine && open,
          withdraw: mine && open,
          changeFile: mine && open,
        },
      };
    });
  }

  private async view(user: SessionUser, id: string) {
    return (await this.views(user, [await this.find(id)]))[0]!;
  }

  /* ---------------------------------------------------------------- reading */

  /**
   * ?status=pending|approved|sent_back|withdrawn|all (default pending), ?mine=true (what I added; else what
   * I approve: the kinds I record, on orders I see). Pending oldest first; the rest newest first.
   */
  async list(user: SessionUser, q: { status: SubmissionStatus | "all"; mine: boolean; page: number; pageSize: number }) {
    const kinds = await this.kindsFor(user);
    if (!q.mine && !kinds.length) throw new ForbiddenError("Only someone who records payments or expenses approves them.");
    const scope: Prisma.MoneySubmissionWhereInput = q.mine
      ? { submittedById: user.id }
      : { kind: { in: kinds }, OR: [{ orderId: null }, { order: { is: orderAccess(user) } }] };
    const where: Prisma.MoneySubmissionWhereInput = { ...scope, ...(q.status === "all" ? {} : { status: q.status }) };
    const [rows, total, grouped] = await Promise.all([
      this.prisma.db.moneySubmission.findMany({
        where,
        include,
        orderBy: q.status === "pending" ? [{ submittedAt: "asc" }, { id: "asc" }] : [{ submittedAt: "desc" }, { id: "asc" }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.db.moneySubmission.count({ where }),
      this.prisma.db.moneySubmission.groupBy({ by: ["status"], where: scope, _count: { _all: true } }),
    ]);
    const counts = Object.fromEntries(SUBMISSION_STATUSES.map((s) => [s, 0])) as Record<SubmissionStatus, number> & { all: number };
    for (const g of grouped) counts[g.status as SubmissionStatus] = g._count._all;
    counts.all = SUBMISSION_STATUSES.reduce((t, s) => t + counts[s], 0);
    return {
      rows: await this.views(user, rows),
      total,
      page: q.page,
      pageSize: q.pageSize,
      counts,
      /** The kinds this person approves. */
      approves: kinds,
      canSubmit: can(user, "money.submit"),
    };
  }

  async get(user: SessionUser, id: string) {
    await this.visible(user, id);
    return this.view(user, id);
  }

  /* ---------------------------------------------------------------- the checks */

  /**
   * The body as the usual endpoint would take it, checked as it would be (without recording anything),
   * and the order it is on. Expenses: only on orders, inquiries and customers this person sees, or none.
   */
  private async checked(user: SessionUser, kind: SubmissionKind, orderId: string | null | undefined, raw: unknown) {
    if (kind === "payment") {
      if (!orderId)
        throw new z.ZodError([{ code: "custom", path: ["orderId"], message: "Choose the order the money is for", input: orderId }]);
      const body: PaymentInput = parseBody(paymentInput, raw);
      const order = await this.payments.check(user, orderId, body);
      return { body: body as Record<string, unknown>, orderId: order.id };
    }
    await this.limits.require("expenses");
    const parsed: ExpenseInput = parseBody(expenseInput, raw);
    if (orderId && parsed.orderId && orderId !== parsed.orderId)
      throw new DomainError("The expense names another order than the one it is sent on.");
    const { reason: _reason, ...body } = { ...parsed, orderId: parsed.orderId ?? orderId ?? null };
    if (!body.orderId && body.inquiryId) {
      const seen = await this.prisma.db.inquiry.count({ where: { id: body.inquiryId, deletedAt: null, ...inquiryAccess(user) } });
      if (!seen) throw new NotFoundError("Inquiry");
    }
    if (!body.orderId && body.customerId) {
      const seen = await this.prisma.db.party.count({ where: { ...isCustomer, id: body.customerId, deletedAt: null, ...customerAccess(user) } });
      if (!seen) throw new NotFoundError("Customer");
    }
    const order = await this.money.checkExpense(user, body);
    return { body: body as Record<string, unknown>, orderId: order?.id ?? null };
  }

  /** "money received SO-2026-0447 · USD 1,000.00" */
  private describe(kind: string, body: Prisma.JsonValue, refNo: string | null | undefined) {
    const s = this.summary(kind, body);
    const amount = s.amount !== null && s.currency ? formatMinor(toMinor(s.amount), s.currency) : "";
    return [KIND_WORDS[kind as SubmissionKind], refNo, amount].filter(Boolean).join(" · ");
  }

  private auditTarget(row: { id: string; kind: string; orderId: string | null; createdId?: string | null }) {
    if (row.orderId) return { entityType: "order", entityId: row.orderId };
    if (row.kind === "expense" && row.createdId) return { entityType: "expense", entityId: row.createdId };
    return { entityType: "money_submission", entityId: row.id };
  }

  /** Recorded in the order's history (expenses: kept with the expenses, for those who see them). */
  private async addHistory(
    tx: Tx,
    user: SessionUser,
    row: { id: string; kind: string; orderId: string | null; createdId?: string | null; body: Prisma.JsonValue },
    summary: string,
    extra: { reason?: string | null; newValues?: Record<string, unknown> } = {},
  ) {
    const b = (row.body ?? {}) as Record<string, unknown>;
    await this.audit.record(tx, {
      userId: user.id,
      action: row.kind === "payment" ? "payment_approval" : "expense_approval",
      ...this.auditTarget(row),
      summary,
      reason: extra.reason,
      newValues: {
        submission: row.id,
        ...(row.kind === "expense" && typeof b.step === "string" ? { step: b.step } : {}),
        ...extra.newValues,
      },
    });
  }

  private async tellApprovers(row: Row, actor: SessionUser) {
    const s = this.summary(row.kind, row.body);
    const amount = s.amount !== null && s.currency ? formatMinor(toMinor(s.amount), s.currency) : "";
    await this.notifications.notify(
      await this.approverIds(row.kind as SubmissionKind, row.order),
      {
        type: "approval.waiting",
        title: row.kind === "payment" ? `To approve: money received · ${row.order?.refNo ?? ""}` : `To approve: expense · ${amount}`,
        body: `${actor.name} added ${row.kind === "payment" ? `${amount} from ${row.order?.customer.name ?? "the customer"}` : `${s.description ?? "an expense"}${row.order ? ` on ${row.order.refNo}` : ""}`}`,
        link: links.approvals,
      },
      actor.id,
    );
  }

  /* ---------------------------------------------------------------- sending */

  /** { kind, orderId?, body } — body exactly as POST /orders/:id/payments or POST /expenses takes it. */
  async submit(user: SessionUser, input: { kind: SubmissionKind; orderId?: string | null; body: unknown }) {
    const { body, orderId } = await this.checked(user, input.kind, input.orderId, input.body);
    const id = await this.prisma.tx(async (tx) => {
      const row = await tx.moneySubmission.create({
        data: { kind: input.kind, orderId, body: body as Prisma.InputJsonValue, submittedById: user.id },
        include,
      });
      await this.addHistory(
        tx,
        user,
        row,
        `${row.order ? `${row.order.refNo}: ` : ""}${user.name} sent ${this.describe(row.kind, row.body, null)} for approval`,
        { newValues: { status: "pending" } },
      );
      return row.id;
    });
    const row = await this.find(id);
    await this.tellApprovers(row, user);
    return this.view(user, id);
  }

  /** { orderId?, body } — the submitter changes one waiting or sent back; it waits for approval again. */
  async edit(user: SessionUser, id: string, input: { orderId?: string | null; body: unknown }) {
    const before = await this.forSubmitter(user, id, ["pending", "sent_back"]);
    const { body, orderId } = await this.checked(user, before.kind as SubmissionKind, input.orderId ?? before.orderId, input.body);
    await this.prisma.tx(async (tx) => {
      const done = await tx.moneySubmission.updateMany({
        where: { id, status: { in: ["pending", "sent_back"] } },
        data: { body: body as Prisma.InputJsonValue, orderId, status: "pending", decidedById: null, decidedAt: null, reason: null },
      });
      if (!done.count) throw new ConflictError(this.closedMessage((await this.find(id, tx)).status));
      await this.addHistory(
        tx,
        user,
        { ...before, orderId, body: body as Prisma.JsonValue },
        `${user.name} changed ${this.describe(before.kind, body as Prisma.JsonValue, null)} sent for approval`,
        {
          newValues: { status: "pending" },
        },
      );
    });
    if (before.status === "sent_back") await this.tellApprovers(await this.find(id), user);
    return this.view(user, id);
  }

  /** The submitter takes it back (waiting or sent back); its photo is deleted. */
  async withdraw(user: SessionUser, id: string) {
    const row = await this.forSubmitter(user, id, ["pending", "sent_back"]);
    await this.prisma.tx(async (tx) => {
      const done = await tx.moneySubmission.updateMany({
        where: { id, status: { in: ["pending", "sent_back"] } },
        data: {
          status: "withdrawn",
          decidedById: user.id,
          decidedAt: new Date(),
        },
      });
      if (!done.count) throw new ConflictError(this.closedMessage((await this.find(id, tx)).status));
      await removeProof(tx, { submissionId: id });
      await this.addHistory(
        tx,
        user,
        row,
        `${row.order ? `${row.order.refNo}: ` : ""}${user.name} withdrew ${this.describe(row.kind, row.body, null)}`,
        { newValues: { status: "withdrawn" } },
      );
    });
    if (row.files[0]) await this.storage.delete(row.files[0].storageKey).catch(() => undefined);
    return this.view(user, id);
  }

  /* ---------------------------------------------------------------- deciding */

  /**
   * Records it with the usual code as the approver (an optional corrected body is checked the same way),
   * moves the photo to the payment or expense made, and tells the submitter. When recording refuses
   * (a domain error, a 409), the refusal is passed on and it stays waiting.
   */
  async approve(user: SessionUser, id: string, input: { body?: unknown }) {
    const row = await this.forApprover(user, id);
    if (row.status !== "pending") throw new ConflictError(this.closedMessage(row.status));
    const kind = row.kind as SubmissionKind;
    let body = row.body as Record<string, unknown>;
    let orderId = row.orderId;
    if (input.body !== undefined)
      ({ body, orderId } = await this.checked(
        user,
        kind,
        kind === "payment" ? row.orderId : ((input.body as { orderId?: string } | null)?.orderId ?? null),
        input.body,
      ));

    // Taken first, so two approvers (or an approval and a withdrawal) never both go through.
    const now = new Date();
    const taken = await this.prisma.db.moneySubmission.updateMany({
      where: { id, status: "pending" },
      data: { status: "approved", decidedById: user.id, decidedAt: now, body: body as Prisma.InputJsonValue, orderId },
    });
    if (!taken.count) throw new ConflictError(this.closedMessage((await this.find(id)).status));

    let createdId: string | null;
    try {
      if (kind === "payment") {
        const made = await this.payments.record(user, orderId!, parseBody(paymentInput, body));
        createdId = made.createdId || null;
      } else {
        const made = await this.money.createExpense(user, parseBody(expenseInput, body));
        createdId = made.id;
      }
    } catch (error) {
      // Back to waiting as it was; the refusal goes to the approver as the usual endpoint gives it.
      await this.prisma.db.moneySubmission.updateMany({
        where: { id, status: "approved", createdId: null },
        data: { status: "pending", decidedById: null, decidedAt: null, body: row.body as Prisma.InputJsonValue, orderId: row.orderId },
      });
      throw error;
    }

    try {
      await this.prisma.tx(async (tx) => {
        // The photo as it is now (no change is let in once it is taken).
        const now = await tx.moneySubmission.findUniqueOrThrow({ where: { id }, include: { files: liveFile } });
        // The photo moves to what was recorded: money in keeps it on its payment entry (createdId: the payment on
        // the order, or the entry), an expense as its receipt.
        if (now.files[0] && createdId) {
          const to =
            kind === "payment"
              ? { movementId: (await tx.allocation.findUnique({ where: { id: createdId }, select: { movementId: true } }))?.movementId ?? createdId }
              : { expenseId: createdId };
          await tx.attachment.update({ where: { id: now.files[0].id }, data: { submissionId: null, ...to } });
        }
        await tx.moneySubmission.update({ where: { id }, data: { createdId } });
        const refNo = row.order?.refNo ?? null;
        await this.addHistory(
          tx,
          user,
          { ...row, orderId, createdId, body: body as Prisma.JsonValue },
          `${refNo ? `${refNo}: ` : ""}${this.describe(kind, body as Prisma.JsonValue, null)} added by ${row.submittedBy.name}, approved by ${user.name}${now.files[0] && createdId ? ` (with ${now.files[0].fileName})` : ""}`,
          { newValues: { status: "approved", createdId, submittedBy: row.submittedBy.name, approvedBy: user.name } },
        );
      });
    } catch (error) {
      // What was approved is recorded; only the photo and the link to it are missing. Logged, not undone.
      this.log.error(`approval ${id}: recorded ${kind} ${createdId} but could not finish: ${(error as Error).message}`);
      await this.prisma.db.moneySubmission.updateMany({ where: { id, createdId: null }, data: { createdId } }).catch(() => undefined);
    }

    const after = await this.find(id);
    await this.notifications.notify(
      [row.submittedById],
      {
        type: "approval.approved",
        title: `Approved: ${this.describe(kind, body as Prisma.JsonValue, after.order?.refNo)}`,
        body: `Approved by ${user.name}. It counts now.`,
        link: after.orderId ? links.order(after.orderId) : links.mine,
      },
      user.id,
    );
    return { submission: await this.view(user, id), createdId };
  }

  /** { reason } — back to the submitter to fix; nothing is recorded. */
  async sendBack(user: SessionUser, id: string, reason: string) {
    const row = await this.forApprover(user, id);
    if (row.status !== "pending") throw new ConflictError(this.closedMessage(row.status));
    await this.prisma.tx(async (tx) => {
      const done = await tx.moneySubmission.updateMany({
        where: { id, status: "pending" },
        data: { status: "sent_back", reason, decidedById: user.id, decidedAt: new Date() },
      });
      if (!done.count) throw new ConflictError(this.closedMessage((await this.find(id, tx)).status));
      await this.addHistory(
        tx,
        user,
        row,
        `${row.order ? `${row.order.refNo}: ` : ""}${user.name} sent back ${this.describe(row.kind, row.body, null)} added by ${row.submittedBy.name}`,
        {
          reason,
          newValues: { status: "sent_back" },
        },
      );
    });
    await this.notifications.notify(
      [row.submittedById],
      {
        type: "approval.sentBack",
        title: `Sent back: ${this.describe(row.kind, row.body, row.order?.refNo)}`,
        body: reason,
        link: links.mine,
      },
      user.id,
    );
    return this.view(user, id);
  }

  /* ---------------------------------------------------------------- the photo */

  /** The bank slip or receipt (a photo or PDF); a new one replaces the one there. The submitter, while it is open. */
  async attach(user: SessionUser, id: string, file: { originalname: string; mimetype: string; size: number; buffer: Buffer }) {
    const row = await this.forSubmitter(user, id, ["pending", "sent_back"]);
    const ext = file.originalname.split(".").pop()?.toLowerCase() ?? "";
    if (!EXTENSIONS.has(ext)) throw new DomainError("The photo can be a JPG, PNG or WEBP picture, or a PDF.");
    if (file.size > this.storage.maxBytes)
      throw new DomainError(`Files can be up to ${Math.round(this.storage.maxBytes / 1024 / 1024)} MB.`);
    const name = safeFileName(file.originalname);
    const key = this.storage.keyFor(`submissions/${id}/${randomUUID()}-${name}`);
    await this.storage.put(key, file.buffer, file.mimetype);
    let old: string | null = null;
    try {
      await this.prisma.tx(async (tx) => {
        const now = await tx.moneySubmission.findUniqueOrThrow({ where: { id } });
        await tx.$queryRaw`select id from money_submissions where id = ${id}::uuid for update`;
        if (now.status !== "pending" && now.status !== "sent_back") throw new ConflictError(this.closedMessage(now.status));
        old = (await setProof(tx, { submissionId: id }, { key, name, type: file.mimetype || "application/octet-stream", size: file.size }, user.id)).replaced;
        await this.addHistory(
          tx,
          user,
          row,
          `${row.order ? `${row.order.refNo}: ` : ""}${user.name} ${old ? "replaced" : "added"} the photo of ${this.describe(row.kind, row.body, null)} sent for approval (${name})`,
        );
      });
    } catch (error) {
      await this.storage.delete(key).catch(() => undefined);
      throw error;
    }
    if (old) await this.storage.delete(old).catch(() => undefined);
    return this.view(user, id);
  }

  async removeFile(user: SessionUser, id: string) {
    const row = await this.forSubmitter(user, id, ["pending", "sent_back"]);
    const f = row.files[0];
    if (!f) return this.view(user, id);
    await this.prisma.tx(async (tx) => {
      const done = await tx.attachment.updateMany({ where: { id: f.id, deletedAt: null }, data: { deletedAt: new Date() } });
      if (!done.count) throw new ConflictError("This changed meanwhile. Reload and try again.");
      await this.addHistory(
        tx,
        user,
        row,
        `${row.order ? `${row.order.refNo}: ` : ""}${user.name} removed the photo of ${this.describe(row.kind, row.body, null)} sent for approval (${f.fileName})`,
      );
    });
    await this.storage.delete(f.storageKey).catch(() => undefined);
    return this.view(user, id);
  }
}
