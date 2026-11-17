"use client";

import { useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Copy, Info, Pencil, Plus, Trash2 } from "lucide-react";
import { formatMinor, toMinor } from "@kebo/money";
import { ATTACHMENT_KIND_LABEL, basisText, lineNumbers, offerTaxText, partsWords, warrantyLine, type AttachmentKind } from "@kebo/shared";
import { Button, cn, Field, Select, Textarea } from "@kebo/ui";
import { toast } from "@kebo/ui/client";
import { LineTable, type LineColumn, type LineMove, type LineResult, type LineRow, type LineValues, type NewLine } from "@/components/lines/line-table";
import { PanelBody, SidePanel, useClosePanel, WhatHappens } from "@/components/common/panel";
import { BoxFacts, RecordBox } from "@/components/common/record-box";
import { HistoryButton, type HistoryEntry } from "@/components/edits/history-button";
import { recordEditAction } from "@/lib/edit-actions";
import { ConfirmDialog } from "@/components/common/dialog";
import type { ActionState } from "@/lib/actions";
import { date as dateText, dateTime, money as amount } from "@/lib/format";
import type { FactoryOption, FactoryQuoteView, OfferFile, SourcingView } from "@/lib/types-deals";
import type { OfferLineResult } from "@/app/(app)/inquiries/[id]/sourcing/actions";
import { send, type Staged } from "./documents-panel";
import { FileRow, FileZone } from "@/components/common/file-zone";
import { fileSize } from "@/lib/format";
import { OFFER_PART_LABEL, OfferHeaderForm, type AskedFactory, type OfferPart, type OfferSaved, type OfferStep } from "./factory-quote-form";
import { LinesExcel, LinesView } from "./lines-view";
import { useBatchLines, type LineHandlers } from "@/components/edits/batch-lines";
import { editedMark } from "@/components/edits/edits";
import type { EditCard, EditsView } from "@/lib/types-edits";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;
type Items = SourcingView["items"];

export interface OfferLineActions {
  add: (quoteId: string, body: object) => Promise<OfferLineResult>;
  edit: (lineId: string, body: object) => Promise<OfferLineResult>;
  move: (lineId: string, body: object) => Promise<OfferLineResult>;
  remove: (lineId: string, reason?: string) => Promise<OfferLineResult>;
  copy: (quoteId: string, fromQuoteId: string) => Promise<OfferLineResult>;
  removeFile: (fileId: string, prev: ActionState, form: FormData) => Promise<ActionState>;
}

/** A factory's file is its quotation unless it is clearly something else. */
const guessOfferKind = (name: string, type: string): AttachmentKind => {
  const n = name.toLowerCase();
  if (/catalog|brochure|spec|datasheet|technical/.test(n)) return "specification";
  if (/\.(dwg|dxf|step|stp)$/.test(n) || /drawing|layout/.test(n)) return "drawing";
  if (type.startsWith("image/") && !/quot|offer|price|pi\b/.test(n)) return "photo";
  return "factory_quote";
};

/** A line as the offer's API takes it; a blank tax % is the offer's (`offerRate`, or the API's when not given). */
function toBody(v: LineValues, offerRate?: number) {
  return {
    description: v.description,
    model: v.model?.trim() || null,
    requestedItemId: v.requestedItemId || null,
    quantity: (v.quantity ?? "").replace(/,/g, "").trim(),
    unit: v.unit?.trim() || "pcs",
    unitPrice: (v.unitPrice ?? "").replace(/,/g, "").trim() || "0",
    taxRate: (v.taxRate ?? "").trim() || (offerRate === undefined ? undefined : String(offerRate)),
    alternativeOfId: v.alternativeOfId || null,
  };
}


/* ---------------------------------------------------------------- the offer's window and its page */

/** What every Edit on an offer's page needs to open the offer's steps window. */
export type OfferKit = {
  dealId: string;
  today: string;
  mainCurrency: string;
  rates: Record<string, number>;
  searchFactories: (q: string) => Promise<FactoryOption[]>;
  saveAction: Action;
  removeAction: Action;
  removeFile: OfferLineActions["removeFile"];
  items: Items;
  others: FactoryQuoteView[];
  lineActions: OfferLineActions;
  linesCard?: EditCard | null;
  /** The inquiry's number, under the window's title ("Shenjing Machinery · RFQ-2026-0007"). */
  refNo?: string;
};

/**
 * The offer's window (design rules 18 Nov): `only` opens just the part asked for — "Edit delivery & payment", 640 px
 * (the prices wide) — the rest "Edit offer", every part.
 */
export function OfferPanel({ kit, q, step, only = false, onClose }: { kit: OfferKit; q: FactoryQuoteView; step: OfferStep; only?: boolean; onClose: () => void }) {
  const one = only;
  const part = step === "review" || step === "changes" ? null : step;
  return (
    <SidePanel
      title={one && part ? `Edit ${OFFER_PART_LABEL[part].toLowerCase()}` : "Edit offer"}
      description={[q.factory.name, kit.refNo].filter(Boolean).join(" · ")}
      onClose={onClose}
      // The payment's parts need a little more room than 640.
      className={!one || part === "prices" ? "md:w-[1180px]" : part === "terms" ? "md:w-[720px]" : "md:w-[640px]"}
    >
      <OfferWindow {...kit} q={q} startStep={step} only={one} />
    </SidePanel>
  );
}

