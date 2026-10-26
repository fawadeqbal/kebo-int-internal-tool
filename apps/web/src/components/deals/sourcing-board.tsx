"use client";

import { useState, type ReactNode } from "react";
import { Plus, Split, X } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, DetailList, EmptyState, Input, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { ConfirmSubmit, SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";
import { date as dateText, money as amount, qty as qtyText } from "@/lib/format";
import type { FactoryOption, FactoryQuoteView, SourcingView } from "@/lib/types-deals";
import { FactoryQuoteForm } from "./factory-quote-form";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** "Quote from this" for one option of one item. */
export function ChoosePrice({ action, itemId, lineId, chosen }: { action: Action; itemId: string; lineId: string; chosen: boolean }) {
  if (chosen) return <Badge tone="primary">Quoting from this</Badge>;
  return (
    <ActionForm action={action} showSuccess={false} className="inline-flex max-w-md flex-col items-end">
      {(s) => (
        <>
          <input type="hidden" name="itemId" value={itemId} />
          <input type="hidden" name="lineId" value={lineId} />
          <SubmitButton size="xs" variant="secondary" pendingText="Saving…">
            Quote from this
          </SubmitButton>
          {s.ok === false && s.code !== "reason_needed" && <span className="ml-2 text-xs text-bad">{s.message}</span>}
        </>
      )}
    </ActionForm>
  );
}

type Part = { key: string; description: string; model: string; quantity: string; unit: string };
const newPart = (unit = "sets"): Part => ({ key: Math.random().toString(36).slice(2), description: "", model: "", quantity: "1", unit });

/**
 * When a factory quotes one item as separate parts (a line as machine +
 * conveyor + spares): the parts become lines of their own, numbered under the
 * item (3.1, 3.2), each priced on its own, on the quotation and the order.
 */
export function SplitItem({
  action,
  itemNo,
  hasParts,
  unit,
  children,
}: {
  action: Action;
  itemNo: string;
  hasParts: boolean;
  unit: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [parts, setParts] = useState<Part[]>(() => [newPart(unit), newPart(unit)]);
  const setPart = (key: string, p: Partial<Part>) => setParts((x) => x.map((y) => (y.key === key ? { ...y, ...p } : y)));
  const close = () => {
    setOpen(false);
    setParts([newPart(unit), newPart(unit)]);
  };
  const head = (
    <span className="flex items-center gap-2 text-sm text-muted tabular">
      {children}
      {!open && (
        <Button size="xs" variant="ghost" onClick={() => setOpen(true)} title="When a factory quotes this item as separate parts">
          <Split aria-hidden /> {hasParts ? "Add parts" : "Split into parts"}
        </Button>
      )}
    </span>
  );
  if (!open) return head;
  const body = {
    parts: parts
      .filter((p) => p.description.trim())
      .map((p) => ({
        description: p.description.trim(),
        model: p.model.trim() || null,
        quantity: p.quantity.replace(",", "."),
        unit: p.unit.trim() || "pcs",
      })),
  };
  return (
    <>
      {head}
      <ActionForm
        action={action}
        onDone={close}
        className="flex basis-full flex-col gap-2 rounded-lg border border-line bg-surface-2/60 p-3"
      >
        {(s) => (
          <>
            <input type="hidden" name="payload" value={JSON.stringify(body)} />
            <p className="text-sm font-medium">Parts of item {itemNo}</p>
            <ol className="flex flex-col gap-2">
              {parts.map((p, i) => (
                <li key={p.key} className="flex flex-wrap items-center gap-2">
                  <span className="w-9 shrink-0 text-xs text-muted tabular">
                    {itemNo}.{i + 1}
                  </span>
                  <Input
                    aria-label={`Part ${i + 1} description`}
                    placeholder="e.g. Capping machine"
                    value={p.description}
                    onChange={(e) => setPart(p.key, { description: e.target.value })}
                    className="min-w-0 flex-1 basis-48"
                  />
                  <Input
                    aria-label={`Part ${i + 1} model`}
                    placeholder="Model"
                    value={p.model}
                    onChange={(e) => setPart(p.key, { model: e.target.value })}
                    maxLength={120}
                    className="w-28"
                  />
                  <Input
                    aria-label={`Part ${i + 1} quantity`}
                    inputMode="decimal"
                    value={p.quantity}
                    onChange={(e) => setPart(p.key, { quantity: e.target.value })}
                    className="w-16 tabular"
                  />
                  <Input
                    aria-label={`Part ${i + 1} unit`}
                    value={p.unit}
                    onChange={(e) => setPart(p.key, { unit: e.target.value })}
                    maxLength={20}
                    className="w-16"
                  />
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    onClick={() => setParts((x) => x.filter((y) => y.key !== p.key))}
                    disabled={parts.length === 1}
                    aria-label={`Remove part ${i + 1}`}
                  >
                    <X aria-hidden />
                  </Button>
                </li>
              ))}
            </ol>
            {s.errors && Object.keys(s.errors).some((k) => k.startsWith("parts")) && (
              <p className="text-xs text-bad">Each part needs a description and a quantity.</p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button size="xs" variant="ghost" onClick={() => setParts((x) => [...x, newPart(unit)])} disabled={parts.length >= 50}>
                <Plus aria-hidden /> Another part
              </Button>
              <span className="flex-1" />
              <Button size="sm" variant="ghost" onClick={close}>
                Cancel
              </Button>
              <SubmitButton size="sm" pendingText="Saving…" disabled={!body.parts.length}>
                Save the parts
              </SubmitButton>
            </div>
          </>
        )}
      </ActionForm>
    </>
  );
}

/**
 * Every factory offer on the deal, with add / edit / remove. The forms open in
 * place so the comparison above stays in view.
 */
export function FactoryQuotes({
  quotes,
  items,
  canEdit,
  today,
  mainCurrency,
  rates,
  saveAction,
  removeAction,
  searchFactories,
}: {
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
}) {
  const [editing, setEditing] = useState<string | null>(quotes.length === 0 && canEdit ? "new" : null);
  const itemNo = (id: string | null) => items.find((i) => i.id === id)?.no ?? null;

  return (
    <Card>
      <CardHeader
        title="Factory offers"
        description={`${quotes.length} offer${quotes.length === 1 ? "" : "s"} · internal, never shown to the customer`}
        actions={
          canEdit && editing !== "new" ? (
            <Button size="sm" variant="primary" onClick={() => setEditing("new")}>
              <Plus aria-hidden /> Add factory prices
            </Button>
          ) : undefined
        }
      />
      <CardBody className="flex flex-col gap-4">
        {editing === "new" && (
          <div className="rounded-xl border border-primary/30 bg-primary-soft/20 p-4">
            <h3 className="mb-3 text-sm font-semibold">New factory offer</h3>
            <FactoryQuoteForm
              action={saveAction.bind(null, null)}
              quote={null}
              items={items}
              today={today}
              mainCurrency={mainCurrency}
              rates={rates}
              searchFactories={searchFactories}
              onDone={() => setEditing(null)}
            />
          </div>
        )}
        {quotes.length === 0 && editing !== "new" && (
          <EmptyState
            title="No factory prices yet"
            description="Ask two or three factories, then record each offer here to compare them."
          />
        )}
        {quotes.map((q) =>
          editing === q.id ? (
            <div key={q.id} className="rounded-xl border border-primary/30 bg-primary-soft/20 p-4">
              <h3 className="mb-3 text-sm font-semibold">Edit the offer from {q.factory.name}</h3>
              <FactoryQuoteForm
                action={saveAction.bind(null, q.id)}
                quote={q}
                items={items}
                today={today}
                mainCurrency={mainCurrency}
                rates={rates}
                searchFactories={searchFactories}
                onDone={() => setEditing(null)}
              />
            </div>
          ) : (
            <article key={q.id} className="rounded-xl border border-line">
              <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">
                    {q.factory.name}
                    {q.reference && <span className="ml-2 font-normal text-muted">ref. {q.reference}</span>}
                  </h3>
                  <p className="mt-0.5 text-xs text-muted">
                    {q.currency} · received {dateText(q.receivedOn)}
                    {q.validUntil ? ` · valid until ${dateText(q.validUntil)}` : ""}
                    {q.fxRate === null && <span className="ml-1 font-medium text-warn">· no exchange rate for {q.currency}</span>}
                  </p>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1">
                    <Button size="xs" variant="secondary" onClick={() => setEditing(q.id)}>
                      Edit
                    </Button>
                    <ActionForm action={removeAction.bind(null, q.id)} showSuccess={false} className="inline-flex">
                      <ConfirmSubmit
                        size="xs"
                        variant="danger-ghost"
                        pendingText="Removing…"
                        message={`Remove the offer from ${q.factory.name}? Items quoted from it will need another price.`}
                      >
                        Remove
                      </ConfirmSubmit>
                    </ActionForm>
                  </div>
                )}
              </header>
              {(q.priceBasis || q.leadTime || q.moq || q.paymentTerms) && (
                <div className="border-b border-line px-4 py-3">
                  <DetailList
                    columns={3}
                    items={[
                      { label: "Price basis", value: q.priceBasis, hidden: !q.priceBasis },
                      { label: "Lead time", value: q.leadTime, hidden: !q.leadTime },
                      { label: "MOQ", value: q.moq, hidden: !q.moq },
                      { label: "Payment terms", value: q.paymentTerms, hidden: !q.paymentTerms },
                    ]}
                  />
                </div>
              )}
              <Table>
                <THead>
                  <tr>
                    <Th>Item</Th>
                    <Th className="text-right">Qty</Th>
                    <Th className="text-right">Price</Th>
                    <Th className="text-right">Your cost / unit</Th>
                  </tr>
                </THead>
                <tbody>
                  {q.lines.map((l) => (
                    <Tr key={l.id}>
                      <Td>
                        <span className="block max-w-96 truncate text-sm">{l.description}</span>
                        <span className="text-xs text-muted">
                          {itemNo(l.requestedItemId) ? `For item ${itemNo(l.requestedItemId)}` : "Not linked to a requested item"}
                          {l.model ? ` · ${l.model}` : ""}
                        </span>
                        <span className="mt-0.5 block text-xs text-text-2">{l.costNote}</span>
                      </Td>
                      <Td className="text-right whitespace-nowrap tabular">
                        {qtyText(l.quantity)} {l.unit}
                      </Td>
                      <Td className="text-right whitespace-nowrap tabular">{amount(l.unitPrice, q.currency)}</Td>
                      <Td className="text-right font-medium whitespace-nowrap tabular">
                        {l.unitCost === null ? (
                          <span className="text-xs font-normal text-warn">No rate</span>
                        ) : (
                          amount(l.unitCost, mainCurrency)
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
              {q.notes && <p className="border-t border-line px-4 py-2.5 text-xs whitespace-pre-line text-text-2">{q.notes}</p>}
            </article>
          ),
        )}
      </CardBody>
    </Card>
  );
}
