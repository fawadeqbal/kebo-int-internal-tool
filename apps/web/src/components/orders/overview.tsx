import "server-only";
import type { ReactNode } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { PROFIT_LABEL } from "@kebo/money";
import { CHANNEL_LABEL, FLOW_STEP_LABEL, shipByVsLc, STEP_PATH, type FlowStep } from "@kebo/shared";
import { Badge, buttonClass, Card, CardHeader, cn } from "@kebo/ui";
import { date, money, qty, whole } from "@/lib/format";
import { countryName, isUnknownCountry } from "@/lib/countries";
import type { DealDetail } from "@/lib/types";
import type { OrderView } from "@/lib/types-orders";
import type { OrderFlow } from "@/lib/types-flow";
import type { OrderCosts, OrderMoney } from "@/lib/types-money";
import type { OrderSteps } from "@/lib/types-checklist";
import { incotermOf } from "@/app/(app)/orders/[id]/shared";
import type { ChangeLine } from "./side-panel";

/* ---------------------------------------------------------------- the facts */

type Tone = "ok" | "warn" | "bad" | "primary" | "neutral";
type JourneyState = "done" | "now" | "late" | "todo";

export interface OverviewInput {
  o: OrderView;
  steps: OrderSteps;
  flow: OrderFlow | null;
  m: OrderMoney | null;
  costs: OrderCosts | null;
  deal: DealDetail | null;
  now: string;
}

interface Stop {
  key: string;
  label: string;
  state: JourneyState;
  /** A date or where it stands ("sailed 14 Jan"). */
  top: string | null;
  /** One short fact ("ETA Karachi 06 Feb"). */
  sub: string | null;
  href: string;
}

interface Deadline {
  on: string;
  what: string;
  step: FlowStep | null;
}

const DAY = 86_400_000;
/** Whole days from a to b (YYYY-MM-DD). */
const daysFrom = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / DAY);
const pct = (part: number, of: number) => (of > 0 ? Math.max(0, Math.min(100, Math.round((part / of) * 100))) : 0);
/** "B/L" of "Bill of lading (B/L)"; the name itself when it has no short form. */
const shortPaper = (label: string) => /\(([^)]{1,6})\)$/.exec(label)?.[1] ?? label.replace(/\s*\(.*\)$/, "");
/** A line's name in a sentence: its first line, at most ~60 characters. */
const named = (d: string) => {
  const first = d.split("\n")[0]!.trim();
  return first.length > 60 ? `${first.slice(0, 57).trimEnd()}…` : first;
};
const inDays = (n: number) => (n === 0 ? "today" : n === 1 ? "tomorrow" : n > 0 ? `in ${n} days` : n === -1 ? "1 day late" : `${-n} days late`);

