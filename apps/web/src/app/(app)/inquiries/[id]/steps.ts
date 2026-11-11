import { LOST_REASON_LABEL, type StepState } from "@kebo/shared";
import { date, plural } from "@/lib/format";
import type { DealDetail } from "@/lib/types";

/**
 * The inquiry's three steps (Needs, Factory prices, Quotation): where each
 * stands, worked out from the inquiry's stage and its quotation. No checklist:
 * each step shows a short status instead ("3 items", "3 offers", "R2 draft").
 */

export type InquiryStepKey = "needs" | "sourcing" | "quotation";

export interface InquiryStep {
  key: InquiryStepKey;
  number: number;
  label: string;
  path: string;
  state: StepState;
  stateLabel: string;
  status: string;
}

const STATE_LABEL: Record<StepState, string> = { done: "Done", now: "Now", late: "Late", todo: "Later" };

type Rev = NonNullable<DealDetail["quotation"]>["revisions"][number];
/** The revisions, newest first. */
export const revisionsOf = (d: DealDetail): Rev[] => [...(d.quotation?.revisions ?? [])].sort((a, b) => b.number - a.number);

/** "3 items, 2 parts" (or "No list" when the customer only wrote what they need). */
export function itemsLine(d: DealDetail) {
  const tops = d.items.filter((i) => !i.parentId).length;
  const parts = d.items.length - tops;
  if (!d.items.length) return "No list, a written requirement";
  return `${plural(tops, "item")}${parts ? `, ${plural(parts, "part")}` : ""}`;
}

/** The quotation's short status: "R2 draft", "R1 sent", "Accepted". */
export function quotationStatus(d: DealDetail) {
  const latest = revisionsOf(d)[0];
  if (!latest) return "Not made";
  if (latest.status === "accepted") return "Accepted";
  return `R${latest.number} ${latest.status}`;
}

/** The steps for the bar and the overview. `offers`: how many factory offers (null: not shown to this person). */
export function inquirySteps(d: DealDetail, offers: number | null): InquiryStep[] {
  const revs = revisionsOf(d);
  const quoted = revs.length > 0;
  const won = d.stage === "won" || revs.some((r) => r.status === "accepted");
  const closed = d.stage === "won" || d.stage === "lost";
  const step = (key: InquiryStepKey, number: number, label: string, path: string, state: StepState, status: string): InquiryStep => ({
    key,
    number,
    label,
    path,
    state,
    stateLabel: d.stage === "lost" && state !== "done" ? "Lost" : STATE_LABEL[state],
    status,
  });
  const sourcing: StepState = quoted || won ? "done" : closed ? "todo" : "now";
  const quotation: StepState = won ? "done" : quoted && !closed ? "now" : "todo";
  return [
    step("needs", 1, "Needs", "needs", "done", d.items.length ? plural(d.items.filter((i) => !i.parentId).length, "item") : "Written"),
    ...(offers === null ? [] : [step("sourcing", 2, "Factory prices", "sourcing", sourcing, offers ? plural(offers, "offer") : "No offers")]),
    step("quotation", 3, "Quotation", "quotation", quotation, quotationStatus(d)),
  ];
}

/** What the deal needs now, worked out from its stage (the same rules the API enforces). Shown on the Overview only. */
export function guidance(d: DealDetail): { text: string; lead?: string; href?: string; label?: string } {
  const latest = revisionsOf(d)[0];
  const order = d.orders.find((o) => o.status !== "cancelled");
  switch (d.stage) {
    case "new":
      return d.assignee
        ? { lead: "Next: get factory prices.", text: `${d.assignee.name} should start by asking factories.`, href: `/inquiries/${d.id}/sourcing`, label: "Add factory prices" }
        : { lead: "Next: assign someone.", text: "Nobody handles this yet. Assign someone (or take it) so sourcing can start." };
    case "sourcing":
      return latest?.status === "draft"
        ? { lead: `Next: send R${latest.number} to ${d.customer.name}.`, text: "Check it, then mark it as sent.", href: `/inquiries/${d.id}/quotation`, label: "Open Quotation" }
        : { lead: "Next: factory prices.", text: "Get prices from 2–3 factories, then make the quotation.", href: `/inquiries/${d.id}/sourcing`, label: "Factory prices" };
    case "quoted":
      if (latest?.status === "draft")
        return { lead: `Next: send R${latest.number} to ${d.customer.name}.`, text: "Check it, then mark it as sent.", href: `/inquiries/${d.id}/quotation`, label: "Open Quotation" };
      return {
        lead: "Waiting for the customer.",
        text: latest?.validUntil ? `R${latest.number} is valid until ${date(latest.validUntil)}: follow up, then record their answer.` : "Follow up and record their answer.",
        href: `/inquiries/${d.id}/quotation#answer`,
        label: "Record the answer",
      };
    case "won":
      return order
        ? { lead: "Won.", text: `The work continues on order ${order.refNo}.`, href: `/orders/${order.id}`, label: "Go to the order" }
        : { lead: "Won.", text: "" };
    case "lost":
      return {
        lead: "Lost.",
        text: `${d.lostReason ? `${LOST_REASON_LABEL[d.lostReason]}.` : ""}${d.allowed.reopen ? " A manager can reopen it." : ""}`.trim(),
      };
  }
}

export { plural };
