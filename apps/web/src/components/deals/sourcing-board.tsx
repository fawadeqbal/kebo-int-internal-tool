"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Download, Eye, FileText, ListPlus, Paperclip, Pencil, Plus, Trash2 } from "lucide-react";
import { formatMinor, toMinor } from "@kebo/money";
import { ATTACHMENT_KIND_LABEL, basisText, DEFAULT_TAX_RATE, type AttachmentKind } from "@kebo/shared";
import { Button, Card, CardBody, CardHeader, cn, DetailList, EmptyState, Select } from "@kebo/ui";
import { ConfirmSubmit } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { LineTable, type LineColumn, type LineMove, type LineResult, type LineRow, type LineValues, type NewLine } from "@/components/lines/line-table";
import type { ActionState } from "@/lib/actions";
import { date as dateText, money as amount } from "@/lib/format";
import type { FactoryOption, FactoryQuoteView, OfferFile, SourcingView } from "@/lib/types-deals";
import type { OfferLineResult } from "@/app/(app)/deals/[id]/sourcing/actions";
import { FileDrop, send, type Staged } from "./documents-panel";
import { OfferHeaderForm } from "./factory-quote-form";
import { CoverageBadge } from "./revision-editor";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

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

/**
 * The factory offers on a deal, one at a time (tabs), each with its lines in
 * the line table — typed, pasted or copied from another factory's offer, saved
 * as they are made — and its own files (the factory's quotation, catalogue,
 * WeChat screenshots) kept as evidence.
 */
