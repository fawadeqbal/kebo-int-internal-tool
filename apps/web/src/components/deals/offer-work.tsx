"use client";

import { useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { factoryTaxMinor, formatMinor, toMinor } from "@kebo/money";
import { ATTACHMENT_KIND_LABEL, lineNumbers, offerTaxText, PAPER, type AttachmentKind } from "@kebo/shared";
import { Button, cn, Field, RULES, Select, Textarea, Badge, Notice, EmptyLine, linkClass, Dash } from "@kebo/ui";
import { toast } from "@kebo/ui/client";
import { LineTable, type LineColumn, type LineMove, type LineResult, type LineRow, type LineValues, type NewLine } from "@/components/lines/line-table";
import { OpenPanelButton, PanelBody, SidePanel, useClosePanel, useSidePanel, WhatHappens } from "@/components/common/panel";
import { SheetFact, SheetPart } from "@/components/records/phone-items";
import { BoxFacts, RecordBox } from "@/components/common/record-box";
import { PaperFacts, PaperLayout } from "@/components/records/paper-boxes";
import { HistoryButton, type HistoryEntry } from "@/components/edits/history-button";
import { recordEditAction } from "@/lib/edit-actions";
import { ConfirmDialog } from "@/components/common/dialog";
import { changeLine } from "@/components/common/change-words";
import type { ActionState } from "@/lib/actions";
import { date as dateText, dateTime, money as amount } from "@/lib/format";
import type { FactoryOption, FactoryQuoteView, OfferFile, SourcingView } from "@/lib/types-deals";
import type { OfferLineResult } from "@/app/(app)/inquiries/[id]/sourcing/actions";
import { send, type Staged } from "@/components/files/upload";
import { FileRow, FileZone } from "@/components/common/file-zone";
import { fileSize } from "@/lib/format";
import { convertText, type Fx } from "@/lib/fx";
import { OFFER_PART_LABEL, OfferHeaderForm, type AskedFactory, type OfferPart, type OfferSaved, type OfferStep } from "./factory-quote-form";
import { LinesExcel } from "./lines-view";
import { ItemsBox } from "@/components/records/items-box";
import { Totals } from "@/components/records/totals";
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
      className={!one || part === "prices" ? RULES.window.items : part === "terms" ? RULES.window.wideRows : RULES.window.part}
    >
      <OfferWindow {...kit} q={q} startStep={step} only={one} />
    </SidePanel>
  );
}

