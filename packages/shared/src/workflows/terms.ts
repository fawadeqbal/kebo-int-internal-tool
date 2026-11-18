import { formatMinor, type Minor } from "@kebo/money";
import { addDays, type ISODate } from "@kebo/utils";
import type { BalanceTerms } from "../enums";
import { paymentSentenceOf } from "./quotation";
import type { FactoryDueRule, FactoryPlanRow, PlanDueRule, PlanPart } from "./money-route";

/**
 * Terms that travel (design "RFQ Desk — terms that travel, one thing in one place", 16 Nov 2026): the factory
 * offer and the quotation keep their terms in the same four groups, in this order and with these names —
 * Delivery · Payment · Warranty · Conditions — as facts a date can be worked out from:
 * - a lead time is days from a moment (after the advance or deposit, after the order, after the drawings);
 * - the payment is parts, like the plan an order and a factory are paid on (a share, and when it falls due);
 * - a warranty is months from a moment (shipment, delivery, the site test).
 * The words the papers print are made from these facts; an older offer or quotation keeps the words it has
 * (and its one advance %, or its deposit % and balance terms). Nothing here touches the database.
 */

export const TERMS_GROUPS = ["Delivery", "Payment", "Warranty", "Conditions"] as const;

/** Whose terms: what we promise the customer (a quotation), or what a factory gives us (its offer). */
export type TermsSide = "customer" | "factory";

const round2 = (n: number) => Math.round(n * 100) / 100;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
/** 30, 33.33: a share as it is written. */
export const percentText = (n: number) => String(round2(n));

/* ---------------------------------------------------------------- delivery: the lead time */

/** What a lead time counts from: the money that starts the work, the order itself, or the drawings approved. */
export const LEAD_FROMS = ["after_payment", "after_order", "after_drawings"] as const;
export type LeadFrom = (typeof LEAD_FROMS)[number];
export const isLeadFrom = (v: unknown): v is LeadFrom => LEAD_FROMS.includes(v as LeadFrom);

/** The moment in words: the customer pays a deposit, we pay the factory an advance. */
export const LEAD_FROM_LABEL: Record<TermsSide, Record<LeadFrom, string>> = {
  customer: { after_payment: "after the deposit", after_order: "after the order", after_drawings: "after the drawings are approved" },
  factory: { after_payment: "after the deposit", after_order: "after the order", after_drawings: "after the drawings are approved" },
};

/** "45 days after the deposit", "30 days after the advance": a lead time's words. */
export function leadWords(days: number, from: string | null | undefined, side: TermsSide): string {
  const n = Math.max(0, Math.round(days));
  return `${plural(n, "day")} ${LEAD_FROM_LABEL[side][isLeadFrom(from) ? from : "after_payment"]}`;
}

/**
 * A lead time's days and moment when its words say them plainly ("45 days after deposit", "6 weeks after
 * the order", "30-40 days": the longer one); null for anything else ("working days", "ex stock"). A lead time
 * without a moment counts from the payment, as a factory's and a quotation's usually do.
 */
export function parseLead(words: string | null | undefined): { days: number; from: LeadFrom } | null {
  const w = (words ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!w || /working|business/.test(w)) return null;
  const m = /^(?:about |approx\.? |approximately |within |around )?(\d{1,4})(?: ?(?:-|–|~|to) ?(\d{1,4}))? ?(days?|d|weeks?|wks?|months?)(?![a-z])/.exec(w);
  if (!m) return null;
  const n = Math.max(Number(m[1]), Number(m[2] ?? 0));
  const days = n * (m[3]!.startsWith("w") ? 7 : m[3]!.startsWith("m") ? 30 : 1);
  if (days > 3650) return null;
  const rest = w.slice(m[0].length);
  const from: LeadFrom = /drawing/.test(rest)
    ? "after_drawings"
    : /deposit|advance|payment|prepay|down ?pay|t\/t|receiv/.test(rest)
      ? "after_payment"
      : /order|\bpo\b|p\.o|contract|confirm/.test(rest)
        ? "after_order"
        : "after_payment";
  return { days, from };
}