/**
 * Edit with its word (never a pencil alone): opens the offer's window on `step` (Factory · Prices · Delivery &
 * payment · Conditions), only that part when `only`. `what` finishes its name for screen readers ("Edit prices").
 */
export function OfferEdit({
  kit,
  q,
  step,
  only = false,
  what,
  words,
  size = "xs",
  variant = "secondary",
}: {
  kit: OfferKit;
  q: FactoryQuoteView;
  step: OfferStep;
  only?: boolean;
  what?: string;
  words?: string;
  size?: "xs" | "sm";
  variant?: "primary" | "secondary" | "ghost";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant={variant} onClick={() => setOpen(true)} className={cn("tracking-normal normal-case", variant === "ghost" && "text-primary hover:text-primary")}>
        <Pencil aria-hidden />
        {words ?? (
          <>
            Edit{what && <span className="sr-only"> {what}</span>}
          </>
        )}
      </Button>
      {open && <OfferPanel kit={kit} q={q} step={step} only={only} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * The offer's window, the same for a new offer and an edit (design 18 Nov, the inquiry's rules): the steps of
 * OfferHeaderForm, the factory's own files in the Factory step and the lines in Prices — all saved by the one Save.
 * A new offer saved opens its page (or the window starts again: Save and add another); an edit closes. Each part's
 * changes are kept with the reason, for its box's history. Removing the offer, or one of its files, asks first.
 */
function OfferWindow({
  dealId,
  q,
  today,
  mainCurrency,
  rates,
  searchFactories,
  saveAction,
  removeAction,
  removeFile,
  taxDefault,
  onAnother,
  items,
  others,
  lineActions,
  linesCard,
  asked,
  startStep,
  only = false,
}: {
  /** Only the step it opens on (Edit on one part). */
  only?: boolean;
  /** The customer's items (a new offer's lines can be copied from them; a line keeps which it answers). */
  items: Items;
  /** The inquiry's other offers with lines (their lines can be copied). */
  others: FactoryQuoteView[];
  lineActions: OfferLineActions;
  /** The lines' saved edits ("Edited n×"). */
  linesCard?: EditCard | null;
  /** The factories asked for this inquiry, first in the picker. */
  asked?: AskedFactory[];
  /** The step it opens on. */
  startStep?: OfferStep;
  dealId: string;
  /** The offer being edited; null: a new one. */
  q: FactoryQuoteView | null;
  today: string;
  mainCurrency: string;
  rates: Record<string, number>;
  searchFactories: (q: string) => Promise<FactoryOption[]>;
  saveAction: Action;
  removeAction?: Action;
  removeFile?: OfferLineActions["removeFile"];
  taxDefault?: { included: boolean; rate: number; advance?: number };
  /** "Save and add another": the window starts again, empty. */
  onAnother?: () => void;
}) {
  const router = useRouter();
  const close = useClosePanel();
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<"offer" | OfferFile | null>(null);
  const [why, setWhy] = useState("");
  const [askError, setAskError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const another = useRef(false);
  const used = q?.lines.some((l) => l.used) ?? false;
  // The lines (design 18 Nov): a copy, saved with the offer by the window's one Save.
  const [step, setStep] = useState<OfferStep>(startStep ?? (q ? "prices" : "factory"));
  const savedRows = useMemo(() => offerRows(q?.lines ?? []), [q]);
  const baseColumns = useMemo(() => offerColumns(q?.lines ?? [], q?.currency ?? mainCurrency, q?.taxRate ?? taxDefault?.rate ?? 0), [q, mainCurrency, taxDefault]);
  const batch = useBatchLines({ rows: savedRows, columns: baseColumns, plain: !used, report: false });
  const [copyFrom, setCopyFrom] = useState("");

  // The factory's files, sent once the offer is saved; what did not go up, said.
  const upload = async (id: string) => {
    const problems: string[] = [];
    for (const file of files) {
      const staged: Staged = { key: file.name, file, kind: guessOfferKind(file.name, file.type), note: "", progress: 0, error: null };
      const e = await send(dealId, staged, () => {}, { factoryQuoteId: id });
      if (e) problems.push(`${file.name} did not upload: ${e}`);
    }
    return problems;
  };

  // A new offer: its files and its page are seen to as soon as it is saved, here, because the page under the
  // window may change with it (the first offer takes the place of "Enter an offer") and take the window away.
  const create: Action = async (prev, form) => {
    const st = await saveAction(prev, form);
    const id = (st.data as { id?: string } | undefined)?.id;
    if (!st.ok || !id) return st;
    const problems = await upload(id);
    if (problems.length) toast({ kind: "fail", message: "The offer was saved, but not all of its files", detail: problems.join(" ") });
    if (!another.current) router.push(`/inquiries/${dealId}/offers/${id}`);
    return st;
  };

  // Saved: a new offer's window closes (or starts again); an edit's new files go up, then its changed lines,
  // then each part keeps what changed with the reason (its box's history), and the window closes.
  const done = async (st: ActionState, saved: OfferSaved) => {
    if (!q) {
      if (another.current) {
        another.current = false;
        onAnother?.();
      } else close(st);
      return;
    }
    const id = q.id;
    setError(null);
    const problems = await upload(id);
    if (problems.length) {
      router.refresh();
      setFiles([]);
      setError(`The offer was saved, but: ${problems.join(" ")}`);
      return;
    }
    if (batch.dirty) {
      const r = await batch.run(offerLineHandlers(id, q, lineActions), saved.reason);
      if (!r.ok) {
        router.refresh();
        setStep("prices");
        setError(`The offer was saved, but its lines were not: ${r.message} Save again to send the rest.`);
        return;
      }
      if (saved.reason || !linesCard?.first)
        await recordEditAction({
          type: "factory_quote",
          id,
          card: "lines",
          kind: saved.reason ? "edit" : "first",
          reason: saved.reason,
          changes: batch.diff.changes.slice(0, 60),
          keys: batch.diff.keys.slice(0, 500),
          lines: Object.fromEntries(Object.entries(batch.diff.byKey).slice(0, 200)),
        }).catch(() => undefined);
    }
    if (saved.reason)
      for (const part of ["factory", "prices", "terms", "conditions"] as OfferPart[]) {
        const list = saved.changes.filter((c) => c.part === part);
        const added = part === "factory" ? files.map((f) => `Added ${f.name}`) : [];
        if (!list.length && !added.length) continue;
        await recordEditAction({
          type: "factory_quote",
          id,
          card: `offer.${part}`,
          kind: "edit",
          reason: saved.reason,
          changes: [...list.map((c) => `${c.label}: ${c.from} → ${c.to}`), ...added],
          keys: list.map((c) => c.key),
        }).catch(() => undefined);
      }
    router.refresh();
    // Saved: close without asking "Discard your change?".
    close(st);
  };

  const confirm = () =>
    start(async () => {
      setAskError(null);
      const form = new FormData();
      if (why.trim()) form.set("reason", why.trim());
      if (asking === "offer") {
        const r = await removeAction!({}, form);
        if (!r.ok) return setAskError(r.message ?? "The offer was not removed.");
        setAsking(null);
        close(r);
        router.push(`/inquiries/${dealId}/sourcing`);
        return;
      }
      if (asking) {
        const r = await removeFile!(asking.id, {}, form);
        if (!r.ok) return setAskError(r.message ?? "The file was not removed.");
        setAsking(null);
        router.refresh();
      }
    });

  // Their quotation (design 18 Nov): with who sent it and when, in the Factory step.
  const fileRows = (
    <div className="flex flex-col gap-2">
      {(q?.files ?? []).map((f) => (
        <div key={f.id} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5 text-[13px]">
          <span className="min-w-0 truncate">
            <a href={`/files/${f.id}?view=1`} target="_blank" rel="noreferrer" className="font-semibold text-primary hover:underline">
              {f.fileName}
            </a>
            <span className="text-text-2">
              {" "}
              · {ATTACHMENT_KIND_LABEL[f.kind]} · {dateText(f.uploadedOn)}
            </span>
          </span>
          {removeFile && (
            <button type="button" onClick={() => (setAskError(null), setAsking(f))} className="shrink-0 font-semibold text-bad hover:underline">
              Remove
            </button>
          )}
        </div>
      ))}
      <FileZone label="Their quotation" compact onFiles={(list) => setFiles((x) => [...x, ...list])}>
        {files.length > 0 &&
          files.map((file, n) => (
            <FileRow
              key={`${file.name}-${n}`}
              name={file.name}
              meta={`${ATTACHMENT_KIND_LABEL[guessOfferKind(file.name, file.type)]} · ${fileSize(file.size)}`}
              actions={
                <Button size="icon-xs" variant="ghost" onClick={() => setFiles((x) => x.filter((_, k) => k !== n))} aria-label={`Remove ${file.name}`}>
                  <Trash2 aria-hidden />
                </Button>
              }
            />
          ))}
      </FileZone>
    </div>
  );

  const fromItems = (taxRate: number) =>
    items.map((it) => ({
      id: it.id,
      parentId: it.parentId,
      values: { description: it.description, model: it.model ?? "", requestedItemId: it.id, quantity: it.quantity, unit: it.unit, unitPrice: "", taxRate: String(taxRate) },
    }));
  const count = batch.rows.length ? linesCount(batch.rows) : "no lines yet";

  return (
    <PanelBody fill>
      <OfferHeaderForm
        step={step}
        onStep={setStep}
        only={only}
        startStep={startStep}
        asked={asked}
        linesCount={count}
        linesChanges={q && batch.dirty ? batch.diff.changes : []}
        onUndoLines={batch.reset}
        filesAdded={files.map((f) => f.name)}
        onUndoFiles={() => setFiles([])}
        lines={(h) => {
          const columns = offerColumns(q?.lines ?? [], h.currency || mainCurrency, h.taxRate, q?.taxRate ?? h.taxRate);
          const empty = batch.rows.length === 0;
          return (
            <div className="flex min-h-0 flex-col gap-3 md:flex-1">
              {used && (
                <p className="flex shrink-0 items-start gap-2 rounded-xl border border-info/25 bg-info-soft px-3 py-2.5 text-sm">
                  <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
                  <span>A quotation is priced from this offer. Its own copy of the lines and prices stays as it was.</span>
                </p>
              )}
              <LineTable
                rows={batch.rows}
                columns={columns}
                noun="line"
                fill
                partButton={false}
                sheet={{
                  name: `Prices from ${q?.factory.name ?? "the factory"}`,
                  upload: !used,
                  templateRows: items.map((it) => ({ no: it.no, values: { description: it.description, model: it.model ?? "", requestedItemId: it.id, quantity: it.quantity, unit: it.unit, unitPrice: "", taxRate: String(h.taxRate) } })),
                }}
                // Copying the customer's items (design 18 Nov): with the other ways in, never inside the table.
                tools={
                  <>
                    {items.length > 0 && (
                      <Button size="sm" variant={empty ? "soft" : "secondary"} onClick={() => batch.add(newLinesOf(fromItems(h.taxRate)))}>
                        <Copy aria-hidden /> Copy customer’s items{empty ? ` · ${linesCount(items.map((it) => ({ key: it.id, parentKey: it.parentId, values: {} })))}` : ""}
                      </Button>
                    )}
                    {empty && others.length > 0 && (
                      <Select
                        compact
                        aria-label="Copy another offer’s lines"
                        value={copyFrom}
                        onChange={(e) => {
                          const o = others.find((x) => x.id === e.target.value);
                          setCopyFrom("");
                          if (o)
                            batch.add(
                              newLinesOf(
                                o.lines
                                  .filter((l) => !l.alternativeOfId)
                                  .map((l) => ({ id: l.id, parentId: l.parentId, values: { description: l.description, model: l.model ?? "", requestedItemId: l.requestedItemId ?? "", quantity: l.quantity, unit: l.unit, unitPrice: "", taxRate: String(h.taxRate) } })),
                              ),
                            );
                        }}
                        className="h-8 w-auto max-w-56"
                      >
                        <option value="">Copy another offer…</option>
                        {others.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.factory.name} ({o.lines.length})
                          </option>
                        ))}
                      </Select>
                    )}
                  </>
                }
                {...batch.local}
                footer={
                  batch.rows.length ? (
                    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 px-3 py-2.5 text-sm text-text-2">
                      <span>
                        Total <span className="font-semibold text-text tabular">{formatMinor(linesTotal(batch.rows), h.currency || mainCurrency)}</span>
                      </span>
                      <span>{h.taxIncluded ? `tax ${h.taxRate}% included` : h.taxRate > 0 ? `+ ${h.taxRate}% tax` : "no tax"}</span>
                    </div>
                  ) : null
                }
              />
              {h.errors.length > 0 && (
                <div role="alert" className="flex shrink-0 flex-col gap-0.5 rounded-xl border border-bad/30 bg-bad-soft px-3 py-2.5 text-sm text-bad">
                  <span className="font-semibold">Nothing was saved yet: fix {h.errors.length === 1 ? "this line" : "these lines"} first.</span>
                  {h.errors.map((e) => (
                    <span key={e}>{e}</span>
                  ))}
                </div>
              )}
            </div>
          );
        }}
        linesReview={(h) => <LinesReview rows={batch.rows} currency={h.currency || mainCurrency} />}
        action={q ? saveAction : create}
        extra={!q && batch.rows.length ? { lines: newOfferLines(batch.rows) } : undefined}
        quote={q}
        today={today}
        mainCurrency={mainCurrency}
        rates={rates}
        searchFactories={searchFactories}
        onDone={(st, saved) => void done(st, saved)}
        defaults={taxDefault ? { taxIncluded: taxDefault.included, taxRate: taxDefault.rate, advancePercent: taxDefault.advance } : undefined}
        files={fileRows}
        note={error && <p role="alert" className="text-sm text-bad">{error}</p>}
        onAnother={onAnother ? () => (another.current = true) : undefined}
        footerStart={
          q && removeAction && !only ? (
            <button type="button" onClick={() => (setAskError(null), setWhy(""), setAsking("offer"))} aria-label="Remove this offer" className="inline-flex min-h-9 items-center gap-1.5 text-[13px] font-semibold text-bad hover:underline max-sm:min-w-9 max-sm:justify-center pointer-coarse:min-h-8">
              <Trash2 className="size-4 max-sm:size-5" aria-hidden /> <span className="max-sm:sr-only">Remove this offer</span>
            </button>
          ) : undefined
        }
      />
      {asking && q && (
        <ConfirmDialog
          title={asking === "offer" ? `Remove ${q.factory.name}’s offer?` : `Remove ${asking.fileName}?`}
          confirmLabel={asking === "offer" ? "Remove the offer" : "Remove the file"}
          cancelLabel={asking === "offer" ? "Keep the offer" : "Keep it"}
          danger
          busy={busy}
          onCancel={() => setAsking(null)}
          onConfirm={() => (asking === "offer" && used && !why.trim() ? setAskError("Say why: a quotation is priced from this offer.") : confirm())}
        >
          <div className="flex flex-col gap-3">
            {asking === "offer" ? (
              <WhatHappens
                lines={[
                  q.lines.length
                    ? `The offer, its ${q.lines.length === 1 ? "line" : `${q.lines.length} lines`} and its files are removed from this inquiry.`
                    : "The offer and its files are removed from this inquiry.",
                  "If the factory was asked, its line goes back to “Waiting”; if not, it leaves the list.",
                  used ? "The quotation made from it keeps its own copy of the lines and prices." : null,
                ]}
              />
            ) : (
              <WhatHappens lines={["The file leaves this offer. Nothing else changes."]} />
            )}
            {asking === "offer" && used && (
              <Field label="Why" htmlFor="remove-offer-why">
                <Textarea id="remove-offer-why" rows={2} value={why} onChange={(e) => setWhy(e.target.value)} maxLength={500} />
              </Field>
            )}
            {askError && <p className="text-sm text-bad">{askError}</p>}
          </div>
        </ConfirmDialog>
      )}
    </PanelBody>
  );
}

