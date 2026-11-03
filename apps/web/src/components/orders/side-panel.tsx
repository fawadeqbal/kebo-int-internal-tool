import "server-only";
import Link from "next/link";
import { BASIS_STEP_LABEL, type BasisStep, type FlowStep } from "@kebo/shared";
import { buttonClass, Card } from "@kebo/ui";
import { dateTime, money, whole } from "@/lib/format";
import type { HistoryEntry } from "@/lib/types";
import { orderFilesOf, orderOf, orderPapersOf } from "@/lib/order-data";
import { optional } from "@/components/print/data";
import { UploadButton } from "@/components/files/files-list";
import { docHref } from "@/app/(app)/orders/[id]/shared";
import { AddOrderExpense } from "./expense-form";
import { orderCostsSetup } from "./costs-data";
import type { PaperLineRow } from "./papers-table";
import { SideFileRow, SidePaperRow, SidePanelCard, SideSection } from "./side-panel-parts";
import { today } from "./today";

const TZ = process.env.APP_TIME_ZONE ?? process.env.NEXT_PUBLIC_APP_TIME_ZONE ?? "Asia/Shanghai";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The planned costs of the quote that are paid in each step. */
const PLANNED_IN: Partial<Record<FlowStep, BasisStep[]>> = {
  shipping: ["to_port", "freight", "insurance"],
  delivery: ["delivery", "duties"],
};

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
}

/**
 * A step's changes, one line each: who, what (short), when. A paper's drafts,
 * finals and remakes fold into one line (the newest); History keeps every one.
 */
export function compactChanges(entries: HistoryEntry[]): ChangeLine[] {
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
      paper,
      all: [full],
    });
  }
  return out.map(({ id, initial, who, text, when, title }) => ({ id, initial, who, text, when, title }));
}

/** The change lines (the side panel's Changes, the Documents page's side card), as list items: avatar, the whole sentence, the time under it. */
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

/** The Documents page's side card: the step's changes. */
export function StepChangesCompact({ entries, historyHref }: { entries: HistoryEntry[]; historyHref: string }) {
  const lines = compactChanges(entries);
  return (
    <Card>
      <SideSection
        title="Changes in this step"
        count={lines.length}
        dense
        action={
          <Link href={historyHref} className={buttonClass("ghost", "sm")}>
            All history
          </Link>
        }
        empty="Nothing changed here yet."
      >
        {changeRows(lines)}
      </SideSection>
    </Card>
  );
}

/**
 * Every step page's right side (but Documents): one card, no tabs, four
 * sections — Papers · Costs · Files · Changes — each with its count and button,
 * two lines per entry (names in full), about six then it scrolls. Papers come from GET
 * /orders/:id/papers (this step's), Costs from the order's costs (managers with
 * the expenses feature only), Files from GET /orders/:id/files (this step's),
 * Changes from the step's history.
 */
