"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Copy, Download, Eye, FileText, Info, ListPlus, Plus, Trash2 } from "lucide-react";
import { formatMinor, fxRate, toMinor } from "@kebo/money";
import { ATTACHMENT_KIND_LABEL, basisText, INCOTERMS, offerTaxText, type AttachmentKind, type Incoterm } from "@kebo/shared";
import { Badge, Button, cn, Field, Input, Select } from "@kebo/ui";
import { ConfirmSubmit, SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { CurrencySelect } from "@/components/common/currency-select";
import {
  LineTable,
  type LineColumn,
  type LineMove,
  type LineResult,
  type LineRow,
  type LineValues,
  type NewLine,
} from "@/components/lines/line-table";
import { DetailsCard, LinesCard, type DetailField } from "@/components/orders/step-view";
import { PanelActions, PanelBody, SidePanel, useClosePanel } from "@/components/common/panel";
import type { ActionState } from "@/lib/actions";
import { date as dateText, money as amount } from "@/lib/format";
import { rateSentence } from "@/lib/fx";
import type { FactoryOption, FactoryQuoteView, OfferFile, SourcingView } from "@/lib/types-deals";
import type { OfferLineResult } from "@/app/(app)/inquiries/[id]/sourcing/actions";
import { FileDrop, send, type Staged } from "./documents-panel";
import { BASIS_HINT, FactoryPicker, OfferHeaderForm, PortPicker, TaxBox, type QuoteState } from "./factory-quote-form";
import { LinesExcel, LinesView } from "./lines-view";

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
  };
}

/**
 * The customer's items as an offer's lines, with the prices typed for them.
 * With `prices`, only the items that have one (and the item a priced part
 * belongs to) are kept; without, every item, unpriced.
 */
