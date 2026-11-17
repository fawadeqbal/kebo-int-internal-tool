"use client";

import { useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Info, ListPlus, Pencil, Plus, Trash2 } from "lucide-react";
import { formatMinor, toMinor } from "@kebo/money";
import { ATTACHMENT_KIND_LABEL, basisText, partsWords, warrantyLine, type AttachmentKind } from "@kebo/shared";
import { Button, cn, Field, Select, Textarea } from "@kebo/ui";
import { SubmitButton, toast } from "@kebo/ui/client";
import { LineTable, type LineColumn, type LineMove, type LineResult, type LineRow, type LineValues, type NewLine } from "@/components/lines/line-table";
import { LinesCard } from "@/components/orders/step-view";
import { PanelBody, SidePanel, useClosePanel, WhatHappens } from "@/components/common/panel";
import { ConfirmDialog } from "@/components/common/dialog";
import type { ActionState } from "@/lib/actions";
import { date as dateText, money as amount } from "@/lib/format";
import type { FactoryOption, FactoryQuoteView, OfferFile, SourcingView } from "@/lib/types-deals";
import type { OfferLineResult } from "@/app/(app)/inquiries/[id]/sourcing/actions";
import { send, type Staged } from "./documents-panel";
import { FileRow, FileZone } from "@/components/common/file-zone";
import { fileSize } from "@/lib/format";
import { OfferHeaderForm, type OfferStep } from "./factory-quote-form";
import { LinesExcel, LinesView } from "./lines-view";
import { useBatchLines, type LineHandlers } from "@/components/edits/batch-lines";
import { useEditSave } from "@/components/edits/use-edit-save";
import { editedMark } from "@/components/edits/edits";
import type { EditCard } from "@/lib/types-edits";

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
};

/**
 * Edit with its word (never a pencil alone): opens the offer's steps window on `step` (Lines · Delivery ·
 * Payment · Warranty & conditions). `what` finishes its name for screen readers ("Edit delivery").
 */
export function OfferEdit({
  kit,
  q,
  step,
  what,
  words,
  size = "xs",
  variant = "secondary",
}: {
  kit: OfferKit;
  q: FactoryQuoteView;
  step: OfferStep;
  what?: string;
  words?: string;
  size?: "xs" | "sm";
  variant?: "primary" | "secondary";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant={variant} onClick={() => setOpen(true)} className="tracking-normal normal-case">
        <Pencil aria-hidden />
        {words ?? (
          <>
            Edit{what && <span className="sr-only"> {what}</span>}
          </>
        )}
      </Button>
      {open && (
        <SidePanel title={`Edit · ${q.factory.name}’s offer`} description="Internal, never shown to the customer." onClose={() => setOpen(false)} className="md:w-[1180px]">
          <OfferWindow {...kit} q={q} startStep={step} />
        </SidePanel>
      )}
    </>
  );
}

/** One of the offer's terms (design 17 Nov): its title and Edit, then what it says. */
function TermGroup({ title, edit, children }: { title: string; edit?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-1 px-4 py-3 text-[13px] leading-relaxed text-text-2 max-md:border-b max-md:border-line max-md:last:border-b-0 md:border-l md:border-line md:first:border-l-0">
      <h3 className="flex min-h-8 items-center justify-between gap-2 text-xs font-bold tracking-wide text-text uppercase">
        {title}
        {edit}
      </h3>
      {children}
    </section>
  );
}

