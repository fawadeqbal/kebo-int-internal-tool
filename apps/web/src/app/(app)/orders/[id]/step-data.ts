import "server-only";
import { can, STEP_PATH, type FlowStep } from "@kebo/shared";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { orderDefaultsOf, orderFlowOf, orderHistoryOf, orderOf, orderStepsOf } from "@/lib/order-data";
import type { Person } from "@/lib/types";
import { optional } from "@/components/print/data";
import { today } from "@/components/orders/today";
import { checklistAction } from "../checklist-actions";

/** What every step page reads: the order, its steps and checklist, its flow, the people to assign, and the step's changes. */
export async function stepData(id: string, step: FlowStep) {
  const me = await requireUser();
  const o = await orderOf(id);
  const [steps, flow, people, changes, defaults] = await Promise.all([
    orderStepsOf(id),
    optional(() => orderFlowOf(id)),
    optional(() => api.get<Person[]>("/users/people")),
    optional(() => orderHistoryOf(id, step, 200)),
    optional(() => orderDefaultsOf(id)),
  ]);
  const base = `/orders/${o.id}`;
  const view = steps.steps.find((s) => s.key === step) ?? null;
  return {
    me,
    o,
    steps,
    flow,
    people: (people ?? []).map((p) => ({ id: p.id, name: p.name })),
    changes: changes ?? [],
    /** What the rows fill in from earlier orders and the quote. */
    defaults: defaults ?? { forwarder: null, banks: null, leadTime: null, priceBasis: null },
    base,
    now: today(),
    open: o.status !== "cancelled",
    items: steps.items.filter((i) => i.step === step),
    current: view?.state === "now" || view?.state === "late",
    run: checklistAction.bind(null, o.id),
    historyHref: `${base}/history?step=${step}`,
    listHref: can(me, "settings.manage") ? "/settings/order-checklist" : undefined,
    path: `${base}/${STEP_PATH[step]}`,
  };
}
