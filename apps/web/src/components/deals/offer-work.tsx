"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Download, Eye, FileText, Info, ListPlus, Plus, Trash2 } from "lucide-react";
import { formatMinor, toMinor } from "@kebo/money";
import { ATTACHMENT_KIND_LABEL, basisText, INCOTERMS, offerTaxText, type AttachmentKind } from "@kebo/shared";
import { Badge, Button, cn, Field, Select, Textarea } from "@kebo/ui";
import { ConfirmSubmit, SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { type LineColumn, type LineMove, type LineResult, type LineRow, type LineValues, type NewLine } from "@/components/lines/line-table";
import { DetailsCard, LinesCard, type DetailField } from "@/components/orders/step-view";
import { PanelBody, PanelFooter, SidePanel, useClosePanel, WhatHappens } from "@/components/common/panel";
import { ConfirmDialog } from "@/components/common/dialog";
import type { ActionState } from "@/lib/actions";
import { date as dateText, money as amount } from "@/lib/format";
import { rateSentence } from "@/lib/fx";
import type { FactoryOption, FactoryQuoteView, OfferFile, SourcingView } from "@/lib/types-deals";
import type { OfferLineResult } from "@/app/(app)/inquiries/[id]/sourcing/actions";
import { FileDrop, send, type Staged } from "./documents-panel";
import { FileRow, FileZone } from "@/components/common/file-zone";
import { fileSize } from "@/lib/format";
import { OfferHeaderForm } from "./factory-quote-form";
import { LinesExcel, LinesView } from "./lines-view";
import { BatchLines } from "@/components/edits/batch-lines";
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

const OFFER_FILE_KINDS: AttachmentKind[] = ["factory_quote", "specification", "drawing", "photo", "other"];
/** A factory's file is its quotation unless it is clearly something else. */
const guessOfferKind = (name: string, type: string): AttachmentKind => {
  const n = name.toLowerCase();
  if (/catalog|brochure|spec|datasheet|technical/.test(n)) return "specification";
  if (/\.(dwg|dxf|step|stp)$/.test(n) || /drawing|layout/.test(n)) return "drawing";
  if (type.startsWith("image/") && !/quot|offer|price|pi\b/.test(n)) return "photo";
  return "factory_quote";
};

const size = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

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


/* ---------------------------------------------------------------- the offer's details */

/**
 * "<factory> · the offer" (board InqV4Prices): its details read only, "n of 8
 * filled", "+ Add" in place for an empty one, Edit for today's offer form in
 * the side panel (with Remove), and the factory's files.
 */
export function OfferDetails({
  dealId,
  q,
  canEdit,
  today,
  mainCurrency,
  rates,
  searchFactories,
  saveAction,
  fieldsAction,
  removeAction,
  removeFile,
}: {
  dealId: string;
  q: FactoryQuoteView;
  canEdit: boolean;
  today: string;
  mainCurrency: string;
  rates: Record<string, number>;
  searchFactories: (q: string) => Promise<FactoryOption[]>;
  /** The offer's form (PUT), bound to it. */
  saveAction: Action;
  /** One value at a time ("+ Add"). */
  fieldsAction: Action;
  removeAction: Action;
  removeFile: (fileId: string, prev: ActionState, form: FormData) => Promise<ActionState>;
}) {
  const [adding, setAdding] = useState(false);
  const rate = q.currency !== mainCurrency ? rateSentence({ main: mainCurrency, rates }, mainCurrency, q.currency) : null;
  const fields: DetailField[] = [
    {
      name: "basis",
      label: "Price basis",
      type: "select",
      value: q.basis,
      options: INCOTERMS.map((t) => ({ value: t, label: t })),
      show: q.basis ? basisText(q.basis, q.basisPlace) : undefined,
    },
    {
      label: "Currency",
      value: q.currency,
      show:
        q.fxRate === null ? (
          <span className="text-warn">{q.currency} · no rate in Settings</span>
        ) : (
          `${q.currency}${rate ? ` · ${rate}` : ""}`
        ),
    },
    { name: "leadTime", label: "Lead time", value: q.leadTime, placeholder: "e.g. 45 days" },
    // Changed with the offer's form (Edit): it moves the lines' tax too.
    { label: "Tax", value: String(q.taxRate), show: offerTaxText(q.taxRate, q.taxIncluded), uncounted: true },
    {
      name: "validUntil",
      label: "Valid until",
      type: "date",
      value: q.validUntil,
      show: q.validUntil ? dateText(q.validUntil) : undefined,
    },
    {
      name: "advancePercent",
      label: "Advance when we order",
      type: "number",
      value: q.advancePercent === null ? null : String(q.advancePercent),
      show: q.advancePercent === null ? undefined : `${q.advancePercent}% · starts the factory's plan, printed on the PO`,
      placeholder: "e.g. 30",
    },
    { name: "paymentTerms", label: "Payment terms (note)", value: q.paymentTerms, placeholder: "e.g. 70% before shipment, by T/T" },
    { name: "warranty", label: "Warranty", value: q.warranty, placeholder: "e.g. 12 months from commissioning" },
    { name: "moq", label: "Minimum order", value: q.moq },
    { name: "reference", label: "Their ref.", value: q.reference, placeholder: "Their quote no." },
    { label: "Received", value: q.receivedOn, show: dateText(q.receivedOn), uncounted: true },
    {
      label: "Quotation file",
      value: q.files.length ? q.files.map((f) => f.fileName).join(", ") : null,
      show: (
        <span className="flex flex-col items-start gap-1">
          {q.files.map((f) => (
            <OfferFileChip key={f.id} f={f} canEdit={canEdit} remove={removeFile.bind(null, f.id)} />
          ))}
          {canEdit && !adding && (
            <button type="button" onClick={() => setAdding(true)} className="text-xs font-medium text-primary hover:underline">
              + Add files
            </button>
          )}
        </span>
      ),
      empty: canEdit ? (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-0.5 rounded text-sm font-medium text-primary hover:underline"
          aria-label="Add their quotation file"
        >
          <Plus className="size-3.5" aria-hidden /> Add
        </button>
      ) : undefined,
    },
  ];
  return (
    <DetailsCard
      id="offer"
      title={`${q.factory.name} · the offer`}
      description="Internal, never shown to the customer."
      fields={fields}
      action={fieldsAction}
      canEdit={canEdit}
      panelTitle={`Edit ${q.factory.name}’s offer`}
      panelDescription="The factory and its terms. Internal, never shown to the customer. Its lines are changed with Edit lines."
      panelClassName="md:w-[860px]"
      panelBody={
        <OfferWindow
          dealId={dealId}
          q={q}
          today={today}
          mainCurrency={mainCurrency}
          rates={rates}
          searchFactories={searchFactories}
          saveAction={saveAction}
          removeAction={removeAction}
          removeFile={removeFile}
        />
      }
      footer={
        <>
          {q.notes && <p className="mx-4 mb-4 rounded-lg bg-surface-2/60 px-3 py-2 text-sm whitespace-pre-line text-text-2">{q.notes}</p>}
          {canEdit && adding && <OfferFileDrop dealId={dealId} q={q} onDone={() => setAdding(false)} />}
        </>
      }
    />
  );
}

/**
 * The offer's window, the same for "Enter factory offer" (no offer yet) and "Edit the offer": the four
 * sections of OfferHeaderForm, the factory's own files, and the buttons. A new offer saved opens its lines
 * editor ("Save and add lines") or empties the window ("Save & enter another"); an edit closes. Removing
 * the offer, or one of its files, asks first and says what happens.
 */
function OfferWindow({
  dealId,
  q,
  itemCount = 0,
  today,
  mainCurrency,
  rates,
  searchFactories,
  saveAction,
  removeAction,
  removeFile,
  taxDefault,
  onAnother,
}: {
  dealId: string;
  /** The offer being edited; null: a new one. */
  q: FactoryQuoteView | null;
  /** A new offer: how many items the customer listed (its lines can start from them). */
  itemCount?: number;
  today: string;
  mainCurrency: string;
  rates: Record<string, number>;
  searchFactories: (q: string) => Promise<FactoryOption[]>;
  saveAction: Action;
  removeAction?: Action;
  removeFile?: OfferLineActions["removeFile"];
  taxDefault?: { included: boolean; rate: number };
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

  // Saved: its new files go up, then the window closes (a new offer opens its lines editor).
  const done = async (st: ActionState) => {
    const id = q?.id ?? (st.data as { id?: string } | undefined)?.id;
    if (!id) return;
    setError(null);
    const problems: string[] = [];
    for (const file of files) {
      const staged: Staged = { key: file.name, file, kind: guessOfferKind(file.name, file.type), note: "", progress: 0, error: null };
      const e = await send(dealId, staged, () => {}, { factoryQuoteId: id });
      if (e) problems.push(`${file.name} did not upload: ${e}`);
    }
    router.refresh();
    if (problems.length) {
      setFiles([]);
      setError(`The offer was saved, but: ${problems.join(" ")}`);
      return;
    }
    if (!q && another.current) {
      another.current = false;
      onAnother?.();
      return;
    }
    // Saved: close without asking "Discard changes?".
    close(st);
    if (!q) router.push(`/inquiries/${dealId}/sourcing?offer=${id}#edit-lines`);
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
    <PanelBody>
      <OfferHeaderForm
        action={saveAction}
        quote={q}
        today={today}
        mainCurrency={mainCurrency}
        rates={rates}
        searchFactories={searchFactories}
        onDone={(st) => void done(st)}
        defaults={taxDefault ? { taxIncluded: taxDefault.included, taxRate: taxDefault.rate } : undefined}
        files={fileRows}
        note={
          <>
            {!q && (
              <p className="flex items-start gap-2 rounded-xl border border-info/25 bg-info-soft px-3 py-2.5 text-sm">
                <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
                <span>
                  Their lines and prices come next: <strong>Save and add lines</strong> opens this offer&rsquo;s lines editor
                  {itemCount ? `, starting from the customer’s ${itemCount === 1 ? "item" : `${itemCount} items`}` : ""}.
                </span>
              </p>
            )}
            {error && <p className="text-sm text-bad">{error}</p>}
          </>
        }
        footer={
          q ? (
            <PanelFooter
              start={
                removeAction ? (
                  <button type="button" onClick={() => (setAskError(null), setWhy(""), setAsking("offer"))} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-bad hover:underline">
                    <Trash2 className="size-4" aria-hidden /> Remove this offer
                  </button>
                ) : undefined
              }
            >
              <Button type="button" variant="ghost" onClick={() => close()}>
                Cancel
              </Button>
              <SubmitButton pendingText="Saving…">
                <Check aria-hidden /> Save the details
              </SubmitButton>
            </PanelFooter>
          ) : (
            <PanelFooter>
              <Button type="button" variant="ghost" onClick={() => close()}>
                Cancel
              </Button>
              <SubmitButton variant="secondary" pendingText="Saving…" onClick={() => (another.current = true)}>
                <Plus aria-hidden /> Save &amp; enter another
              </SubmitButton>
              <SubmitButton pendingText="Saving…" onClick={() => (another.current = false)}>
                <Check aria-hidden /> Save and add lines
              </SubmitButton>
            </PanelFooter>
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
    </PanelBody>
  );
}

/** Upload the factory's quotation, catalogue or screenshots to the offer. */
function OfferFileDrop({ dealId, q, onDone }: { dealId: string; q: FactoryQuoteView; onDone: () => void }) {
  const router = useRouter();
  const [staged, setStaged] = useState<Staged[]>([]);
  const [busy, setBusy] = useState(false);
  const patch = (key: string, p: Partial<Staged>) => setStaged((s) => s.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const upload = async () => {
    setBusy(true);
    let done = 0;
    for (const s of staged) {
      if (s.progress === 100 && !s.error) continue;
      patch(s.key, { progress: 0, error: null });
      const error = await send(dealId, s, (p) => patch(s.key, { progress: p }), { factoryQuoteId: q.id });
      patch(s.key, { progress: error ? null : 100, error });
      if (!error) done += 1;
    }
    setBusy(false);
    if (done) {
      router.refresh();
      onDone();
    }
    setStaged((s) => s.filter((x) => x.error));
  };
  return (
    <div className="flex flex-col gap-2 border-t border-line px-4 py-3">
      <FileDrop
        staged={staged}
        setStaged={setStaged}
        busy={busy}
        onUpload={() => void upload()}
        kinds={OFFER_FILE_KINDS}
        guess={guessOfferKind}
        title={`Drop ${q.factory.name}'s quotation, catalogue or screenshots here`}
      />
      {!staged.length && (
        <Button size="xs" variant="ghost" className="self-start" onClick={onDone}>
          Close
        </Button>
      )}
    </div>
  );
}

function OfferFileChip({ f, canEdit, remove }: { f: OfferFile; canEdit: boolean; remove: Action }) {
  const viewable = /^(application\/pdf|image\/(png|jpeg|gif|webp))$/.test(f.mimeType);
  return (
    <span
      className="inline-flex max-w-full items-center gap-1 rounded-full bg-surface-2 py-0.5 pr-1 pl-3 text-xs font-normal"
      title={`${ATTACHMENT_KIND_LABEL[f.kind]} · ${size(f.size)} · ${dateText(f.uploadedOn)}${f.note ? ` · ${f.note}` : ""}`}
    >
      <FileText className="size-3.5 shrink-0 text-muted" aria-hidden />
      <span className="max-w-40 truncate">{f.fileName}</span>
      {viewable && (
        <a
          href={`/files/${f.id}?view=1`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex size-7 items-center justify-center rounded-full hover:bg-surface-3"
          aria-label={`View ${f.fileName}`}
        >
          <Eye className="size-3.5" />
        </a>
      )}
      <a
        href={`/files/${f.id}`}
        className="inline-flex size-7 items-center justify-center rounded-full hover:bg-surface-3"
        aria-label={`Download ${f.fileName}`}
      >
        <Download className="size-3.5" />
      </a>
      {canEdit && (
        <ActionForm action={remove} showSuccess={false} className="inline-flex">
          <ConfirmSubmit
            size="icon-xs"
            variant="danger-ghost"
            pendingText="…"
            message={`Remove ${f.fileName}?`}
            aria-label={`Remove ${f.fileName}`}
          >
            <Trash2 aria-hidden />
          </ConfirmSubmit>
        </ActionForm>
      )}
    </span>
  );
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
  others,
  items,
  canEdit,
  mainCurrency,
  lines,
  edits,
}: {
  q: FactoryQuoteView;
  others: FactoryQuoteView[];
  items: Items;
  canEdit: boolean;
  mainCurrency: string;
  lines: OfferLineActions;
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
  // Lines another spec can point at: the offer's main lines (not parts, not specs themselves).
  const mains = q.lines.filter((l) => !l.parentId && !l.alternativeOfId);
  const numberOf = (id: string) => q.lines.find((l) => l.id === id)?.no ?? "";

  const lineTotal = (v: LineValues) => {
    const p = Number((v.unitPrice ?? "").replace(/,/g, ""));
    const n = Number((v.quantity ?? "").replace(/,/g, ""));
    if (!Number.isFinite(p) || !Number.isFinite(n) || !p) return <span className="text-muted">—</span>;
    const t = formatMinor(Math.round(toMinor(p) * n), q.currency);
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
      label: `Price ${q.currency}`,
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
      initial: String(q.taxRate),
      phoneHidden: true,
    },
    ...(mains.length > 1 || q.lines.some((l) => l.alternativeOfId)
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
      panelTitle={`Edit lines · ${q.factory.name}`}
      panelDescription="Type, paste or upload the factory's lines and prices. Nothing is saved until Save changes."
      edit={<OfferLinesEditor q={q} others={others} items={items} rows={rows} columns={columns} sheet={sheet} used={used} lines={lines} card={edits} />}
    />
  );
}

function OfferLinesEditor({
  q,
  others,
  items,
  rows,
  columns,
  sheet,
  used,
  lines,
  card,
}: {
  q: FactoryQuoteView;
  others: FactoryQuoteView[];
  items: Items;
  rows: LineRow[];
  columns: LineColumn[];
  sheet: { name: string; upload: boolean; templateRows: { no: string; values: LineValues }[] };
  used: boolean;
  lines: OfferLineActions;
  card?: EditCard | null;
}) {
  const [copyFrom, setCopyFrom] = useState(others[0]?.id ?? "");

  /** The line table's answer from an action's answer; the offer's lines that were not there before (new ones). */
  const result = (r: OfferLineResult): LineResult => {
    if (!r.ok) return { ok: false, message: r.message, reasonChoices: r.reasonChoices };
    const had = new Set(q.lines.map((l) => l.id));
    return { ok: true, keys: r.offer.lines.filter((l) => !had.has(l.id)).map((l) => l.id) };
  };
  /** Lines as new rows of this offer: values for its columns, parts under their line. */
  const asNew = (src: { id: string; parentId: string | null; values: LineValues }[]): NewLine[] => {
    const at = new Map(src.map((l, n) => [l.id, n]));
    return src.map((l) => ({ values: l.values, partOf: l.parentId ? (at.get(l.parentId) ?? null) : null }));
  };
  const fromItems = () =>
    asNew(
      items.map((it) => ({
        id: it.id,
        parentId: it.parentId,
        values: { description: it.description, model: it.model ?? "", requestedItemId: it.id, quantity: it.quantity, unit: it.unit, unitPrice: "", taxRate: String(q.taxRate) },
      })),
    );
  const fromOffer = (o: FactoryQuoteView) =>
    asNew(
      o.lines
        .filter((l) => !l.alternativeOfId)
        .map((l) => ({
          id: l.id,
          parentId: l.parentId,
          values: { description: l.description, model: l.model ?? "", requestedItemId: l.requestedItemId ?? "", quantity: l.quantity, unit: l.unit, unitPrice: "", taxRate: String(q.taxRate) },
        })),
    );
  const total = (list: LineRow[]) => {
    let t = 0;
    for (const r of list) {
      if (r.values.alternativeOfId) continue;
      const p = Number((r.values.unitPrice ?? "").replace(/,/g, ""));
      const n = Number((r.values.quantity ?? "").replace(/,/g, ""));
      if (Number.isFinite(p * n)) t += Math.round(toMinor(p) * n);
    }
    return t;
  };

  return (
    <BatchLines
      rows={rows}
      columns={columns}
      noun="line"
      sheet={sheet}
      edit={{ type: "factory_quote", id: q.id, card: "lines" }}
      card={card}
      plain={!used}
      handlers={{
        onAdd: async (newLines: NewLine[], at, reason) =>
          result(
            await lines.add(q.id, {
              lines: newLines.map((l) => ({ ...toBody(l.values, q.taxRate), partOf: l.partOf })),
              afterId: at.afterKey,
              parentId: at.parentKey,
              reason,
            }),
          ),
        onEdit: async (key, values, reason) => {
          const body: Record<string, unknown> = { reason };
          const full = toBody({ ...(rows.find((r) => r.key === key)?.values ?? {}), ...values }, q.taxRate);
          for (const k of Object.keys(values)) body[k] = full[k as keyof typeof full];
          return result(await lines.edit(key, body));
        },
        onRemove: async (key, reason) => result(await lines.remove(key, reason)),
        onMove: async (key, to: LineMove, reason) => result(await lines.move(key, { to, reason })),
      }}
      footer={(list) =>
        list.length ? (
          <div className="flex flex-wrap items-center justify-end gap-x-1.5 px-3 py-2 text-sm text-muted">
            Factory total <span className="font-semibold text-text tabular">{formatMinor(total(list), q.currency)}</span>
            {q.taxIncluded ? "tax included" : "without tax"}
          </div>
        ) : null
      }
      note={used ? "A quotation is priced from this offer: it keeps its own copy." : undefined}
      above={({ rows: now, add }) => (
        <>
          {used && (
            <p className="flex items-start gap-2 rounded-xl border border-info/25 bg-info-soft px-3 py-2.5 text-sm">
              <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
              <span>A quotation is priced from this offer. Saving changes to its lines asks why; the quotation keeps its own copy.</span>
            </p>
          )}
          {now.length === 0 && (items.length > 0 || others.length > 0) && (
            <div className="flex flex-col gap-3 rounded-xl border-[1.5px] border-dashed border-primary/40 bg-primary-soft/20 p-3 sm:p-4">
              <p className="text-sm font-semibold">Start this offer</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {items.length > 0 && (
                  <button
                    type="button"
                    onClick={() => add(fromItems())}
                    className="flex items-start gap-2.5 rounded-lg border border-primary/30 bg-surface px-3 py-2.5 text-left text-sm hover:border-primary"
                  >
                    <ListPlus className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                    <span>
                      <span className="block font-medium">From the customer&apos;s list ({items.length})</span>
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
                          if (o) add(fromOffer(o));
                        }}
                      >
                        Copy
                      </Button>
                    </span>
                  </div>
                )}
              </div>
              <p className="text-xs text-muted">Or type the first line in the table below, paste their list, or use the Excel menu to upload their file.</p>
            </div>
          )}
        </>
      )}
    />
  );
}

/* ---------------------------------------------------------------- add an offer */

/**
 * "Enter an offer": a short window for the offer itself (the factory, its reference, dates, currency, price
 * basis, tax, lead time and terms, notes, their files). Its lines are not entered here: saving opens the
 * offer with its lines editor, the same one "Edit lines" opens.
 */
export function AddOfferButton({
  dealId,
  items,
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
}: {
  /** The inquiry's number, in the window's line under the title. */
  refNo?: string;
  dealId: string;
  items: Items;
  today: string;
  mainCurrency: string;
  rates: Record<string, number>;
  searchFactories: (q: string) => Promise<FactoryOption[]>;
  /** saveFactoryQuoteAction bound to the deal and null (a new offer). */
  createAction: Action;
  /** A new offer's tax: the company's default (Settings). */
  taxDefault: { included: boolean; rate: number };
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
          className="md:w-[860px]"
          onClose={() => setOpen(false)}
        >
          <OfferWindow
            dealId={dealId}
            q={null}
            itemCount={items.length}
            today={today}
            mainCurrency={mainCurrency}
            rates={rates}
            searchFactories={searchFactories}
            saveAction={createAction}
            taxDefault={taxDefault}
            onAnother={() => setRound((n) => n + 1)}
          />
        </SidePanel>
      )}
    </>
  );
}

/** A small badge for the offers table's "Covers" column. */
export function CoverBadge({ cover }: { cover: { all: boolean; n: number; of: number } | null }) {
  if (!cover) return <span className="text-muted">—</span>;
  return <Badge tone={cover.all ? "ok" : "warn"}>{cover.all ? `All ${cover.of} items` : `${cover.n} of ${cover.of} items`}</Badge>;
}