function linesFromItems(items: Items, prices?: Record<string, string>) {
  const priced = (id: string) => !!prices?.[id]?.replace(/[^\d.]/g, "");
  const keep = prices ? items.filter((it) => priced(it.id) || items.some((p) => p.parentId === it.id && priced(p.id))) : items;
  const at = new Map(keep.map((it, n) => [it.id, n]));
  return keep.map((it) => ({
    ...toBody({
      description: it.description,
      model: it.model ?? "",
      requestedItemId: it.id,
      quantity: it.quantity,
      unit: it.unit,
      unitPrice: prices?.[it.id]?.replace(/[^\d.]/g, "") ?? "0",
      taxRate: "",
    }),
    partOf: it.parentId ? (at.get(it.parentId) ?? null) : null,
  }));
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
    { name: "moq", label: "Minimum order", value: q.moq },
    { name: "reference", label: "Their ref.", value: q.reference, placeholder: "Their quote no." },
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
      panelTitle={`Edit ${q.factory.name}'s offer`}
      panelDescription="Who, their reference, currency, dates, price basis, lead time and terms. The lines are changed in the lines card."
      panelBody={
        <OfferForm
          q={q}
          today={today}
          mainCurrency={mainCurrency}
          rates={rates}
          searchFactories={searchFactories}
          saveAction={saveAction}
          removeAction={removeAction}
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

/** The Edit panel: today's offer form, and Remove. */
function OfferForm({
  q,
  today,
  mainCurrency,
  rates,
  searchFactories,
  saveAction,
  removeAction,
}: {
  q: FactoryQuoteView;
  today: string;
  mainCurrency: string;
  rates: Record<string, number>;
  searchFactories: (q: string) => Promise<FactoryOption[]>;
  saveAction: Action;
  removeAction: Action;
}) {
  const close = useClosePanel();
  const removeId = `remove-offer-${q.id}`;
  return (
    <PanelBody>
      {/* Remove this offer (its button sits in the footer): only its error shows here. */}
      <ActionForm id={removeId} action={removeAction} showSuccess={false} onDone={close}>
        {null}
      </ActionForm>
      <OfferHeaderForm
        action={saveAction}
        quote={q}
        today={today}
        mainCurrency={mainCurrency}
        rates={rates}
        searchFactories={searchFactories}
        onDone={close}
        onCancel={close}
        panel={{
          // Its own form (below): a form inside a form is not allowed, so the button points at it.
          end: (
            <ConfirmSubmit
              form={removeId}
              size="sm"
              variant="danger-ghost"
              pendingText="Removing…"
              message={`Remove the offer from ${q.factory.name} with its ${q.lines.length} lines?`}
            >
              <Trash2 aria-hidden /> Remove this offer
            </ConfirmSubmit>
          ),
        }}
      />
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
}: {
  q: FactoryQuoteView;
  others: FactoryQuoteView[];
  items: Items;
  canEdit: boolean;
  mainCurrency: string;
  lines: OfferLineActions;
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
    },
  }));

  const lineTotal = (v: LineValues) => {
    const p = Number((v.unitPrice ?? "").replace(/,/g, ""));
    const n = Number((v.quantity ?? "").replace(/,/g, ""));
    if (!Number.isFinite(p) || !Number.isFinite(n) || !p) return <span className="text-muted">—</span>;
    return formatMinor(Math.round(toMinor(p) * n), q.currency);
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
              return p && Number.isFinite(p * n) ? (
                (p * n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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
          : "No lines yet: Edit lines to type, paste or upload them, or start from the customer's list."
      }
      canEdit={canEdit}
      actions={<LinesExcel name={sheet.name} rows={rows} columns={columns} numbers={q.lines.map((l) => l.no)} />}
      view={
        q.lines.length ? (
          <LinesView label={`${q.factory.name} · lines`} rows={rows} columns={viewColumns} numbers={q.lines.map((l) => l.no)} footer={footer} />
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
      edit={
        <OfferLinesEditor
          q={q}
          others={others}
          items={items}
          rows={rows}
          columns={columns}
          footer={footer}
          sheet={sheet}
          used={used}
          lines={lines}
        />
      }
    />
  );
}

function OfferLinesEditor({
  q,
  others,
  items,
  rows,
  columns,
  footer,
  sheet,
  used,
  lines,
}: {
  q: FactoryQuoteView;
  others: FactoryQuoteView[];
  items: Items;
  rows: LineRow[];
  columns: LineColumn[];
  footer: ReactNode;
  sheet: { name: string; upload: boolean; templateRows: { no: string; values: LineValues }[] };
  used: boolean;
  lines: OfferLineActions;
}) {
  const [copyFrom, setCopyFrom] = useState(others[0]?.id ?? "");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  /** The line table's answer from an action's answer; new line ids for "keep adding after this". */
  const result = (r: OfferLineResult): LineResult => {
    if (!r.ok) return { ok: false, message: r.message, reasonChoices: r.reasonChoices };
    const had = new Set(q.lines.map((l) => l.id));
    return { ok: true, keys: r.offer.lines.filter((l) => !had.has(l.id)).map((l) => l.id) };
  };
  const start = async (fn: () => Promise<OfferLineResult>) => {
    setStarting(true);
    setStartError(null);
    const r = await fn();
    setStarting(false);
    if (!r.ok) setStartError(r.message);
  };

  return (
    <div className="flex flex-col gap-3">
      {used && (
        <p className="flex items-start gap-2 rounded-xl border border-info/25 bg-info-soft px-3 py-2.5 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
          <span>
            A quotation is priced from this offer. Changing a price, quantity or the order of its lines asks why; wording and models can
            change freely (the quotation keeps its own copy).
          </span>
        </p>
      )}
      {q.lines.length === 0 && (items.length > 0 || others.length > 0) && (
        <div className="flex flex-col gap-3 rounded-xl border-[1.5px] border-dashed border-primary/40 bg-primary-soft/20 p-3 sm:p-4">
          <p className="text-sm font-semibold">Start this offer</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {items.length > 0 && (
              <button
                type="button"
                onClick={() => void start(() => lines.add(q.id, { lines: linesFromItems(items) }))}
                disabled={starting}
                className="flex items-start gap-2.5 rounded-lg border border-primary/30 bg-surface px-3 py-2.5 text-left text-sm hover:border-primary disabled:opacity-60"
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
                  <Select
                    compact
                    aria-label="Offer to copy lines from"
                    value={copyFrom}
                    onChange={(e) => setCopyFrom(e.target.value)}
                    className="h-8 min-w-0 flex-1"
                  >
                    {others.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.factory.name} ({o.lines.length})
                      </option>
                    ))}
                  </Select>
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => copyFrom && void start(() => lines.copy(q.id, copyFrom))}
                    disabled={starting}
                  >
                    Copy
                  </Button>
                </span>
              </div>
            )}
          </div>
          <p className="text-xs text-muted">
            Or type the first line in the table below, paste their list, or use the Excel menu to upload their file.
          </p>
          {startError && <p className="text-xs text-bad">{startError}</p>}
        </div>
      )}
      <LineTable
        rows={rows}
        columns={columns}
        noun="line"
        sheet={sheet}
        onAdd={async (newLines: NewLine[], at, reason) =>
          result(
            await lines.add(q.id, {
              lines: newLines.map((l) => ({ ...toBody(l.values, q.taxRate), partOf: l.partOf })),
              afterId: at.afterKey,
              parentId: at.parentKey,
              reason,
            }),
          )
        }
        onEdit={async (key, values, reason) => {
          const body: Record<string, unknown> = { reason };
          const full = toBody({ ...rows.find((r) => r.key === key)!.values, ...values }, q.taxRate);
          for (const k of Object.keys(values)) body[k] = full[k as keyof typeof full];
          return result(await lines.edit(key, body));
        }}
        onRemove={async (key, reason) => result(await lines.remove(key, reason))}
        onMove={async (key, to: LineMove, reason) => result(await lines.move(key, { to, reason }))}
        footer={footer}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- add an offer */

