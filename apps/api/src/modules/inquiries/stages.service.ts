import { Injectable } from "@nestjs/common";
import { checkManualMove, INQUIRY_STAGE_LABEL, stageAfter, type InquiryEvent, type InquiryStage, type LostReason } from "@kebo/shared";
import { GateError } from "@kebo/utils";
import type { Tx } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import type { DomainEvent } from "../../common/events/event-bus";

export interface StageSubject {
  id: string;
  refNo: string;
  title: string;
  stage: InquiryStage;
  assigneeId: string | null;
  createdById: string;
}

/**
 * The only place a deal changes stage. Automatic moves (from events in the
 * work) and manual ones (lost, start, reopen) both write the stage history and
 * the audit trail, and return the event to publish once the transaction commits.
 */
@Injectable()
export class StagesService {
  constructor(private readonly audit: AuditService) {}

  private async write(tx: Tx, subject: StageSubject, to: InquiryStage, cause: string, actorId: string | null, extra: { lostReason?: LostReason | null; note?: string | null } = {}) {
    const closing = to === "won" || to === "lost";
    await tx.inquiry.update({
      where: { id: subject.id },
      data: {
        stage: to,
        closedAt: closing ? new Date() : null,
        // A closed deal is no longer "on hold"; a reopened one starts clean.
        ...(closing ? { onHold: false } : {}),
        lostReason: to === "lost" ? (extra.lostReason ?? "other") : null,
        lostNote: to === "lost" ? (extra.note ?? null) : null,
      },
    });
    await tx.inquiryStageChange.create({
      data: { inquiryId: subject.id, fromStage: subject.stage, toStage: to, cause, lostReason: to === "lost" ? (extra.lostReason ?? "other") : null, note: extra.note ?? null, changedById: actorId },
    });
    await this.audit.record(tx, {
      userId: actorId,
      action: "stage_change",
      entityType: "inquiry",
      entityId: subject.id,
      summary: `${subject.refNo}: ${INQUIRY_STAGE_LABEL[subject.stage]} → ${INQUIRY_STAGE_LABEL[to]}${cause === "manual" ? "" : ` (${cause.replace(/_/g, " ")})`}${extra.note ? ` — ${extra.note}` : ""}`,
      oldValues: { stage: subject.stage },
      newValues: { stage: to },
    });
    const event: DomainEvent = {
      type: "inquiry.stageChanged",
      inquiryId: subject.id,
      refNo: subject.refNo,
      title: subject.title,
      from: subject.stage,
      to,
      actorId,
      notify: [subject.assigneeId, subject.createdById].filter((v): v is string => !!v),
    };
    return event;
  }

  /** Move a deal on because something happened (no-op when the event does not change its stage). */
  async after(tx: Tx, subject: StageSubject, event: InquiryEvent, actorId: string | null): Promise<DomainEvent | null> {
    const to = stageAfter(subject.stage, event);
    if (!to) return null;
    return this.write(tx, subject, to, event, actorId, event === "order_cancelled" ? { lostReason: "customer_cancelled" } : {});
  }

  /** A person's decision: mark lost (with a reason), start working, or reopen. */
  async manual(tx: Tx, subject: StageSubject, to: InquiryStage, input: { lostReason?: LostReason | null; note?: string | null }, actor: { id: string; canReopen: boolean }) {
    const problems = checkManualMove(subject.stage, to, { lostReason: input.lostReason, canReopen: actor.canReopen });
    if (problems.length) throw new GateError(problems[0], "stage_move");
    return this.write(tx, subject, to, "manual", actor.id, input);
  }
}
