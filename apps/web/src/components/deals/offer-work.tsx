"use client";

import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Download, Eye, FileText, Info, List, ListPlus, Plus, Trash2 } from "lucide-react";
import { formatMinor, fxRate, toMinor } from "@kebo/money";
import { ATTACHMENT_KIND_LABEL, basisText, INCOTERMS, offerTaxText, type AttachmentKind, type Incoterm } from "@kebo/shared";
import { Badge, Button, cn, Field, Input, Select, Textarea } from "@kebo/ui";
import { ConfirmSubmit, SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { CurrencySelect } from "@/components/common/currency-select";
import { LineTable, type LineColumn, type LineMove, type LineResult, type LineRow, type LineValues, type NewLine } from "@/components/lines/line-table";
import { DetailsCard, LinesCard, type DetailField } from "@/components/orders/step-view";
import { PanelActions, PanelBody, SidePanel, useClosePanel } from "@/components/common/panel";
import type { ActionState } from "@/lib/actions";
import { date as dateText, money as amount } from "@/lib/format";
import { rateSentence } from "@/lib/fx";
import type { FactoryOption, FactoryQuoteView, OfferFile, SourcingView } from "@/lib/types-deals";
import type { OfferLineResult } from "@/app/(app)/inquiries/[id]/sourcing/actions";
import { FileDrop, send, type Staged } from "./documents-panel";
import { FileRow, FileZone } from "@/components/common/file-zone";
import { fileSize } from "@/lib/format";
import { BASIS_HINT, FactoryPicker, OfferHeaderForm, PortPicker, type QuoteState } from "./factory-quote-form";
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
    alternativeOfId: v.alternativeOfId || null,
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

/** A line typed in the Enter-offer window: what it is for (an item's id, "new", "part:<key>", "spec:<key>"), then its values. */
interface OfferRow {
  key: string;
  for: string;
  description: string;
  model: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  taxRate: string;
}
let rowSeq = 0;
const blankRow = (): OfferRow => ({ key: `n${(rowSeq += 1)}`, for: "new", description: "", model: "", quantity: "1", unit: "pcs", unitPrice: "", taxRate: "" });

/**
 * The window's lines as the API takes them: a line for an item without a price is left out (they don't
 * offer it), so are empty lines; parts and other specs point at their line's place in the list.
 */
export function offerLinesOf(rows: OfferRow[], offerTax: string) {
  const kept = rows.filter((r) => r.description.trim() && (!/^[0-9a-f-]{36}$/i.test(r.for) || r.unitPrice.replace(/[^\d.]/g, "")));
  const at = new Map(kept.map((r, n) => [r.key, n]));
  const ref = (r: OfferRow, kind: "part" | "spec") => (r.for.startsWith(`${kind}:`) ? (at.get(r.for.slice(kind.length + 1)) ?? null) : null);
  return kept.map((r) => ({
    ...toBody({
      description: r.description,
      model: r.model,
      requestedItemId: /^[0-9a-f-]{36}$/i.test(r.for) ? r.for : "",
      quantity: r.quantity || "1",
      unit: r.unit,
      unitPrice: r.unitPrice.replace(/[^\d.]/g, "") || "0",
      taxRate: r.taxRate || offerTax,
    }),
    partOf: ref(r, "part"),
    specOf: ref(r, "spec"),
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
      alternativeOfId: l.alternativeOfId ?? "",
    },
  }));
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
          title="Enter factory offer"
          description={`${refNo ? `${refNo} · ` : ""}${items.length ? "their prices for the customer’s items" : "the inquiry has no item list, so these lines become its items"}`}
          className="md:w-[1180px]"
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

const num = (v: string) => Number(v.replace(/[^\d.]/g, "")) || 0;

/**
 * "Enter factory offer" (board RecordOffer): the factory and its terms in
 * three columns, its prices for the customer's items (each line's amount and
 * the total), notes and the factory's own quotation files. With no item list
 * the lines open right after saving, ready to paste their list or Excel; they
 * become the inquiry's items.
 */
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
  const blank = {
    reference: "",
    receivedOn: today,
    validUntil: "",
    basisPlace: "",
    leadTime: "",
    moq: "",
    paymentTerms: "",
    advancePercent: "",
    notes: "",
  };
  const [round, setRound] = useState(0);
  const [factory, setFactory] = useState<QuoteState["factory"]>(null);
  const [basis, setBasis] = useState<Incoterm | "">("");
  const [currency, setCurrency] = useState("CNY");
  const [taxIncluded, setTaxIncluded] = useState(taxDefault.included);
  const [taxRate, setTaxRate] = useState(String(taxDefault.rate));
  const [f, setF] = useState(blank);
  const [files, setFiles] = useState<File[]>([]);
  const startRows = (): OfferRow[] =>
    items.length
      ? items.map((it) => ({
          key: it.id,
          for: it.id,
          description: it.description.split("\n")[0] ?? "",
          model: it.model ?? "",
          quantity: it.quantity,
          unit: it.unit,
          unitPrice: "",
          taxRate: "",
        }))
      : [blankRow()];
  const [lineRows, setLineRows] = useState<OfferRow[]>(startRows);
  const [pasting, setPasting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const another = useRef(false);
  const set = (k: keyof typeof blank, v: string) => setF((x) => ({ ...x, [k]: v }));
  const rate = fxRate(currency, mainCurrency, mainCurrency, rates);
  const fx = { main: mainCurrency, rates };
  const own = items.length === 0;
  const amountOf = (r: OfferRow) => num(r.unitPrice) * num(r.quantity);
  // Another spec is a choice beside its line: shown, left out of the total.
  const total = lineRows.filter((r) => !r.for.startsWith("spec:")).reduce((t, r) => t + amountOf(r), 0);
  const setRow = (key: string, patch: Partial<OfferRow>) => setLineRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRows = (more: OfferRow[], after?: string) =>
    setLineRows((rs) => {
      const at = after ? rs.findIndex((r) => r.key === after) + 1 : rs.length;
      return [...rs.slice(0, at), ...more, ...rs.slice(at)];
    });
  /** Rows pasted from Excel: description, model, qty, unit, price (tab between, one line per row). */
  const pasted = (text: string): OfferRow[] =>
    text
      .replace(/\r?\n$/, "")
      .split(/\r?\n/)
      .map((line) => line.split("\t").map((c) => c.trim()))
      .filter((c) => c[0])
      .map((c) => ({ ...blankRow(), description: c[0]!, model: c[1] ?? "", quantity: (c[2] ?? "1").replace(/[^\d.]/g, "") || "1", unit: c[3] || "pcs", unitPrice: (c[4] ?? "").replace(/[^\d.]/g, "") }));

  const payload = {
    factoryId: factory?.id ?? null,
    newFactoryName: factory && !factory.id ? factory.name : null,
    reference: f.reference,
    receivedOn: f.receivedOn || today,
    validUntil: f.validUntil || null,
    currency,
    basis: basis || null,
    basisPlace: f.basisPlace,
    leadTime: f.leadTime,
    moq: f.moq,
    paymentTerms: f.paymentTerms,
    ...(f.advancePercent.trim() ? { advancePercent: f.advancePercent.trim() } : {}),
    notes: f.notes,
    taxIncluded,
    taxRate: taxRate.trim() || "0",
  };

  return (
    <ActionForm
      key={round}
      action={createAction}
      keepFields
      showSuccess={false}
      className="flex min-h-0 flex-1 flex-col"
      onDone={async (st) => {
        const id = (st.data as { id?: string } | undefined)?.id;
        if (!id) return;
        setError(null);
        const problems: string[] = [];
        const lines = offerLinesOf(lineRows, taxRate);
        if (lines.length) {
          const r = await addLines(id, { lines });
          if (!r.ok) problems.push(r.message ?? "The lines were not saved.");
        }
        for (const file of files) {
          const staged: Staged = { key: file.name, file, kind: guessOfferKind(file.name, file.type), note: "", progress: 0, error: null };
          const e = await send(dealId, staged, () => {}, { factoryQuoteId: id });
          if (e) problems.push(`${file.name} did not upload: ${e}`);
        }
        router.refresh();
        if (another.current && !problems.length) {
          another.current = false;
          setFactory(null);
          setF(blank);
          setFiles([]);
          setLineRows(startRows());
          setRound((n) => n + 1);
          return;
        }
        if (problems.length) {
          setError(`The offer was saved, but: ${problems.join(" ")}`);
          return;
        }
        close();
        router.push(`/inquiries/${dealId}/sourcing?offer=${id}${lines.length ? "" : "#edit-lines"}`);
      }}
    >
      {(s) => (
        <>
          <input type="hidden" name="payload" value={JSON.stringify(payload)} />
          <PanelBody className="flex flex-col gap-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Field label="Factory" htmlFor="factory" required error={s.errors?.factoryId ?? s.errors?.newFactoryName} className="md:col-span-2">
                <FactoryPicker value={factory} search={searchFactories} error={s.errors?.factoryId} onChange={(x) => setFactory(x)} />
              </Field>
              <Field label="Their reference" htmlFor="add-ref" error={s.errors?.reference}>
                <Input id="add-ref" value={f.reference} onChange={(e) => set("reference", e.target.value)} maxLength={80} placeholder="Their quote no." />
              </Field>
              <Field label="Received on" htmlFor="add-received" required error={s.errors?.receivedOn}>
                <Input id="add-received" type="date" max={today} value={f.receivedOn} onChange={(e) => set("receivedOn", e.target.value)} />
              </Field>
              <Field label="Valid until" htmlFor="add-valid" error={s.errors?.validUntil}>
                <Input id="add-valid" type="date" value={f.validUntil} onChange={(e) => set("validUntil", e.target.value)} />
              </Field>
              <Field
                label="Currency"
                htmlFor="add-currency"
                error={s.errors?.currency}
                hint={rate === null ? `No exchange rate for ${currency} in Settings` : (rateSentence(fx, mainCurrency, currency) ?? undefined)}
              >
                <CurrencySelect id="add-currency" value={currency} short onChange={(e) => setCurrency(e.target.value)} />
              </Field>
              <Field label="Basis" htmlFor="add-basis" error={s.errors?.basis} hint={basis ? BASIS_HINT[basis] : undefined}>
                <Select id="add-basis" value={basis} onChange={(e) => setBasis(e.target.value as Incoterm | "")}>
                  <option value="">Not said</option>
                  {INCOTERMS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Place" htmlFor="add-port" error={s.errors?.basisPlace}>
                <PortPicker id="add-port" value={f.basisPlace} onChange={(v) => set("basisPlace", v)} exw={basis === "EXW"} />
              </Field>
              <Field label="Lead time" htmlFor="add-lead" error={s.errors?.leadTime}>
                <Input id="add-lead" value={f.leadTime} onChange={(e) => set("leadTime", e.target.value)} maxLength={120} placeholder="e.g. 40 days" />
              </Field>
              <label className="flex items-center gap-2.5 self-end py-2.5 text-sm">
                <input type="checkbox" checked={taxIncluded} onChange={(e) => setTaxIncluded(e.target.checked)} className="size-[18px] accent-primary" />
                Prices include tax
              </label>
              <Field label="Tax rate %" htmlFor="add-tax" error={s.errors?.taxRate ?? s.errors?.taxIncluded}>
                <Input id="add-tax" inputMode="decimal" className="tabular" value={taxRate} onChange={(e) => setTaxRate(e.target.value.replace(/[^0-9.]/g, ""))} />
              </Field>
              <Field label="MOQ" htmlFor="add-moq" error={s.errors?.moq}>
                <Input id="add-moq" value={f.moq} onChange={(e) => set("moq", e.target.value)} maxLength={60} placeholder="e.g. 1 set" />
              </Field>
              <Field label="Payment terms" htmlFor="add-pay" error={s.errors?.paymentTerms} className="md:col-span-2">
                <Input id="add-pay" value={f.paymentTerms} onChange={(e) => set("paymentTerms", e.target.value)} maxLength={2000} placeholder="e.g. 30% advance, 70% before shipping" />
              </Field>
              <Field label="Advance %" htmlFor="add-adv" error={s.errors?.advancePercent}>
                <Input id="add-adv" inputMode="decimal" className="tabular" value={f.advancePercent} onChange={(e) => set("advancePercent", e.target.value.replace(/[^0-9.]/g, ""))} placeholder="default" />
              </Field>
            </div>

            <section className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[15px] font-bold">Lines</h3>
                <Button type="button" variant="secondary" size="sm" onClick={() => setPasting((x) => !x)} aria-expanded={pasting}>
                  <List aria-hidden /> Paste from Excel
                </Button>
              </div>
              {own && <p className="text-xs text-text-2">The inquiry has no item list, so these lines become the offer&rsquo;s items to compare.</p>}
              {pasting && (
                <div className="flex flex-col gap-1.5 rounded-lg border border-dashed border-primary/40 bg-primary-soft/20 p-3">
                  <label htmlFor="add-paste" className="text-sm font-medium">
                    Paste their rows: description, model, qty, unit, price (one row per line)
                  </label>
                  <Textarea
                    id="add-paste"
                    rows={3}
                    placeholder="Copy the rows in Excel and paste here"
                    onPaste={(e) => {
                      const more = pasted(e.clipboardData.getData("text/plain"));
                      if (!more.length) return;
                      e.preventDefault();
                      // Pasting into an empty start replaces its blank line.
                      setLineRows((rs) => [...rs.filter((r) => r.description.trim() || r.unitPrice.trim()), ...more]);
                      setPasting(false);
                    }}
                  />
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] border-collapse text-[13px]">
                  <thead>
                    <tr className="bg-surface-2 text-left text-muted">
                      <th scope="col" className="w-[190px] px-2 py-2.5 font-semibold">For item</th>
                      <th scope="col" className="px-2 py-2.5 font-semibold">Description *</th>
                      <th scope="col" className="w-[90px] px-2 py-2.5 font-semibold">Model</th>
                      <th scope="col" className="w-[76px] px-2 py-2.5 text-right font-semibold">Qty *</th>
                      <th scope="col" className="w-[76px] px-2 py-2.5 font-semibold">Unit</th>
                      <th scope="col" className="w-[120px] px-2 py-2.5 text-right font-semibold">Unit price *</th>
                      <th scope="col" className="w-[70px] px-2 py-2.5 text-right font-semibold">Tax %</th>
                      <th scope="col" className="w-[110px] px-2 py-2.5 text-right font-semibold">Amount</th>
                      <th scope="col" className="w-10 px-1 py-2.5">
                        <span className="sr-only">Remove</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineRows.map((r, i) => {
                      // A part or another spec points at a main line above it.
                      const above = lineRows.slice(0, i).filter((x) => !x.for.startsWith("part:") && !x.for.startsWith("spec:"));
                      const label = (x: OfferRow) => (x.model || x.description || "line").slice(0, 24);
                      const spec = r.for.startsWith("spec:");
                      return (
                        <tr key={r.key} className={cn("border-t border-line", spec && "bg-warn-soft/30")}>
                          <td className="px-1.5 py-1.5">
                            <Select aria-label={`Line ${i + 1}: what it is for`} className="h-[38px] text-[13px]" value={r.for} onChange={(e) => setRow(r.key, { for: e.target.value })}>
                              {items.map((it) => (
                                <option key={it.id} value={it.id}>
                                  Item {it.no}: {it.description.split("\n")[0]!.slice(0, 30)}
                                </option>
                              ))}
                              <option value="new">{own ? "A line of its own" : "Extra (not asked)"}</option>
                              {above
                                .filter((x) => x.key !== r.key)
                                .map((x) => (
                                  <option key={`p${x.key}`} value={`part:${x.key}`}>
                                    Part of: {label(x)}
                                  </option>
                                ))}
                              {above
                                .filter((x) => x.key !== r.key)
                                .map((x) => (
                                  <option key={`s${x.key}`} value={`spec:${x.key}`}>
                                    Another spec of: {label(x)}
                                  </option>
                                ))}
                            </Select>
                          </td>
                          <td className="px-1.5 py-1.5">
                            <Input
                              aria-label={`Line ${i + 1}: description`}
                              className="h-[38px] text-[13px]"
                              value={r.description}
                              onChange={(e) => setRow(r.key, { description: e.target.value })}
                              onPaste={(e) => {
                                const text = e.clipboardData.getData("text/plain");
                                if (!/[\t\n]/.test(text.trim())) return;
                                e.preventDefault();
                                const more = pasted(text);
                                if (!more.length) return;
                                setRow(r.key, { description: more[0]!.description, model: more[0]!.model, quantity: more[0]!.quantity, unit: more[0]!.unit, unitPrice: more[0]!.unitPrice || r.unitPrice });
                                addRows(more.slice(1), r.key);
                              }}
                            />
                          </td>
                          <td className="px-1.5 py-1.5">
                            <Input aria-label={`Line ${i + 1}: model`} className="h-[38px] text-[13px]" value={r.model} maxLength={120} onChange={(e) => setRow(r.key, { model: e.target.value })} />
                          </td>
                          <td className="px-1.5 py-1.5">
                            <Input aria-label={`Line ${i + 1}: quantity`} inputMode="decimal" className="h-[38px] text-right text-[13px] tabular" value={r.quantity} onChange={(e) => setRow(r.key, { quantity: e.target.value.replace(/[^\d.,]/g, "") })} />
                          </td>
                          <td className="px-1.5 py-1.5">
                            <Input aria-label={`Line ${i + 1}: unit`} className="h-[38px] text-[13px]" value={r.unit} maxLength={20} onChange={(e) => setRow(r.key, { unit: e.target.value })} />
                          </td>
                          <td className="px-1.5 py-1.5">
                            <Input
                              aria-label={`Line ${i + 1}: unit price`}
                              data-add-price={i}
                              inputMode="decimal"
                              className="h-[38px] text-right text-[13px] tabular"
                              value={r.unitPrice}
                              onChange={(e) => setRow(r.key, { unitPrice: e.target.value.replace(/[^\d.,]/g, "") })}
                              onKeyDown={(e) => {
                                if (e.key !== "Enter") return;
                                e.preventDefault();
                                document.querySelector<HTMLInputElement>(`[data-add-price="${i + 1}"]`)?.focus();
                              }}
                              onPaste={(e) => {
                                // A column of prices copied from Excel fills this line and the ones below.
                                const values = e.clipboardData.getData("text/plain").replace(/\r?\n$/, "").split(/\r?\n/).map((v) => v.split("\t").pop()!.trim());
                                if (values.length < 2) return;
                                e.preventDefault();
                                const below = lineRows.slice(i, i + values.length).map((x) => x.key);
                                setLineRows((rs) => rs.map((x) => (below.includes(x.key) ? { ...x, unitPrice: values[below.indexOf(x.key)]!.replace(/[^\d.]/g, "") } : x)));
                              }}
                            />
                          </td>
                          <td className="px-1.5 py-1.5">
                            <Input aria-label={`Line ${i + 1}: tax %`} inputMode="decimal" placeholder={taxRate || "0"} className="h-[38px] text-right text-[13px] tabular" value={r.taxRate} onChange={(e) => setRow(r.key, { taxRate: e.target.value.replace(/[^\d.]/g, "") })} />
                          </td>
                          <td className="px-2 py-1.5 text-right tabular">
                            {amountOf(r) ? (
                              spec ? (
                                <span className="text-muted" title="Another spec: a choice, not in the total">
                                  ({amountOf(r).toLocaleString("en-US", { maximumFractionDigits: 2 })})
                                </span>
                              ) : (
                                amountOf(r).toLocaleString("en-US", { maximumFractionDigits: 2 })
                              )
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-1 py-1.5 text-center">
                            <Button
                              type="button"
                              size="icon-xs"
                              variant="ghost"
                              aria-label={`Remove line ${i + 1}`}
                              onClick={() => setLineRows((rs) => rs.filter((x) => x.key !== r.key).map((x) => (x.for.endsWith(`:${r.key}`) ? { ...x, for: "new" } : x)))}
                            >
                              <Trash2 aria-hidden />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button type="button" variant="secondary" size="sm" onClick={() => addRows([blankRow()])}>
                  <Plus aria-hidden /> Add line
                </Button>
                <span className="flex gap-10 px-2 text-base font-bold">
                  <span>Total</span>
                  <span className="tabular">
                    {currency} {total.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                  </span>
                </span>
              </div>
              <p className="text-xs text-muted">
                Prices in {currency}, {taxIncluded ? "tax included" : "without tax"}. An item they don&apos;t offer: leave its price empty and it is left out. &ldquo;Another spec of&rdquo; a line is a choice beside it and is not added to the total.
              </p>
            </section>

            <div className="grid items-start gap-4 md:grid-cols-2">
              <Field label="Notes" htmlFor="add-notes" error={s.errors?.notes}>
                <Textarea id="add-notes" rows={3} value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Packing, samples, anything to remember about this offer" />
              </Field>
              <FileZone
                label="The factory’s own quotation"
                hint="Their PDF, Excel, or WeChat screenshots · kept with this offer, seen only by people who see factory prices"
                onFiles={(list) => setFiles((x) => [...x, ...list])}
              >
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
            {error && <p className="text-sm text-bad">{error}</p>}
          </PanelBody>
          <PanelActions className="static mx-0 mb-0 justify-end">
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <SubmitButton variant="secondary" pendingText="Saving…" onClick={() => (another.current = true)}>
              <Plus aria-hidden /> Save &amp; enter another
            </SubmitButton>
            <SubmitButton pendingText="Saving…" onClick={() => (another.current = false)}>
              <Check aria-hidden /> Save offer
            </SubmitButton>
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
