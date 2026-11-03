import { Injectable } from "@nestjs/common";
import { fromDbDateOrNull, toDbDate, toDbDateOrNull, type Prisma } from "@kebo/database";
import {
  autoChecklist,
  autoTitle,
  can,
  DEFAULT_CHECKLIST,
  doNow,
  fillSplit,
  FLOW_STEP_LABEL,
  stepLine,
  itemClosed,
  orderSteps,
  stepNumber,
  stepOfKey,
  stepProgress,
  stepStates,
  STEP_STATE_LABEL,
  type AutoItem,
  checklistPaperOf,
  type ChecklistAutoInput,
  type ChecklistFacts,
  type ChecklistField,
  type ChecklistItemInput,
  type ChecklistItemUpdateInput,
  type ChecklistTemplateItem,
  type ChecklistTickInput,
  type ChecklistTool,
  type FlowStep,
  type PaperKind,
  type PaymentRoute,
  type StepState,
} from "@kebo/shared";
import { addDays, dateIn, DomainError, ForbiddenError, NotFoundError, type ISODate } from "@kebo/utils";
import { PrismaService, type Tx } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { Clock } from "../../common/time/clock.service";
import { LimitsService } from "../../common/company/limits.service";
import type { SessionUser } from "../../common/auth/session-user";
import { orderAccess } from "../orders/orders.service";
import { MoneyService } from "../money/money.service";
import { SettingsService } from "../settings/settings.service";
import { checklistFactsOf, checklistOrderInclude } from "./checklist-facts";
import { fxOf } from "../money/position";

/** The settings row that keeps the company's list choices: { hidden: auto keys, saved: the company made its own list }. */
export const CHECKLIST_SETTING = "order_checklist";

const itemInclude = {
  assignee: { select: { id: true, name: true } },
  doneBy: { select: { id: true, name: true } },
  attachment: { select: { id: true, fileName: true, deletedAt: true } },
} satisfies Prisma.OrderChecklistItemInclude;
type ItemRow = Prisma.OrderChecklistItemGetPayload<{ include: typeof itemInclude }>;

export interface ChecklistItemView {
  /** The stored row (an own item, or an automatic item's overrides); null: an automatic item with none. */
  id: string | null;
  /** The automatic item's key; null for own items. */
  key: string | null;
  auto: boolean;
  step: FlowStep;
  title: string;
  /** An own item's tool (automatic items open the form for their data). */
  tool: ChecklistTool | null;
  /** Make and Send items: the paper the app makes. */
  paper: PaperKind | null;
  fields: ChecklistField[];
  /** An own item's values by field key (files: the file's id). */
  values: Record<string, string>;
  /** What it collected, as label / value pairs (a YYYY-MM-DD value is a date). */
  data: [string, string][];
  needs: string | null;
  done: boolean;
  doneOn: ISODate | null;
  doneBy: { id: string; name: string } | null;
  skipped: boolean;
  skipReason: string | null;
  dueOn: ISODate | null;
  late: boolean;
  assignee: { id: string; name: string } | null;
  note: string | null;
  file: { id: string; name: string } | null;
  route: PaymentRoute | null;
  sort: number;
}

export interface StepView {
  key: FlowStep;
  number: number;
  label: string;
  state: StepState;
  stateLabel: string;
  done: number;
  total: number;
  line: string;
  /** The first open item, for the step card. */
  next: { title: string; dueOn: ISODate | null; late: boolean } | null;
}

/** Fields of a file type keep a file id: shown as the file's name. */
const fileFields = (fields: ChecklistField[]) => fields.filter((f) => f.type === "file").map((f) => f.key);
const asFields = (v: Prisma.JsonValue): ChecklistField[] => (Array.isArray(v) ? (v as unknown as ChecklistField[]) : []);
const asData = (v: Prisma.JsonValue): Record<string, string> =>
  v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, String(x ?? "")])) : {};

/**
 * An order's checklist: the automatic items worked out from its data, the
 * company's own items copied in once, and the items added on the order, under
 * the six steps. Rows are company rows under row-level security; changes need
 * orders.update on an order the person may see, and go into its history.
 */
