import { Injectable, type OnModuleInit } from "@nestjs/common";
import { toDbDate } from "@kebo/database";
import { isOpen, QUOTE_FOLLOW_UP_DAYS, REPLY_WITHIN_DAYS } from "@kebo/shared";
import { addDays, type ISODate } from "@kebo/utils";
import { PrismaService, type Tx } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { Clock } from "../../common/time/clock.service";
import { EventBus, type DomainEvent } from "../../common/events/event-bus";
import { dueWords } from "./follow-ups.service";

type Of<T extends DomainEvent["type"]> = Extract<DomainEvent, { type: T }>;

/**
 * The follow-ups the system sets itself, so an inquiry starts with one (claude/reminders-how-it-works.md, step 2):
 *
 * - A new inquiry, once someone handles it: "Reply to the customer", a day on.
 * - A quotation sent: "Follow up quotation QUO-… R1", 3 days on; when that one is done and the customer has
 *   not answered, the next comes 7 days after it was sent, then 14 (FollowUpsService.done sets those).
 *
 * The system also closes its own: the reply when the quotation is sent, the quotation's when the customer
 * answers or a newer quotation is sent, and all of them when the inquiry is won or lost. Follow-ups people
 * made are never touched.
 */
@Injectable()
export class AutoFollowUps implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly events: EventBus,
  ) {}

  onModuleInit() {
    this.events.on("inquiry.assigned", (e) => this.assigned(e));
    this.events.on("revision.statusChanged", (e) => this.quotation(e));
    this.events.on("inquiry.stageChanged", (e) => this.stage(e));
  }

  /** Someone handles the inquiry now: its first follow-up, unless it has had one. */
  private async assigned(e: Of<"inquiry.assigned">) {
    if (!e.assigneeId) return;
    const assigneeId = e.assigneeId;
    await this.prisma.tx(async (tx) => {
      const inquiry = await tx.inquiry.findFirst({ where: { id: e.inquiryId, deletedAt: null }, select: { stage: true, customer: { select: { name: true } } } });
      if (!inquiry || !isOpen(inquiry.stage)) return;
      const had = await tx.followUp.count({ where: { inquiryId: e.inquiryId, OR: [{ doneAt: null }, { auto: "reply" }] } });
      if (had) return;
      await this.set(tx, { inquiryId: e.inquiryId, label: `${e.refNo} · ${inquiry.customer.name}`, auto: "reply", title: "Reply to the customer", dueOn: addDays(this.clock.today(), REPLY_WITHIN_DAYS), assigneeId, actorId: e.actorId });
    });
  }

  /** Sent: the reply is done, older quotation follow-ups end, and the new quotation gets its first. Answered: its follow-ups end. */
  private async quotation(e: Of<"revision.statusChanged">) {
    if (e.status !== "sent" && e.status !== "accepted" && e.status !== "rejected") return;
    await this.prisma.tx(async (tx) => {
      const inquiry = await tx.inquiry.findFirst({ where: { id: e.inquiryId, deletedAt: null }, select: { refNo: true, stage: true, assigneeId: true, customer: { select: { name: true } } } });
      if (!inquiry) return;
      await this.close(tx, e.inquiryId, e.actorId, e.status === "sent" ? `Quotation ${e.refNo} sent` : `The customer answered ${e.refNo}: ${e.status}`);
      if (e.status !== "sent" || !isOpen(inquiry.stage)) return;
      await this.set(tx, {
        inquiryId: e.inquiryId,
        label: `${inquiry.refNo} · ${inquiry.customer.name}`,
        auto: "quote1",
        title: `Follow up quotation ${e.refNo}`,
        dueOn: addDays(this.clock.today(), QUOTE_FOLLOW_UP_DAYS[0]),
        assigneeId: inquiry.assigneeId ?? e.actorId,
        actorId: e.actorId,
      });
    });
  }

  /** Won or lost: nothing is left to wait for. */
  private async stage(e: Of<"inquiry.stageChanged">) {
    if (isOpen(e.to)) return;
    await this.prisma.tx((tx) => this.close(tx, e.inquiryId, e.actorId, `Inquiry ${e.to}`));
  }

  private async set(tx: Tx, f: { inquiryId: string; label: string; auto: string; title: string; dueOn: ISODate; assigneeId: string; actorId: string }) {
    const row = await tx.followUp.create({
      data: { title: f.title, kind: "other", dueOn: toDbDate(f.dueOn), inquiryId: f.inquiryId, assigneeId: f.assigneeId, createdById: f.actorId, auto: f.auto, createdAt: this.clock.now() },
      include: { assignee: { select: { name: true } } },
    });
    await this.audit.record(tx, {
      userId: f.actorId,
      action: "follow_up.added",
      entityType: "inquiry",
      entityId: f.inquiryId,
      summary: `${f.label}: follow-up set for ${row.assignee.name} on ${dueWords(f.dueOn, null)}: ${f.title}`,
      newValues: { followUp: row.id, assignee: row.assignee.name, dueOn: f.dueOn },
    });
  }

  /** Ends the system's own open follow-ups on an inquiry, saying why. */
  private async close(tx: Tx, inquiryId: string, actorId: string | null, why: string) {
    await tx.followUp.updateMany({ where: { inquiryId, auto: { not: null }, doneAt: null }, data: { doneAt: this.clock.now(), doneById: actorId, doneNote: why } });
  }
}