/** The offer's terms in three groups, each with Edit opening its step: Delivery · Payment · Warranty & conditions. */
export function OfferTerms({ q, kit }: { q: FactoryQuoteView; /** Given when the offer can be edited. */ kit?: OfferKit }) {
  const edit = (step: OfferStep, what: string) => (kit ? <OfferEdit kit={kit} q={q} step={step} what={what} /> : undefined);
  const none = <span className="text-muted">Not said</span>;
  return (
    <div className="grid overflow-hidden rounded-xl border border-line bg-surface md:grid-cols-3">
      <TermGroup title="Delivery" edit={edit("delivery", "delivery")}>
        <span className="font-medium text-text">{q.basis ? basisText(q.basis, q.basisPlace) : "Delivery basis not said"}</span>
        {q.leadTime ? <span>{q.leadTime}</span> : <span className="text-muted">Lead time not said</span>}
      </TermGroup>
      <TermGroup title="Payment" edit={edit("payment", "payment")}>
        {q.paymentParts.length ? <span className="font-medium text-text">{partsWords(q.paymentParts, "factory")}</span> : none}
        {q.paymentTerms && <span className="line-clamp-3 whitespace-pre-line">{q.paymentTerms}</span>}
      </TermGroup>
      <TermGroup title="Warranty & conditions" edit={edit("warranty", "warranty and conditions")}>
        <span className="font-medium text-text">{warrantyLine(q)?.replace(/\.$/, "") ?? "No warranty said"}</span>
        {q.moq && <span>Minimum order {q.moq}</span>}
        {q.notes && <span className="line-clamp-4 whitespace-pre-line">{q.notes}</span>}
      </TermGroup>
    </div>
  );
}