@Injectable()
export class ChecklistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly limits: LimitsService,
    private readonly money: MoneyService,
    private readonly settings: SettingsService,
  ) {}

  /* ---------------------------------------------------------------- the company's choices */

  async companyChoices(db: PrismaService["db"] | Tx = this.prisma.db): Promise<{ hidden: string[]; saved: boolean }> {
    const row = await db.setting.findFirst({ where: { key: CHECKLIST_SETTING } });
    const v = (row?.value ?? {}) as { hidden?: unknown; saved?: unknown };
    return { hidden: Array.isArray(v.hidden) ? v.hidden.map(String) : [], saved: v.saved === true };
  }

  /** The company's list, or the default one while it has not made its own. */
  async companyList(db: PrismaService["db"] | Tx = this.prisma.db): Promise<ChecklistTemplateItem[]> {
    const { saved } = await this.companyChoices(db);
    if (!saved) return DEFAULT_CHECKLIST;
    const rows = await db.checklistTemplate.findMany({ orderBy: [{ step: "asc" }, { sortOrder: "asc" }] });
    return rows.map((r) => ({
      step: r.step as FlowStep,
      title: r.title,
      tool: r.tool as ChecklistTool,
      fields: asFields(r.fields),
      paper: (r.paper as PaperKind | null) ?? null,
      route: r.route,
      dueDays: r.dueDays,
      sort: r.sortOrder,
    }));
  }

  /* ---------------------------------------------------------------- reading */

  /** The order (if the person may see it) with what its checklist is worked out from. */
  private async order(user: SessionUser, id: string) {
    const o = await this.prisma.db.order.findFirst({ where: { id, ...orderAccess(user) }, include: checklistOrderInclude });
    if (!o) throw new NotFoundError("Order");
    return o;
  }

  /** Copies the company's list into the order the first time its checklist is read (once; concurrent reads wait). */
  private async seed(orderId: string) {
    await this.prisma.tx(async (tx) => {
      const [o] = await tx.$queryRaw<{ checklist_seeded_at: Date | null; created_by: string; ordered_on: Date; status: string }[]>`
        select checklist_seeded_at, created_by, ordered_on, status from orders where id = ${orderId}::uuid for update`;
      if (!o || o.checklist_seeded_at || o.status === "cancelled") return;
      const list = await this.companyList(tx);
      const orderedOn = fromDbDateOrNull(o.ordered_on)!;
      if (list.length)
        await tx.orderChecklistItem.createMany({
          data: list.map((t) => ({
            orderId,
            step: t.step,
            title: t.title,
            tool: t.tool,
            fields: (t.fields ?? []) as unknown as Prisma.InputJsonValue,
            paper: t.paper ?? null,
            route: t.route ?? null,
            dueOn: t.dueDays === null || t.dueDays === undefined ? null : toDbDate(addDays(orderedOn, t.dueDays)),
            sortOrder: t.sort,
            createdById: o.created_by,
          })),
        });
      await tx.order.update({ where: { id: orderId }, data: { checklistSeededAt: new Date() } });
    });
  }

  /** What we owe the factories on this order, for people who see factory money. */
  private async factoriesOf(user: SessionUser, orderId: string): Promise<ChecklistFacts["factories"]> {
    if (!can(user, "sourcing.manage")) return null;
    const m = await this.money.forOrder(user, orderId);
    return m.factories
      ? m.factories.rows.map((r) => ({
          name: r.factory.name,
          currency: r.currency,
          owed: r.owed,
          paid: r.paid,
          toPay: r.toPay,
          plan: m.factories!.plans
            .find((p) => p.factory.id === r.factory.id && p.currency === r.currency)
            ?.rows.map((x) => ({ label: x.label, dueRule: x.dueRule, due: x.due, open: x.open, status: x.status })),
        }))
      : null;
  }

  /**
   * GET /orders/:id/steps — the steps with their state and progress, "do this
   * now", and every item (automatic and own) in order.
   */
  async view(user: SessionUser, id: string) {
    let o = await this.order(user, id);
    if (!o.checklistSeededAt && o.status !== "cancelled") {
      await this.seed(o.id);
      o = await this.order(user, id);
    }
    const [features, choices, factories, rows] = await Promise.all([
      this.limits.features(),
      this.companyChoices(),
      this.factoriesOf(user, o.id),
      this.prisma.db.orderChecklistItem.findMany({
        where: { orderId: o.id },
        include: itemInclude,
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      }),
    ]);
    const tz = this.clock.timeZone;
    const today = this.clock.today();
    const settings = await this.settings.get();
    // Settings › Papers we use: switched-off papers leave the Documents step (unless already in).
    const facts = { ...checklistFactsOf(o, factories, tz, fxOf(settings, await this.limits.allows("expenses")), settings.reminders.lcCourierDays), papersOff: settings.papers.off };
    const steps = orderSteps(features);
    const overrides = new Map(rows.filter((r) => r.key).map((r) => [r.key!, r]));
    const late = (done: boolean, skipped: boolean, due: ISODate | null) => !done && !skipped && !!due && due < today;

    const autoView = (a: AutoItem): ChecklistItemView => {
      const r = overrides.get(a.key);
      const skipped = !a.done && !!r?.skippedAt;
      const dueOn = fromDbDateOrNull(r?.dueOn) ?? a.due ?? null;
      return {
        id: r?.id ?? null,
        key: a.key,
        auto: true,
        step: a.step,
        title: a.title,
        tool: null,
        paper: null,
        fields: [],
        values: {},
        data: a.data,
        needs: a.done || skipped ? null : a.needs,
        done: a.done,
        doneOn: a.doneOn,
        doneBy: null,
        skipped,
        skipReason: skipped ? (r?.skipReason ?? null) : null,
        dueOn,
        late: late(a.done, skipped, dueOn) || (!a.done && !skipped && !!a.warn),
        assignee: r?.assignee ?? null,
        note: r?.note ?? null,
        // A file kept with the item (loading photos, the B/L copy).
        file: r?.attachment && !r.attachment.deletedAt ? { id: r.attachment.id, name: r.attachment.fileName } : null,
        route: null,
        sort: a.sort,
      };
    };

    const ownView = (r: ItemRow): ChecklistItemView => {
      const fields = asFields(r.fields);
      const values = asData(r.data);
      const files = fileFields(fields);
      const done = !!r.doneAt;
      const skipped = !done && !!r.skippedAt;
      const dueOn = fromDbDateOrNull(r.dueOn);
      const file = r.attachment && !r.attachment.deletedAt ? { id: r.attachment.id, name: r.attachment.fileName } : null;
      const shown = fields
        .filter((f) => values[f.key])
        .map((f): [string, string] => [f.label, files.includes(f.key) ? (fileNames.get(values[f.key]!) ?? "attached") : values[f.key]!]);
      // What ticks it: the fields asked up front (the rest are optional, one tap away).
      const missing = fillSplit(fields)
        .required.filter((f) => !values[f.key])
        .map((f) => f.label.toLowerCase());
      return {
        id: r.id,
        key: null,
        auto: false,
        step: r.step as FlowStep,
        title: r.title ?? "",
        tool: r.tool as ChecklistTool,
        paper: (r.paper as PaperKind | null) ?? null,
        fields,
        values,
        data: shown,
        needs: done || skipped ? null : r.tool === "upload" && !file ? "the file" : missing.length ? missing.join(", ") : null,
        done,
        doneOn: r.doneAt ? dateIn(r.doneAt, tz) : null,
        doneBy: r.doneBy,
        skipped,
        skipReason: skipped ? r.skipReason : null,
        dueOn,
        late: late(done, skipped, dueOn),
        assignee: r.assignee,
        note: r.note,
        file,
        route: r.route,
        sort: r.sortOrder,
      };
    };

    // File fields keep the file's id: their names, from the deal's files.
    const ids = rows.flatMap((r) =>
      fileFields(asFields(r.fields))
        .map((k) => asData(r.data)[k])
        .filter((v): v is string => !!v && /^[0-9a-f-]{36}$/i.test(v)),
    );
    const fileNames = new Map(
      ids.length
        ? (
            await this.prisma.db.attachment.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, fileName: true } })
          ).map((a) => [a.id, a.fileName])
        : [],
    );

    const auto = autoChecklist(facts, features)
      .filter((a) => !choices.hidden.includes(a.key) && steps.includes(a.step))
      .map(autoView);
    const own = rows.filter((r) => !r.key && steps.includes(r.step as FlowStep) && (!r.route || r.route === o.paymentRoute)).map(ownView);
    const items = [...auto, ...own].sort(
      (a, b) => steps.indexOf(a.step) - steps.indexOf(b.step) || a.sort - b.sort || Number(b.auto) - Number(a.auto),
    );

    const byStep = steps.map((key) => ({ key, items: items.filter((i) => i.step === key) }));
    const cancelled = o.status === "cancelled";
    const states = stepStates(
      byStep.map((s) => ({ key: s.key, items: s.items.map((i) => ({ done: i.done, skipped: i.skipped, late: i.late })) })),
      cancelled,
    );
    const stepViews: StepView[] = byStep.map((s, i) => {
      const p = stepProgress(s.items);
      const open = s.items.filter((x) => !itemClosed(x));
      const next = open.find((x) => x.late) ?? open[0] ?? null;
      return {
        key: s.key,
        number: stepNumber(s.key),
        label: FLOW_STEP_LABEL[s.key],
        state: states[i]!,
        stateLabel: STEP_STATE_LABEL[states[i]!],
        done: p.done,
        total: p.total,
        line: stepLine(s.key, facts, s.items, today),
        next: next && { title: next.title, dueOn: next.dueOn, late: next.late },
      };
    });
    const now = doNow(byStep, cancelled || o.status === "closed");
    return {
      orderId: o.id,
      refNo: o.refNo,
      canEdit: can(user, "orders.update") && !cancelled,
      steps: stepViews,
      doNow: now && {
        step: now.step,
        label: FLOW_STEP_LABEL[now.step],
        id: now.item.id,
        key: now.item.key,
        title: now.item.title,
        needs: now.item.needs,
        dueOn: now.item.dueOn,
        late: now.item.late,
      },
      items,
    };
  }

  /* ---------------------------------------------------------------- changing */

  private must(user: SessionUser) {
    if (!can(user, "orders.update")) throw new ForbiddenError("You cannot change orders.");
  }

  /** The order, locked for the change, if the person may see it and it is not cancelled. */
  private async lockOrder(tx: Tx, user: SessionUser, id: string) {
    await tx.$queryRaw`select id from orders where id = ${id}::uuid for update`;
    const o = await tx.order.findFirst({
      where: { id, ...orderAccess(user) },
      select: { id: true, refNo: true, status: true, inquiryId: true, paymentRoute: true },
    });
    if (!o) throw new NotFoundError("Order");
    if (o.status === "cancelled") throw new DomainError("This order is cancelled.");
    return o;
  }

  private async item(tx: Tx, user: SessionUser, itemId: string) {
    const r = await tx.orderChecklistItem.findUnique({ where: { id: itemId } });
    if (!r) throw new NotFoundError("Checklist item");
    const o = await this.lockOrder(tx, user, r.orderId);
    return { r: await tx.orderChecklistItem.findUniqueOrThrow({ where: { id: itemId } }), o };
  }

  private own(r: { key: string | null }) {
    if (r.key) throw new DomainError("This item ticks itself from the order's data: record the data instead.");
  }

  private log(
    tx: Tx,
    user: SessionUser,
    orderId: string,
    action: string,
    summary: string,
    step: string,
    oldValues?: Record<string, unknown>,
    newValues?: Record<string, unknown>,
  ) {
    return this.audit.record(tx, {
      userId: user.id,
      action: `checklist.${action}`,
      entityType: "order",
      entityId: orderId,
      summary,
      oldValues,
      newValues: { ...newValues, step },
    });
  }

  private async checkPerson(tx: Tx, assigneeId: string | null | undefined) {
    if (assigneeId && !(await tx.user.findFirst({ where: { id: assigneeId, isActive: true, isSystem: false } })))
      throw new DomainError("Choose an active person.");
  }

  /** A file must be one of the deal's files (not a factory offer's evidence). */
  private async checkFiles(tx: Tx, inquiryId: string, ids: (string | null | undefined)[]) {
    for (const id of ids) {
      if (!id) continue;
      const a = await tx.attachment.findFirst({ where: { id, inquiryId, deletedAt: null, factoryQuoteId: null } });
      if (!a) throw new DomainError("That file is not on this deal. Upload it again.");
    }
  }

  /** Only the item's own fields are kept; file fields must be the deal's files. */
  private async cleanData(tx: Tx, inquiryId: string, fields: ChecklistField[], data: Record<string, string>) {
    const keys = new Set(fields.map((f) => f.key));
    const out = Object.fromEntries(Object.entries(data).filter(([k, v]) => keys.has(k) && v !== ""));
    await this.checkFiles(
      tx,
      inquiryId,
      fileFields(fields).map((k) => out[k]),
    );
    for (const f of fields)
      if (f.type === "date" && out[f.key] && !/^\d{4}-\d{2}-\d{2}$/.test(out[f.key]!))
        throw new DomainError(`${f.label}: use a valid date.`);
    return out;
  }

  /** POST /orders/:id/checklist — an item added on the order. */
  async add(user: SessionUser, orderId: string, input: ChecklistItemInput) {
    this.must(user);
    await this.view(user, orderId); // copies the company's list first, so it is not added on top later
    await this.prisma.tx(async (tx) => {
      const o = await this.lockOrder(tx, user, orderId);
      await this.checkPerson(tx, input.assigneeId);
      const last = await tx.orderChecklistItem.aggregate({ where: { orderId, step: input.step, key: null }, _max: { sortOrder: true } });
      const r = await tx.orderChecklistItem.create({
        data: {
          orderId,
          step: input.step,
          title: input.title,
          tool: input.tool,
          fields: input.fields as unknown as Prisma.InputJsonValue,
          paper: checklistPaperOf(input.tool, input.paper),
          route: input.route,
          dueOn: toDbDateOrNull(input.dueOn),
          assigneeId: input.assigneeId,
          note: input.note,
          sortOrder: Math.max(90, last._max.sortOrder ?? 0) + 10,
          createdById: user.id,
        },
      });
      await this.log(
        tx,
        user,
        orderId,
        "add",
        `${o.refNo}: added "${input.title}" to ${FLOW_STEP_LABEL[input.step]}${input.dueOn ? `, due ${input.dueOn}` : ""}`,
        input.step,
        undefined,
        {
          itemId: r.id,
          title: input.title,
          dueOn: input.dueOn,
        },
      );
    });
    return this.view(user, orderId);
  }

  /** PATCH /checklist/:id — an own item's details; due date, person and note on any stored row. */
  async update(user: SessionUser, itemId: string, input: ChecklistItemUpdateInput) {
    this.must(user);
    const orderId = await this.prisma.tx(async (tx) => {
      const { r, o } = await this.item(tx, user, itemId);
      const ownOnly = (["title", "tool", "fields", "paper", "route", "data", "attachmentId"] as const).filter((k) => input[k] !== undefined);
      if (r.key && ownOnly.length) this.own(r);
      await this.checkPerson(tx, input.assigneeId);
      if (input.attachmentId) await this.checkFiles(tx, o.inquiryId, [input.attachmentId]);
      const fields = input.fields ?? asFields(r.fields);
      const data: Prisma.OrderChecklistItemUncheckedUpdateInput = {};
      if (input.title !== undefined) data.title = input.title;
      if (input.tool !== undefined) data.tool = input.tool;
      if (input.fields !== undefined) data.fields = input.fields as unknown as Prisma.InputJsonValue;
      if (input.paper !== undefined || input.tool !== undefined)
        data.paper = checklistPaperOf((input.tool ?? r.tool) as ChecklistTool, input.paper !== undefined ? input.paper : (r.paper as PaperKind | null));
      if (input.route !== undefined) data.route = input.route;
      if (input.dueOn !== undefined) data.dueOn = toDbDateOrNull(input.dueOn);
      if (input.assigneeId !== undefined) data.assigneeId = input.assigneeId;
      if (input.note !== undefined) data.note = input.note;
      if (input.attachmentId !== undefined) data.attachmentId = input.attachmentId;
      if (input.data !== undefined) data.data = { ...asData(r.data), ...(await this.cleanData(tx, o.inquiryId, fields, input.data)) };
      await tx.orderChecklistItem.update({ where: { id: itemId }, data });
      const before = { title: r.title, dueOn: fromDbDateOrNull(r.dueOn), assigneeId: r.assigneeId, note: r.note, ...asData(r.data) };
      const after = { ...input, ...(input.data ?? {}), data: undefined };
      await this.log(tx, user, o.id, "edit", `${o.refNo}: changed "${r.title ?? autoTitle(r.key ?? "")}"`, r.step, before, after);
      return o.id;
    });
    return this.view(user, orderId);
  }

  /** POST /checklist/:id/tick — done, with what its form collected and the file attached. */
  async tick(user: SessionUser, itemId: string, input: ChecklistTickInput) {
    this.must(user);
    const orderId = await this.prisma.tx(async (tx) => {
      const { r, o } = await this.item(tx, user, itemId);
      this.own(r);
      const fields = asFields(r.fields);
      const values = { ...asData(r.data), ...(await this.cleanData(tx, o.inquiryId, fields, input.data)) };
      if (r.tool === "fill") {
        const missing = fillSplit(fields).required.filter((f) => !values[f.key]);
        if (missing.length) throw new DomainError(`Fill in ${missing.map((f) => f.label.toLowerCase()).join(", ")}.`);
      }
      const attachmentId = input.attachmentId ?? r.attachmentId;
      if (input.attachmentId) await this.checkFiles(tx, o.inquiryId, [input.attachmentId]);
      if (r.tool === "upload" && !attachmentId) throw new DomainError("Attach the file to tick this item.");
      await tx.orderChecklistItem.update({
        where: { id: itemId },
        data: { data: values, attachmentId, doneAt: new Date(), doneById: user.id, skippedAt: null, skipReason: null },
      });
      await this.log(tx, user, o.id, "tick", `${o.refNo}: ticked "${r.title}"`, r.step, undefined, { title: r.title, ...values });
      return o.id;
    });
    return this.view(user, orderId);
  }

  /** POST /checklist/:id/untick — open again (also un-skips). */
  async untick(user: SessionUser, itemId: string) {
    this.must(user);
    const orderId = await this.prisma.tx(async (tx) => {
      const { r, o } = await this.item(tx, user, itemId);
      this.own(r);
      if (!r.doneAt && !r.skippedAt) return o.id;
      await tx.orderChecklistItem.update({
        where: { id: itemId },
        data: { doneAt: null, doneById: null, skippedAt: null, skipReason: null },
      });
      await this.log(
        tx,
        user,
        o.id,
        "untick",
        `${o.refNo}: unticked "${r.title}"`,
        r.step,
        { done: true },
        { title: r.title, done: false },
      );
      return o.id;
    });
    return this.view(user, orderId);
  }

  /** POST /checklist/:id/skip — not needed on this order, with why. */
  async skip(user: SessionUser, itemId: string, reason: string) {
    this.must(user);
    const orderId = await this.prisma.tx(async (tx) => {
      const { r, o } = await this.item(tx, user, itemId);
      this.own(r);
      await tx.orderChecklistItem.update({
        where: { id: itemId },
        data: { skippedAt: new Date(), skipReason: reason, doneAt: null, doneById: null },
      });
      await this.log(tx, user, o.id, "skip", `${o.refNo}: skipped "${r.title}": ${reason}`, r.step, undefined, { title: r.title, reason });
      return o.id;
    });
    return this.view(user, orderId);
  }

  /** DELETE /checklist/:id — own items only (automatic ones are skipped instead). */
  async remove(user: SessionUser, itemId: string) {
    this.must(user);
    const orderId = await this.prisma.tx(async (tx) => {
      const { r, o } = await this.item(tx, user, itemId);
      if (r.key) throw new DomainError("Items that tick themselves cannot be deleted; skip them with a reason.");
      await tx.orderChecklistItem.delete({ where: { id: itemId } });
      await this.log(tx, user, o.id, "delete", `${o.refNo}: removed "${r.title}"`, r.step, { title: r.title }, undefined);
      return o.id;
    });
    return this.view(user, orderId);
  }

  /** PUT /orders/:id/checklist/auto/:key — an automatic item's due date, person, note, or skipped with a reason. */
  async auto(user: SessionUser, orderId: string, key: string, input: ChecklistAutoInput) {
    this.must(user);
    const features = await this.limits.features();
    const step = key === "closed" ? (orderSteps(features).includes("delivery") ? "delivery" : "shipping") : stepOfKey(key);
    if (!step) throw new NotFoundError("Checklist item");
    await this.prisma.tx(async (tx) => {
      const o = await this.lockOrder(tx, user, orderId);
      await this.checkPerson(tx, input.assigneeId);
      if (input.attachmentId) await this.checkFiles(tx, o.inquiryId, [input.attachmentId]);
      const before = await tx.orderChecklistItem.findUnique({ where: { orderId_key: { orderId, key } } });
      const data = {
        ...(input.attachmentId !== undefined && { attachmentId: input.attachmentId }),
        ...(input.dueOn !== undefined && { dueOn: toDbDateOrNull(input.dueOn) }),
        ...(input.assigneeId !== undefined && { assigneeId: input.assigneeId }),
        ...(input.note !== undefined && { note: input.note }),
        ...(input.skipped === true && { skippedAt: new Date(), skipReason: input.skipReason }),
        ...(input.skipped === false && { skippedAt: null, skipReason: null }),
      };
      await tx.orderChecklistItem.upsert({
        where: { orderId_key: { orderId, key } },
        create: { orderId, key, step, createdById: user.id, ...data },
        update: data,
      });
      const action = input.skipped === true ? "skip" : input.skipped === false ? "untick" : "edit";
      const name = autoTitle(key);
      const what =
        input.skipped === true
          ? `skipped "${name}": ${input.skipReason}`
          : input.skipped === false
            ? `un-skipped "${name}"`
            : input.attachmentId
              ? `kept a file with "${name}"`
              : `changed "${name}"`;
      await this.log(
        tx,
        user,
        o.id,
        action,
        `${o.refNo}: ${what}`,
        step,
        before ? { dueOn: fromDbDateOrNull(before.dueOn), assigneeId: before.assigneeId, note: before.note } : undefined,
        { key, title: name, ...input },
      );
    });
    return this.view(user, orderId);
  }

  /**
   * Open own items with a due date by today + `ahead` days, on open orders the
   * person may see (Home, reminders, my to-do). Automatic items with a due date
   * are checked against their order's data.
   */
  async dated(user: SessionUser, ahead: number, filter: { mine?: boolean } = {}) {
    const today = this.clock.today();
    const rows = await this.prisma.db.orderChecklistItem.findMany({
      where: {
        doneAt: null,
        skippedAt: null,
        dueOn: { lte: toDbDate(addDays(today, ahead)) },
        order: { status: "open", ...orderAccess(user), ...(filter.mine ? { inquiry: { assigneeId: user.id } } : {}) },
      },
      select: {
        id: true,
        key: true,
        step: true,
        title: true,
        dueOn: true,
        route: true,
        assignee: { select: { name: true } },
        order: { select: { id: true, refNo: true, paymentRoute: true, inquiry: { select: { assignee: { select: { name: true } } } } } },
      },
      orderBy: { dueOn: "asc" },
      take: 200,
    });
    const own = rows.filter((r) => !r.key && (!r.route || r.route === r.order.paymentRoute));
    // Automatic items: still open by the order's data (a few orders at most).
    const autoOrders = [...new Set(rows.filter((r) => r.key).map((r) => r.order.id))].slice(0, 20);
    const open = new Map<string, string>();
    for (const id of autoOrders) {
      const v = await this.view(user, id).catch(() => null);
      for (const i of v?.items ?? []) if (i.auto && i.key && !i.done && !i.skipped) open.set(`${id}:${i.key}`, i.title);
    }
    const auto = rows
      .filter((r) => r.key && open.has(`${r.order.id}:${r.key}`))
      .map((r) => ({ ...r, title: open.get(`${r.order.id}:${r.key}`)! }));
    return [...own, ...auto]
      .map((r) => {
        const due = fromDbDateOrNull(r.dueOn)!;
        return {
          id: r.id,
          orderId: r.order.id,
          refNo: r.order.refNo,
          step: r.step as FlowStep,
          title: r.title ?? "",
          due,
          late: due < today,
          who: r.assignee?.name ?? r.order.inquiry.assignee?.name ?? null,
        };
      })
      .sort((a, b) => a.due.localeCompare(b.due));
  }
}