/**
 * "Add an offer" (board InqV4PricesAdd): a short side panel — the factory,
 * basis, currency and lead time; the rest only if they have it; the
 * customer's items listed with a price box each. Blanks are left out. For
 * their own wording and extra lines: "Paste from Excel" adds the offer and
 * opens its lines ready to paste or upload.
 */
export function AddOfferButton({
  dealId,
  items,
  today,
  mainCurrency,
  rates,
  searchFactories,
  createAction,
  addLines,
  taxDefault,
  label = "Add an offer",
  variant = "secondary",
  size = "md",
  defaultOpen = false,
}: {
  dealId: string;
  items: Items;
  today: string;
  mainCurrency: string;
  rates: Record<string, number>;
  searchFactories: (q: string) => Promise<FactoryOption[]>;
  /** saveFactoryQuoteAction bound to the deal and null (a new offer). */
  createAction: Action;
  addLines: OfferLineActions["add"];
  /** A new offer's tax: the company's default (Settings). */
  taxDefault: { included: boolean; rate: number };
  label?: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "xs" | "sm" | "md";
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <Button size={size} variant={variant} onClick={() => setOpen(true)}>
        <Plus aria-hidden /> {label}
      </Button>
      {open && (
        <SidePanel
          title="Add a factory offer"
          description="Who and their prices. The rest can be added later."
          onClose={() => setOpen(false)}
        >
          <AddOfferForm
            dealId={dealId}
            items={items}
            today={today}
            mainCurrency={mainCurrency}
            rates={rates}
            searchFactories={searchFactories}
            createAction={createAction}
            addLines={addLines}
            taxDefault={taxDefault}
          />
        </SidePanel>
      )}
    </>
  );
}

type Extra = "validUntil" | "paymentTerms" | "moq" | "reference" | "file";
const EXTRAS: { key: Extra; label: string }[] = [
  { key: "validUntil", label: "Valid until" },
  { key: "paymentTerms", label: "Payment terms" },
  { key: "moq", label: "Minimum order" },
  { key: "reference", label: "Their ref." },
  { key: "file", label: "Their quotation file" },
];

const h = "mb-2 text-[11px] font-semibold tracking-wide text-muted uppercase";