/* ---------------------------------------------------------------- warranty */

/** What a warranty counts from. */
export const WARRANTY_FROMS = ["shipment", "delivery", "sat"] as const;
export type WarrantyFrom = (typeof WARRANTY_FROMS)[number];
export const isWarrantyFrom = (v: unknown): v is WarrantyFrom => WARRANTY_FROMS.includes(v as WarrantyFrom);

/** In a form. */
export const WARRANTY_FROM_LABEL: Record<WarrantyFrom, string> = { shipment: "shipment", delivery: "delivery", sat: "the site test (SAT)" };
/** On a paper. */
const WARRANTY_FROM_PRINTED: Record<WarrantyFrom, string> = { shipment: "shipment", delivery: "delivery", sat: "the site acceptance test (SAT)" };
/** About how many months after shipment each moment comes (the voyage; then installing and testing). */
export const WARRANTY_FROM_MONTHS: Record<WarrantyFrom, number> = { shipment: 0, delivery: 1, sat: 2 };

export interface WarrantyFacts {
  warrantyMonths: number | null;
  warrantyFrom: string | null;
  /** The words: what it covers ("parts and service"); an older offer's or quotation's whole sentence. */
  warranty: string | null;
}

/**
 * The warranty as a paper prints it (without "Warranty:"), a sentence: "12 months from shipment, parts not
 * labour."; an older one (no months) its words as they are; null when there is none.
 */
export function warrantyLine(w: WarrantyFacts): string | null {
  const words = w.warranty?.trim() || null;
  if (w.warrantyMonths === null || w.warrantyMonths === undefined) return words;
  const from = isWarrantyFrom(w.warrantyFrom) ? w.warrantyFrom : "shipment";
  const rest = words?.replace(/^[,;:.\s]+/, "");
  const line = `${plural(w.warrantyMonths, "month")} from ${WARRANTY_FROM_PRINTED[from]}${rest ? `, ${rest}` : ""}`;
  return /[.!?]$/.test(line) ? line : `${line}.`;
}

/**
 * A warranty's months and moment when its words say them plainly ("Warranty: 12 months from the site acceptance
 * test (SAT), parts and service" → 12, sat, "parts and service"); null for anything else.
 */
export function parseWarranty(words: string | null | undefined): { months: number; from: WarrantyFrom; rest: string | null } | null {
  const w = (words ?? "").replace(/^\s*warranty\s*[:\-–]?\s*/i, "").replace(/\s+/g, " ").trim();
  const m = /^(\d{1,3}) ?(months?|years?)(?: warranty)? (?:from|after) (?:the )?(.*)$/i.exec(w);
  if (!m) return null;
  const months = Number(m[1]) * (/^y/i.test(m[2]!) ? 12 : 1);
  if (months > 240) return null;
  const moments: [RegExp, WarrantyFrom][] = [
    [/^(?:date of )?(?:shipment|shipping|b\/?l(?: date)?|bill of lading(?: date)?)/i, "shipment"],
    [/^(?:date of )?(?:delivery|arrival)/i, "delivery"],
    [/^(?:site acceptance test|site test|sat|commissioning|installation(?: and commissioning)?|acceptance)(?: \(sat\))?/i, "sat"],
  ];
  for (const [re, from] of moments) {
    const hit = re.exec(m[3]!);
    if (!hit) continue;
    const rest = m[3]!.slice(hit[0].length).replace(/^[\s,;:.)-]+/, "").replace(/[.\s]+$/, "").trim();
    return { months, from, rest: rest || null };
  }
  return null;
}

/* ---------------------------------------------------------------- payment: parts */

/** One part of a payment: what it is, its share of the total, and when it falls due (with its days). */
export interface TermPart {
  label: string;
  percent: number;
  rule: string;
  days: number | null;
}