export function FactoryQuotes({
  dealId,
  quotes,
  items,
  canEdit,
  today,
  mainCurrency,
  rates,
  saveAction,
  removeAction,
  searchFactories,
  lines,
}: {
  dealId: string;
  quotes: FactoryQuoteView[];
  items: SourcingView["items"];
  canEdit: boolean;
  today: string;
  mainCurrency: string;
  rates: Record<string, number>;
  /** saveFactoryQuoteAction bound to the deal; bound here to the offer (null = new). */
  saveAction: (quoteId: string | null, prev: ActionState, form: FormData) => Promise<ActionState>;
  removeAction: (quoteId: string, prev: ActionState, form: FormData) => Promise<ActionState>;
  searchFactories: (q: string) => Promise<FactoryOption[]>;
  lines: OfferLineActions;
}) {
  const router = useRouter();
  // The offers as the page last loaded them, with any line changes made since (until the page reloads).
  const [seen, setSeen] = useState(quotes);
  const [fresh, setFresh] = useState<Record<string, FactoryQuoteView>>({});
  if (seen !== quotes) {
    setSeen(quotes);
    setFresh({});
  }
  const offers = quotes.map((q) => fresh[q.id] ?? q);
  const [active, setActive] = useState<string | "new" | null>(() => (quotes.length ? quotes[0]!.id : canEdit ? "new" : null));
  const [details, setDetails] = useState(false);
  const shown = offers.find((q) => q.id === active) ?? null;

  // The comparisons above reload a moment after the last change, not on every keystroke.
  const reload = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (reload.current && clearTimeout(reload.current)), []);
  const changed = (offer: FactoryQuoteView) => {
    setFresh((f) => ({ ...f, [offer.id]: offer }));
    if (reload.current) clearTimeout(reload.current);
    reload.current = setTimeout(() => router.refresh(), 1200);
  };

  return (
    <Card>
      <CardHeader title="Factory offers" description="Internal, never shown to the customer. Each offer is one factory's lines as it gave them." />
      <CardBody className="flex flex-col gap-4">
        <div role="tablist" aria-label="Factory offers" className="flex flex-wrap items-center gap-1.5">
          {offers.map((q) => (
            <button
              key={q.id}
              type="button"
              role="tab"
              aria-selected={active === q.id}
              onClick={() => {
                setActive(q.id);
                setDetails(false);
              }}
              className={cn(
                "flex max-w-60 flex-col items-start rounded-lg border px-3 py-1.5 text-left text-sm",
                active === q.id ? "border-primary bg-primary-soft text-primary" : "border-line bg-surface hover:border-line-strong",
              )}
            >
              <span className="w-full truncate font-semibold">{q.factory.name}</span>
              <span className="text-xs text-muted tabular">
                {q.lines.length} line{q.lines.length === 1 ? "" : "s"}
                {q.totalCost && q.lines.length ? ` · ${amount(q.totalCost, mainCurrency)}` : ""}
                {q.files.length ? ` · 📎${q.files.length}` : ""}
              </span>
            </button>
          ))}
          {canEdit && (
            <Button size="sm" variant={active === "new" ? "primary" : "ghost"} onClick={() => setActive("new")} aria-pressed={active === "new"}>
              <Plus aria-hidden /> New offer
            </Button>
          )}
        </div>

        {active === "new" && (
          <div className="rounded-xl border border-primary/30 bg-primary-soft/20 p-4">
            <h3 className="mb-3 text-sm font-semibold">New factory offer</h3>
            <OfferHeaderForm
              action={saveAction.bind(null, null)}
              quote={null}
              today={today}
              mainCurrency={mainCurrency}
              rates={rates}
              searchFactories={searchFactories}
              onDone={(st) => setActive((st.data as { id?: string } | undefined)?.id ?? null)}
              onCancel={offers.length ? () => setActive(offers[0]!.id) : undefined}
            />
          </div>
        )}
        {!offers.length && active !== "new" && (
          <EmptyState title="No factory offers yet" description="Ask two or three factories, then record each offer here to compare them." />
        )}
        {active && active !== "new" && !shown && <p className="text-sm text-muted">Opening the offer…</p>}

        {shown && (
          <Offer
            key={shown.id}
            dealId={dealId}
            q={shown}
            others={offers.filter((o) => o.id !== shown.id && o.lines.length)}
            items={items}
            canEdit={canEdit}
            mainCurrency={mainCurrency}
            details={details}
            setDetails={setDetails}
            onChanged={changed}
            lines={lines}
            headerForm={
              <OfferHeaderForm
                action={saveAction.bind(null, shown.id)}
                quote={shown}
                today={today}
                mainCurrency={mainCurrency}
                rates={rates}
                searchFactories={searchFactories}
                onDone={() => setDetails(false)}
                onCancel={() => setDetails(false)}
              />
            }
            removeAction={removeAction.bind(null, shown.id)}
          />
        )}
      </CardBody>
    </Card>
  );
}