/**
 * The offer's window, the same for "Enter factory offer" (no offer yet) and "Edit the offer": the four
 * sections of OfferHeaderForm, the factory's own files, and the buttons. A new offer saved shows on the
 * page, opened ("Save offer"), or empties the window ("Save & enter another"); an edit closes. Removing
 * the offer, or one of its files, asks first and says what happens.
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
  startStep,
}: {
  /** The customer's items (a new offer can start from them; a line says which it answers). */
  items: Items;
  /** The inquiry's other offers with lines (their lines can be copied). */
  others: FactoryQuoteView[];
  lineActions: OfferLineActions;
  /** The lines' saved edits ("Edited n×"). */
  linesCard?: EditCard | null;
  /** The step it opens on (Edit lines: Lines; a group's Edit: its step). */
  startStep?: OfferStep;
  dealId: string;
  /** The offer being edited; null: a new one. */
  q: FactoryQuoteView | null;
  /** A new offer: how many items the customer listed (its lines can start from them). */
  today: string;
  mainCurrency: string;
  rates: Record<string, number>;
  searchFactories: (q: string) => Promise<FactoryOption[]>;
  saveAction: Action;
  removeAction?: Action;
  removeFile?: OfferLineActions["removeFile"];
  taxDefault?: { included: boolean; rate: number; advance?: number };
  /** "Save & enter another": the window starts again, empty. */
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
  // The Lines step (design 17 Nov): the offer's lines on a copy, saved with the offer by the window's one Save.
  const [step, setStep] = useState<OfferStep>(startStep ?? "lines");
  const savedRows = useMemo(() => offerRows(q?.lines ?? []), [q]);
  const baseColumns = useMemo(() => offerColumns(q?.lines ?? [], items, q?.currency ?? mainCurrency, q?.taxRate ?? taxDefault?.rate ?? 0), [q, items, mainCurrency, taxDefault]);
  const batch = useBatchLines({ rows: savedRows, columns: baseColumns, plain: !used });
  const linesSave = useEditSave({ edit: q ? { type: "factory_quote", id: q.id, card: "lines" } : undefined, card: linesCard });
  const [copyFrom, setCopyFrom] = useState(others[0]?.id ?? "");

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

  // Saved: a new offer's window closes (or starts again: Save & enter another); an offer's new files go up,
  // then its changed lines, then the window closes.
  const done = async (st: ActionState) => {
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
    router.refresh();
    if (problems.length) {
      setFiles([]);
      setError(`The offer was saved, but: ${problems.join(" ")}`);
      return;
    }
    // Then an offer's changed lines (the Lines step), in the order they were changed; a refused one opens
    // the Lines step. (A new offer's lines went in the same save.)
    if (batch.dirty) {
      await linesSave.save({
        changes: batch.diff.changes,
        keys: batch.diff.keys,
        askWhy: batch.askWhy,
        run: async (reason) => {
          const r = await batch.run(offerLineHandlers(id, q, lineActions), reason);
          if (!r.ok) setStep("lines");
          return r;
        },
      });
      return;
    }
    // Saved: close without asking "Throw away your changes?".
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
      <FileZone
        label="The factory’s own quotation"
        hint="Their PDF, Excel or screenshots · seen only by people who see factory prices"
        onFiles={(list) => setFiles((x) => [...x, ...list])}
      >
        {files.length > 0 &&
          files.map((file, n) => (
            <FileRow
              key={`${file.name}-${n}`}
              name={file.name}
              meta={`${ATTACHMENT_KIND_LABEL[guessOfferKind(file.name, file.type)]} · ${fileSize(file.size)} · goes up when you save`}
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

  return (
    <PanelBody fill>
      <OfferHeaderForm
        step={step}
        onStep={setStep}
        linesSummary={batch.rows.length ? `${batch.rows.length} line${batch.rows.length === 1 ? "" : "s"}` : "no lines yet"}
        lines={(h) => {
          const columns = offerColumns(q?.lines ?? [], items, h.currency || mainCurrency, h.taxRate);
          const fromItems = () =>
            items.map((it) => ({ id: it.id, parentId: it.parentId, values: { description: it.description, model: it.model ?? "", requestedItemId: it.id, quantity: it.quantity, unit: it.unit, unitPrice: "", taxRate: String(h.taxRate) } }));
          return (
            <div className="flex flex-col gap-3">
              {used && (
                <p className="flex items-start gap-2 rounded-xl border border-info/25 bg-info-soft px-3 py-2.5 text-sm">
                  <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
                  <span>A quotation is priced from this offer. Saving changes to its lines asks why; the quotation keeps its own copy.</span>
                </p>
              )}
              {batch.rows.length === 0 && (items.length > 0 || others.length > 0) && (
                <LinesStart
                  items={items.length}
                  others={others}
                  copyFrom={copyFrom}
                  setCopyFrom={setCopyFrom}
                  onItems={() => batch.add(newLinesOf(fromItems()))}
                  onCopy={(o) => batch.add(newLinesOf(o.lines.filter((l) => !l.alternativeOfId).map((l) => ({ id: l.id, parentId: l.parentId, values: { description: l.description, model: l.model ?? "", requestedItemId: l.requestedItemId ?? "", quantity: l.quantity, unit: l.unit, unitPrice: "", taxRate: String(h.taxRate) } }))))}
                />
              )}
              <LineTable
                rows={batch.rows}
                columns={columns}
                noun="line"
                sheet={{
                  name: `Prices from ${q?.factory.name ?? "the factory"}`,
                  upload: !used,
                  templateRows: items.map((it) => ({ no: it.no, values: { description: it.description, model: it.model ?? "", requestedItemId: it.id, quantity: it.quantity, unit: it.unit, unitPrice: "", taxRate: String(h.taxRate) } })),
                }}
                {...batch.local}
                footer={
                  batch.rows.length ? (
                    <div className="flex flex-wrap items-center justify-end gap-x-1.5 px-3 py-2 text-sm text-muted">
                      Factory total <span className="font-semibold text-text tabular">{formatMinor(linesTotal(batch.rows), h.currency || mainCurrency)}</span>
                      {h.taxIncluded ? `tax ${h.taxRate}% included` : h.taxRate > 0 ? `+ ${h.taxRate}% tax` : "no tax"}
                    </div>
                  ) : null
                }
              />
              {h.errors.length > 0 && (
                <div role="alert" className="flex flex-col gap-0.5 rounded-xl border border-bad/30 bg-bad-soft px-3 py-2.5 text-sm text-bad">
                  <span className="font-semibold">Nothing was saved yet: fix {h.errors.length === 1 ? "this line" : "these lines"} first.</span>
                  {h.errors.map((e) => (
                    <span key={e}>{e}</span>
                  ))}
                </div>
              )}
              {linesSave.error && (
                <p role="alert" className="text-sm text-bad">
                  The offer was saved, but its lines were not: {linesSave.error} Save again to send the rest.
                </p>
              )}
            </div>
          );
        }}
        action={q ? saveAction : create}
        extra={!q && batch.rows.length ? { lines: newOfferLines(batch.rows) } : undefined}
        quote={q}
        today={today}
        mainCurrency={mainCurrency}
        rates={rates}
        searchFactories={searchFactories}
        onDone={(st) => void done(st)}
        defaults={taxDefault ? { taxIncluded: taxDefault.included, taxRate: taxDefault.rate, advancePercent: taxDefault.advance } : undefined}
        files={fileRows}
        note={
          <>
            {error && <p className="text-sm text-bad">{error}</p>}
          </>
        }
        footerStart={
          q && removeAction ? (
            <button type="button" onClick={() => (setAskError(null), setWhy(""), setAsking("offer"))} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-bad hover:underline">
              <Trash2 className="size-4" aria-hidden /> Remove this offer
            </button>
          ) : undefined
        }
        footer={(last) =>
          q ? (
            <>
              <Button type="button" variant="ghost" onClick={() => close()} className="max-md:hidden">
                Cancel
              </Button>
              <SubmitButton variant={last ? "primary" : "secondary"} pendingText="Saving…">
                <Check aria-hidden /> Save
              </SubmitButton>
            </>
          ) : (
            <>
              <Button type="button" variant="ghost" onClick={() => close()} className="max-md:hidden">
                Cancel
              </Button>
              {last && (
                <SubmitButton variant="secondary" pendingText="Saving…" onClick={() => (another.current = true)}>
                  <Plus aria-hidden /> Save &amp; enter another
                </SubmitButton>
              )}
              <SubmitButton variant={last ? "primary" : "secondary"} pendingText="Saving…" onClick={() => (another.current = false)}>
                <Check aria-hidden /> Save offer
              </SubmitButton>
            </>
          )
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
              <Field label="Why" htmlFor="remove-offer-why" hint="Kept in History: a quotation is priced from this offer">
                <Textarea id="remove-offer-why" rows={2} value={why} onChange={(e) => setWhy(e.target.value)} maxLength={500} />
              </Field>
            )}
            {askError && <p className="text-sm text-bad">{askError}</p>}
          </div>
        </ConfirmDialog>
      )}
      {linesSave.dialog}
    </PanelBody>
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

/** An offer with no lines yet: start from the customer's list, or copy another factory's lines (prices empty). */
function LinesStart({
  items,
  others,
  copyFrom,
  setCopyFrom,
  onItems,
  onCopy,
}: {
  items: number;
  others: FactoryQuoteView[];
  copyFrom: string;
  setCopyFrom: (id: string) => void;
  onItems: () => void;
  onCopy: (o: FactoryQuoteView) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border-[1.5px] border-dashed border-primary/40 bg-primary-soft/20 p-3 sm:p-4">
      <p className="text-sm font-semibold">Start the lines</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {items > 0 && (
          <button type="button" onClick={onItems} className="flex items-start gap-2.5 rounded-lg border border-primary/30 bg-surface px-3 py-2.5 text-left text-sm hover:border-primary">
            <ListPlus className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <span>
              <span className="block font-medium">From the customer&apos;s list ({items})</span>
              <span className="block text-xs text-text-2">Then change the models and add their prices</span>
            </span>
          </button>
        )}
        {others.length > 0 && (
          <div className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-surface px-3 py-2.5 text-sm">
            <span className="flex items-start gap-2.5">
              <Copy className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <span>
                <span className="block font-medium">Copy another factory&apos;s lines</span>
                <span className="block text-xs text-text-2">Same lines, prices left empty</span>
              </span>
            </span>
            <span className="flex flex-wrap items-center gap-1.5">
              <Select compact aria-label="Offer to copy lines from" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} className="h-8 min-w-0 flex-1">
                {others.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.factory.name} ({o.lines.length})
                  </option>
                ))}
              </Select>
              <Button
                size="xs"
                variant="secondary"
                onClick={() => {
                  const o = others.find((x) => x.id === copyFrom);
                  if (o) onCopy(o);
                }}
              >
                Copy
              </Button>
            </span>
          </div>
        )}
      </div>
      <p className="text-xs text-muted">Or type the first line in the table below, or paste their list.</p>
    </div>
  );
}