/** When a customer's part falls due (a quotation's; the order's plan starts from them). */
export const QUOTE_PART_RULES = ["on_order", "before_shipment", "against_bl_copy", "after_shipping", "after_arrival", "lc", "after_sat"] as const;
export type QuotePartRule = (typeof QUOTE_PART_RULES)[number];
/** When a factory's part falls due (its offer's; the factory's plan on an order starts from them). */
export const OFFER_PART_RULES = ["on_order", "on_ready", "after_shipping"] as const;
export type OfferPartRule = (typeof OFFER_PART_RULES)[number];

export const PART_RULES: Record<TermsSide, readonly string[]> = { customer: QUOTE_PART_RULES, factory: OFFER_PART_RULES };

/** The rules as a form lists them. */
export const PART_RULE_LABEL: Record<TermsSide, Record<string, string>> = {
  customer: {
    on_order: "On the order",
    before_shipment: "Before shipment",
    against_bl_copy: "Against the B/L copy",
    after_shipping: "Days after shipping",
    after_arrival: "After arrival",
    lc: "By letter of credit",
    after_sat: "After the site test (SAT)",
  },
  factory: { on_order: "When we order", on_ready: "When they say ready", after_shipping: "Days after shipping" },
};

/** The rules that take a number of days, and the days they start with (a letter of credit: 0 is at sight). */
export const PART_RULE_DAYS: Record<TermsSide, Partial<Record<string, number>>> = {
  customer: { after_shipping: 14, lc: 0, after_sat: 0 },
  factory: { after_shipping: 30 },
};

/** "before shipment", "14 days after shipment", "by letter of credit at sight": when a part falls due, in words. */
export function partWhen(p: Pick<TermPart, "rule" | "days">, side: TermsSide): string {
  const d = Math.max(Math.round(p.days ?? 0), 0);
  switch (p.rule) {
    case "on_order":
      return side === "customer" ? "with the order" : "when we order";
    case "on_ready":
      return "when ready";
    case "before_shipment":
      return "before shipment";
    case "against_bl_copy":
      return "against the B/L copy";
    case "after_shipping":
      return d ? `${plural(d, "day")} after shipment` : "on shipment";
    case "after_arrival":
      return "after arrival";
    case "lc":
      return d ? `by letter of credit, ${plural(d, "day")} after the documents` : "by letter of credit at sight";
    case "after_sat":
      return d ? `${plural(d, "day")} after the site acceptance test (SAT)` : "after the site acceptance test (SAT)";
    default:
      return "";
  }
}

/** "30% with the order · 60% before shipment · 10% after the site acceptance test (SAT)". */
export const partsWords = (parts: TermPart[], side: TermsSide) => parts.map((p) => `${percentText(p.percent)}% ${partWhen(p, side)}`).join(" · ");

const shareOf = (parts: TermPart[], rules: readonly string[]) => round2(parts.filter((p) => rules.includes(p.rule)).reduce((t, p) => t + p.percent, 0));

/** The deposit (a quotation) or the advance (an offer): the parts due with the order, added up. */
export const depositOfParts = (parts: TermPart[]) => shareOf(parts, ["on_order"]);

/**
 * The one balance rule an older reader of a quotation understands: a letter of credit when a part is paid
 * by one, else the rule of the largest part after the deposit (after the B/L copy for days after shipping,
 * after arrival for the site test).
 */
export function balanceTermsOfParts(parts: TermPart[]): BalanceTerms {
  const rest = parts.filter((p) => p.rule !== "on_order");
  if (rest.some((p) => p.rule === "lc")) return "letter_of_credit";
  const main = rest.reduce<TermPart | null>((best, p) => (!best || p.percent > best.percent ? p : best), null);
  if (main?.rule === "against_bl_copy" || main?.rule === "after_shipping") return "against_bl_copy";
  if (main?.rule === "after_arrival" || main?.rule === "after_sat") return "after_arrival";
  return "before_shipment";
}

const BALANCE_RULE: Record<BalanceTerms, QuotePartRule> = {
  before_shipment: "before_shipment",
  against_bl_copy: "against_bl_copy",
  after_arrival: "after_arrival",
  letter_of_credit: "lc",
};