function AddOfferForm({
  dealId,
  items,
  today,
  mainCurrency,
  rates,
  searchFactories,
  createAction,
  addLines,
  taxDefault,
}: {
  dealId: string;
  items: Items;
  today: string;
  mainCurrency: string;
  rates: Record<string, number>;
  searchFactories: (q: string) => Promise<FactoryOption[]>;
  createAction: Action;
  addLines: OfferLineActions["add"];
  taxDefault: { included: boolean; rate: number };
}) {
  const router = useRouter();
  const close = useClosePanel();
  const [factory, setFactory] = useState<QuoteState["factory"]>(null);
  const [basis, setBasis] = useState<Incoterm | "">("");
  const [basisPlace, setBasisPlace] = useState("");
  const [currency, setCurrency] = useState("CNY");
  const [leadTime, setLeadTime] = useState("");
  const [taxIncluded, setTaxIncluded] = useState(taxDefault.included);
  const [taxRate, setTaxRate] = useState(String(taxDefault.rate));
  const [shown, setShown] = useState<Extra[]>([]);
  const [extra, setExtra] = useState<Record<Exclude<Extra, "file">, string>>({ validUntil: "", paymentTerms: "", moq: "", reference: "" });
  const [file, setFile] = useState<File | null>(null);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [own, setOwn] = useState(items.length === 0);
  const [error, setError] = useState<string | null>(null);
  const rate = fxRate(currency, mainCurrency, mainCurrency, rates);
  const fx = { main: mainCurrency, rates };

  const payload = {
    factoryId: factory?.id ?? null,
    newFactoryName: factory && !factory.id ? factory.name : null,
    reference: extra.reference,
    receivedOn: today,
    validUntil: extra.validUntil || null,
    currency,
    basis: basis || null,
    basisPlace,
    leadTime,
    moq: extra.moq,
    paymentTerms: extra.paymentTerms,
    notes: "",
    taxIncluded,
    taxRate: taxRate.trim() || "0",
  };

  return (
    <ActionForm
      action={createAction}
      keepFields
      showSuccess={false}
      className="flex min-h-0 flex-1 flex-col"
      onDone={async (st) => {
        const id = (st.data as { id?: string } | undefined)?.id;
        if (!id) return;
        setError(null);
        if (!own) {
          const lines = linesFromItems(items, prices);
          if (lines.length) {
            const r = await addLines(id, { lines });
            if (!r.ok) setError(r.message);
          }
        }
        if (file) {
          const staged: Staged = { key: "f", file, kind: guessOfferKind(file.name, file.type), note: "", progress: 0, error: null };
          const e = await send(dealId, staged, () => {}, { factoryQuoteId: id });
          if (e) setError(`The offer was added, but ${file.name} did not upload: ${e}`);
        }
        close();
        const priced = Object.values(prices).some((p) => p.trim());
        router.push(`/inquiries/${dealId}/sourcing?offer=${id}${own || !priced ? "#edit-lines" : ""}`);
        router.refresh();
      }}
    >
      {(s) => (
        <>
          <input type="hidden" name="payload" value={JSON.stringify(payload)} />
          <PanelBody className="flex flex-col gap-5">
            <section>
              <h3 className={h}>The offer</h3>
              <div className="grid grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-2">
                <Field label="Factory" htmlFor="factory" error={s.errors?.factoryId ?? s.errors?.newFactoryName}>
                  <FactoryPicker value={factory} search={searchFactories} error={s.errors?.factoryId} onChange={(f) => setFactory(f)} />
                </Field>
                <Field label="Price basis" htmlFor="add-basis" error={s.errors?.basis} hint={basis ? BASIS_HINT[basis] : undefined}>
                  <Select id="add-basis" value={basis} onChange={(e) => setBasis(e.target.value as Incoterm | "")}>
                    <option value="">Not said</option>
                    {INCOTERMS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={basis === "EXW" ? "Town" : "Port"} htmlFor="add-port" optional error={s.errors?.basisPlace}>
                  <PortPicker id="add-port" value={basisPlace} onChange={setBasisPlace} exw={basis === "EXW"} />
                </Field>
                <Field
                  label="Currency"
                  htmlFor="add-currency"
                  error={s.errors?.currency}
                  hint={
                    rate === null ? `No exchange rate for ${currency} in Settings` : (rateSentence(fx, mainCurrency, currency) ?? undefined)
                  }
                >
                  <CurrencySelect id="add-currency" value={currency} short onChange={(e) => setCurrency(e.target.value)} />
                </Field>
                <Field label="Lead time" htmlFor="add-lead" optional error={s.errors?.leadTime}>
                  <Input
                    id="add-lead"
                    value={leadTime}
                    onChange={(e) => setLeadTime(e.target.value)}
                    maxLength={120}
                    placeholder="e.g. 45 days"
                  />
                </Field>
                {shown.includes("validUntil") && (
                  <Field label="Valid until" htmlFor="add-valid" error={s.errors?.validUntil}>
                    <Input
                      id="add-valid"
                      type="date"
                      value={extra.validUntil}
                      onChange={(e) => setExtra((x) => ({ ...x, validUntil: e.target.value }))}
                      autoFocus
                    />
                  </Field>
                )}
                {shown.includes("moq") && (
                  <Field label="Minimum order" htmlFor="add-moq" error={s.errors?.moq}>
                    <Input
                      id="add-moq"
                      value={extra.moq}
                      onChange={(e) => setExtra((x) => ({ ...x, moq: e.target.value }))}
                      maxLength={60}
                      autoFocus
                    />
                  </Field>
                )}
                {shown.includes("reference") && (
                  <Field label="Their ref." htmlFor="add-ref" error={s.errors?.reference}>
                    <Input
                      id="add-ref"
                      value={extra.reference}
                      onChange={(e) => setExtra((x) => ({ ...x, reference: e.target.value }))}
                      maxLength={80}
                      placeholder="Their quote no."
                      autoFocus
                    />
                  </Field>
                )}
                {shown.includes("paymentTerms") && (
                  <Field label="Payment terms" htmlFor="add-pay" error={s.errors?.paymentTerms} className="sm:col-span-2">
                    <Input
                      id="add-pay"
                      value={extra.paymentTerms}
                      onChange={(e) => setExtra((x) => ({ ...x, paymentTerms: e.target.value }))}
                      maxLength={2000}
                      placeholder="e.g. 30% deposit, 70% before delivery"
                      autoFocus
                    />
                  </Field>
                )}
                {shown.includes("file") && (
                  <Field label="Their quotation file" htmlFor="add-file" className="sm:col-span-2" hint="PDF, Excel or a WeChat screenshot">
                    <Input id="add-file" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                  </Field>
                )}
              </div>
              {shown.length < EXTRAS.length && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  Add if you have it:
                  {EXTRAS.filter((x) => !shown.includes(x.key)).map((x) => (
                    <button
                      key={x.key}
                      type="button"
                      onClick={() => setShown((v) => [...v, x.key])}
                      className="inline-flex items-center rounded-full border border-dashed border-primary/40 px-2.5 py-1 font-medium text-primary hover:bg-primary-soft"
                    >
                      + {x.label}
                    </button>
                  ))}
                </div>
              )}
              <TaxBox
                idPrefix="add"
                className="mt-4"
                included={taxIncluded}
                rate={taxRate}
                onIncluded={setTaxIncluded}
                onRate={setTaxRate}
                error={s.errors?.taxRate ?? s.errors?.taxIncluded}
              />
            </section>

            <section>
              <h3 className={h}>Their prices</h3>
              {own ? (
                <p className="rounded-lg bg-surface-2/60 px-3 py-2.5 text-sm text-text-2">
                  Their own lines: once the offer is added, its lines open ready to paste their list or upload their Excel.
                  {items.length > 0 && (
                    <>
                      {" "}
                      <button type="button" className="font-medium text-primary hover:underline" onClick={() => setOwn(false)}>
                        Price the customer&apos;s items instead
                      </button>
                    </>
                  )}
                </p>
              ) : (
                <>
                  <ul className="flex flex-col gap-1.5" aria-label="The customer's items">
                    {items.map((it, i) => (
                      <li key={it.id} className="flex items-center gap-3">
                        <span className="w-7 shrink-0 text-xs text-muted tabular">{it.no}</span>
                        <span className={cn("min-w-0 flex-1 text-sm", it.parentId && "pl-2")}>
                          <span className="line-clamp-2">{it.description.split("\n")[0]}</span>
                          <span className="text-xs text-muted tabular">
                            {Number(it.quantity).toLocaleString("en-US", { maximumFractionDigits: 2 })} {it.unit}
                          </span>
                        </span>
                        <Input
                          aria-label={`Price for ${it.no}`}
                          data-add-price={i}
                          inputMode="decimal"
                          placeholder="Price"
                          className="h-9 w-28 shrink-0 text-right tabular"
                          value={prices[it.id] ?? ""}
                          onChange={(e) => setPrices((p) => ({ ...p, [it.id]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key !== "Enter") return;
                            e.preventDefault();
                            document.querySelector<HTMLInputElement>(`[data-add-price="${i + 1}"]`)?.focus();
                          }}
                          onPaste={(e) => {
                            // A column of prices copied from Excel fills this item and the ones below.
                            const values = e.clipboardData
                              .getData("text/plain")
                              .replace(/\r?\n$/, "")
                              .split(/\r?\n/)
                              .map((v) => v.split("\t").pop()!.trim());
                            if (values.length < 2) return;
                            e.preventDefault();
                            const below = items.slice(i);
                            setPrices((p) => ({
                              ...p,
                              ...Object.fromEntries(
                                below.slice(0, values.length).map((x, n) => [x.id, values[n]!.replace(/[^\d.,]/g, "").replace(/,/g, "")]),
                              ),
                            }));
                          }}
                        />
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-muted">
                    Type each price ({currency}, {taxIncluded ? "tax included" : "without tax"}), leave out what they don&apos;t offer. Their own wording, models and extra
                    lines:{" "}
                    <button type="button" className="font-medium text-primary hover:underline" onClick={() => setOwn(true)}>
                      Paste from Excel
                    </button>
                  </p>
                </>
              )}
            </section>
            {error && <p className="text-sm text-bad">{error}</p>}
          </PanelBody>
          <PanelActions className="static mx-0 mb-0">
            <SubmitButton size="sm" pendingText="Adding…">
              Add the offer
            </SubmitButton>
            <Button type="button" size="sm" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <span className="text-xs text-muted">Our cost works out by itself.</span>
          </PanelActions>
        </>
      )}
    </ActionForm>
  );
}

/** A small badge for the offers table's "Covers" column. */
export function CoverBadge({ cover }: { cover: { all: boolean; n: number; of: number } | null }) {
  if (!cover) return <span className="text-muted">—</span>;
  return <Badge tone={cover.all ? "ok" : "warn"}>{cover.all ? `All ${cover.of} items` : `${cover.n} of ${cover.of} items`}</Badge>;
}