export async function StepSidePanel({
  id,
  step,
  changes,
  historyHref,
}: {
  id: string;
  step: FlowStep;
  changes: HistoryEntry[];
  historyHref: string;
}) {
  const [o, papers, files, costs] = await Promise.all([
    orderOf(id),
    optional(() => orderPapersOf(id)),
    optional(() => orderFilesOf(id)),
    orderCostsSetup(id),
  ]);

  // Papers: this step's, the proforma printing as the order's own document (as on Documents).
  const proforma = o.documents.find((x) => x.kind === "proforma");
  const paperRows: PaperLineRow[] = (papers?.papers ?? [])
    .filter((r) => r.step === step)
    .map((r) =>
      r.kind === "proforma" && proforma
        ? { ...r, links: { ...docHref(o, proforma), internal: `${docHref(o, proforma).pdf}?copy=internal` } }
        : r,
    );

  // Costs: the step's expenses, what they add up to, what the quote planned for it.
  let costsSection = null;
  if (costs) {
    const c = costs.costs.currency;
    const here = costs.costs.expenses.filter((e) => e.step === step && !e.voided);
    const planned = costs.costs.planned.filter((r) => r.basisStep && PLANNED_IN[step]?.includes(r.basisStep) && r.planned !== null);
    const total = costs.costs.steps[step]?.spent ?? "0.00";
    const note = planned.length
      ? `Planned on the quote: ${planned.map((r) => `${BASIS_STEP_LABEL[r.basisStep!].toLowerCase()} ${whole(r.planned, c)}`).join(" · ")}.`
      : here.some((e) => e.borneBy === "us")
        ? "Nothing was planned for this step, so these cut the profit."
        : null;
    costsSection = (
      <SideSection
        target="costs"
        title="Costs"
        count={here.length}
        action={<AddOrderExpense setup={costs.setup} step={step} variant="ghost" size="sm" />}
        empty={`No expense on this step yet · ${money("0", c)}`}
        footer={
          <>
            {here.length > 0 && (
              <p className="mt-1 flex items-baseline justify-between gap-3 text-sm text-text-2">
                Spent in this step <b className="font-semibold text-text tabular">{money(total, c)}</b>
              </p>
            )}
            {note && <p className="mt-1 text-[13px] text-muted">{note}</p>}
          </>
        }
      >
        {here.map((e) => {
          const meta = [dayOf(e.spentOn), e.paidBy?.name.split(" ")[0]].filter(Boolean).join(" · ");
          const detail = [
            e.description,
            dayOf(e.spentOn),
            e.paidBy ? `${e.paidBy.name}${e.ownMoney ? ", own money" : e.account ? `, ${e.account.name}` : ""}` : null,
            e.borneBy === "customer" ? "charged to the customer" : e.borneBy === "factory" ? "the factory bears it" : null,
            money(e.amount, e.currency),
            e.receipt ? null : "no receipt",
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <li
              key={e.id}
              data-target={`costs.${e.category}`}
              title={detail}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5 border-b border-line py-2 last:border-b-0"
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium [overflow-wrap:anywhere]">{e.description}</span>
                <span className="flex items-center gap-1 text-xs text-text-2">
                  {meta}
                  {!e.receipt && <span role="img" aria-label="No receipt" title="No receipt" className="size-1.5 shrink-0 rounded-full bg-warn" />}
                </span>
              </span>
              <span className="text-sm tabular">{money(e.amount, e.currency)}</span>
            </li>
          );
        })}
      </SideSection>
    );
  }

  const stepFiles = files?.files.filter((f) => f.step === step) ?? [];
  const now = today();
  /** "Sales contract signed · Fawad · today": what the file belongs to, who added it, when. */
  const fileMeta = (f: (typeof stepFiles)[number]) =>
    [f.attachedTo.label.replace(/^(Checklist|Paper|Inquiry|Step) · /, ""), f.by?.name.split(" ")[0], when(f.at, now).replace(/^today .*/, "today")]
      .filter(Boolean)
      .join(" · ");
  const lines = compactChanges(changes);

  return (
    <SidePanelCard label="This step's papers, costs, files and changes">
      {papers && (
        <SideSection
          title="Papers"
          count={paperRows.length}
          action={
            <Link href={`/orders/${id}/documents?tab=all#papers`} className={buttonClass("ghost", "sm")}>
              All papers
            </Link>
          }
          empty="No papers on this step."
        >
          {paperRows.map((r) => (
            <SidePaperRow
              key={r.key}
              r={r}
              orderId={id}
              canMake={papers.canMake}
              canRecord={papers.canRecord}
              sub={r.sub ? r.sub.replace(/\d{4}-\d{2}-\d{2}/g, dayOf) : null}
            />
          ))}
        </SideSection>
      )}
      {costsSection}
      {files && (
        <SideSection
          target="files"
          title="Files"
          count={stepFiles.length}
          action={
            files.canUpload ? (
              <UploadButton orderId={id} step={step} label="Upload" variant="ghost" size="sm" />
            ) : (
              <Link href={`/orders/${id}/documents#files`} className={buttonClass("ghost", "sm")}>
                All files
              </Link>
            )
          }
          empty="No files on this step yet. Drop them on the page, or upload."
        >
          {stepFiles.map((f) => (
            <SideFileRow key={f.id} file={f} set={stepFiles} meta={fileMeta(f)} />
          ))}
        </SideSection>
      )}
      <SideSection
        title="Changes"
        count={lines.length}
        dense
        action={
          <Link href={historyHref} className={buttonClass("ghost", "sm")}>
            All history
          </Link>
        }
        empty="Nothing changed here yet."
      >
        {changeRows(lines)}
      </SideSection>
    </SidePanelCard>
  );
}