/** An older quotation's payment as parts: its deposit with the order, and its balance by its one rule. */
export function quotePartsFrom(depositPercent: number, balanceTerms: BalanceTerms): TermPart[] {
  const d = Math.min(Math.max(round2(depositPercent), 0), 100);
  const parts: TermPart[] = [];
  if (d > 0) parts.push({ label: d < 100 ? `Deposit ${percentText(d)}%` : "Payment with the order", percent: d, rule: "on_order", days: null });
  if (d < 100) {
    const rule = BALANCE_RULE[balanceTerms];
    parts.push({ label: d > 0 ? `Balance ${percentText(100 - d)}%` : "Payment", percent: round2(100 - d), rule, days: rule === "lc" ? 0 : null });
  }
  return parts;
}

/** An older offer's payment as parts: its advance when we order, the rest when the goods are ready. */
export function offerPartsFrom(advancePercent: number): TermPart[] {
  const a = Math.min(Math.max(round2(advancePercent), 0), 100);
  const parts: TermPart[] = [];
  if (a > 0) parts.push({ label: a < 100 ? `Deposit ${percentText(a)}%` : "Payment when we order", percent: a, rule: "on_order", days: null });
  if (a < 100) parts.push({ label: a > 0 ? `Balance ${percentText(100 - a)}%` : "Payment", percent: round2(100 - a), rule: "on_ready", days: null });
  return parts;
}

/** Stored parts as they are (null: none kept, or nothing usable in them). */
export function storedParts(v: unknown, side: TermsSide): TermPart[] | null {
  if (!Array.isArray(v)) return null;
  const rules = PART_RULES[side];
  const parts = v.flatMap((x): TermPart[] => {
    if (!x || typeof x !== "object") return [];
    const p = x as Record<string, unknown>;
    const percent = Number(p.percent);
    if (typeof p.rule !== "string" || !rules.includes(p.rule) || !(percent > 0 && percent <= 100)) return [];
    const days = p.days === null || p.days === undefined || p.days === "" ? null : Math.max(Math.round(Number(p.days)) || 0, 0);
    return [{ label: String(p.label ?? "").trim().slice(0, 80) || PART_RULE_LABEL[side][p.rule]!, percent: round2(percent), rule: p.rule, days }];
  });
  return parts.length ? parts : null;
}

/** A quotation's payment as parts: the ones it keeps, else its deposit and balance. */
export const quotePartsOf = (r: { paymentParts: unknown; depositPercent: number | { toString(): string }; balanceTerms: BalanceTerms }) =>
  storedParts(r.paymentParts, "customer") ?? quotePartsFrom(Number(r.depositPercent), r.balanceTerms);

/** An offer's payment as parts: the ones it keeps, else its advance (or the company's usual one) and the rest when ready. */
export const offerPartsOf = (q: { paymentParts: unknown; advancePercent: number | { toString(): string } | null }, usualAdvance: number) =>
  storedParts(q.paymentParts, "factory") ?? offerPartsFrom(q.advancePercent === null ? usualAdvance : Number(q.advancePercent));

/** The parts add up to 100% (to the cent of a percent). */
export const partsAddUp = (parts: Pick<TermPart, "percent">[]) => Math.abs(parts.reduce((t, p) => t + p.percent, 0) - 100) < 0.005;

/** A deposit and one balance, as a quotation could say before it had parts. */
export function plainQuoteParts(parts: TermPart[]): boolean {
  const plain = quotePartsFrom(depositOfParts(parts), balanceTermsOfParts(parts));
  return plain.length === parts.length && plain.every((p, i) => p.rule === parts[i]!.rule && p.percent === parts[i]!.percent && (p.days ?? 0) === (parts[i]!.days ?? 0));
}

const listJoin = (bits: string[]) => (bits.length < 2 ? (bits[0] ?? "") : `${bits.slice(0, -1).join(", ")} and ${bits[bits.length - 1]}`);

/**
 * The payment sentence a quotation prints. A deposit and one balance: Kebo's sentence as it always was ("Our
 * usual payment is made by 30% Advance deposit and 70% before shipment."); more parts, each with its share:
 * "Our usual payment is made by 30% Advance deposit, 60% before shipment and 10% after the site acceptance
 * test (SAT)."
 */