/** Everything the overview says, worked out from what the pages already load (missing facts are left out). */
export function overviewFacts({ o, steps, flow, m, costs, deal, now }: OverviewInput) {
  const c = o.currency;
  const year = now.slice(0, 4);
  /** "14 Jan" this year, "14 Jan 2027" another. */
  const short = (d: string | null | undefined) => (d ? (d.slice(0, 4) === year ? date(d).replace(/ \d{4}$/, "") : date(d)) : null);
  const base = `/orders/${o.id}`;
  // Shipment 1 (the primary: the first made; the API lists it first), as the papers and the checklist read it.
  const ship = flow?.shipping?.shipments[0] ?? null;
  const pod = ship?.portOfDischarge ?? o.portOfDischarge ?? null;
  const contract = flow?.payment.bankContract ?? null;
  const lc = flow?.payment.route === "letter_of_credit";
  // Our ship-by beside the LC's latest shipment date (we keep ours; warned about when it is later).
  const lcLatest = lc ? (contract?.latestShipOn ?? null) : null;
  const shipByLc = shipByVsLc(o.shipBy, lcLatest);
  const docs = flow?.documents ?? null;
  const required = docs?.set.filter((d) => d.required) ?? [];
  const missing = required.filter((d) => d.status !== "ready");
  const delivery = flow?.delivery ?? null;
  const factories = flow?.factory.factories ?? [];
  const stateOf = (k: FlowStep) => steps.steps.find((s) => s.key === k)?.state;

  const total = Number(o.money.total);
  const received = Number(o.money.received);
  // The order's own position: the same due whether or not the money data loaded (charged expenses included).
  const due = Number(o.money.due);
  const charged = Number(o.money.charged ?? 0);
  const receivedPct = pct(received, total + charged);
  const rest = m?.plan.items.find((i) => Number(i.open) > 0) ?? null;
  const restHow = rest?.how.trim() ? `by ${rest.how.trim()}${rest.when ? `, ${rest.when}` : ""}` : null;

  // The journey: the inquiry and its quotation, then the order's own steps (switched-off ones are not there).
  const accepted = deal?.quotation?.revisions.find((r) => r.status === "accepted") ?? null;
  const stops: Stop[] = [];
  if (deal) {
    stops.push({
      key: "inquiry",
      label: "Inquiry",
      state: "done",
      top: short(deal.createdAt.slice(0, 10)),
      sub: [CHANNEL_LABEL[deal.channel], deal.attachments.length ? `${deal.attachments.length} file${deal.attachments.length === 1 ? "" : "s"}` : null]
        .filter(Boolean)
        .join(" · "),
      href: `/inquiries/${deal.id}/needs`,
    });
    stops.push({
      key: "quotation",
      label: "Quotation",
      state: "done",
      top: short(accepted?.sentOn ?? o.orderedOn),
      sub: accepted ? `R${accepted.number} accepted` : "accepted",
      href: `/inquiries/${deal.id}/quotation`,
    });
  }
  for (const s of steps.steps) {
    const state: JourneyState = s.state;
    const href = `${base}/${STEP_PATH[s.key]}`;
    let label = s.label;
    let top: string | null = null;
    let sub: string | null = null;
    if (s.key === "payment") {
      top = received > 0 ? `${receivedPct}% in` : "nothing in yet";
      sub = due <= 0 ? "paid in full" : restHow ? `rest ${restHow}` : `${whole(due, c)} due`;
    } else if (s.key === "factory") {
      label = "Factory";
      top = flow?.factory.orderedOn ? short(flow.factory.orderedOn) : "not ordered yet";
      sub = [factories.map((f) => f.name).join(", ") || null, flow?.factory.orderNo ? `order ${flow.factory.orderNo}` : null].filter(Boolean).join(" · ") || null;
    } else if (s.key === "production") {
      top = o.readyOn ? `ready ${short(o.readyOn)}` : null;
      const ps = flow?.production?.steps ?? [];
      sub = ps.length
        ? `${ps.filter((p) => p.doneOn).length} of ${ps.length} steps done`
        : o.goods.lines
          ? `${o.goods.received} of ${o.goods.lines} lines in`
          : null;
    } else if (s.key === "shipping") {
      top = ship?.arrivedOn
        ? `arrived ${short(ship.arrivedOn)}`
        : ship?.departedOn
          ? `sailed ${short(ship.departedOn)}`
          : ship?.etd
            ? `leaves ${short(ship.etd)}`
            : o.shipBy
              ? `ship by ${short(o.shipBy)}`
              : null;
      sub = ship?.eta && !ship.arrivedOn ? `ETA ${pod ?? "port"} ${short(ship.eta)}` : [pod, ship?.forwarder].filter(Boolean).join(" · ") || null;
    } else if (s.key === "documents") {
      label = contract ? "Bank" : "Documents";
      top = contract?.expiresOn && s.state !== "done" ? `by ${short(contract.expiresOn)}` : docs ? `${required.length - missing.length} of ${required.length} papers` : null;
      sub = !docs ? null : missing.length === 0 ? "papers ready" : missing.length === 1 ? `${shortPaper(missing[0]!.label)} missing` : `${missing.length} papers missing`;
    } else if (s.key === "delivery") {
      top = delivery?.deliveredOn ? `delivered ${short(delivery.deliveredOn)}` : delivery?.satPlannedOn ? `~${short(delivery.satPlannedOn)}` : null;
      sub = delivery?.satDoneOn ? `SAT signed ${short(delivery.satDoneOn)}` : delivery?.satPlannedOn ? `SAT ${short(delivery.satPlannedOn)}` : `at ${o.customer.name}`;
    }
    stops.push({ key: s.key, label, state, top, sub, href });
  }

  // Deadlines still ahead (or missed), earliest first.
  const open = o.status !== "cancelled" && o.status !== "closed";
  const shipped = !!o.shippedOn || !!flow?.shipping?.shipments.some((s) => s.departedOn || s.arrivedOn);
  const raw: Deadline[] = [];
  if (open) {
    for (const i of steps.items) if (!i.done && !i.skipped && i.dueOn) raw.push({ on: i.dueOn, what: i.title, step: i.step });
    for (const i of m?.plan.items ?? []) if (Number(i.open) > 0 && i.dueOn) raw.push({ on: i.dueOn, what: `${i.label} from the customer`, step: "payment" });
    if (!shipped && o.shipBy) raw.push({ on: o.shipBy, what: "Ship by (promised)", step: "shipping" });
    if (!shipped && contract?.latestShipOn) raw.push({ on: contract.latestShipOn, what: `Latest shipment on the ${lc ? "LC" : "contract"}`, step: "shipping" });
    if (contract?.expiresOn && stateOf("documents") !== "done") raw.push({ on: contract.expiresOn, what: `${lc ? "LC" : "Contract"} expires`, step: "documents" });
    if (ship?.eta && !ship.arrivedOn) raw.push({ on: ship.eta, what: `Arrives ${pod ?? "at the port"}`, step: "shipping" });
    if (delivery?.satPlannedOn && !delivery.satDoneOn) raw.push({ on: delivery.satPlannedOn, what: "SAT at the customer's", step: "delivery" });
  }
  const seen = new Set<string>();
  const deadlines = raw
    .filter((d) => (seen.has(`${d.on}|${d.what}`) ? false : (seen.add(`${d.on}|${d.what}`), true)))
    .sort((a, b) => a.on.localeCompare(b.on));
  const nextDeadline = deadlines[0] ?? null;

  const late = steps.steps.some((s) => s.state === "late") || deadlines.some((d) => d.on < now);
  const status: { label: string; tone: Tone } =
    o.status === "cancelled"
      ? { label: "Cancelled", tone: "neutral" }
      : o.status === "closed"
        ? { label: "Closed", tone: "ok" }
        : late
          ? { label: "Late", tone: "bad" }
          : { label: "On time", tone: "ok" };
  const day = Math.max(0, daysFrom(o.orderedOn, now));
  const current = open ? (stops.find((s) => s.state === "late" || s.state === "now") ?? null) : null;
  const doneStops = stops.filter((s) => s.state === "done").length;

  // What happens next: the open checklist items, the one to do now first, then late ones, then in step order.
  const order = steps.steps.map((s) => s.key);
  const nextItems = steps.items
    .filter((i) => !i.done && !i.skipped)
    .map((i) => ({ i, now: steps.doNow ? (steps.doNow.id ? steps.doNow.id === i.id : steps.doNow.key === i.key && steps.doNow.step === i.step) : false }))
    .sort((a, b) => Number(b.now) - Number(a.now) || Number(b.i.late) - Number(a.i.late) || order.indexOf(a.i.step) - order.indexOf(b.i.step) || a.i.sort - b.i.sort)
    .slice(0, 3)
    .map(({ i }) => ({
      title: i.title,
      detail: [i.needs, i.dueOn ? `${i.late ? "was due" : "due"} ${short(i.dueOn)}` : null].filter(Boolean).join(" · ") || null,
      late: i.late,
      step: i.step,
      stepLabel: steps.steps.find((s) => s.key === i.step)?.label ?? FLOW_STEP_LABEL[i.step],
    }));

  // Keep an eye on: deadlines within 30 days (and missed ones), papers missing, profit against the quote.
  const watch: { tone: Tone; strong: string; rest: string }[] = [];
  if (open && !shipped && shipByLc?.late)
    watch.push({
      tone: "bad",
      strong: "Ship-by is later than the LC allows",
      rest: `ours ${short(o.shipBy)} · LC latest ${short(lcLatest)}: ship by the LC's date, or ask for an amendment · Shipping`,
    });
  for (const d of deadlines.filter((x) => daysFrom(now, x.on) <= 30).slice(0, 3)) {
    const n = daysFrom(now, d.on);
    watch.push({
      tone: n < 0 ? "bad" : "warn",
      strong: `${d.what} ${n < 0 ? `was due ${short(d.on)}` : inDays(n)}`,
      rest: `${n < 0 ? `${-n} day${n === -1 ? "" : "s"} ago` : `(${short(d.on)})`}${d.step ? ` · ${steps.steps.find((s) => s.key === d.step)?.label ?? FLOW_STEP_LABEL[d.step]}` : ""}`,
    });
  }
  if (open && missing.length)
    watch.push({
      tone: "warn",
      strong: `${missing.length} paper${missing.length === 1 ? "" : "s"} missing`,
      rest: `for the bank: ${missing.map((d) => shortPaper(d.label)).join(", ")}`,
    });
  const profit = costs?.profit ?? null;
  if (profit && profit.margin !== null) {
    const quoted = profit.onQuoteMargin;
    const below = Number(profit.expected) < 0 || (quoted !== null && profit.margin < quoted - 1);
    const extra = Number(costs!.totals.notPlanned) > 0 ? ` (${whole(costs!.totals.notPlanned, costs!.currency)} unplanned costs)` : "";
    watch.push({
      tone: below ? "bad" : "ok",
      strong: below ? "Profit below the quote" : "Profit on track",
      rest: `${profit.margin.toFixed(1)}%${quoted !== null ? ` vs ${quoted.toFixed(1)}% quoted` : ""}${extra}`,
    });
  }

  // The figures.
  const rows = m?.factories?.rows.length ? m.factories.rows : null;
  const fx = rows && rows.length ? rows[0]!.currency : null;
  const oneCurrency = !!rows && rows.every((r) => r.currency === fx);
  const owed = oneCurrency ? rows!.reduce((t, r) => t + Number(r.owed), 0) : 0;
  const paidFactory = oneCurrency ? rows!.reduce((t, r) => t + Number(r.paid), 0) : 0;

  return {
    c,
    now,
    lcLatest,
    shipByLc,
    short,
    ship,
    pod,
    contract,
    lc,
    missing,
    delivery,
    factories,
    factoryOrder: { no: flow?.factory.orderNo ?? null, on: flow?.factory.orderedOn ?? null },
    total,
    received,
    due,
    receivedPct,
    rest,
    restHow,
    accepted,
    stops,
    deadlines,
    nextDeadline,
    status,
    day,
    current,
    doneStops,
    nextItems,
    watch,
    profit,
    factoryRows: rows,
    factoryTotal: oneCurrency && rows!.length ? { currency: fx!, owed, paid: paidFactory, pct: pct(paidFactory, owed) } : null,
  };
}

