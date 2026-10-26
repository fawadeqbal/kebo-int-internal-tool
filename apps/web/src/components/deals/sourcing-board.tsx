"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button, Card, CardBody, CardHeader, cn, DetailList, EmptyState, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { ConfirmSubmit } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";
import { date as dateText, money as amount, qty as qtyText } from "@/lib/format";
import type { FactoryOption, FactoryQuoteView, SourcingView } from "@/lib/types-deals";
import { FactoryQuoteForm } from "./factory-quote-form";
import { CoverageBadge } from "./revision-editor";

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
                  <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    {q.factory.name}
                    {q.reference && <span className="font-normal text-muted">ref. {q.reference}</span>}
                    <CoverageBadge missing={q.coverage.missing} />
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
                      <Td className={cn(l.parentId && "pl-8")}>
                        <span className="flex items-start gap-1.5">
                          <span className="shrink-0 text-xs text-muted tabular">{l.no}</span>
                          <span className="block max-w-96 truncate text-sm">{l.description}</span>
                        </span>
                        <span className="text-xs text-muted">
                          {l.answersNo ? `Answers item ${l.answersNo}` : "An extra (not one of the customer's items)"}
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