export function quotePaymentSentence(parts: TermPart[]): string {
  if (plainQuoteParts(parts)) return paymentSentenceOf(depositOfParts(parts), balanceTermsOfParts(parts));
  // Inside a sentence: "30% deposit, 60% before shipment".
  const bits = parts.map((p) => `${percentText(p.percent)}% ${p.rule === "on_order" ? "deposit" : partWhen(p, "customer").replace(/^Deposit$/, "deposit")}`);
  return `Our usual payment is made by ${listJoin(bits)}.`;
}

/**
 * A factory offer's terms as facts, to check a promise against: its lead time as days from a moment, its payment
 * as parts (an older offer: its advance, or the company's usual one, and the rest when ready), its warranty as
 * months from a moment. An older offer's words are read for them where they say them plainly.
 */
export function offerTermsOf(
  q: {
    leadTime: string | null;
    leadDays: number | null;
    leadFrom: string | null;
    paymentParts: unknown;
    advancePercent: number | { toString(): string } | null;
    warranty: string | null;
    warrantyMonths: number | null;
    warrantyFrom: string | null;
  },
  usualAdvance: number,
): { leadDays: number | null; leadFrom: LeadFrom | null; parts: TermPart[]; warrantyMonths: number | null; warrantyFrom: WarrantyFrom | null } {
  const lead = q.leadDays !== null ? { days: q.leadDays, from: isLeadFrom(q.leadFrom) ? q.leadFrom : ("after_payment" as const) } : parseLead(q.leadTime);
  const warranty = q.warrantyMonths !== null ? { months: q.warrantyMonths, from: isWarrantyFrom(q.warrantyFrom) ? q.warrantyFrom : ("shipment" as const) } : parseWarranty(q.warranty);
  return {
    leadDays: lead?.days ?? null,
    leadFrom: lead?.from ?? null,
    parts: offerPartsOf(q, usualAdvance),
    warrantyMonths: warranty?.months ?? null,
    warrantyFrom: warranty?.from ?? null,
  };
}

/* ---------------------------------------------------------------- what we promise beside what the factory gives */

/** What we promise the customer in an option. */
export interface OurTerms {
  leadDays: number | null;
  leadFrom: string | null;
  parts: TermPart[];
  warrantyMonths: number | null;
  warrantyFrom: string | null;
  /** The option's total, in the quotation's currency. */
  totalMinor: Minor;
  currency: string;
}

/** What the option's factory gives us. */
export interface TheirTerms {
  factory: string;
  leadDays: number | null;
  leadFrom: string | null;
  parts: TermPart[] | null;
  warrantyMonths: number | null;
  warrantyFrom: string | null;
  /** What the option costs us at the factory, in the quotation's currency (null: not known, e.g. no rate). */
  costMinor: Minor | null;
}

/** One check of a promise against the factory: fine (ok) or something to look at, in a sentence. */
export interface TermsCheck {
  key: "lead" | "payment" | "warranty";
  ok: boolean;
  /** In a few words, for a badge ("14 days to spare", "We may pay first", "2 months not covered"). */
  word: string;
  text: string;
}

/** The lead time we promise against the factory's: the days to spare, or how many more it needs. */
export function leadCheck(ours: OurTerms, theirs: TheirTerms): TermsCheck | null {
  if (ours.leadDays === null || theirs.leadDays === null) return null;
  const given = leadWords(theirs.leadDays, theirs.leadFrom, "factory");
  const drawings = (ours.leadFrom === "after_drawings") !== (theirs.leadFrom === "after_drawings");
  if (drawings)
    return {
      key: "lead",
      ok: false,
      word: "Allow for the drawings",
      text: `${theirs.factory} gives ${given}; we promise ${leadWords(ours.leadDays, ours.leadFrom, "customer")}: allow for the drawings being approved.`,
    };
  const spare = ours.leadDays - theirs.leadDays;
  if (spare >= 0) {
    const word = spare ? `${plural(spare, "day")} to spare` : "Nothing to spare";
    return { key: "lead", ok: true, word, text: `${theirs.factory} gives ${given} · ${word.toLowerCase()}` };
  }
  return { key: "lead", ok: false, word: `${plural(-spare, "day")} short`, text: `${theirs.factory} needs ${given}: ${plural(-spare, "day")} more than we promise.` };
}