export type OverviewFacts = ReturnType<typeof overviewFacts>;

/* ---------------------------------------------------------------- the order in one sentence + journey */

/** "Al-Shifa Pharma (Pakistan) bought … for USD 63,000 CFR Karachi. Wenzhou factory made it; it sailed … The customer paid 30% and pays the rest by LC." */
function Sentence({ o, f }: { o: OverviewInput["o"]; f: OverviewFacts }) {
  const main = o.lines.filter((l) => !l.no.includes(".") && l.type !== "charge");
  const names = main.slice(0, 2).map((l) => named(l.description));
  const where = isUnknownCountry(o.customer.country) ? "" : ` (${countryName(o.customer.country)})`;
  const madeDone = f.stops.find((s) => s.key === "production")?.state === "done";
  const parts: ReactNode[] = [];
  parts.push(
    <span key="who">
      {o.customer.name}
      {where} bought{" "}
      {names.length ? (
        <>
          <b className="font-semibold">{names.join(" and ")}</b>
          {main.length > 2 ? ` and ${main.length - 2} more` : ""}
        </>
      ) : (
        <b className="font-semibold">{o.inquiry.title || "goods"}</b>
      )}{" "}
      for{" "}
      <b className="font-semibold">
        {whole(o.money.total, f.c)} {incotermOf(o)}
      </b>
      .
    </span>,
  );
  const ship = f.ship;
  const shipping: ReactNode = ship?.arrivedOn ? (
    <>
      it <b className="font-semibold">arrived {f.pod ? `at ${f.pod} ` : ""}{f.short(ship.arrivedOn)}</b>
    </>
  ) : ship?.departedOn ? (
    <>
      it <b className="font-semibold">sailed {f.short(ship.departedOn)}{ship.vessel ? ` on ${ship.vessel}` : ""}</b>
      {ship.eta ? (
        <>
          {" "}
          and reaches {f.pod ?? "the port"} <b className="font-semibold">{f.short(ship.eta)}</b>
        </>
      ) : null}
    </>
  ) : ship?.etd ? (
    <>
      it leaves {ship.portOfLoading ? `${ship.portOfLoading} ` : ""}
      <b className="font-semibold">{f.short(ship.etd)}</b>
    </>
  ) : o.shipBy ? (
    <>
      it ships by <b className="font-semibold">{f.short(o.shipBy)}</b>
    </>
  ) : null;
  if (f.factories.length || shipping)
    parts.push(
      <span key="made">
        {" "}
        {f.factories.length ? (
          <>
            {f.factories.map((x) => x.name).join(" and ")} {madeDone ? "made" : "makes"} it
            {shipping ? "; " : "."}
          </>
        ) : null}
        {shipping}
        {shipping ? "." : null}
      </span>,
    );
  parts.push(
    <span key="paid">
      {" "}
      {f.due <= 0 ? (
        <>The customer paid in full.</>
      ) : f.received <= 0 ? (
        <>
          Nothing is received yet{f.restHow ? <>; they pay <b className="font-semibold">{f.restHow}</b></> : null}.
        </>
      ) : (
        <>
          The customer paid {f.receivedPct}%{f.restHow ? <> and pays the rest <b className="font-semibold">{f.restHow}</b></> : null}.
        </>
      )}
    </span>,
  );
  return <p className="text-[17px] leading-relaxed text-text">{parts}</p>;
}