function Offer({
  dealId,
  q,
  others,
  items,
  canEdit,
  mainCurrency,
  details,
  setDetails,
  onChanged,
  lines,
  headerForm,
  removeAction,
}: {
  dealId: string;
  q: FactoryQuoteView;
  others: FactoryQuoteView[];
  items: SourcingView["items"];
  canEdit: boolean;
  mainCurrency: string;
  details: boolean;
  setDetails: (v: boolean) => void;
  onChanged: (offer: FactoryQuoteView) => void;
  lines: OfferLineActions;
  headerForm: React.ReactNode;
  removeAction: Action;
}) {
  const [copyFrom, setCopyFrom] = useState(others[0]?.id ?? "");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  /** The line table's answer from an action's answer; new line ids for "keep adding after this". */
  const result = (r: OfferLineResult, before?: FactoryQuoteView): LineResult => {
    if (!r.ok) return { ok: false, message: r.message, reasonChoices: r.reasonChoices };
    onChanged(r.offer);
    const had = new Set((before ?? q).lines.map((l) => l.id));
    return { ok: true, keys: r.offer.lines.filter((l) => !had.has(l.id)).map((l) => l.id) };
  };

  const toBody = (v: LineValues) => ({
    description: v.description,
    model: v.model?.trim() || null,
    requestedItemId: v.requestedItemId || null,
    quantity: (v.quantity ?? "").replace(/,/g, "").trim(),
    unit: v.unit?.trim() || "pcs",
    unitPrice: (v.unitPrice ?? "").replace(/,/g, "").trim() || "0",
    taxRate: (v.taxRate ?? "").trim() || String(DEFAULT_TAX_RATE),
  });

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
    { key: "description", label: "Description (as the factory wrote it)", width: "minmax(0,1fr)", input: "textarea", required: "Each line needs a description" },
    { key: "model", label: "Model", width: "7rem", input: "text", maxLength: 120, placeholder: "Model" },
    ...(items.length
      ? [
          {
            key: "requestedItemId",
            label: "For item",
            width: "4.5rem",
            input: "select" as const,
            options: [{ value: "", label: "— extra" }, ...items.map((it) => ({ value: it.id, label: `${it.no} ${it.description.split("\n")[0]!.slice(0, 40)}` }))],
            format: (v: LineValues) => items.find((it) => it.id === v.requestedItemId)?.no ?? <span className="text-muted">extra</span>,
          },
        ]
      : []),
    { key: "quantity", label: "Qty", width: "4.5rem", input: "number", align: "right", initial: "1", required: "Enter a quantity" },
    { key: "unit", label: "Unit", width: "4.5rem", input: "text", list: "line-units", maxLength: 20, initial: (p) => (p ? "sets" : "pcs") },
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
    { key: "taxRate", label: "Tax %", width: "3.5rem", input: "number", align: "right", initial: String(DEFAULT_TAX_RATE), phoneHidden: true },
    { key: "total", label: "Total", width: "7.5rem", align: "right", format: lineTotal },
  ];

  const startFromItems = async () => {
    setStarting(true);
    setStartError(null);
    const at = new Map(items.map((it, n) => [it.id, n]));
    const r = await lines.add(q.id, {
      lines: items.map((it) => ({
        ...toBody({ description: it.description, model: it.model ?? "", requestedItemId: it.id, quantity: it.quantity, unit: it.unit, unitPrice: "0", taxRate: "" }),
        partOf: it.parentId ? (at.get(it.parentId) ?? null) : null,
      })),
    });
    setStarting(false);
    if (r.ok) onChanged(r.offer);
    else setStartError(r.message);
  };

  const copy = async () => {
    if (!copyFrom) return;
    setStarting(true);
    setStartError(null);
    const r = await lines.copy(q.id, copyFrom);
    setStarting(false);
    if (r.ok) onChanged(r.offer);
    else setStartError(r.message);
  };

  const copyTool = others.length > 0 && canEdit && (
    <span className="flex items-center gap-1.5">
      <Select compact aria-label="Offer to copy lines from" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} className="h-8 w-48">
        {others.map((o) => (
          <option key={o.id} value={o.id}>
            {o.factory.name} ({o.lines.length})
          </option>
        ))}
      </Select>
      <Button size="xs" variant="secondary" onClick={() => void copy()} disabled={starting}>
        <Copy aria-hidden /> Copy their lines
      </Button>
    </span>
  );

  return (
    <article aria-label={`Offer from ${q.factory.name}`} className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold">
            {q.factory.name}
            {q.reference && <span className="text-sm font-normal text-muted">ref. {q.reference}</span>}
            {items.length > 0 && q.lines.length > 0 && <CoverageBadge missing={q.coverage.missing} />}
          </h3>
          <p className="mt-0.5 text-xs text-muted">
            {q.basis ? (
              <span className="font-medium text-text-2">{basisText(q.basis, q.basisPlace)} · </span>
            ) : (
              <span className="font-medium text-warn">Price basis not said · </span>
            )}
            {q.currency} · received {dateText(q.receivedOn)}
            {q.validUntil ? ` · valid until ${dateText(q.validUntil)}` : ""}
            {q.leadTime ? ` · ${q.leadTime}` : ""}
            {q.fxRate === null && <span className="ml-1 font-medium text-warn">· no exchange rate for {q.currency}</span>}
          </p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-1">
            <Button size="xs" variant="secondary" onClick={() => setDetails(!details)} aria-expanded={details}>
              <Pencil aria-hidden /> Details
            </Button>
            <ActionForm action={removeAction} showSuccess={false} className="inline-flex">
              <ConfirmSubmit size="xs" variant="danger-ghost" pendingText="Removing…" message={`Remove the offer from ${q.factory.name} with its ${q.lines.length} lines?`}>
                Remove offer
              </ConfirmSubmit>
            </ActionForm>
          </div>
        )}
      </header>

      {details ? (
        <div className="rounded-xl border border-primary/30 bg-primary-soft/20 p-4">{headerForm}</div>
      ) : (
        (q.moq || q.paymentTerms || q.notes) && (
          <DetailList
            columns={3}
            items={[
              { label: "MOQ", value: q.moq, hidden: !q.moq },
              { label: "Payment terms", value: q.paymentTerms, hidden: !q.paymentTerms },
              { label: "Notes", value: <span className="whitespace-pre-line">{q.notes}</span>, hidden: !q.notes },
            ]}
          />
        )
      )}

      {q.lines.some((l) => l.used) && canEdit && (
        <p className="rounded-md bg-info-soft px-3 py-2 text-xs text-text-2">
          A quotation is priced from this offer. Changing a price, quantity or the order of its lines asks why; wording and models can change freely
          (the quotation keeps its own copy).
        </p>
      )}

      {q.lines.length === 0 && canEdit && (items.length > 0 || others.length > 0) && (
        <div className="flex flex-col gap-2 rounded-lg border border-dashed border-primary/40 bg-primary-soft/20 p-3 text-sm">
          <p className="font-medium">Start this offer</p>
          <div className="flex flex-wrap items-center gap-2">
            {others.length > 0 && copyTool}
            {items.length > 0 && (
              <Button size="xs" variant="secondary" onClick={() => void startFromItems()} disabled={starting}>
                <ListPlus aria-hidden /> Start from the customer&apos;s list ({items.length})
              </Button>
            )}
            <span className="text-xs text-muted">or type the first line below. Change models and prices to what this factory offers.</span>
          </div>
          {startError && <p className="text-xs text-bad">{startError}</p>}
        </div>
      )}

      <LineTable
        rows={rows}
        columns={columns}
        noun="line"
        readOnly={!canEdit}
        onAdd={async (newLines: NewLine[], at, reason) =>
          result(
            await lines.add(q.id, {
              lines: newLines.map((l) => ({ ...toBody(l.values), partOf: l.partOf })),
              afterId: at.afterKey,
              parentId: at.parentKey,
              reason,
            }),
          )
        }
        onEdit={async (key, values, reason) => {
          const body: Record<string, unknown> = { reason };
          const full = toBody({ ...rows.find((r) => r.key === key)!.values, ...values });
          for (const k of Object.keys(values)) body[k] = full[k as keyof typeof full];
          return result(await lines.edit(key, body));
        }}
        onRemove={async (key, reason) => result(await lines.remove(key, reason))}
        onMove={async (key, to: LineMove, reason) => result(await lines.move(key, { to, reason }))}
        footer={
          q.lines.length > 0 ? (
            <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-1 px-3 py-2 text-sm">
              <span className="text-muted">
                Factory total{" "}
                <span className="font-semibold text-text tabular">
                  {formatMinor(
                    q.lines.reduce((t, l) => t + Math.round(toMinor(l.unitPrice) * Number(l.quantity)), 0),
                    q.currency,
                  )}
                </span>{" "}
                without tax
              </span>
              {q.totalCost && (
                <span className="text-muted">
                  Our cost with tax <span className="font-semibold text-text tabular">{amount(q.totalCost, mainCurrency)}</span>
                </span>
              )}
            </div>
          ) : undefined
        }
      />
      <datalist id="line-units">
        {["pcs", "sets", "kg", "tons", "m", "m²", "m³", "rolls", "cartons", "pairs", "litres", "lot"].map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>

      <OfferFiles dealId={dealId} q={q} canEdit={canEdit} removeFile={lines.removeFile} />
    </article>
  );
}