/**
 * The customer's money against the factory's, at the two moments we pay the factory: when we order (the
 * customer's deposit against the factory's advance) and before the goods leave (what the customer has paid
 * by then against what the factory wants by then). When the factory wants more, we pay the difference first.
 */
export function paymentCheck(ours: OurTerms, theirs: TheirTerms): TermsCheck | null {
  if (!theirs.parts?.length || theirs.costMinor === null || theirs.costMinor <= 0 || !ours.parts.length) return null;
  const fmt = (m: Minor) => formatMinor(m, ours.currency);
  const at = (minor: Minor, pct: number) => Math.round((minor * pct) / 100);
  const dep = depositOfParts(ours.parts);
  const adv = depositOfParts(theirs.parts);
  const depMinor = at(ours.totalMinor, dep);
  const advMinor = at(theirs.costMinor, adv);
  if (advMinor > depMinor)
    return {
      key: "payment",
      ok: false,
      word: "We may pay first",
      text: `${theirs.factory} wants ${percentText(adv)}% when we order (≈ ${fmt(advMinor)}); the customer's deposit is ${percentText(dep)}% (${fmt(depMinor)}): we pay about ${fmt(advMinor - depMinor)} of it first.`,
    };
  const ourPre = shareOf(ours.parts, ["on_order", "before_shipment"]);
  const theirPre = shareOf(theirs.parts, ["on_order", "on_ready"]);
  const ourPreMinor = at(ours.totalMinor, ourPre);
  const theirPreMinor = at(theirs.costMinor, theirPre);
  if (theirPreMinor > ourPreMinor)
    return {
      key: "payment",
      ok: false,
      word: "We may pay first",
      text: `Before the goods leave, ${theirs.factory} wants ${percentText(theirPre)}% (≈ ${fmt(theirPreMinor)}); the customer has paid ${percentText(ourPre)}% (${fmt(ourPreMinor)}) by then: we pay about ${fmt(theirPreMinor - ourPreMinor)} first, until the rest comes in.`,
    };
  return {
    key: "payment",
    ok: true,
    word: "Covered",
    text: `Covered: the customer pays ${fmt(depMinor)} with the order and ${fmt(ourPreMinor)} before shipping; ${theirs.factory} wants ${fmt(advMinor)} and ${fmt(theirPreMinor)}.`,
  };
}

/** The warranty we give against the factory's, both counted on from shipment: the months the factory does not cover. */
export function warrantyCheck(ours: OurTerms, theirs: TheirTerms): TermsCheck | null {
  if (ours.warrantyMonths === null || theirs.warrantyMonths === null) return null;
  const ourFrom = isWarrantyFrom(ours.warrantyFrom) ? ours.warrantyFrom : "shipment";
  const theirFrom = isWarrantyFrom(theirs.warrantyFrom) ? theirs.warrantyFrom : "shipment";
  const given = `${plural(theirs.warrantyMonths, "month")} from ${WARRANTY_FROM_LABEL[theirFrom]}`;
  const gap = WARRANTY_FROM_MONTHS[ourFrom] + ours.warrantyMonths - (WARRANTY_FROM_MONTHS[theirFrom] + theirs.warrantyMonths);
  if (gap <= 0) return { key: "warranty", ok: true, word: "Covered", text: `Covered: ${theirs.factory} gives ${given}.` };
  const later = WARRANTY_FROM_MONTHS[ourFrom] - WARRANTY_FROM_MONTHS[theirFrom];
  const why = later > 0 ? ` (${ourFrom === "sat" ? "the site test" : WARRANTY_FROM_LABEL[ourFrom]} is about ${plural(later, "month")} after ${WARRANTY_FROM_LABEL[theirFrom]})` : "";
  return {
    key: "warranty",
    ok: false,
    word: `${plural(gap, "month")} not covered`,
    text: `${theirs.factory} gives ${given}${why}, so the last ${plural(gap, "month")} of ours are not covered by the supplier: ask ${theirs.factory} for ${theirs.warrantyMonths + gap} months, or keep it in mind.`,
  };
}

