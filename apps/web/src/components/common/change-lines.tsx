import { dateTime, TZ } from "@/lib/format";
import type { HistoryEntry } from "@/lib/types";
import { today } from "@/components/orders/today";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-03" and "10:12" of a moment, in the business time zone. */
function partsOf(iso: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
/** "today 10:12", "03 Nov", or "03 Nov 2025" for another year. */
function when(iso: string, now: string) {
  const { day, time } = partsOf(iso);
  if (day === now) return `today ${time}`;
  return `${day.slice(8, 10)} ${MONTHS[Number(day.slice(5, 7)) - 1]}${day.slice(0, 4) === now.slice(0, 4) ? "" : ` ${day.slice(0, 4)}`}`;
}
/** "03 Nov" of a YYYY-MM-DD. */
const dayOf = (d: string) => `${d.slice(8, 10)} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;

const PAPER_STEPS = /^paper\.(draft|final|again|delete)$/;
const PAPER_OF = /^(.*?\b[A-Z]{2,4}-\d{4}-\d+(?:-\d+)?)\b/;

export interface ChangeLine {
  id: string;
  initial: string;
  who: string;
  text: string;
  when: string;
  /** The whole change (all of a paper's folded versions), on hover. */
  title: string;
  /** The order step it belongs to (the overview's Recent changes). */
  step: string | null;
}

/**
 * A record's changes, one line each: who, what (short), when. A paper's drafts,
 * finals and remakes fold into one line (the newest); History keeps every one.
 */
export function compactChanges(entries: (HistoryEntry & { step?: string | null })[]): ChangeLine[] {
  const now = today();
  const out: (ChangeLine & { paper?: string; all: string[] })[] = [];
  for (const e of entries) {
    const who = e.by?.name ?? "System";
    let text = (e.summary ?? e.action).replace(/^[A-Z]{2,4}-\d{4}-\d+: /, "").replace(/\d{4}-\d{2}-\d{2}/g, dayOf);
    // A summary that already says "a → b" needs no "was".
    const change = /→/.test(text) ? null : e.changes.find((c) => c.from && c.to);
    if (change?.from) text += ` · was ${/^\d{4}-\d{2}-\d{2}$/.test(change.from) ? dayOf(change.from) : change.from}`;
    const full = `${who} ${text} · ${dateTime(e.at)}`;
    const paper = PAPER_STEPS.test(e.action) ? PAPER_OF.exec(text)?.[1] : undefined;
    const folded = paper ? out.find((x) => x.paper === paper) : undefined;
    if (folded) {
      folded.all.push(full);
      folded.title = folded.all.join("\n");
      continue;
    }
    out.push({
      id: e.id,
      initial: who.charAt(0).toUpperCase(),
      who: who.split(" ")[0]!,
      text,
      when: when(e.at, now),
      title: full,
      step: e.step ?? null,
      paper,
      all: [full],
    });
  }
  return out.map(({ id, initial, who, text, when, title, step }) => ({ id, initial, who, text, when, title, step }));
}

/** The change lines, as list items: avatar, the whole sentence, the time under it. */
export function changeRows(lines: ChangeLine[]) {
  return lines.map((c) => (
    <li key={c.id} title={c.title} className="grid grid-cols-[24px_minmax(0,1fr)] items-start gap-2.5 border-b border-line py-2 last:border-b-0">
      <span aria-hidden className="grid size-6 place-items-center rounded-full bg-primary-soft text-[11px] font-bold text-primary">
        {c.initial}
      </span>
      <span className="min-w-0">
        <span className="block text-sm [overflow-wrap:anywhere]">
          <b className="font-semibold">{c.who}</b> {c.text}
        </span>
        <span className="block text-xs text-muted tabular">{c.when}</span>
      </span>
    </li>
  ));
}
