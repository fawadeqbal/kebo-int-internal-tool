import "server-only";
import type { FlowStep } from "@kebo/shared";
import { requireUser } from "@/lib/session";
import { orderDefaultsOf, orderFilesOf, orderFlowOf, orderOf, orderSectionsOf } from "@/lib/order-data";
import { optional } from "@/components/print/data";
import { today } from "@/components/orders/today";

/**
 * What every rebuilt tab of an order reads (the order without checklists): the order, its flow, where
 * each stage stands, whether files can be added, and what a window fills in from earlier orders.
 */
export async function stageData(id: string, stage?: FlowStep) {
  const me = await requireUser();
  const o = await orderOf(id);
  const [flow, sections, files, defaults] = await Promise.all([
    optional(() => orderFlowOf(id)),
    optional(() => orderSectionsOf(id)),
    optional(() => orderFilesOf(id)),
    optional(() => orderDefaultsOf(id)),
  ]);
  return {
    me,
    o,
    flow,
    base: `/orders/${o.id}`,
    now: today(),
    /** Still worked on: not cancelled and not closed. */
    open: o.status === "open",
    /** This stage's line (its word and tone), when the company uses the stage. */
    stand: stage ? (sections?.stands.find((s) => s.stage === stage) ?? null) : null,
    canFiles: !!files?.canUpload && o.status === "open",
    defaults: defaults ?? { forwarder: null, banks: null, leadTime: null, priceBasis: null },
  };
}