/** Every check of one option against its factory (only those both sides say enough for). */
export const termsChecks = (ours: OurTerms, theirs: TheirTerms): TermsCheck[] =>
  [leadCheck(ours, theirs), paymentCheck(ours, theirs), warrantyCheck(ours, theirs)].filter((c): c is TermsCheck => c !== null);

/* ---------------------------------------------------------------- the factory's plan from its offer's parts */

/** An offer's parts are an advance and the rest when ready (or one of them): the company's usual factory plan. */
export function plainOfferParts(parts: Pick<TermPart, "rule">[]): boolean {
  const rules = parts.map((p) => p.rule);
  return rules.length > 0 && rules.length <= 2 && rules.every((r, i) => (r === "on_order" && i === 0) || (r === "on_ready" && i === rules.length - 1));
}

/**
 * The factory's plan on an order from its offer's parts (design "terms that travel", step 3): each part its share
 * of what we owe (the last the rest, so they add up exactly), due when we order, when they say ready, or days after
 * the goods leave. Null when the parts are the usual advance and the rest when ready — the company's default plan
 * is that, to the cent and in the same words, as before.
 */
export function offerPlan(parts: TermPart[], owedMinor: Minor): FactoryPlanRow[] | null {
  if (!parts.length || !partsAddUp(parts) || plainOfferParts(parts)) return null;
  let left = owedMinor;
  return parts.map((p, i) => {
    const amountMinor = i === parts.length - 1 ? left : Math.round((owedMinor * p.percent) / 100);
    left -= amountMinor;
    const dueRule: FactoryDueRule = p.rule === "on_order" ? "on_order" : p.rule === "on_ready" ? "on_ready" : "on_ship_plus_days";
    const when = partWhen(p, "factory");
    return {
      label: p.label.trim() || `${percentText(p.percent)}% ${when}`.replace(/^./, (c) => c.toUpperCase()),
      percent: p.percent,
      amountMinor,
      dueRule,
      dueOn: null,
      ...(dueRule === "on_ship_plus_days" ? { dueDays: Math.max(Math.round(p.days ?? 0), 0) } : {}),
    };
  });
}

/* ---------------------------------------------------------------- the order's plan from the parts */

/** One row of an order's plan made from a quotation's parts. */
export interface PartsPlanRow {
  label: string;
  amountMinor: Minor;
  /** A fixed row's date (the deposit's); null for the others (worked out from the rule). */
  dueOn: ISODate | null;
  /** The first part due with the order is the deposit; the others are parts of their own. */
  part: PlanPart | null;
  dueRule: PlanDueRule;
  dueDays: number | null;
}

/** About how long after the goods leave they arrive (a part due "after arrival"). */
export const ARRIVAL_DAYS = 30;

/**
 * The order's plan from the quotation's parts, when they are more than a deposit and one balance (design "terms
 * that travel", step 2): each part its share of the total (the last one the rest, so they add up exactly), dated
 * by its rule — the first part due with the order is the deposit, a few days after the order (as a route's
 * deposit); before shipment on the ready date; against the B/L copy some days after the goods leave; days after
 * shipping, and after arrival, after the goods leave; by a letter of credit when the papers reach their bank (or
 * days after); after the site test, days after it is done.
 */