function Dot({ state, n }: { state: JourneyState; n: number }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold",
        state === "done"
          ? "bg-ok text-white"
          : state === "now"
            ? "bg-primary text-primary-fg ring-4 ring-primary-soft"
            : state === "late"
              ? "bg-bad text-white ring-4 ring-bad-soft"
              : "border-[1.5px] border-line-strong bg-surface text-muted",
      )}
    >
      {state === "done" ? <Check className="size-3.5" strokeWidth={3} /> : n}
    </span>
  );
}

const STATE_WORD: Record<JourneyState, string> = { done: "done", now: "now", late: "late", todo: "later" };

/** The order in one sentence, On time / Late and its day, then the journey (each stop opens its page). */
export function OrderStory({ o, f }: { o: OverviewInput["o"]; f: OverviewFacts }) {
  return (
    <section aria-label="The order in one sentence" className="flex flex-col gap-5 rounded-xl border border-line bg-surface p-4 shadow-card sm:px-[22px] sm:py-5">
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
        <div className="max-w-[820px] min-w-0">
          <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase">The order in one sentence</p>
          <Sentence o={o} f={f} />
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end sm:gap-1.5">
          <Badge tone={f.status.tone} dot>
            {f.status.label}
          </Badge>
          <span className="text-xs text-text-2">Day {f.day} since the order</span>
        </div>
      </div>
      {/* Wide: the stops in a row joined by a line. Phone: one under the other. */}
      <ol aria-label="The order's journey" className="hidden gap-2 md:flex">
        {f.stops.map((s, i) => (
          <li key={s.key} className="min-w-0 flex-1">
            <Link href={s.href} className="group flex flex-col gap-1.5">
              <span className="flex items-center">
                <Dot state={s.state} n={i + 1} />
                {i < f.stops.length - 1 && <span aria-hidden className={cn("ml-1.5 h-[3px] flex-1 rounded-full", s.state === "done" ? "bg-ok" : "bg-line")} />}
              </span>
              <b
                className={cn(
                  "text-[13px] font-semibold group-hover:underline",
                  s.state === "now" ? "text-primary" : s.state === "late" ? "text-bad" : "text-text",
                )}
              >
                {s.label}
                <span className="sr-only">: {STATE_WORD[s.state]}</span>
              </b>
              {s.top && <span className="text-xs text-text-2 tabular">{s.top}</span>}
              {s.sub && <span className="text-xs text-muted [overflow-wrap:anywhere]">{s.sub}</span>}
            </Link>
          </li>
        ))}
      </ol>
      <ol aria-label="The order's journey" className="flex flex-col md:hidden">
        {f.stops.map((s, i) => (
          <li key={s.key} className="relative pb-3 last:pb-0">
            {i < f.stops.length - 1 && (
              <span aria-hidden className={cn("absolute top-8 bottom-1 left-[13px] w-[2px] rounded-full", s.state === "done" ? "bg-ok" : "bg-line")} />
            )}
            <Link href={s.href} className="grid grid-cols-[28px_minmax(0,1fr)] items-start gap-3">
              <Dot state={s.state} n={i + 1} />
              <span className="min-w-0 pt-1">
                <b className={cn("block text-sm font-semibold", s.state === "now" ? "text-primary" : s.state === "late" ? "text-bad" : "text-text")}>
                  {s.label}
                  {(s.state === "now" || s.state === "late") && <span className="ml-1.5 text-xs font-normal">· {STATE_WORD[s.state]}</span>}
                </b>
                <span className="block text-xs text-text-2">{[s.top, s.sub].filter(Boolean).join(" · ")}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ---------------------------------------------------------------- six figures */

const TONE_TEXT: Record<Tone, string> = { ok: "text-ok", warn: "text-warn", bad: "text-bad", primary: "text-primary", neutral: "text-text" };
const TONE_BG: Record<Tone, string> = { ok: "bg-ok", warn: "bg-warn", bad: "bg-bad", primary: "bg-primary", neutral: "bg-text-2" };

function Bar({ value, tone, className }: { value: number; tone: Tone; className?: string }) {
  return (
    <span className={cn("block h-1.5 overflow-hidden rounded-full bg-surface-3", className)} aria-hidden>
      <span className={cn("block h-full rounded-full", TONE_BG[tone])} style={{ width: `${value}%` }} />
    </span>
  );
}

interface Figure {
  key: string;
  label: string;
  value: string;
  tone: Tone;
  bar?: number;
  sub: string | null;
}

/** The six figures a manager asks for first, in one card: 6 across, 3×2 on a tablet, 2×3 on a phone. */
export function OrderFigures({ o, f, steps }: { o: OverviewInput["o"]; f: OverviewFacts; steps: OrderSteps }) {
  const c = f.c;
  const figures: Figure[] = [];
  figures.push({ key: "value", label: "Order value", value: whole(o.money.total, c), tone: "neutral", sub: incotermOf(o) });
  figures.push({
    key: "received",
    label: "Received",
    value: `${f.receivedPct}%`,
    tone: f.due <= 0 ? "ok" : f.received > 0 ? "ok" : "warn",
    bar: f.receivedPct,
    sub: f.due <= 0 ? `${whole(f.received, c)} · paid in full` : `${whole(f.received, c)} · ${whole(f.due, c)} left${f.restHow ? ` ${f.restHow}` : ""}`,
  });
  if (f.factoryRows) {
    const t = f.factoryTotal;
    const names = f.factoryRows.map((r) => r.factory.name);
    figures.push({
      key: "factory",
      label: "Paid to the factory",
      value: t ? `${t.pct}%` : `${f.factoryRows.length} factories`,
      tone: t && t.pct >= 100 ? "ok" : t && t.paid > 0 ? "ok" : "neutral",
      bar: t?.pct,
      sub: t ? `${whole(t.paid, t.currency)} of ${whole(t.owed, t.currency)} to ${names.length === 1 ? names[0] : `${names.length} factories`}` : null,
    });
  }
  if (f.profit) {
    figures.push({
      key: "profit",
      label: PROFIT_LABEL.expected,
      value: whole(f.profit.expected, c),
      tone: Number(f.profit.expected) < 0 ? "bad" : "neutral",
      sub: [f.profit.margin !== null ? `${f.profit.margin.toFixed(1)}%` : null, f.profit.onQuoteMargin !== null ? `quoted at ${f.profit.onQuoteMargin.toFixed(1)}%` : null]
        .filter(Boolean)
        .join(" · ") || null,
    });
  }
  const d = f.nextDeadline;
  const n = d ? daysFrom(f.now, d.on) : 0;
  figures.push({
    key: "deadline",
    label: "Next deadline",
    value: d ? f.short(d.on)! : "None",
    tone: !d ? "neutral" : n < 0 ? "bad" : n <= 14 ? "warn" : "neutral",
    sub: d ? `${d.what} · ${inDays(n)}` : "nothing dated ahead",
  });
  const total = f.stops.length;
  figures.push({
    key: "progress",
    label: "Progress",
    value: `${f.doneStops} of ${total}`,
    tone: f.status.tone === "bad" ? "bad" : "primary",
    bar: pct(f.doneStops, total),
    sub: [f.current ? `${f.current.label} now` : steps.steps.every((s) => s.state === "done") ? "every step done" : null, f.status.label.toLowerCase(), `day ${f.day}`]
      .filter(Boolean)
      .join(" · "),
  });
  const cols = figures.length;
  return (
    <section aria-label="The order in figures" className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
      <dl
        className={cn(
          "-mr-px -mb-px grid grid-cols-2 sm:grid-cols-3",
          cols === 6 ? "xl:grid-cols-6" : cols === 5 ? "xl:grid-cols-5" : "xl:grid-cols-4",
        )}
      >
        {figures.map((x) => (
          <div key={x.key} className="flex min-w-0 flex-col gap-0.5 border-r border-b border-line px-4 py-3.5">
            <dt className="text-xs text-text-2">{x.label}</dt>
            <dd className="contents">
              <b className={cn("text-xl leading-7 font-semibold tabular", TONE_TEXT[x.tone])}>{x.value}</b>
              {x.bar !== undefined && <Bar value={x.bar} tone={x.tone === "neutral" ? "primary" : x.tone} className="mt-1" />}
              {x.sub && <span className="text-xs text-muted [overflow-wrap:anywhere]">{x.sub}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/* ---------------------------------------------------------------- what happens next · keep an eye on */

export function WhatNext({ f, base }: { f: OverviewFacts; base: string }) {
  const stepsShown = [...new Set(f.nextItems.map((i) => i.step))].slice(0, 2);
  return (
    <section aria-labelledby="next-title" className="flex flex-col gap-2.5 rounded-xl border border-primary bg-surface p-4 shadow-card ring-1 ring-primary sm:px-[18px]">
      <h2 id="next-title" className="text-sm font-semibold">
        What happens next
      </h2>
      {f.nextItems.length ? (
        <>
          <ol className="flex list-decimal flex-col gap-2 pl-[18px] text-sm">
            {f.nextItems.map((i, k) => (
              <li key={k}>
                <b className={cn("font-semibold", i.late && "text-bad")}>{i.title}</b>{" "}
                <span className="text-xs text-text-2">
                  {i.detail ? `· ${i.detail} ` : ""}· {i.stepLabel}
                </span>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-2">
            {stepsShown.map((s, k) => (
              <Link key={s} href={`${base}/${STEP_PATH[s]}`} className={buttonClass(k === 0 ? "secondary" : "ghost", "sm")}>
                Open {f.nextItems.find((i) => i.step === s)!.stepLabel}
              </Link>
            ))}
          </div>
        </>
      ) : (
        <p className="text-sm text-text-2">Nothing left open on the checklist.</p>
      )}
    </section>
  );
}

const WATCH_DOT: Record<Tone, string> = { ok: "bg-ok", warn: "bg-warn", bad: "bg-bad", primary: "bg-primary", neutral: "bg-muted" };

export function KeepAnEye({ f }: { f: OverviewFacts }) {
  return (
    <Card>
      <CardHeader title="Keep an eye on" />
      <div className="px-4 py-3.5">
        {f.watch.length ? (
          <ul className="flex flex-col gap-2">
            {f.watch.map((w, k) => (
              <li key={k} className="flex gap-2 text-xs text-text-2">
                <span aria-hidden className={cn("mt-1 size-2 shrink-0 rounded-full", WATCH_DOT[w.tone])} />
                <span>
                  <b className="font-semibold text-text">{w.strong}</b> {w.rest}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Nothing to watch right now.</p>
        )}
      </div>
    </Card>
  );
}

/* ---------------------------------------------------------------- money · what they bought */

function MoneyBar({
  label,
  amount,
  parts,
  legend,
}: {
  label: string;
  amount: string;
  parts: { value: number; className: string }[];
  legend: { className: string; text: string }[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-xs text-text-2">{label}</span>
        <b className="text-sm font-semibold tabular">{amount}</b>
      </span>
      <span aria-hidden className="flex h-2.5 overflow-hidden rounded-full bg-surface-3">
        {parts.map((p, k) => (
          <span key={k} className={cn("block h-full", p.className)} style={{ width: `${p.value}%` }} />
        ))}
      </span>
      <span className="flex flex-wrap gap-x-3.5 gap-y-1">
        {legend.map((l, k) => (
          <span key={k} className="flex items-center gap-1.5 text-xs">
            <span aria-hidden className={cn("size-2.5 shrink-0 rounded-[2px]", l.className)} />
            {l.text}
          </span>
        ))}
      </span>
    </div>
  );
}

export function MoneyCard({ f, costs, base }: { f: OverviewFacts; costs: OrderCosts | null; base: string }) {
  const c = f.c;
  const restWhen = f.rest ? [f.rest.how.trim() || null, f.rest.when ?? (f.rest.dueOn ? `due ${f.short(f.rest.dueOn)}` : null)].filter(Boolean).join(" · ") : null;
  return (
    <Card>
      <CardHeader
        title="Money"
        actions={
          <Link href={costs ? `${base}/costs` : `${base}/payment`} className={buttonClass("ghost", "sm")}>
            {costs ? "Costs" : "Payment"}
          </Link>
        }
      />
      <div className="flex flex-col gap-4 px-4 py-3.5">
        <MoneyBar
          label="From the customer"
          amount={whole(f.total, c)}
          parts={[
            { value: f.receivedPct, className: "bg-ok" },
            { value: 100 - f.receivedPct, className: "bg-primary-soft" },
          ]}
          legend={[
            { className: "bg-ok", text: `received ${whole(f.received, c)}` },
            ...(f.due > 0 ? [{ className: "bg-primary-soft", text: `still due ${whole(f.due, c)}${restWhen ? ` · ${restWhen}` : ""}` }] : []),
          ]}
        />
        {f.factoryRows?.map((r) => {
          const p = pct(Number(r.paid), Number(r.owed));
          return (
            <MoneyBar
              key={r.factory.id}
              label={`To ${r.factory.name}`}
              amount={whole(r.owed, r.currency)}
              parts={[{ value: p, className: "bg-ok" }]}
              legend={[
                { className: "bg-ok", text: Number(r.toPay) <= 0 ? `paid ${whole(r.paid, r.currency)} in full` : `paid ${whole(r.paid, r.currency)}` },
                ...(Number(r.toPay) > 0 ? [{ className: "bg-surface-3", text: `to pay ${whole(r.toPay, r.currency)}` }] : []),
              ]}
            />
          );
        })}
        {costs && (
          <MoneyBar
            label="Costs"
            amount={whole(Math.max(Number(costs.totals.spent), Number(costs.totals.planned)), costs.currency)}
            parts={[
              {
                value: pct(Number(costs.totals.spent), Math.max(Number(costs.totals.spent), Number(costs.totals.planned))),
                className: Number(costs.totals.notPlanned) > 0 ? "bg-warn" : "bg-primary",
              },
            ]}
            legend={[
              {
                className: Number(costs.totals.notPlanned) > 0 ? "bg-warn" : "bg-primary",
                text: `spent ${whole(costs.totals.spent, costs.currency)}${Number(costs.totals.notPlanned) > 0 ? ` (${whole(costs.totals.notPlanned, costs.currency)} not planned)` : ""}`,
              },
              { className: "bg-surface-3", text: `planned ${whole(costs.totals.planned, costs.currency)}` },
            ]}
          />
        )}
        {f.profit && (
          <p className="flex items-baseline justify-between gap-3 border-t border-line pt-2.5 text-xs text-text-2">
            {PROFIT_LABEL.expected}
            <b className={cn("text-sm font-semibold tabular", Number(f.profit.expected) < 0 ? "text-bad" : "text-text")}>
              {whole(f.profit.expected, c)}
              {f.profit.margin !== null ? ` · ${f.profit.margin.toFixed(1)}%` : ""}
            </b>
          </p>
        )}
      </div>
    </Card>
  );
}

/** "37,500" when every price is whole, else with cents. */
function priceFormat(values: string[]) {
  const whole = values.every((v) => Number(v) % 1 === 0);
  return (v: string) => Number(v).toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
}

/** The order's lines, read only, and the total. */
export function WhatTheyBought({ o, f }: { o: OverviewInput["o"]; f: OverviewFacts }) {
  const fmt = priceFormat(o.lines.map((l) => l.lineTotal));
  return (
    <Card>
      <CardHeader
        title="What they bought"
        actions={
          f.accepted ? (
            <Link href={`/inquiries/${o.inquiry.id}/quotation`} className={buttonClass("ghost", "sm")}>
              Quotation R{f.accepted.number}
            </Link>
          ) : undefined
        }
      />
      <div className="p-4">
        {o.lines.length ? (
          // It can scroll sideways on a phone, so Tab stops on it.
          <div
            tabIndex={0}
            role="region"
            aria-label="The order's lines"
            className="overflow-x-auto rounded-lg border border-line focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
          >
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-surface-2 text-xs text-text-2">
                  <th className="w-12 border-b border-line px-2 py-2 text-left font-medium">No.</th>
                  <th className="border-b border-l border-line px-2 py-2 text-left font-medium">Description</th>
                  <th className="border-b border-l border-line px-2 py-2 text-right font-medium max-sm:hidden">Qty</th>
                  <th className="border-b border-l border-line px-2 py-2 text-right font-medium whitespace-nowrap max-sm:hidden">Price {f.c}</th>
                </tr>
              </thead>
              <tbody>
                {o.lines.map((l) => (
                  <tr key={l.id} className="border-b border-line last:border-b-0">
                    <td className="px-2 py-2 align-top text-xs text-muted tabular">{l.no}</td>
                    <td className={cn("border-l border-line px-2 py-2 align-top whitespace-pre-line", l.no.includes(".") && "pl-5")}>
                      {l.description}
                      {l.model && <span className="block text-xs text-muted">{l.model}</span>}
                      <span className="block text-xs text-text-2 tabular sm:hidden">
                        {qty(l.quantity)} {l.unit} · {f.c} {fmt(l.lineTotal)}
                      </span>
                    </td>
                    <td className="border-l border-line px-2 py-2 text-right align-top whitespace-nowrap tabular max-sm:hidden">
                      {qty(l.quantity)} {l.unit}
                    </td>
                    <td className="border-l border-line px-2 py-2 text-right align-top whitespace-nowrap tabular max-sm:hidden">{fmt(l.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-line px-3 py-2 text-right text-sm text-text-2">
              Total {incotermOf(o)} <b className="font-semibold text-text tabular">{money(o.money.total, f.c)}</b>
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted">No lines on this order.</p>
        )}
      </div>
    </Card>
  );
}

/* ---------------------------------------------------------------- who's involved · key dates */

export function WhoIsInvolved({ o, f, deal }: { o: OverviewInput["o"]; f: OverviewFacts; deal: DealDetail | null }) {
  const people: { role: string; name: string; sub: string | null; href?: string }[] = [];
  const contact = deal?.contact ?? null;
  people.push({
    role: "Customer",
    name: contact ? `${contact.name} · ${o.customer.name}` : o.customer.name,
    sub: [isUnknownCountry(o.customer.country) ? null : countryName(o.customer.country), deal ? `via ${CHANNEL_LABEL[deal.channel]}` : null].filter(Boolean).join(" · ") || null,
    href: `/customers/${o.customer.id}`,
  });
  if (o.inquiry.assignee) {
    const since = deal?.assignments.filter((a) => a.assigneeId === o.inquiry.assignee!.id).at(-1)?.assignedAt;
    people.push({ role: "Handles it", name: o.inquiry.assignee.name, sub: since ? `since ${f.short(since.slice(0, 10))}` : null });
  }
  const ordered = f.factoryOrder.no ? `order ${f.factoryOrder.no}` : f.factoryOrder.on ? `ordered ${f.short(f.factoryOrder.on)}` : null;
  for (const x of f.factories) people.push({ role: "Factory", name: x.name, sub: ordered, href: `/factories/${x.id}` });
  if (f.ship?.forwarder)
    people.push({
      role: "Forwarder",
      name: f.ship.forwarder,
      sub: f.ship.bookingNo ? `booking ${f.ship.bookingNo}` : f.ship.blNo ? `B/L ${f.ship.blNo}` : null,
    });
  if (f.contract && (f.contract.customerBank || f.contract.ourBank))
    people.push({
      role: "Banks",
      name: [f.contract.customerBank, f.contract.ourBank].filter(Boolean).join(" → "),
      sub: f.contract.number,
    });
  return (
    <Card>
      <CardHeader title="Who's involved" />
      <ul className="flex flex-col px-4 py-2.5">
        {people.map((p, k) => (
          <li key={k} className="grid grid-cols-[30px_minmax(0,1fr)] items-center gap-2.5 py-1.5">
            <span aria-hidden className="grid size-[30px] place-items-center rounded-full bg-surface-2 text-xs font-bold text-text-2">
              {p.name.charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0">
              <span className="block text-xs text-muted">{p.role}</span>
              {p.href ? (
                <Link href={p.href} className="block text-sm font-medium [overflow-wrap:anywhere] hover:underline">
                  {p.name}
                </Link>
              ) : (
                <b className="block text-sm font-medium [overflow-wrap:anywhere]">{p.name}</b>
              )}
              {p.sub && <span className="block text-xs text-text-2 [overflow-wrap:anywhere]">{p.sub}</span>}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function KeyDates({ o, f, deal }: { o: OverviewInput["o"]; f: OverviewFacts; deal: DealDetail | null }) {
  const rows: [string, string | null | undefined][] = [
    ["Inquiry", deal?.createdAt.slice(0, 10)],
    ["Order", o.orderedOn],
    ["Ready at factory", o.readyOn],
    ["Ship by", o.shipBy],
    ["LC latest shipment", f.lcLatest],
    [f.ship?.departedOn ? "Sailed" : "ETD", f.ship?.departedOn ?? f.ship?.etd],
    [f.ship?.arrivedOn ? `Arrived${f.pod ? ` ${f.pod}` : ""}` : `ETA${f.pod ? ` ${f.pod}` : ""}`, f.ship?.arrivedOn ?? f.ship?.eta],
    [f.lc ? "LC expires" : "Contract expires", f.contract?.expiresOn],
    ["Delivered", f.delivery?.deliveredOn],
    [f.delivery?.satDoneOn ? "SAT signed" : "SAT (planned)", f.delivery?.satDoneOn ?? f.delivery?.satPlannedOn],
  ];
  return (
    <Card>
      <CardHeader title="Key dates" />
      <dl className="flex flex-col gap-2.5 px-4 py-3.5">
        {rows
          .filter((r) => r[1])
          .map(([label, d]) => (
            <div key={label} className="flex items-baseline justify-between gap-3">
              <dt className="text-xs text-text-2">{label}</dt>
              <dd className="text-sm font-medium tabular">{date(d!)}</dd>
            </div>
          ))}
      </dl>
    </Card>
  );
}

/* ---------------------------------------------------------------- recent changes */

/** Every step's changes, newest first: one line each (the whole on hover), its step and when; five show, the rest scroll. */
export function RecentChanges({ lines, more, historyHref }: { lines: ChangeLine[]; more: boolean; historyHref: string }) {
  return (
    <Card>
      <CardHeader
        title={
          <>
            Recent changes{" "}
            <span className="ml-0.5 text-xs font-normal text-muted tabular">
              {lines.length}
              {more ? "+" : ""}
            </span>
          </>
        }
        description="across every step · 5 show, scroll for more"
        actions={
          <Link href={historyHref} className={buttonClass("ghost", "sm")}>
            All history
          </Link>
        }
        className="max-sm:flex-row"
      />
      {lines.length ? (
        <ul className="max-h-[290px] overflow-y-auto px-4 pt-1 pb-2 [scrollbar-width:thin] sm:max-h-[204px]">
          {lines.map((c) => {
            const step = c.step ? (FLOW_STEP_LABEL[c.step as FlowStep] ?? c.step) : null;
            return (
              <li
                key={c.id}
                title={c.title}
                className="grid grid-cols-[24px_minmax(0,1fr)] items-center gap-x-2.5 border-b border-line py-2 last:border-b-0 sm:h-10 sm:grid-cols-[24px_minmax(0,1fr)_130px_90px] sm:py-0"
              >
                <span aria-hidden className="row-span-2 grid size-6 place-items-center rounded-full bg-primary-soft text-[11px] font-bold text-primary sm:row-span-1">
                  {c.initial}
                </span>
                <span className="truncate text-sm">
                  <b className="font-semibold">{c.who}</b> {c.text}
                </span>
                <span className="truncate text-xs text-text-2">
                  {step ?? <span className="text-muted">Order</span>}
                  <span className="text-muted sm:hidden"> · {c.when}</span>
                </span>
                <span className="hidden text-right text-xs text-muted tabular sm:block">{c.when}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-4 py-3.5 text-sm text-muted">Nothing changed yet.</p>
      )}
    </Card>
  );
}