/** The offer's line columns (the view and the steps window's sheet): its currency in the price, its tax % for new lines. */
export function offerColumns(lines: FactoryQuoteView["lines"], items: Items, currency: string, taxRate: number): LineColumn[] {
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
      label: "Description (as the factory wrote it)",
      width: "minmax(0,1fr)",
      input: "textarea",
      required: "Each line needs a description",
    },
    { key: "model", label: "Model", width: "7rem", input: "text", maxLength: 120, placeholder: "Model" },
    ...(items.length
      ? [
          {
            key: "requestedItemId",
            label: "For item",
            width: "4.5rem",
            input: "select" as const,
            options: [
              { value: "", label: "— extra" },
              ...items.map((it) => ({ value: it.id, label: `${it.no} ${it.description.split("\n")[0]!.slice(0, 40)}` })),
            ],
            sheetChoices: [{ value: "", text: "extra" }, ...items.map((it) => ({ value: it.id, text: it.no }))],
            format: (v: LineValues) => items.find((it) => it.id === v.requestedItemId)?.no ?? <span className="text-muted">extra</span>,
          },
        ]
      : []),
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
    {
      key: "taxRate",
      label: "Tax %",
      width: "3.5rem",
      input: "number",
      align: "right",
      initial: String(taxRate),
      phoneHidden: true,
    },
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
    { key: "total", label: "Total", width: "9.5rem", align: "right", format: lineTotal },
  ];
  return columns;
}