export function partsPlan(parts: TermPart[], totalMinor: Minor, orderedOn: ISODate, depositDays: number, balanceDays: number): PartsPlanRow[] {
  let left = totalMinor;
  let deposit = false;
  return parts.map((p, i) => {
    const amountMinor = i === parts.length - 1 ? left : Math.round((totalMinor * p.percent) / 100);
    left -= amountMinor;
    const days = Math.max(p.days ?? 0, 0);
    const row = (dueRule: PlanDueRule, dueDays: number | null, dueOn: ISODate | null = null, part: PlanPart | null = null): PartsPlanRow => ({
      label: p.label,
      amountMinor,
      dueOn,
      part,
      dueRule,
      dueDays,
    });
    switch (p.rule) {
      case "on_order": {
        const first = !deposit;
        deposit = true;
        return row("fixed", null, addDays(orderedOn, depositDays), first ? "deposit" : null);
      }
      case "before_shipment":
        return row("on_ready", null);
      case "against_bl_copy":
        return row("on_ship_plus_days", Math.max(balanceDays, 0));
      case "after_shipping":
        return row("on_ship_plus_days", days);
      case "after_arrival":
        return row("on_ship_plus_days", ARRIVAL_DAYS);
      case "lc":
        return row("after_papers", days);
      default:
        return row("after_sat", days);
    }
  });
}

/**
 * An order's plan as parts of its total, for the checks against the factory (design "terms that travel": the
 * customer and the factory, side by side): the deposit is due with the order; a part due on the ready date is
 * before shipment; a dated part before shipment when it falls on or before ship by (else after shipping); the
 * others after shipping, by a letter of credit or after the site test, with their days.
 */
export function planParts(
  rows: { label: string; amountMinor: Minor; part: string | null; dueRule: string | null; dueDays: number | null; dueOn: ISODate | null }[],
  totalMinor: Minor,
  shipBy: ISODate | null,
): TermPart[] {
  if (totalMinor <= 0) return [];
  return rows
    .filter((r) => r.amountMinor > 0)
    .map((r) => {
      const percent = round2((r.amountMinor * 100) / totalMinor);
      const days = r.dueDays === null ? null : Math.max(r.dueDays, 0);
      const part = (rule: QuotePartRule, d: number | null = null): TermPart => ({ label: r.label, percent, rule, days: d });
      if (r.part === "deposit") return part("on_order");
      switch (r.dueRule) {
        case "on_ready":
          return part("before_shipment");
        case "on_ship_plus_days":
          return part("after_shipping", days ?? 0);
        case "after_papers":
          return part("lc", days ?? 0);
        case "after_sat":
          return part("after_sat", days ?? 0);
        default:
          return r.dueOn && shipBy && r.dueOn <= shipBy ? part("before_shipment") : part("after_shipping", 0);
      }
    });
}

/** When a row of a plan falls due, in a paper's words ("before shipment", "30 days after shipment"). */
function rowWhen(r: { part: string | null; dueRule: string | null; dueDays: number | null; dueOn: ISODate | null }): string {
  const d = Math.max(r.dueDays ?? 0, 0);
  switch (r.dueRule) {
    case "on_ready":
      return "before shipment";
    case "on_ship_plus_days":
      return d ? `${plural(d, "day")} after shipment` : "on shipment";
    case "after_papers":
      return d ? `by letter of credit, ${plural(d, "day")} after the documents` : "by letter of credit at sight";
    case "after_sat":
      return d ? `${plural(d, "day")} after the site acceptance test (SAT)` : "after the site acceptance test (SAT)";
    case "fixed":
      return r.part === "deposit" ? "Deposit" : r.dueOn ? `by ${r.dueOn.split("-").reverse().join("/")}` : "";
    default:
      return "later";
  }
}

/**
 * The payment sentence of an order whose plan was made from the quotation's parts: each row's share of the
 * total and when it falls due, as the plan stands now ("Our usual payment is made by 30% Advance deposit, 60%
 * before shipment and 10% after the site acceptance test (SAT).").
 */
export function planSentence(rows: { amountMinor: Minor; part: string | null; dueRule: string | null; dueDays: number | null; dueOn: ISODate | null }[], totalMinor: Minor): string {
  const pct = (m: Minor) => percentText(totalMinor > 0 ? (m * 100) / totalMinor : 0);
  const bits = rows.filter((r) => r.amountMinor > 0).map((r) => `${pct(r.amountMinor)}% ${rowWhen(r).replace(/^Deposit$/, "deposit")}`.trim());
  return `Our usual payment is made by ${listJoin(bits)}.`;
}
