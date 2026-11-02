"use client";

import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Copy, Download, Eye, Factory, FileText, Info, ListPlus, Paperclip, Pencil, Plus, Trash2 } from "lucide-react";
import { formatMinor, toMinor } from "@kebo/money";
import { ATTACHMENT_KIND_LABEL, basisText, DEFAULT_TAX_RATE, type AttachmentKind } from "@kebo/shared";
import { Badge, Button, Card, cn, Select } from "@kebo/ui";
import { ConfirmSubmit } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { LineTable, type LineColumn, type LineMove, type LineResult, type LineRow, type LineValues, type NewLine } from "@/components/lines/line-table";
import type { ActionState } from "@/lib/actions";
import { date as dateText, money as amount } from "@/lib/format";
import { rateSentence } from "@/lib/fx";
import type { FactoryOption, FactoryQuoteView, OfferFile, SourcingView } from "@/lib/types-deals";
import type { OfferLineResult } from "@/app/(app)/inquiries/[id]/sourcing/actions";
import { FileDrop, send, type Staged } from "./documents-panel";
import { OfferHeaderForm } from "./factory-quote-form";

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
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What is still missing before an offer can be quoted with confidence. */
type Issue = { key: string; text: ReactNode; fix?: "details" | "files" };

function issuesOf(q: FactoryQuoteView, items: Items): Issue[] {
  if (!q.lines.length) return [];
  const out: Issue[] = [];
  if (q.unpriced > 0) out.push({ key: "price", text: <>{plural(q.unpriced, "line")} without a price.</> });
  if (items.length && q.coverage.missing.length) {
    const names = q.coverage.missing.map((no) => {
      const it = items.find((i) => i.no === no);
      return `${no}${it ? ` ${it.description.split("\n")[0]}` : ""}`;
    });
    out.push({
      key: "cover",
      text: (
        <>
          The customer&apos;s {q.coverage.missing.length === 1 ? "item" : "items"} <b>{names.join(", ")}</b> {q.coverage.missing.length === 1 ? "is" : "are"} not in this offer.
        </>
      ),
    });
  }
  if (!q.basis) out.push({ key: "basis", text: <>Price basis not said (EXW, FOB…): needed to work out freight and the like.</>, fix: "details" });
  if (q.fxRate === null) out.push({ key: "rate", text: <>No exchange rate for {q.currency} in Settings, so this offer is left out of totals and the comparison.</> });
  if (!q.files.length) out.push({ key: "file", text: <>No factory quotation file kept with it yet.</>, fix: "files" });
  return out;
}

function statusOf(q: FactoryQuoteView, items: Items): { label: string; tone: "ok" | "warn" | "neutral" } {
  if (!q.lines.length) return { label: "No lines yet", tone: "neutral" };
  if (q.fxRate === null) return { label: `Needs ${q.currency} rate`, tone: "warn" };
  const n = issuesOf(q, items).length;
  return n ? { label: `${n} to finish`, tone: "warn" } : { label: "Complete", tone: "ok" };
}

/**
 * The factory offers on a deal: a list of the offers (cost, basis, what is
 * missing) and the chosen one — its details, what is still missing, its lines
 * in the line table (typed, pasted or copied from another factory's offer,
 * saved as they are made) and its own files (the factory's quotation,
 * catalogue, WeChat screenshots) kept as evidence.
 */
