import { notificationHandlers } from "@/modules/notifications/handlers";
import { emailHandlers } from "@/modules/notifications/email-handlers";

/**
 * Domain events. Modules publish what happened; other modules react
 * (notifications today, emails/WhatsApp/webhooks later) without being coupled.
 */
export type DomainEvent =
  | { type: "query.created"; queryId: string; refNo: string; title: string; actorId: string; source: string }
  | { type: "query.assigned"; queryId: string; refNo: string; title: string; assignedTo: string | null; actorId: string }
  | {
      type: "query.statusChanged";
      queryId: string;
      refNo: string;
      title: string;
      from: string;
      to: string;
      actorId: string;
      notify: string[];
    }
  | { type: "quotation.statusChanged"; quotationId: string; refNo: string; status: string; actorId: string; notify: string[] }
  | { type: "invoice.created"; invoiceId: string; invoiceNo: string; actorId: string }
  | { type: "payment.recorded"; invoiceId: string; invoiceNo: string; amount: string; actorId: string };

export type EventType = DomainEvent["type"];
export type EventHandler<T extends EventType> = (event: Extract<DomainEvent, { type: T }>) => Promise<void>;
export type HandlerMap = { [K in EventType]?: EventHandler<K>[] };

const registries: HandlerMap[] = [notificationHandlers, emailHandlers];

/** Publish after the database transaction has committed. Handler failures never break the user's action. */
export async function publish(event: DomainEvent): Promise<void> {
  for (const registry of registries) {
    const handlers = (registry[event.type] ?? []) as EventHandler<typeof event.type>[];
    for (const handler of handlers) {
      try {
        await handler(event as never);
      } catch (error) {
        console.error(`[events] handler for ${event.type} failed`, error);
      }
    }
  }
}
