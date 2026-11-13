import { INQUIRY_STAGE_LABEL, LOST_REASON_LABEL } from "@kebo/shared";
import { date, plural } from "@/lib/format";
import type { DealDetail } from "@/lib/types";

/**
 * The inquiry in words: its status line, what to do next, and the quotation's short status ("R2 draft"),
 * worked out from the inquiry's stage, its factory offers and its quotation.
 */

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

/** What the inquiry's frame knows about its factory side (null: this person does not see factory prices). */
export interface OfferFacts {
  /** Offers entered. */
  offers: number;
  /** Factories asked, and how many of them answered. */
  asked: number;
  answered: number;
  /** Factories asked that have not answered yet. */
  waiting: { name: string; replyBy: string | null }[];
}

/**
 * The inquiry's status in words, under its title on every tab (it replaces the coloured stage line):
 * the stage, then the one fact that says how far it is ("Sourcing · 2 of 3 offers in",
 * "Quoted · waiting for the customer's answer", "Won · order SO-2026-0127").
 */
export function statusWords(d: DealDetail, f: OfferFacts | null, today: string): { text: string; tone: "action" | "ok" | "bad" | "mute" } {
  const stage = INQUIRY_STAGE_LABEL[d.stage];
  const latest = revisionsOf(d)[0];
  if (d.onHold) return { text: `On hold · ${stage.toLowerCase()}`, tone: "mute" };
  if (d.stage === "lost") return { text: `Lost${d.lostReason ? ` · ${LOST_REASON_LABEL[d.lostReason].toLowerCase()}` : ""}`, tone: "bad" };
  if (d.stage === "won") {
    const order = d.orders.find((o) => o.status !== "cancelled");
    return { text: `Won${order ? ` · order ${order.refNo}` : ""}`, tone: "ok" };
  }
  if (latest?.status === "draft") return { text: `${stage} · quotation R${latest.number} is a draft`, tone: "action" };
  if (latest?.status === "sent")
    return { text: `${stage} · ${latest.validUntil < today ? `R${latest.number} has passed its validity, no answer yet` : "waiting for the customer's answer"}`, tone: "action" };
  if (latest?.status === "rejected" || latest?.status === "expired")
    return { text: `${stage} · R${latest.number} ${latest.status === "rejected" ? "was rejected" : "expired"}`, tone: "action" };
  if (!d.assignee) return { text: `${stage} · nobody handles it yet`, tone: "action" };
  if (f) {
    if (f.asked > 0 && f.answered < f.asked) return { text: `${stage} · ${f.answered} of ${f.asked} offers in`, tone: "action" };
    if (f.offers > 0) return { text: `${stage} · ${plural(f.offers, "offer")} in`, tone: "action" };
    return { text: `${stage} · no factory asked yet`, tone: "action" };
  }
  return { text: stage, tone: "action" };
}

/** Which tab the next thing to do is on. */
export type NextTab = "overview" | "sourcing" | "quotation";

/**
 * "Do next": the one thing the inquiry needs now and the tab it is done on. Every other tab shows it with a
 * link there; that tab itself shows it with the working button. Null: nothing to do (won, lost, on hold).
 */
export function inquiryNext(d: DealDetail, f: OfferFacts | null): { tab: NextTab; title: string; meta: string; href?: string; label?: string } | null {
  if (d.onHold || d.stage === "won" || d.stage === "lost") return null;
  const base = `/inquiries/${d.id}`;
  const latest = revisionsOf(d)[0];
  const quo = d.quotation?.refNo ?? d.refNo;
  const total = latest ? `${latest.totalUpTo ? "from " : ""}${latest.currency} ${Number(latest.total).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "";
  if (latest?.status === "draft")
    return {
      tab: "quotation",
      title: `Send R${latest.number} to ${d.customer.name}`,
      meta: `${quo} · ${total} · valid until ${date(latest.validUntil)}`,
      href: `${base}/quotation`,
      label: "Open the quotation",
    };
  if (latest?.status === "sent")
    return {
      tab: "quotation",
      title: `Record ${d.customer.name}'s answer to R${latest.number}`,
      meta: `${latest.sentOn ? `Sent ${date(latest.sentOn)} · ` : ""}valid until ${date(latest.validUntil)}`,
      href: `${base}/quotation`,
      label: "Open the quotation",
    };
  if (latest?.status === "rejected" || latest?.status === "expired")
    return {
      tab: "quotation",
      title: `R${latest.number} ${latest.status === "rejected" ? "was rejected" : "expired"}: revise it, or mark the inquiry lost`,
      meta: `${quo} · a new revision starts as a copy of R${latest.number}`,
      href: `${base}/quotation`,
      label: "Open the quotation",
    };
  if (!d.assignee) return { tab: "overview", title: "Assign someone", meta: "Nobody handles this inquiry yet. Choose who under Handles it, so the prices can be asked for." };
  if (!f) return { tab: "quotation", title: "Make the quotation", meta: "Once the factory prices are in.", href: `${base}/quotation`, label: "Open Quotations" };
  if (f.offers > 0)
    return {
      tab: "quotation",
      title: "Make the quotation",
      meta: `${plural(f.offers, "offer")} in${f.waiting.length ? ` · ${f.waiting.map((w) => w.name.split(" ")[0]).join(", ")} still to answer` : ""}`,
      href: `${base}/quotation?start=1`,
      label: "Make the quotation",
    };
  if (f.waiting.length) {
    const w = f.waiting[0]!;
    return {
      tab: "sourcing",
      title: `Enter ${w.name}'s offer when it comes`,
      meta: `${plural(f.waiting.length, "factory", "factories")} asked${w.replyBy ? ` · answer due ${date(w.replyBy)}` : ""}`,
      href: `${base}/sourcing?add=1`,
      label: "Enter an offer",
    };
  }
  return { tab: "sourcing", title: "Ask factories for prices", meta: "Send the customer's list to two or three factories, then enter what they offer.", href: `${base}/sourcing`, label: "Open Factory offers" };
}

export { plural };