/**
 * Edit with its word (never a pencil alone): opens the offer's window on `step` (Factory · Prices · Delivery &
 * payment · Warranty & conditions), only that part when `only`. `what` finishes its name for screen readers ("Edit prices").
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

/** Edit offer from the page's ⋯ (?panel=edit-offer): every part, in steps, as the Edit offer button opened it. */
export function OfferUrlWindow({ kit, q }: { kit: OfferKit; q: FactoryQuoteView }) {
  const panel = useSidePanel("edit-offer");
  if (!panel.open) return null;
  // ?panel=edit-offer: every step; …&id=prices: that part only (an item's sheet on a phone opens it so).
  const part = panel.id === "prices" || panel.id === "terms" || panel.id === "conditions" || panel.id === "factory" ? (panel.id as OfferPart) : null;
  return <OfferPanel kit={kit} q={q} step={part ?? "factory"} only={!!part} onClose={() => panel.close()} />;
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
        setError(`The offer was saved, but its items were not: ${r.message} Save again to send the rest.`);
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
        const added = part === "factory" ? files.map((f) => `Added · File: ${f.name}`) : [];
        if (!list.length && !added.length) continue;
        await recordEditAction({
          type: "factory_quote",
          id,
          card: `offer.${part}`,
          kind: "edit",
          reason: saved.reason,
          changes: [...list.map((c) => changeLine(c.label, c.from, c.to)), ...added],
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
        <div key={f.id} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5 text-md">
          <span className="min-w-0 truncate">
            <a href={`/files/${f.id}?view=1`} className={linkClass}>
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
  const count = batch.rows.length ? linesCount(batch.rows) : "no items yet";

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
          const columns = offerColumns(q?.lines ?? [], h.currency || mainCurrency, h.taxRate, q?.taxRate ?? taxDefault?.rate ?? 0);
          const empty = batch.rows.length === 0;
          return (
            <div className="flex flex-col gap-3 md:min-h-0 md:flex-1">
              {used && (
                // On a phone it is one line at the top of the items instead (LineTable's notice).
                <Notice tone="info" className="shrink-0 max-sm:hidden">
                  A quotation is priced from this offer. Its own copy of the items and prices stays as it was.
                </Notice>
              )}
              <LineTable
                rows={batch.rows}
                columns={columns}
                noun="item"
                fill
                partButton={false}
                sheet={{
                  name: `Prices from ${q?.factory.name ?? "the supplier"}`,
                  upload: !used,
                  templateRows: items.map((it) => ({ no: it.no, values: { description: it.description, model: it.model ?? "", requestedItemId: it.id, quantity: it.quantity, unit: it.unit, unitPrice: "", taxRate: String(h.taxRate) } })),
                }}
                // Copying the customer's items (design 18 Nov): with the other ways in, never inside the table.
                tools={
                  <>
                    {items.length > 0 && (
                      <Button variant="secondary" onClick={() => batch.add(newLinesOf(fromItems(h.taxRate)))}>
                        <Copy aria-hidden /> Copy customer’s items{empty ? ` · ${linesCount(items.map((it) => ({ key: it.id, parentKey: it.parentId, values: {} })))}` : ""}
                      </Button>
                    )}
                    {empty && others.length > 0 && (
                      <Select
                        compact
                        aria-label="Copy another offer’s items"
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
                // A phone (design "Items on a small phone"): the other ways in under ⋯, the notice in one line, the
                // currency and tax in the caption, the customer's items this offer lacks at the end, the total in the footer.
                ways={[
                  ...(items.length > 0
                    ? [{ key: "customer", label: "Copy the customer’s items", note: String(items.length), onSelect: () => batch.add(newLinesOf(fromItems(h.taxRate))) }]
                    : []),
                  ...others.map((o) => ({
                    key: `offer-${o.id}`,
                    label: `Copy ${o.factory.name}’s items`,
                    note: String(o.lines.filter((l) => !l.alternativeOfId).length),
                    onSelect: () =>
                      batch.add(
                        newLinesOf(
                          o.lines
                            .filter((l) => !l.alternativeOfId)
                            .map((l) => ({ id: l.id, parentId: l.parentId, values: { description: l.description, model: l.model ?? "", requestedItemId: l.requestedItemId ?? "", quantity: l.quantity, unit: l.unit, unitPrice: "", taxRate: String(h.taxRate) } })),
                        ),
                      ),
                  })),
                ]}
                notice={used ? "A quotation is priced from this offer. Its own copy of the items and prices stays as it was." : undefined}
                caption={[h.currency || mainCurrency, h.taxRate > 0 ? offerTaxText(String(h.taxRate), h.taxIncluded) : "no tax"].join(" · ")}
                suggest={(() => {
                  // The customer's items this offer does not answer yet (only when it has some of its own).
                  const answered = new Set(batch.rows.map((r) => r.values.requestedItemId).filter(Boolean));
                  const lacking = items.filter((it) => !it.parentId && !answered.has(it.id));
                  if (empty || !lacking.length || answered.size === 0) return null;
                  return {
                    text: `${lacking.length} of the customer’s items ${lacking.length === 1 ? "is" : "are"} not here yet.`,
                    label: lacking.length === 1 ? "Copy it" : "Copy them",
                    onSelect: () => batch.add(newLinesOf(fromItems(h.taxRate).filter((x) => lacking.some((it) => it.id === x.id) || lacking.some((it) => it.id === x.parentId)))),
                  };
                })()}
                total={batch.rows.length ? offerTotalLine(batch.rows, h.currency || mainCurrency, h.taxRate, q?.taxRate ?? taxDefault?.rate ?? 0, h.taxIncluded) : null}
                {...batch.local}
                footer={
                  batch.rows.length ? (
                    <OfferTotals
                      rows={batch.rows}
                      currency={h.currency || mainCurrency}
                      taxRate={h.taxRate}
                      savedRate={q?.taxRate ?? taxDefault?.rate ?? 0}
                      included={h.taxIncluded}
                      fx={{ main: mainCurrency, rates }}
                    />
                  ) : null
                }
              />
              {h.errors.length > 0 && (
                <Notice tone="bad" className="shrink-0" title={`Nothing was saved yet: fix ${h.errors.length === 1 ? "this item" : "these items"} first.`}>
                  {h.errors.map((e) => (
                    <span key={e} className="block">
                      {e}
                    </span>
                  ))}
                </Notice>
              )}
            </div>
          );
        }}
        linesReview={(h) => (
          <LinesReview
            rows={batch.rows}
            currency={h.currency || mainCurrency}
            tax={{ taxRate: h.taxRate, savedRate: q?.taxRate ?? taxDefault?.rate ?? 0, included: h.taxIncluded, fx: { main: mainCurrency, rates } }}
          />
        )}
        action={q ? saveAction : create}
        // A new offer's lines at the tax % they started with follow the offer's % as it is now.
        extra={!q && batch.rows.length ? (h) => ({ lines: newOfferLines(batch.rows, h.taxRate, taxDefault?.rate ?? 0) }) : undefined}
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
            <button type="button" onClick={() => (setAskError(null), setWhy(""), setAsking("offer"))} aria-label="Remove this offer" className="inline-flex min-h-9 items-center gap-1.5 text-md font-semibold text-bad hover:underline max-sm:min-w-9 max-sm:justify-center pointer-coarse:min-h-8">
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
                    ? `The offer, its ${q.lines.length === 1 ? "item" : `${q.lines.length} items`} and its files are removed from this inquiry.`
                    : "The offer and its files are removed from this inquiry.",
                  "If the supplier was asked, its item goes back to “Waiting”; if not, it leaves the list.",
                  used ? "The quotation made from it keeps its own copy of the items and prices." : null,
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
  return [`${lines} item${lines === 1 ? "" : "s"}`, parts ? `${parts} part${parts === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ");
}

/** The lines in Review (a new offer): number, what, how many, the line's total. */
function LinesReview({ rows, currency, tax }: { rows: LineRow[]; currency: string; tax: Omit<Parameters<typeof OfferTotals>[0], "rows" | "currency"> }) {
  if (!rows.length) return <EmptyLine className="px-4 py-3">No items yet.</EmptyLine>;
  const numbers = lineNumbers(rows.map((r) => ({ key: r.key, parentKey: r.parentKey })));
  return (
    <>
      <table className="w-full text-md">
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
                <td className="w-32 px-4 py-2 text-right font-semibold tabular">{p && Number.isFinite(p * n) ? formatMinor(Math.round(toMinor(p) * n), currency) : <Dash />}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="border-t border-line bg-surface-2/50 px-1">
        <OfferTotals rows={rows} currency={currency} {...tax} />
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
function newOfferLines(rows: LineRow[], taxRate: number, startRate: number) {
  const at = new Map(rows.map((r, n) => [r.key, n]));
  return rows.map((r) => {
    const { alternativeOfId, ...body } = toBody({ ...r.values, taxRate: String(lineRate(r.values.taxRate, taxRate, startRate)) });
    return { ...body, partOf: r.parentKey ? (at.get(r.parentKey) ?? null) : null, specOf: alternativeOfId ? (at.get(alternativeOfId) ?? null) : null };
  });
}

/** Lines given with their own ids and parents, as new rows (parts under their line). */
function newLinesOf(src: { id: string; parentId: string | null; values: LineValues }[]): NewLine[] {
  const at = new Map(src.map((l, n) => [l.id, n]));
  return src.map((l) => ({ values: l.values, partOf: l.parentId ? (at.get(l.parentId) ?? null) : null }));
}

/** 198,300.00: an amount without its currency (the column's name says it). */
const plainAmount = (minor: number) => (minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * A line's tax % as it will be saved: a line at the offer's saved % follows the offer's % (it changes with it);
 * a line at another % keeps its own.
 */
export function lineRate(raw: string | undefined, taxRate: number, savedRate = taxRate): number {
  const r = Number(String(raw ?? "").replace(/,/g, ""));
  if (String(raw ?? "").trim() === "" || !Number.isFinite(r)) return taxRate;
  return r === Number(savedRate) ? taxRate : r;
}

/**
 * Under the lines (design 18 Nov): Before tax · Tax (added, or the part included) · Total with tax, and the total
 * in the main currency; no tax at all: "Total · no tax". From the lines as they are now (other specs left out).
 */
/** An offer's sums from its lines as they are now (other specs left out), in minor units, by tax rate. */
export function offerSums(rows: LineRow[], taxRate: number, savedRate: number, included: boolean) {
  const byRate = new Map<number, { amount: number; lines: number }>();
  let sum = 0;
  for (const r of rows) {
    if (r.values.alternativeOfId) continue;
    const p = Number((r.values.unitPrice ?? "").replace(/,/g, ""));
    const n = Number((r.values.quantity ?? "").replace(/,/g, ""));
    if (!Number.isFinite(p) || !Number.isFinite(n) || !p) continue;
    const m = Math.round(toMinor(p) * n);
    const rate = lineRate(r.values.taxRate, taxRate, savedRate);
    const g = byRate.get(rate) ?? { amount: 0, lines: 0 };
    byRate.set(rate, { amount: g.amount + m, lines: g.lines + 1 });
    sum += m;
  }
  const tax = [...byRate].reduce((t, [r, g]) => t + factoryTaxMinor(g.amount, r, included), 0);
  const rates = [...byRate.keys()].sort((a, b) => b - a);
  const noTax = rates.every((r) => r === 0) && taxRate === 0;
  return { byRate, sum, tax, rates, noTax, total: included ? sum : sum + tax };
}

/** The big line of an offer's totals, for a phone's footer: "Total with tax · CNY 110,740.00". */
export function offerTotalLine(rows: LineRow[], currency: string, taxRate: number, savedRate: number, included: boolean) {
  const t = offerSums(rows, taxRate, savedRate, included);
  return { label: t.noTax ? "Total · no tax" : "Total with tax", value: formatMinor(t.total, currency) };
}

export function OfferTotals({
  rows,
  currency,
  taxRate,
  savedRate = taxRate,
  included,
  fx,
  extra,
}: {
  rows: LineRow[];
  currency: string;
  taxRate: number;
  savedRate?: number;
  included: boolean;
  fx?: Fx;
  /** Ours only, in the shaded strip above the totals ("Our cost"). */
  extra?: [string, ReactNode];
}) {
  const { byRate, sum, tax, rates, noTax, total } = offerSums(rows, taxRate, savedRate, included);
  const main = fx && currency !== fx.main ? convertText(String(total / 100), currency, fx.main, fx) : null;
  const money = (minor: number) => <span className="tabular">{formatMinor(minor, currency)}</span>;
  const how = included ? "included" : "added";
  const taxLabel =
    rates.length > 1 ? (
      <>
        Tax · {how}
        <span className="block text-xs text-muted">{rates.map((r) => `${r}% on ${byRate.get(r)!.lines} item${byRate.get(r)!.lines === 1 ? "" : "s"}`).join(" · ")}</span>
      </>
    ) : (
      `Tax ${rates[0] ?? taxRate}% · ${how}`
    );
  // The one totals block (canvas "What changes, piece by piece"): our cost in its shaded strip above.
  return (
    <Totals
      ours={extra ? [{ label: extra[0], value: extra[1] }] : null}
      rows={[
        ...(noTax
          ? []
          : [
              { label: "Before tax", value: money(included ? sum - tax : sum) },
              { label: taxLabel, value: money(tax) },
            ]),
        { label: noTax ? "Total · no tax" : "Total with tax", value: money(total), big: true },
        ...(main
          ? [{ label: `In ${fx!.main}`, value: `≈ ${fx!.main} ${Number(main).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, quiet: true }]
          : []),
      ]}
    />
  );
}