/** The factory's quotation, catalogue and screenshots, kept with the offer as evidence. */
function OfferFiles({
  dealId,
  q,
  canEdit,
  removeFile,
}: {
  dealId: string;
  q: FactoryQuoteView;
  canEdit: boolean;
  removeFile: (fileId: string, prev: ActionState, form: FormData) => Promise<ActionState>;
}) {
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
    if (done) router.refresh();
    setStaged((s) => s.filter((x) => x.error));
  };

  return (
    <section aria-label="The factory's files" className="flex flex-col gap-2 rounded-lg border border-line p-3">
      <h4 className="flex items-center gap-1.5 text-sm font-semibold">
        <Paperclip className="size-4 text-muted" aria-hidden /> The factory&apos;s quotation &amp; files
        <span className="text-xs font-normal text-muted">· kept as evidence, internal</span>
      </h4>
      {q.files.length === 0 && !canEdit && <p className="text-sm text-muted">No files.</p>}
      {q.files.length === 0 && canEdit && !staged.length && (
        <p className="text-xs text-warn">No factory quotation attached yet — add their PDF, Excel or WeChat screenshots.</p>
      )}
      {q.files.length > 0 && (
        <ul className="flex flex-col divide-y divide-line">
          {q.files.map((f) => (
            <OfferFileRow key={f.id} f={f} canEdit={canEdit} remove={removeFile.bind(null, f.id)} />
          ))}
        </ul>
      )}
      {canEdit && (
        <FileDrop
          staged={staged}
          setStaged={setStaged}
          busy={busy}
          onUpload={() => void upload()}
          kinds={OFFER_FILE_KINDS}
          guess={guessOfferKind}
          title={`Drop ${q.factory.name}'s quotation, catalogue or screenshots here`}
        />
      )}
    </section>
  );
}