/* ---------------------------------------------------------------- the offer's lines */

/**
 * "<factory> · lines": read only (Excel in the table's menu), Edit lines for
 * today's line table — typed, pasted, uploaded or copied from another
 * factory's offer, saved as they are made, a reason asked once a quotation is
 * priced from it.
 */
export function OfferLines({
  q,
  items,
  canEdit,
  mainCurrency,
  edits,
  kit,
}: {
  /** The offer's window: Edit lines opens it on the Lines step. */
  kit: OfferKit;
  q: FactoryQuoteView;
  items: Items;
  canEdit: boolean;
  mainCurrency: string;
  /** This offer's saved edits to its lines ("Edited n×"). */
  edits?: EditCard | null;
}) {
  const used = q.lines.some((l) => l.used);
  const rows: LineRow[] = q.lines.map((l) => ({
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
  // The view marks lines changed since they were first saved ("edited 2×"); the editor shows them plain.
  const viewRows: LineRow[] = rows.map((r) => ({ ...r, badge: editedMark(edits, r.key) }));
  const columns = offerColumns(q.lines, items, q.currency, q.taxRate);

  // Read only, narrower: the model only when a line has one, no room kept for typing.
  const narrow: Record<string, string> = {
    requestedItemId: "4rem",
    quantity: "4rem",
    unit: "4rem",
    unitPrice: "6rem",
    taxRate: "3.5rem",
    total: "7rem",
  };
  const viewColumns = columns
    .filter((c) => c.key !== "model" || q.lines.some((l) => l.model))
    .map((c) => (narrow[c.key] ? { ...c, width: narrow[c.key]! } : c))
    .map((c) =>
      c.key === "total"
        ? {
            ...c,
            format: (v: LineValues) => {
              const p = Number((v.unitPrice ?? "").replace(/,/g, ""));
              const n = Number((v.quantity ?? "").replace(/,/g, ""));
              const t = (p * n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
              return p && Number.isFinite(p * n) ? (
                v.alternativeOfId ? <span className="text-muted" title="Another spec: not in the total">({t})</span> : t
              ) : (
                <span className="text-muted">—</span>
              );
            },
          }
        : c,
    );

  // One % for every line: said in the footer ("Tax 13%"); lines with their own %: "Tax".
  const rates = [...new Set(q.lines.map((l) => Number(l.taxRate)))];
  const ratePart = rates.length === 1 ? ` ${rates[0]}%` : "";
  const strong = (v: ReactNode) => <span className="font-semibold text-text tabular">{v}</span>;
  const footer =
    q.lines.length > 0 ? (
      <div className="flex flex-wrap items-center justify-end gap-x-1.5 gap-y-1 px-3 py-2 text-sm text-muted">
        <span>
          Factory total {strong(formatMinor(toMinor(q.factoryTotal), q.currency))} {q.taxIncluded ? "tax included" : "without tax"}
        </span>
        <span aria-hidden>·</span>
        <span>
          {q.taxIncluded ? `of which tax${ratePart}` : `Tax${ratePart}`} {strong(formatMinor(toMinor(q.taxTotal), q.currency))}
        </span>
        {q.totalCost && (
          <>
            <span aria-hidden>·</span>
            <span>Our cost {strong(amount(q.totalCost, mainCurrency))}</span>
          </>
        )}
      </div>
    ) : undefined;

  const sheet = {
    name: `Prices from ${q.factory.name}`,
    // Lines from a file go into an offer no quotation is priced from yet.
    upload: !used,
    templateRows: items.map((it) => ({
      no: it.no,
      values: {
        description: it.description,
        model: it.model ?? "",
        requestedItemId: it.id,
        quantity: it.quantity,
        unit: it.unit,
        unitPrice: "",
        taxRate: String(q.taxRate),
      },
    })),
  };

  return (
    <LinesCard
      title={`${q.factory.name} · lines`}
      description={
        q.lines.length
          ? q.taxIncluded
            ? `Tax included · ${q.taxRate}%: the tax inside the price is shown, not added again`
            : `Without tax · ${q.taxRate}%: ${q.taxRate > 0 ? "the tax is added on top for our cost" : "our cost is the factory's price"}`
          : "No lines yet: Add lines to type, paste or upload them, or start from the customer’s list."
      }
      canEdit={canEdit}
      editLabel={q.lines.length ? "Edit lines" : "Add lines"}
      actions={<LinesExcel name={sheet.name} rows={rows} columns={columns} numbers={q.lines.map((l) => l.no)} />}
      view={
        q.lines.length ? (
          <LinesView label={`${q.factory.name} · lines`} rows={viewRows} columns={viewColumns} numbers={q.lines.map((l) => l.no)} footer={footer} />
        ) : (
          <p className="text-sm text-muted">No lines yet.</p>
        )
      }
      phone={
        q.lines.length ? (
          <ul className="flex flex-col divide-y divide-line text-sm">
            {q.lines.map((l) => (
              <li key={l.id} className={cn("flex justify-between gap-3 py-2", l.parentId && "pl-4")}>
                <span className="min-w-0">
                  <span className="mr-1.5 text-xs text-muted tabular">{l.no}</span>
                  {l.description.split("\n")[0]}
                  <span className="block text-xs text-muted tabular">
                    {Number(l.quantity).toLocaleString("en-US")} {l.unit}
                  </span>
                </span>
                <span className="shrink-0 tabular">
                  {Number(l.unitPrice) ? formatMinor(Math.round(toMinor(l.unitPrice) * Number(l.quantity)), q.currency) : "—"}
                </span>
              </li>
            ))}
          </ul>
        ) : undefined
      }
      edits={edits}
      panelTitle={`Edit · ${q.factory.name}’s offer`}
      panelDescription="Internal, never shown to the customer."
      edit={<OfferWindow {...kit} q={q} startStep="lines" />}
    />
  );
}


/* ---------------------------------------------------------------- add an offer */

/**
 * "Enter an offer": a short window for the offer itself (the factory, its reference, dates, currency, price
 * basis, tax, lead time and terms, notes, their files). Its lines are not entered here: saving shows the
 * offer on the page, and "Add lines" there opens its lines editor.
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
}: {
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
  // "Save & enter another": the window starts again, empty.
  const [round, setRound] = useState(0);
  return (
    <>
      <Button size={size} variant={variant} onClick={() => setOpen(true)}>
        <Plus aria-hidden /> {label}
      </Button>
      {open && (
        <SidePanel
          key={round}
          title="Enter factory offer"
          description={`${refNo ? `${refNo} · ` : ""}The factory and its terms. Internal, never shown to the customer.`}
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
          />
        </SidePanel>
      )}
    </>
  );
}