/**
 * The offer's line columns (the view and the steps window's sheet): its currency in the price, its tax % for new lines.
 * Which item a line answers is kept on the line, not shown (design 18 Nov): copied lines keep it.
 */
export function offerColumns(lines: FactoryQuoteView["lines"], currency: string, taxRate: number, savedRate = taxRate): LineColumn[] {
  // Lines another spec can point at: the offer's main lines (not parts, not specs themselves).
  const mains = lines.filter((l) => !l.parentId && !l.alternativeOfId);
  const numberOf = (id: string) => lines.find((l) => l.id === id)?.no ?? "";

  // The currency is in the column's name ("Total CNY"), so the cells are plain numbers (design 18 Nov: it fits).
  const lineTotal = (v: LineValues) => {
    const p = Number((v.unitPrice ?? "").replace(/,/g, ""));
    const n = Number((v.quantity ?? "").replace(/,/g, ""));
    if (!Number.isFinite(p) || !Number.isFinite(n) || !p) return <Dash />;
    const t = plainAmount(Math.round(toMinor(p) * n));
    return v.alternativeOfId ? <span className="text-muted" title="Another spec: not in the total">({t})</span> : t;
  };
  // A line's tax % (design 18 Nov): on every line when the offer has tax; a line at its own % is marked.
  const rateOf = (v: LineValues) => lineRate(v.taxRate, taxRate, savedRate);
  const showTax = taxRate > 0 || lines.some((l) => lineRate(String(l.taxRate), taxRate, savedRate) !== taxRate);

  const columns: LineColumn[] = [
    {
      key: "description",
      label: "Description",
      width: "minmax(0,1fr)",
      input: "textarea",
      required: "Each item needs a description",
    },
    { key: "model", label: "Model / part no.", width: "5.5rem", input: "text", maxLength: 120, placeholder: "Model" },
    { key: "quantity", label: "Quantity", width: "4.25rem", input: "number", align: "right", initial: "1", required: "Enter a quantity" },
    { key: "unit", label: "Unit", width: "4.75rem", input: "unit", maxLength: 20, initial: (p) => (p ? "sets" : "pcs") },
    {
      key: "unitPrice",
      label: `Unit price ${currency}`,
      width: "6.5rem",
      input: "number",
      align: "right",
      placeholder: "0",
      format: (v) =>
        Number(v.unitPrice) ? (
          Number(v.unitPrice).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        ) : (
          <Dash />
        ),
    },
    ...(showTax
      ? [
          {
            key: "taxRate",
            label: "Tax",
            width: "4rem",
            input: "number" as const,
            align: "right" as const,
            initial: String(taxRate),
            phoneHidden: true,
            // On a phone a line's tax is said only when it has its own (the offer's % is said above the lines).
            summary: (v: LineValues) => (rateOf(v) === taxRate ? null : `Tax ${rateOf(v)}%`),
            format: (v: LineValues, row?: LineRow) => {
              if (row?.parentKey && !Number(v.unitPrice)) return <Dash />;
              const r = rateOf(v);
              return r === taxRate ? (
                <span className="text-text-2">{r}%</span>
              ) : (
                <span className="font-bold text-text" title="Its own tax %">
                  <span aria-hidden className="mr-1.5 inline-block size-1.5 rounded-full bg-action align-middle" />
                  {r}%<span className="sr-only"> (its own)</span>
                </span>
              );
            },
          },
        ]
      : []),
    ...(mains.length > 1 || lines.some((l) => l.alternativeOfId)
      ? [
          {
            key: "alternativeOfId",
            label: "Alternative to",
            width: "6.5rem",
            input: "select" as const,
            options: [{ value: "", label: "—" }, ...mains.map((l) => ({ value: l.id, label: `${l.no} ${l.description.split("\n")[0]!.slice(0, 30)}` }))],
            sheetChoices: [{ value: "", text: "" }, ...mains.map((l) => ({ value: l.id, text: l.no }))],
            phoneHidden: true,
            format: (v: LineValues) =>
              v.alternativeOfId ? (
                <Badge size="sm" tone="warn" title="Another spec of that item: a choice, left out of the total">
                  of {numberOf(v.alternativeOfId)}
                </Badge>
              ) : (
                <Dash />
              ),
          },
        ]
      : []),
    { key: "total", label: `Amount ${currency}`, width: "7rem", align: "right", format: lineTotal },
  ];
  return columns;
}