function OfferFileRow({ f, canEdit, remove }: { f: OfferFile; canEdit: boolean; remove: Action }) {
  const viewable = /^(application\/pdf|image\/(png|jpeg|gif|webp))$/.test(f.mimeType);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <span className="flex min-w-0 items-center gap-2">
        <FileText className="size-4 shrink-0 text-muted" aria-hidden />
        <span className="min-w-0">
          <span className="block truncate text-sm">{f.fileName}</span>
          <span className="text-xs text-muted">
            {ATTACHMENT_KIND_LABEL[f.kind]} · {size(f.size)} · {dateText(f.uploadedOn)}
            {f.note ? ` · ${f.note}` : ""}
          </span>
        </span>
      </span>
      <span className="flex items-center gap-1">
        {viewable && (
          <a href={`/files/${f.id}?view=1`} target="_blank" rel="noreferrer" className="inline-flex size-7 items-center justify-center rounded-md hover:bg-surface-2" aria-label={`View ${f.fileName}`}>
            <Eye className="size-4" />
          </a>
        )}
        <a href={`/files/${f.id}`} className="inline-flex size-7 items-center justify-center rounded-md hover:bg-surface-2" aria-label={`Download ${f.fileName}`}>
          <Download className="size-4" />
        </a>
        {canEdit && (
          <ActionForm action={remove} showSuccess={false} className="inline-flex">
            <ConfirmSubmit size="icon-xs" variant="danger-ghost" pendingText="…" message={`Remove ${f.fileName}?`} aria-label={`Remove ${f.fileName}`}>
              <Trash2 aria-hidden />
            </ConfirmSubmit>
          </ActionForm>
        )}
      </span>
    </li>
  );
}