/** "4 lines, 2 parts". */
function linesCount(rows: { parentKey: string | null }[]) {
  const parts = rows.filter((r) => r.parentKey).length;
  const lines = rows.length - parts;
  return [`${lines} line${lines === 1 ? "" : "s"}`, parts ? `${parts} part${parts === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ");
}

/** The lines in Review (a new offer): number, what, how many, the line's total. */
function LinesReview({ rows, currency }: { rows: LineRow[]; currency: string }) {
  if (!rows.length) return <p className="px-4 py-3 text-sm text-text-2">No lines yet.</p>;
  const numbers = lineNumbers(rows.map((r) => ({ key: r.key, parentKey: r.parentKey })));
  return (
    <>
      <table className="w-full text-[13.5px]">
        <tbody>
          {rows.map((r, i) => {
            const p = Number((r.values.unitPrice ?? "").replace(/,/g, ""));
            const n = Number((r.values.quantity ?? "").replace(/,/g, ""));
            return (
              <tr key={r.key} className="border-t border-line first:border-t-0">
                <td className="w-12 px-4 py-2 text-text-2 tabular">{numbers[i]}</td>
                <td className={cn("py-2", r.parentKey && "pl-4")}>{(r.values.description ?? "").split("\n")[0]}</td>
                <td className="w-24 px-3 py-2 text-right tabular">
                  {r.values.quantity} {r.values.unit}
                </td>
                <td className="w-32 px-4 py-2 text-right font-semibold tabular">{p && Number.isFinite(p * n) ? formatMinor(Math.round(toMinor(p) * n), currency) : <span className="font-normal text-muted">—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex justify-end gap-2 border-t border-line bg-surface-2/50 px-4 py-2.5 text-sm text-text-2">
        Total <span className="font-semibold text-text tabular">{formatMinor(linesTotal(rows), currency)}</span>
      </div>
    </>
  );
}

/** The offer's saved lines as rows of the line table. */
export function offerRows(lines: FactoryQuoteView["lines"]): LineRow[] {
  return lines.map((l) => ({
    key: l.id,
    parentKey: l.parentId,
    values: {
      description: l.description,
      model: l.model ?? "",
      requestedItemId: l.requestedItemId ?? "",
      quantity: l.quantity,
      unit: l.unit,
      unitPrice: l.unitPrice,
      taxRate: String(l.taxRate),
      alternativeOfId: l.alternativeOfId ?? "",
    },
  }));
}

/** The offer's line calls (one change, one call), for the offer `id` (a new offer's, once it is saved). */
function offerLineHandlers(id: string, q: FactoryQuoteView | null, lines: OfferLineActions): LineHandlers {
  const had = new Set((q?.lines ?? []).map((l) => l.id));
  const result = (r: OfferLineResult): LineResult => {
    if (!r.ok) return { ok: false, message: r.message, reasonChoices: r.reasonChoices };
    return { ok: true, keys: r.offer.lines.filter((l) => !had.has(l.id)).map((l) => l.id) };
  };
  return {
    onAdd: async (newLines: NewLine[], at, reason) =>
      result(await lines.add(id, { lines: newLines.map((l) => ({ ...toBody(l.values), partOf: l.partOf })), afterId: at.afterKey, parentId: at.parentKey, reason })),
    onEdit: async (key, values, reason) => {
      const body: Record<string, unknown> = { reason };
      const full = toBody(values);
      for (const k of Object.keys(values)) body[k] = full[k as keyof typeof full];
      return result(await lines.edit(key, body));
    },
    onRemove: async (key, reason) => result(await lines.remove(key, reason)),
    onMove: async (key, to: LineMove, reason) => result(await lines.move(key, { to, reason })),
  };
}

/** A new offer's lines, in the same save as the offer: a part or another spec names its line by its place. */
function newOfferLines(rows: LineRow[]) {
  const at = new Map(rows.map((r, n) => [r.key, n]));
  return rows.map((r) => {
    const { alternativeOfId, ...body } = toBody(r.values);
    return { ...body, partOf: r.parentKey ? (at.get(r.parentKey) ?? null) : null, specOf: alternativeOfId ? (at.get(alternativeOfId) ?? null) : null };
  });
}

/** Lines given with their own ids and parents, as new rows (parts under their line). */
function newLinesOf(src: { id: string; parentId: string | null; values: LineValues }[]): NewLine[] {
  const at = new Map(src.map((l, n) => [l.id, n]));
  return src.map((l) => ({ values: l.values, partOf: l.parentId ? (at.get(l.parentId) ?? null) : null }));
}

/** The lines' total as typed (another spec is left out). */
function linesTotal(list: LineRow[]) {
  let t = 0;
  for (const r of list) {
    if (r.values.alternativeOfId) continue;
    const p = Number((r.values.unitPrice ?? "").replace(/,/g, ""));
    const n = Number((r.values.quantity ?? "").replace(/,/g, ""));
    if (Number.isFinite(p * n)) t += Math.round(toMinor(p) * n);
  }
  return t;
}

/**
 * The offer's line columns (the view and the steps window's sheet): its currency in the price, its tax % for new lines.
 * Which item a line answers is kept on the line, not shown (design 18 Nov): copied lines keep it.
 */
export function offerColumns(lines: FactoryQuoteView["lines"], currency: string, taxRate: number, savedRate = taxRate): LineColumn[] {
  // Lines another spec can point at: the offer's main lines (not parts, not specs themselves).
  const mains = lines.filter((l) => !l.parentId && !l.alternativeOfId);
  const numberOf = (id: string) => lines.find((l) => l.id === id)?.no ?? "";

  const lineTotal = (v: LineValues) => {
    const p = Number((v.unitPrice ?? "").replace(/,/g, ""));
    const n = Number((v.quantity ?? "").replace(/,/g, ""));
    if (!Number.isFinite(p) || !Number.isFinite(n) || !p) return <span className="text-muted">—</span>;
    const t = formatMinor(Math.round(toMinor(p) * n), currency);
    return v.alternativeOfId ? <span className="text-muted" title="Another spec: not in the total">({t})</span> : t;
  };

  const columns: LineColumn[] = [
    {
      key: "description",
      label: "Description",
      width: "minmax(0,1fr)",
      input: "textarea",
      required: "Each line needs a description",
    },
    { key: "model", label: "Model", width: "7rem", input: "text", maxLength: 120, placeholder: "Model" },
    { key: "quantity", label: "Qty", width: "4.5rem", input: "number", align: "right", initial: "1", required: "Enter a quantity" },
    { key: "unit", label: "Unit", width: "5.5rem", input: "unit", maxLength: 20, initial: (p) => (p ? "sets" : "pcs") },
    {
      key: "unitPrice",
      label: `Price ${currency}`,
      width: "6.5rem",
      input: "number",
      align: "right",
      placeholder: "0",
      format: (v) =>
        Number(v.unitPrice) ? (
          Number(v.unitPrice).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    // A line's own tax % only when one has its own (design 18 Nov: the offer's tax is said once, above the lines).
    ...(lines.some((l) => Number(l.taxRate) !== Number(savedRate))
      ? [{ key: "taxRate", label: "Tax %", width: "3.5rem", input: "number" as const, align: "right" as const, initial: String(taxRate), phoneHidden: true }]
      : []),
    ...(mains.length > 1 || lines.some((l) => l.alternativeOfId)
      ? [
          {
            key: "alternativeOfId",
            label: "Spec of",
            width: "5rem",
            input: "select" as const,
            options: [{ value: "", label: "—" }, ...mains.map((l) => ({ value: l.id, label: `${l.no} ${l.description.split("\n")[0]!.slice(0, 30)}` }))],
            sheetChoices: [{ value: "", text: "" }, ...mains.map((l) => ({ value: l.id, text: l.no }))],
            phoneHidden: true,
            format: (v: LineValues) =>
              v.alternativeOfId ? (
                <span className="rounded-full bg-warn-soft px-2 py-0.5 text-xs font-semibold text-warn" title="Another spec of that line: a choice, left out of the total">
                  of {numberOf(v.alternativeOfId)}
                </span>
              ) : (
                <span className="text-muted">—</span>
              ),
          },
        ]
      : []),
    { key: "total", label: "Total", width: "8.5rem", align: "right", format: lineTotal },
  ];
  return columns;
}

/* ---------------------------------------------------------------- the offer's page: a box per part */

/**
 * The offer's page (design 18 Nov, the inquiry's rules): the same boxes as its steps — Factory and Delivery &
 * payment side by side, then Prices, then Conditions — each with its own history clock and Edit (that part only),
 * each fact once.
 */
export function OfferBoxes({
  q,
  kit,
  canEdit,
  edits,
  mainCurrency,
  historyHref,
}: {
  q: FactoryQuoteView;
  kit: OfferKit;
  canEdit: boolean;
  /** This offer's saved edits, by card. */
  edits?: EditsView;
  mainCurrency: string;
  /** "All history". */
  historyHref?: string;
}) {
  // Each box's own changes (who, when, old → new, why), newest first, then when the offer came.
  const history = (cards: string[], title: string) => {
    const entries: HistoryEntry[] = [
      ...cards
        .flatMap((c) => edits?.cards[c]?.edits ?? [])
        .sort((a, b) => b.at.localeCompare(a.at))
        .map((e) => ({ lines: e.changes, reason: e.reason, by: e.by, at: dateTime(e.at) })),
      { lines: ["Offer received"], reason: null, by: q.factory.name, at: dateText(q.receivedOn), start: true },
    ];
    return <HistoryButton title={title} entries={entries} allHref={historyHref} />;
  };
  const edit = (part: OfferPart, what: string) => <OfferEdit kit={kit} q={q} step={part} what={what} only variant="ghost" />;

  const rows: LineRow[] = offerRows(q.lines).map((r) => ({ ...r, badge: editedMark(edits?.cards.lines, r.key) }));
  const numbers = q.lines.map((l) => l.no);
  const columns = offerColumns(q.lines, q.currency, q.taxRate);
  // Read only, narrower: the model only when a line has one.
  const narrow: Record<string, string> = { quantity: "4rem", unit: "4rem", unitPrice: "6.5rem", taxRate: "3.5rem", total: "7.5rem" };
  const viewColumns = columns
    .filter((c) => c.key !== "model" || q.lines.some((l) => l.model))
    .map((c) => (narrow[c.key] ? { ...c, width: narrow[c.key]! } : c));
  const strong = (v: ReactNode) => <span className="font-semibold text-text tabular">{v}</span>;
  const footer =
    q.lines.length > 0 ? (
      <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 px-3 py-2.5 text-sm text-text-2">
        <span>Total {strong(formatMinor(toMinor(q.factoryTotal), q.currency))}</span>
        <span>
          {q.taxIncluded ? "tax included" : "without tax"} · {q.taxIncluded ? "of which tax" : "tax"} {strong(formatMinor(toMinor(q.taxTotal), q.currency))}
        </span>
        {q.totalCost && <span>our cost {strong(amount(q.totalCost, mainCurrency))}</span>}
      </div>
    ) : undefined;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <RecordBox title="Factory" what="the factory" canEdit={canEdit} edit={edit("factory", "the factory")} history={history(["offer.factory"], "Factory")}>
          <BoxFacts
            rows={[
              ["Factory", q.factory.name],
              ["Received on", dateText(q.receivedOn)],
              ["Valid until", q.validUntil ? dateText(q.validUntil) : null],
              ["Their reference", q.reference || null],
              [
                "Their quotation",
                q.files.length ? (
                  <span className="flex flex-col gap-1">
                    {q.files.map((f) => (
                      <a key={f.id} href={`/files/${f.id}?view=1`} target="_blank" rel="noreferrer" className="font-semibold text-primary underline underline-offset-2 [overflow-wrap:anywhere]">
                        {f.fileName}
                      </a>
                    ))}
                  </span>
                ) : null,
              ],
            ]}
          />
        </RecordBox>
        <RecordBox title="Delivery & payment" what="delivery and payment" canEdit={canEdit} edit={edit("terms", "delivery and payment")} history={history(["offer.terms"], "Delivery & payment")}>
          <BoxFacts
            rows={[
              ["Delivery", q.basis ? basisText(q.basis, q.basisPlace) : null],
              ["Ready in", q.leadTime || null],
              ["Payment", q.paymentParts.length ? partsWords(q.paymentParts, "factory") : null],
              ["Payment note", q.paymentTerms ? <span className="line-clamp-3 whitespace-pre-line">{q.paymentTerms}</span> : null],
            ]}
          />
        </RecordBox>
      </div>
      <RecordBox
        title="Prices"
        count={[q.lines.length ? linesCount(offerRows(q.lines)) : null, q.currency, Number(q.taxRate) > 0 ? offerTaxText(q.taxRate, q.taxIncluded) : "no tax"].filter(Boolean).join(" · ")}
        what="prices"
        canEdit={canEdit}
        edit={<OfferEdit kit={kit} q={q} step="prices" what="prices" words={q.lines.length ? undefined : "Add lines"} only variant="ghost" />}
        tools={<LinesExcel name={`Prices from ${q.factory.name}`} rows={rows} columns={columns} numbers={numbers} />}
        history={history(["lines", "offer.prices"], "Prices")}
      >
        {q.lines.length ? (
          <>
            <div className="p-3 max-sm:hidden">
              <LinesView label={`${q.factory.name} · prices`} rows={rows} columns={viewColumns} numbers={numbers} footer={footer} />
            </div>
            {/* A phone: one line per row, its quantity and price under its name, the total on the right. */}
            <ul aria-label={`${q.factory.name} · prices`} className="flex flex-col divide-y divide-line px-4 text-sm sm:hidden">
              {q.lines.map((l) => (
                <li key={l.id} className={cn("flex flex-col gap-1 py-2.5", l.parentId && "pl-4")}>
                  <span className="flex gap-2">
                    <span className="w-6 shrink-0 text-xs text-muted tabular">{l.no}</span>
                    <span className="min-w-0 flex-1 font-medium [overflow-wrap:anywhere]">{l.description.split("\n")[0]}</span>
                  </span>
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3 pl-8 text-xs text-text-2 tabular">
                    <span>
                      {Number(l.quantity).toLocaleString("en-US")} {l.unit}
                      {Number(l.unitPrice) ? <> × {Number(l.unitPrice).toLocaleString("en-US", { minimumFractionDigits: 2 })}</> : " · no price yet"}
                    </span>
                    {Number(l.unitPrice) > 0 && <span className="text-sm font-semibold text-text">{formatMinor(Math.round(toMinor(l.unitPrice) * Number(l.quantity)), q.currency)}</span>}
                  </span>
                </li>
              ))}
            </ul>
            <div className="border-t border-line sm:hidden">{footer}</div>
          </>
        ) : (
          <p className="px-5 py-4 text-sm text-muted max-sm:px-4">No lines yet.</p>
        )}
      </RecordBox>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <RecordBox title="Conditions" what="the conditions" canEdit={canEdit} edit={edit("conditions", "the conditions")} history={history(["offer.conditions"], "Conditions")}>
          <BoxFacts
            rows={[
              ["Warranty", warrantyLine(q)?.replace(/\.$/, "") ?? null],
              ["Minimum order", q.moq || null],
              ["Notes", q.notes ? <span className="line-clamp-4 whitespace-pre-line">{q.notes}</span> : null],
            ]}
          />
        </RecordBox>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- add an offer */

/**
 * "Enter an offer": the New factory offer window (design 18 Nov): Factory · Prices · Delivery & payment · Conditions,
 * then Review and Confirm and save. The factories asked for this inquiry come first in its picker.
 */
export function AddOfferButton({
  dealId,
  today,
  mainCurrency,
  rates,
  searchFactories,
  createAction,
  taxDefault,
  label = "Add an offer",
  variant = "secondary",
  size = "md",
  defaultOpen = false,
  refNo,
  items,
  others,
  lineActions,
  asked,
  inquiryTitle,
}: {
  /** The factories asked for this inquiry (first in the picker). */
  asked?: AskedFactory[];
  /** The inquiry's title, under the window's title ("For RFQ-2026-0007 · Tablet press machine"). */
  inquiryTitle?: string;
  /** The customer's items and the other offers (a new offer's lines can start from them), and the line calls. */
  items: Items;
  others: FactoryQuoteView[];
  lineActions: OfferLineActions;
  /** The inquiry's number, in the window's line under the title. */
  refNo?: string;
  dealId: string;
  today: string;
  mainCurrency: string;
  rates: Record<string, number>;
  searchFactories: (q: string) => Promise<FactoryOption[]>;
  /** saveFactoryQuoteAction bound to the deal and null (a new offer). */
  createAction: Action;
  /** A new offer's tax and advance: the company's defaults (Settings). */
  taxDefault: { included: boolean; rate: number; advance?: number };
  label?: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "xs" | "sm" | "md";
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // "Save and add another": the window starts again, empty.
  const [round, setRound] = useState(0);
  return (
    <>
      <Button size={size} variant={variant} onClick={() => setOpen(true)}>
        <Plus aria-hidden /> {label}
      </Button>
      {open && (
        <SidePanel
          key={round}
          title="New factory offer"
          description={refNo ? `For ${[refNo, inquiryTitle].filter(Boolean).join(" · ")}` : "Internal, never shown to the customer."}
          className="md:w-[1180px]"
          onClose={() => setOpen(false)}
        >
          <OfferWindow
            dealId={dealId}
            q={null}
            today={today}
            mainCurrency={mainCurrency}
            rates={rates}
            searchFactories={searchFactories}
            saveAction={createAction}
            taxDefault={taxDefault}
            onAnother={() => setRound((n) => n + 1)}
            items={items}
            others={others}
            lineActions={lineActions}
            asked={asked}
          />
        </SidePanel>
      )}
    </>
  );
}