/* ---------------------------------------------------------------- the offer's page: a box per part */

/**
 * The offer's page (design 18 Nov, the inquiry's rules): the same boxes as its steps — Factory and Delivery &
 * payment side by side, then Prices, then Warranty & conditions — each with its own history clock and Edit (that part only),
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
  const footer =
    q.lines.length > 0 ? (
      <OfferTotals
        rows={rows}
        currency={q.currency}
        taxRate={Number(q.taxRate)}
        included={q.taxIncluded}
        extra={q.totalCost ? ["Our cost", amount(q.totalCost, mainCurrency)] : undefined}
      />
    ) : undefined;

  const terms = PAPER.ofOffer(q);
  return (
    <PaperLayout
      party={
        <RecordBox title="Supplier" what="the supplier" canEdit={canEdit} edit={edit("factory", "the supplier")} history={history(["offer.factory"], "Supplier")}>
          <BoxFacts
            rows={[
              ["Supplier", q.factory.name],
              ["Received on", dateText(q.receivedOn)],
              ["Valid until", q.validUntil ? dateText(q.validUntil) : null],
              ["Their reference", q.reference || null],
              [
                "Their quotation",
                q.files.length ? (
                  <span className="flex flex-col gap-1">
                    {q.files.map((f) => (
                      <a key={f.id} href={`/files/${f.id}?view=1`} className="font-semibold text-primary underline underline-offset-2 [overflow-wrap:anywhere]">
                        {f.fileName}
                      </a>
                    ))}
                  </span>
                ) : null,
              ],
            ]}
          />
        </RecordBox>
      }
      terms={
        <RecordBox title="Delivery & payment" what="delivery and payment" canEdit={canEdit} edit={edit("terms", "delivery and payment")} history={history(["offer.terms"], "Delivery & payment")}>
          <PaperFacts terms={terms} kind="offer" box="terms" />
        </RecordBox>
      }
      prices={
        <ItemsBox
          title="Prices"
          count={[q.lines.length ? linesCount(offerRows(q.lines)) : null, q.currency, Number(q.taxRate) > 0 ? offerTaxText(q.taxRate, q.taxIncluded) : "no tax"].filter(Boolean).join(" · ")}
          what="prices"
          canEdit={canEdit}
          edit={<OfferEdit kit={kit} q={q} step="prices" what="prices" words={q.lines.length ? undefined : "Add items"} only variant="ghost" />}
          tools={<LinesExcel name={`Prices from ${q.factory.name}`} rows={rows} columns={columns} numbers={numbers} />}
          history={history(["lines", "offer.prices"], "Prices")}
          label={`${q.factory.name} · prices`}
          rows={rows}
          columns={viewColumns}
          numbers={numbers}
          totals={footer}
          // A phone: the item line, read only (its model under its name, how many × the price, the amount on the right);
          // a tap shows the item, with Edit prices.
          phone={q.lines.map((l) => {
            const priced = Number(l.unitPrice) > 0;
            const minor = priced ? Math.round(toMinor(l.unitPrice) * Number(l.quantity)) : null;
            // The currency is said once, in the box's count and the totals; the sheet says it with each price.
            const amount = minor !== null ? plainAmount(minor) : null;
            const rate = lineRate(String(l.taxRate), Number(q.taxRate));
            const forItem = l.requestedItemId ? kit.items.find((it) => it.id === l.requestedItemId) : null;
            return {
              key: l.id,
              no: l.no,
              part: !!l.parentId,
              title: l.description.split("\n")[0],
              under: l.model || undefined,
              sub: (
                <>
                  {Number(l.quantity).toLocaleString("en-US")} {l.unit}
                  {priced && <> × {Number(l.unitPrice).toLocaleString("en-US", { minimumFractionDigits: 2 })}</>}
                </>
              ),
              amount: amount ?? (l.parentId ? undefined : <span className="rounded-md bg-warn-soft px-1.5 py-0.5 text-xs font-semibold text-warn">No price</span>),
              sheet: {
                sub: l.model || undefined,
                body: (
                  <>
                    <SheetPart>
                      <SheetFact label="Quantity">
                        {Number(l.quantity).toLocaleString("en-US")} {l.unit}
                      </SheetFact>
                      <SheetFact label="Unit price">{priced ? formatMinor(toMinor(l.unitPrice), q.currency) : "—"}</SheetFact>
                      {Number(q.taxRate) > 0 && (
                        <SheetFact label="Tax">
                          {rate}% · {q.taxIncluded ? "included" : "added"}
                        </SheetFact>
                      )}
                      <SheetFact label="Amount">{minor !== null ? formatMinor(minor, q.currency) : "—"}</SheetFact>
                      {forItem && <SheetFact label="For the customer’s">item {forItem.no}</SheetFact>}
                    </SheetPart>
                    {canEdit && (
                      <div className="px-4 pt-1 pb-2">
                        <OpenPanelButton panel="edit-offer" id="prices" className="w-full">
                          <Pencil aria-hidden /> Edit prices
                        </OpenPanelButton>
                      </div>
                    )}
                  </>
                ),
              },
            };
          })}
          empty="No items yet."
        />
      }
      conditions={
        <RecordBox title="Warranty & conditions" what="the warranty and conditions" canEdit={canEdit} edit={edit("conditions", "the warranty and conditions")} history={history(["offer.conditions"], "Warranty & conditions")}>
          <PaperFacts terms={terms} kind="offer" box="conditions" />
        </RecordBox>
      }
    />
  );
}

/* ---------------------------------------------------------------- add an offer */

/**
 * "Enter an offer": the New factory offer window (design 18 Nov): Factory · Prices · Delivery & payment · Warranty & conditions,
 * then Review and Add the offer. The factories asked for this inquiry come first in its picker.
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
          title="New supplier offer"
          description={refNo ? `For ${[refNo, inquiryTitle].filter(Boolean).join(" · ")}` : "Internal, never shown to the customer."}
          className={RULES.window.items}
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

