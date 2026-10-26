import { Global, Injectable, Logger, Module } from "@nestjs/common";
import type { InquiryStage, OrderStage, RevisionStatus } from "@kebo/shared";

/**
 * What happened, for anyone who wants to react (in-app notifications, emails,
 * push) without the business modules knowing about them. Published after the
 * database transaction has committed; a failing handler never breaks the action.
 */
export type DomainEvent =
  | { type: "inquiry.created"; inquiryId: string; refNo: string; title: string; channel: string; actorId: string }
  | { type: "inquiry.assigned"; inquiryId: string; refNo: string; title: string; assigneeId: string | null; actorId: string }
  | { type: "inquiry.stageChanged"; inquiryId: string; refNo: string; title: string; from: InquiryStage; to: InquiryStage; actorId: string | null; notify: string[] }
  | { type: "revision.statusChanged"; inquiryId: string; refNo: string; revision: number; status: RevisionStatus; actorId: string; notify: string[] }
  | { type: "order.created"; orderId: string; refNo: string; inquiryId: string; actorId: string; notify: string[] }
  | { type: "order.stageChanged"; orderId: string; refNo: string; from: OrderStage; to: OrderStage; actorId: string; notify: string[] }
  | { type: "payment.recorded"; orderId: string; refNo: string; amount: string; actorId: string; notify: string[] };

type Handler<E extends DomainEvent = DomainEvent> = (event: E) => Promise<void> | void;

@Injectable()
export class EventBus {
  private readonly log = new Logger("Events");
  private readonly handlers = new Map<DomainEvent["type"], Handler[]>();

  on<T extends DomainEvent["type"]>(type: T, handler: Handler<Extract<DomainEvent, { type: T }>>) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler as Handler]);
  }

  async publish(...events: DomainEvent[]) {
    for (const event of events) {
      for (const handler of this.handlers.get(event.type) ?? []) {
        try {
          await handler(event);
        } catch (error) {
          this.log.error(`handler for ${event.type} failed: ${(error as Error).message}`);
        }
      }
    }
  }
}

@Global()
@Module({ providers: [EventBus], exports: [EventBus] })
export class EventsModule {}