export function FactoryQuotes({
  dealId,
  quotes,
  items,
  canEdit,
  today,
  mainCurrency,
  rates,
  initialOffer,
  saveAction,
  removeAction,
  searchFactories,
  lines,
}: {
  dealId: string;
  quotes: FactoryQuoteView[];
  items: Items;
  canEdit: boolean;
  today: string;
  mainCurrency: string;
  rates: Record<string, number>;
  /** The offer to open first (from "Compare side by side"). */
  initialOffer?: string | null;
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
  const [active, setActive] = useState<string | "new" | null>(() =>
    initialOffer && quotes.some((q) => q.id === initialOffer) ? initialOffer : quotes.length ? quotes[0]!.id : null,
  );
  const [details, setDetails] = useState(false);
  const shown = offers.find((q) => q.id === active) ?? null;

  // The totals reload a moment after the last change, not on every keystroke.
  const reload = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (reload.current && clearTimeout(reload.current)), []);
  const changed = (offer: FactoryQuoteView) => {
    setFresh((f) => ({ ...f, [offer.id]: offer }));
    if (reload.current) clearTimeout(reload.current);
    reload.current = setTimeout(() => router.refresh(), 1200);
  };
  const open = (id: string | "new") => {
    setActive(id);
    setDetails(false);
  };

  if (!offers.length && active !== "new") return <NoOffers items={items} canEdit={canEdit} onAdd={() => open("new")} />;

  return (
    <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-start">
      <OfferList offers={offers} items={items} active={active} mainCurrency={mainCurrency} canEdit={canEdit} onOpen={open} />

      <div className="min-w-0 flex-1">
        {active === "new" && (
          <AddOffer
            others={offers.filter((o) => o.lines.length)}
            items={items}
            today={today}
            mainCurrency={mainCurrency}
            rates={rates}
            searchFactories={searchFactories}
            saveAction={saveAction.bind(null, null)}
            lines={lines}
            onCreated={(id) => open(id)}
            onChanged={changed}
            onCancel={offers.length ? () => open(offers[0]!.id) : () => setActive(null)}
          />
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
            rates={rates}
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
      </div>
    </div>
  );
}

/** No offer yet: what to do, and what the factories quote on. */
function NoOffers({ items, canEdit, onAdd }: { items: Items; canEdit: boolean; onAdd: () => void }) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
      <Card className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
        <span className="grid size-14 place-items-center rounded-2xl bg-primary-soft text-primary">
          <Factory className="size-7" aria-hidden />
        </span>
        <h2 className="text-lg font-semibold">No factory offers yet</h2>
        <p className="max-w-md text-sm text-text-2">
          Send the customer&apos;s list to two or three factories. When each one replies, add its offer here and compare them side by side.
        </p>
        {canEdit && (
          <Button variant="primary" onClick={onAdd} className="mt-1">
            <Plus aria-hidden /> Add the first offer
          </Button>
        )}
      </Card>
      {items.length > 0 && (
        <Card className="flex flex-col gap-2 p-4 lg:w-96 lg:shrink-0">
          <h3 className="text-sm font-semibold">What the factories quote on</h3>
          <p className="text-xs text-muted">The customer&apos;s {plural(items.filter((i) => !i.parentId).length, "item")}, from the inquiry.</p>
          <ul className="flex flex-col divide-y divide-line">
            {items.map((it) => (
              <li key={it.id} className={cn("flex items-baseline justify-between gap-3 py-2 text-sm", it.parentId && "pl-5")}>
                <span className="min-w-0">
                  <span className="mr-1.5 rounded bg-surface-2 px-1.5 py-0.5 text-xs font-medium text-text-2 tabular">{it.no}</span>
                  {it.description.split("\n")[0]}
                </span>
                <span className="shrink-0 text-text-2 tabular">
                  {Number(it.quantity).toLocaleString("en-US", { maximumFractionDigits: 2 })} {it.unit}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/** Every offer at a glance: our cost, its basis and lead time, and whether anything is still missing. A row on phones, a column beside the offer on wide screens. */
function OfferList({
  offers,
  items,
  active,
  mainCurrency,
  canEdit,
  onOpen,
}: {
  offers: FactoryQuoteView[];
  items: Items;
  active: string | null;
  mainCurrency: string;
  canEdit: boolean;
  onOpen: (id: string | "new") => void;
}) {
  return (
    <nav aria-label="Factory offers" className="flex flex-col gap-2 2xl:sticky 2xl:top-20 2xl:w-72 2xl:shrink-0">
      <span className="hidden text-xs font-semibold tracking-wide text-muted uppercase 2xl:block">{plural(offers.length, "offer")}</span>
      <ul className="-mx-4 flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 pt-0.5 pb-1 sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:mx-0 lg:scroll-px-0 lg:px-0.5 2xl:flex-col 2xl:overflow-visible 2xl:pb-0">
        {offers.map((q) => {
          const st = statusOf(q, items);
          const on = active === q.id;
          return (
            <li key={q.id} className="w-64 shrink-0 snap-start 2xl:w-auto">
              <button
                type="button"
                onClick={() => onOpen(q.id)}
                aria-current={on ? "true" : undefined}
                className={cn(
                  "flex h-full w-full flex-col items-start gap-1.5 rounded-xl border px-3.5 py-3 text-left transition-colors",
                  on ? "border-primary bg-primary-soft ring-1 ring-primary" : "border-line bg-surface hover:border-line-strong",
                )}
              >
                <span className="flex w-full items-baseline justify-between gap-2">
                  <span className="min-w-0 font-semibold break-words">{q.factory.name}</span>
                  <span className="shrink-0 text-sm font-semibold tabular">
                    {q.lines.length && q.totalCost && Number(q.totalCost) > 0 ? amount(q.totalCost, mainCurrency) : <span className="font-normal text-muted">—</span>}
                  </span>
                </span>
                <span className="text-xs text-text-2">
                  {[q.basis ? basisText(q.basis, q.basisPlace) : "Basis not said", q.currency, q.leadTime].filter(Boolean).join(" · ")}
                </span>
                <span className="flex flex-wrap gap-1.5">
                  <Badge tone={st.tone}>
                    {st.tone === "ok" ? <CheckCircle2 aria-hidden /> : null}
                    {st.label}
                  </Badge>
                  {q.lines.some((l) => l.used) && <Badge tone="primary">In the quotation</Badge>}
                </span>
              </button>
            </li>
          );
        })}
        {canEdit && (
          <li className="w-48 shrink-0 snap-start 2xl:w-auto">
            <button
              type="button"
              onClick={() => onOpen("new")}
              aria-pressed={active === "new"}
              className={cn(
                "flex h-full min-h-12 w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed px-3 py-3 text-sm font-semibold text-primary",
                active === "new" ? "border-primary bg-primary-soft" : "border-primary/40 bg-surface hover:border-primary",
              )}
            >
              <Plus className="size-4" aria-hidden /> Add factory offer
            </button>
          </li>
        )}
      </ul>
      <p className="hidden text-xs text-muted 2xl:block">Totals are our cost in {mainCurrency} with tax, on each factory&apos;s own price basis.</p>
    </nav>
  );
}

/** A new offer: the factory and its currency, and where its lines start from. Everything else is filled in on the offer. */
function AddOffer({
  others,
  items,
  today,
  mainCurrency,
  rates,
  searchFactories,
  saveAction,
  lines,
  onCreated,
  onChanged,
  onCancel,
}: {
  others: FactoryQuoteView[];
  items: Items;
  today: string;
  mainCurrency: string;
  rates: Record<string, number>;
  searchFactories: (q: string) => Promise<FactoryOption[]>;
  saveAction: Action;
  lines: OfferLineActions;
  onCreated: (id: string) => void;
  onChanged: (offer: FactoryQuoteView) => void;
  onCancel: () => void;
}) {
  type Start = "items" | "copy" | "empty";
  const [start, setStart] = useState<Start>(items.length ? "items" : others.length ? "copy" : "empty");
  const [from, setFrom] = useState(others[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const choices: { value: Start; title: string; hint: string; hidden?: boolean }[] = [
    { value: "items", title: `The customer's list (${items.length})`, hint: "Then change the models and add their prices.", hidden: !items.length },
    { value: "copy", title: "Another factory's lines", hint: "Same lines, prices left empty.", hidden: !others.length },
    { value: "empty", title: "Nothing: I'll type or paste them", hint: "Excel upload is in the table's Excel menu." },
  ];
  return (
    <Card className="flex flex-col gap-4 p-4 sm:p-5">
      <div>
        <h2 className="text-base font-semibold">Add a factory offer</h2>
        <p className="text-sm text-text-2">Just the factory and its currency now. Price basis, lead time and the rest are filled in on the offer.</p>
      </div>
      <OfferHeaderForm
        compact
        action={saveAction}
        quote={null}
        today={today}
        mainCurrency={mainCurrency}
        rates={rates}
        searchFactories={searchFactories}
        submitLabel="Add offer"
        onCancel={onCancel}
        onDone={async (st) => {
          const id = (st.data as { id?: string } | undefined)?.id;
          if (!id) return;
          onCreated(id);
          setError(null);
          let r: OfferLineResult | null = null;
          if (start === "items") r = await lines.add(id, { lines: startLines(items) });
          else if (start === "copy" && from) r = await lines.copy(id, from);
          if (r && r.ok) onChanged(r.offer);
          else if (r && !r.ok) setError(r.message);
        }}
        extra={
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">Start the lines from</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {choices
                .filter((c) => !c.hidden)
                .map((c) => (
                  <label
                    key={c.value}
                    className={cn(
                      "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm",
                      start === c.value ? "border-primary bg-primary-soft ring-1 ring-primary" : "border-line bg-surface hover:border-line-strong",
                    )}
                  >
                    <input type="radio" name="start-from" className="mt-1 accent-[var(--color-primary)]" checked={start === c.value} onChange={() => setStart(c.value)} />
                    <span>
                      <span className="block font-medium">{c.title}</span>
                      <span className="block text-xs text-text-2">{c.hint}</span>
                    </span>
                  </label>
                ))}
            </div>
            {start === "copy" && others.length > 1 && (
              <Select compact aria-label="Offer to copy lines from" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-full sm:w-72">
                {others.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.factory.name} ({plural(o.lines.length, "line")})
                  </option>
                ))}
              </Select>
            )}
            {start === "copy" && others.length === 1 && <p className="text-xs text-muted">From {others[0]!.factory.name}.</p>}
            {error && <p className="text-xs text-bad">{error}</p>}
          </fieldset>
        }
      />
    </Card>
  );
}

/** The customer's items as an offer's first lines (no prices yet). */
function startLines(items: Items) {
  const at = new Map(items.map((it, n) => [it.id, n]));
  return items.map((it) => ({
    ...toBody({ description: it.description, model: it.model ?? "", requestedItemId: it.id, quantity: it.quantity, unit: it.unit, unitPrice: "0", taxRate: "" }),
    partOf: it.parentId ? (at.get(it.parentId) ?? null) : null,
  }));
}

function toBody(v: LineValues) {
  return {
    description: v.description,
    model: v.model?.trim() || null,
    requestedItemId: v.requestedItemId || null,
    quantity: (v.quantity ?? "").replace(/,/g, "").trim(),
    unit: v.unit?.trim() || "pcs",
    unitPrice: (v.unitPrice ?? "").replace(/,/g, "").trim() || "0",
    taxRate: (v.taxRate ?? "").trim() || String(DEFAULT_TAX_RATE),
  };
}

function Offer({
  dealId,
  q,
  others,
  items,
  canEdit,
  mainCurrency,
  rates,
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
  items: Items;
  canEdit: boolean;
  mainCurrency: string;
  rates: Record<string, number>;
  details: boolean;
  setDetails: (v: boolean) => void;
  onChanged: (offer: FactoryQuoteView) => void;
  lines: OfferLineActions;
  headerForm: ReactNode;
  removeAction: Action;
}) {
  const [copyFrom, setCopyFrom] = useState(others[0]?.id ?? "");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [addingFiles, setAddingFiles] = useState(false);
  const filesRef = useRef<HTMLElement>(null);
  const issues = issuesOf(q, items);
  const used = q.lines.some((l) => l.used);

  /** The line table's answer from an action's answer; new line ids for "keep adding after this". */
  const result = (r: OfferLineResult, before?: FactoryQuoteView): LineResult => {
    if (!r.ok) return { ok: false, message: r.message, reasonChoices: r.reasonChoices };
    onChanged(r.offer);
    const had = new Set((before ?? q).lines.map((l) => l.id));
    return { ok: true, keys: r.offer.lines.filter((l) => !had.has(l.id)).map((l) => l.id) };
  };

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
    { key: "taxRate", label: "Tax %", width: "3.5rem", input: "number", align: "right", initial: String(DEFAULT_TAX_RATE), phoneHidden: true },
    { key: "total", label: "Total", width: "9.5rem", align: "right", format: lineTotal },
  ];

  const startFromItems = async () => {
    setStarting(true);
    setStartError(null);
    const r = await lines.add(q.id, { lines: startLines(items) });
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

  const fix = (what: Issue["fix"]) => {
    if (what === "details") setDetails(true);
    if (what === "files") {
      setAddingFiles(true);
      requestAnimationFrame(() => filesRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
    }
  };

  const rate = q.currency !== mainCurrency ? rateSentence({ main: mainCurrency, rates }, mainCurrency, q.currency) : null;
  const facts: { label: string; value: string | null; warn?: string }[] = [
    { label: "Price basis", value: q.basis ? basisText(q.basis, q.basisPlace) : null, warn: "Not said" },
    { label: "Currency", value: q.fxRate === null ? null : `${q.currency}${rate ? ` · ${rate}` : ""}`, warn: `${q.currency} · no rate` },
    { label: "Lead time", value: q.leadTime },
    { label: "Valid until", value: q.validUntil ? dateText(q.validUntil) : null },
    { label: "Payment terms", value: q.paymentTerms },
    { label: "Minimum order", value: q.moq },
  ];

  return (
    <Card className="flex flex-col" aria-label={`Offer from ${q.factory.name}`}>
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">{q.factory.name}</h2>
            <p className="text-xs text-muted">
              {q.reference ? `ref. ${q.reference} · ` : ""}received {dateText(q.receivedOn)} · internal, never shown to the customer
            </p>
          </div>
          {canEdit && (
            <div className="flex items-center gap-1">
              <Button size="sm" variant="secondary" onClick={() => setDetails(!details)} aria-expanded={details}>
                <Pencil aria-hidden /> {details ? "Close details" : "Edit details"}
              </Button>
              <ActionForm action={removeAction} showSuccess={false} className="inline-flex">
                <ConfirmSubmit size="sm" variant="danger-ghost" pendingText="Removing…" message={`Remove the offer from ${q.factory.name} with its ${q.lines.length} lines?`}>
                  <Trash2 aria-hidden /> <span className="hidden sm:inline">Remove</span>
                  <span className="sr-only sm:hidden">Remove offer</span>
                </ConfirmSubmit>
              </ActionForm>
            </div>
          )}
        </header>

        {details ? (
          <div className="rounded-xl border border-primary/30 bg-primary-soft/20 p-4">{headerForm}</div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
            {facts.map((f) => {
              const empty = f.value === null || f.value === "";
              if (empty && !f.warn && !canEdit) return null;
              const body = (
                <>
                  <span className="block text-xs text-muted">{f.label}</span>
                  <span className={cn("line-clamp-2 block text-sm font-medium break-words", empty ? (f.warn ? "text-warn" : "text-primary") : "text-text")}>
                    {empty ? (f.warn ?? "+ Add") : f.value}
                  </span>
                </>
              );
              const cls = cn(
                "min-w-0 rounded-lg border px-3 py-2 text-left",
                empty && f.warn ? "border-warn/30 bg-warn-soft/50" : empty ? "border-dashed border-line-strong bg-surface" : "border-line bg-surface-2/50",
              );
              return canEdit ? (
                <button key={f.label} type="button" onClick={() => setDetails(true)} className={cn(cls, "hover:border-primary/50")} title={`Change ${f.label.toLowerCase()}`}>
                  {body}
                </button>
              ) : (
                <div key={f.label} className={cls}>
                  {body}
                </div>
              );
            })}
          </div>
        )}
        {!details && q.notes && <p className="rounded-lg bg-surface-2/60 px-3 py-2 text-sm whitespace-pre-line text-text-2">{q.notes}</p>}

        {q.lines.length > 0 &&
          (issues.length ? (
            <div role="status" className="flex flex-col gap-2 rounded-xl border border-warn/30 bg-warn-soft/60 p-3 sm:p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-warn">
                <AlertTriangle className="size-4" aria-hidden /> {issues.length === 1 ? "1 thing" : `${issues.length} things`} to finish this offer
              </p>
              <ul className="flex flex-col gap-1.5">
                {issues.map((i) => (
                  <li key={i.key} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="min-w-0">{i.text}</span>
                    {canEdit && i.fix && (
                      <Button size="xs" variant="secondary" onClick={() => fix(i.fix)}>
                        {i.fix === "details" ? "Add it" : "Add the file"}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p role="status" className="flex items-start gap-2 rounded-xl border border-ok/30 bg-ok-soft px-3 py-2.5 text-sm">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
              <span>
                <b className="text-ok">Complete.</b> {items.length ? "Covers all the customer's items, every" : "Every"} line has a price, and their quotation file is
                kept with it.
              </span>
            </p>
          ))}

        {used && canEdit && (
          <p className="flex items-start gap-2 rounded-xl border border-info/25 bg-info-soft px-3 py-2.5 text-sm">
            <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
            <span>
              A quotation is priced from this offer. Changing a price, quantity or the order of its lines asks why; wording and models can change freely (the
              quotation keeps its own copy).
            </span>
          </p>
        )}

        {q.lines.length === 0 && canEdit && (items.length > 0 || others.length > 0) && (
          <div className="flex flex-col gap-3 rounded-xl border-[1.5px] border-dashed border-primary/40 bg-primary-soft/20 p-3 sm:p-4">
            <p className="text-sm font-semibold">Start this offer</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {items.length > 0 && (
                <button
                  type="button"
                  onClick={() => void startFromItems()}
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
                    <Select compact aria-label="Offer to copy lines from" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} className="h-8 min-w-0 flex-1">
                      {others.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.factory.name} ({o.lines.length})
                        </option>
                      ))}
                    </Select>
                    <Button size="xs" variant="secondary" onClick={() => void copy()} disabled={starting}>
                      Copy
                    </Button>
                  </span>
                </div>
              )}
            </div>
            <p className="text-xs text-muted">Or type the first line in the table below, or use its Excel menu to upload their file.</p>
            {startError && <p className="text-xs text-bad">{startError}</p>}
          </div>
        )}
      </div>

      <div className="px-4 pb-4 sm:px-5 sm:pb-5">
        <LineTable
          rows={rows}
          columns={columns}
          noun="line"
          readOnly={!canEdit}
          sheet={{
            name: `Prices from ${q.factory.name}`,
            // Lines from a file go into an offer no quotation is priced from yet.
            upload: !used,
            templateRows: items.map((it) => ({
              no: it.no,
              values: { description: it.description, model: it.model ?? "", requestedItemId: it.id, quantity: it.quantity, unit: it.unit, unitPrice: "", taxRate: String(DEFAULT_TAX_RATE) },
            })),
          }}
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
      </div>

      <OfferFiles ref={filesRef} dealId={dealId} q={q} canEdit={canEdit} removeFile={lines.removeFile} adding={addingFiles} setAdding={setAddingFiles} />
    </Card>
  );
}

/** The factory's quotation, catalogue and screenshots, kept with the offer as evidence: a row of files, and a drop area when adding. */
function OfferFiles({
  ref,
  dealId,
  q,
  canEdit,
  removeFile,
  adding,
  setAdding,
}: {
  ref: Ref<HTMLElement>;
  dealId: string;
  q: FactoryQuoteView;
  canEdit: boolean;
  removeFile: (fileId: string, prev: ActionState, form: FormData) => Promise<ActionState>;
  adding: boolean;
  setAdding: (v: boolean) => void;
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
    if (done) {
      router.refresh();
      setAdding(false);
    }
    setStaged((s) => s.filter((x) => x.error));
  };
  const dropOpen = canEdit && (adding || staged.length > 0);

  return (
    <section ref={ref} aria-label="The factory's files" className="flex flex-col gap-3 border-t border-line px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-1 flex items-center gap-1.5 text-sm font-semibold text-text-2">
          <Paperclip className="size-4 text-muted" aria-hidden /> Factory&apos;s files
        </h3>
        {q.files.map((f) => (
          <OfferFileChip key={f.id} f={f} canEdit={canEdit} remove={removeFile.bind(null, f.id)} />
        ))}
        {q.files.length === 0 && (
          <span className={cn("text-xs", canEdit ? "font-medium text-warn" : "text-muted")}>
            {canEdit ? "None yet: add their PDF, Excel or WeChat screenshots." : "No files."}
          </span>
        )}
        {canEdit && !dropOpen && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-dashed border-line-strong px-3 text-xs font-semibold text-primary hover:border-primary"
          >
            <Plus className="size-3.5" aria-hidden /> Add files
          </button>
        )}
      </div>
      {dropOpen && (
        <div className="flex flex-col gap-2">
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
            <Button size="xs" variant="ghost" className="self-start" onClick={() => setAdding(false)}>
              Close
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

function OfferFileChip({ f, canEdit, remove }: { f: OfferFile; canEdit: boolean; remove: Action }) {
  const viewable = /^(application\/pdf|image\/(png|jpeg|gif|webp))$/.test(f.mimeType);
  return (
    <span
      className="inline-flex max-w-full items-center gap-1 rounded-full bg-surface-2 py-0.5 pr-1 pl-3 text-xs"
      title={`${ATTACHMENT_KIND_LABEL[f.kind]} · ${size(f.size)} · ${dateText(f.uploadedOn)}${f.note ? ` · ${f.note}` : ""}`}
    >
      <FileText className="size-3.5 shrink-0 text-muted" aria-hidden />
      <span className="max-w-48 truncate">{f.fileName}</span>
      <span className="text-muted">{size(f.size)}</span>
      {viewable && (
        <a href={`/files/${f.id}?view=1`} target="_blank" rel="noreferrer" className="inline-flex size-7 items-center justify-center rounded-full hover:bg-surface-3" aria-label={`View ${f.fileName}`}>
          <Eye className="size-3.5" />
        </a>
      )}
      <a href={`/files/${f.id}`} className="inline-flex size-7 items-center justify-center rounded-full hover:bg-surface-3" aria-label={`Download ${f.fileName}`}>
        <Download className="size-3.5" />
      </a>
      {canEdit && (
        <ActionForm action={remove} showSuccess={false} className="inline-flex">
          <ConfirmSubmit size="icon-xs" variant="danger-ghost" pendingText="…" message={`Remove ${f.fileName}?`} aria-label={`Remove ${f.fileName}`}>
            <Trash2 aria-hidden />
          </ConfirmSubmit>
        </ActionForm>
      )}
    </span>
  );
}
