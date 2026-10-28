import Link from "next/link";
import { multiplyMinor, toMinor, formatMinor } from "@kebo/money";
import { basisText } from "@kebo/shared";
import { Alert, Badge, buttonClass, Card, CardHeader, cn, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { todayIn } from "@kebo/utils";
import { api } from "@/lib/api";
import { load, requirePermission } from "@/lib/session";
import { date, money, qty } from "@/lib/format";
import type { DealDetail } from "@/lib/types";
import type { SalesSettings, SourcingView } from "@/lib/types-deals";
import { FactoryQuotes } from "@/components/deals/sourcing-board";
import { CoverageBadge } from "@/components/deals/revision-editor";
import { removeFileAction } from "../../actions";
import {
  addOfferLinesAction,
  copyOfferLinesAction,
  editOfferLineAction,
  moveOfferLineAction,
  removeFactoryQuoteAction,
  removeOfferLineAction,
  saveFactoryQuoteAction,
  searchFactoriesAction,
} from "./actions";

export const metadata = { title: "Factory prices" };

const TZ = process.env.APP_TIME_ZONE ?? process.env.NEXT_PUBLIC_APP_TIME_ZONE ?? "Asia/Shanghai";

/**
 * The factories' offers for the deal. Each offer is the factory's own lines
 * (its models, quantities and parts), each saying which of the customer's items
 * it answers. Compare whole offers (cost, what they cover, lead time) and item
 * by item; the quotation offers whole offers as options A, B…
 */
export default async function SourcingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePermission("sourcing.manage");
  const [d, s, settings] = await Promise.all([
    load(() => api.get<DealDetail>(`/inquiries/${id}`)),
    load(() => api.get<SourcingView>(`/inquiries/${id}/sourcing`)),
    api.get<{ sales: SalesSettings }>("/settings"),
  ]);
  const canEdit = d.allowed.source;
  // Only an offer that covers everything and has a price on every line can be "cheapest".
  // Offers on different price bases (EXW vs CFR) cannot be compared on cost alone.
  const bases = [...new Set(s.quotes.filter((q) => q.lines.length).map((q) => q.basis ?? "?"))];
  const mixedBases = bases.length > 1;
  const cheapest = mixedBases ? NaN : Math.min(...s.quotes.filter((q) => q.totalCost !== null && !q.coverage.missing.length && !q.unpriced && q.lines.length).map((q) => Number(q.totalCost)));

  return (
    <div className="flex flex-col gap-5">
      {!canEdit && (
        <Alert tone="info">
          {d.stage === "won" || d.stage === "lost"
            ? "This inquiry is closed, so its factory prices can no longer change."
            : "Only the person handling this inquiry (or a manager) can change its factory prices."}
        </Alert>
      )}
      {s.missingRates.length > 0 && (
        <Alert tone="warning">
          There is no exchange rate for {s.missingRates.join(", ")} in Settings, so those prices cannot be turned into {s.currency} and are
          left out of the comparison. Ask an admin to add the rate (1 {s.currency} = ? {s.missingRates[0]}).
        </Alert>
      )}

      {s.quotes.some((q) => q.lines.length) && (
        <Card>
          <CardHeader
            title="Compare offers"
            description={`What each whole offer costs us in ${s.currency} (factory prices plus tax, on each factory's own price basis) and which of the customer's items it covers. Freight and the like to reach your basis are added in the quotation.`}
            actions={
              <Link href={`/inquiries/${d.id}/quotation`} className={buttonClass("primary", "sm")}>
                Go to the quotation
              </Link>
            }
          />
          <Table>
            <THead>
              <tr>
                <Th>Factory</Th>
                {s.items.length > 0 && <Th>Covers</Th>}
                <Th>Price basis</Th>
                <Th className="text-right">Lines</Th>
                <Th className="text-right">Cost to us</Th>
                <Th>Lead time</Th>
                <Th>Valid until</Th>
              </tr>
            </THead>
            <tbody>
              {s.quotes
                .filter((q) => q.lines.length)
                .sort((a, b) => a.coverage.missing.length - b.coverage.missing.length || (a.totalCost === null ? 1 : b.totalCost === null ? -1 : Number(a.totalCost) - Number(b.totalCost)))
                .map((q) => (
                  <Tr key={q.id}>
                    <Td>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{q.factory.name}</span>
                        {q.totalCost !== null && Number(q.totalCost) === cheapest && s.quotes.length > 1 && <Badge tone="ok">Cheapest complete</Badge>}
                      </span>
                      <span className="text-xs text-muted">received {date(q.receivedOn)}</span>
                      {q.unpriced > 0 && (
                        <span className="block text-xs font-medium text-warn">
                          {q.unpriced} line{q.unpriced === 1 ? "" : "s"} without a price
                        </span>
                      )}
                    </Td>
                    {s.items.length > 0 && (
                      <Td>
                        <CoverageBadge missing={q.coverage.missing} />
                      </Td>
                    )}
                    <Td className="text-sm whitespace-nowrap">{q.basis ? basisText(q.basis, q.basisPlace) : <span className="text-xs text-warn">Not said</span>}</Td>
                    <Td className="text-right tabular">{q.lines.length}</Td>
                    <Td className="text-right font-medium whitespace-nowrap tabular">{q.totalCost === null ? <span className="text-xs font-normal text-warn">No exchange rate</span> : money(q.totalCost, s.currency)}</Td>
                    <Td className="text-sm">{q.leadTime ?? <span className="text-muted">—</span>}</Td>
                    <Td className="text-sm whitespace-nowrap">{q.validUntil ? date(q.validUntil) : <span className="text-muted">—</span>}</Td>
                  </Tr>
                ))}
            </tbody>
          </Table>
          {mixedBases && (
            <p className="border-t border-line px-4 py-2.5 text-xs text-warn">
              These offers are on different price bases ({bases.map((b) => (b === "?" ? "not said" : b)).join(", ")}), so their costs are not like for like: the
              quotation adds freight and the like to each before comparing margins.
            </p>
          )}
        </Card>
      )}

      <FactoryQuotes
        dealId={d.id}
        quotes={s.quotes}
        items={s.items}
        canEdit={canEdit}
        today={todayIn(TZ)}
        mainCurrency={s.currency}
        rates={settings.sales.exchangeRates}
        saveAction={saveFactoryQuoteAction.bind(null, d.id)}
        removeAction={removeFactoryQuoteAction.bind(null, d.id)}
        searchFactories={searchFactoriesAction}
        lines={{
          add: addOfferLinesAction.bind(null, d.id),
          edit: editOfferLineAction.bind(null, d.id),
          move: moveOfferLineAction.bind(null, d.id),
          remove: removeOfferLineAction.bind(null, d.id),
          copy: copyOfferLinesAction.bind(null, d.id),
          removeFile: removeFileAction.bind(null, d.id),
        }}
      />

      {s.items.length > 0 && s.quotes.some((q) => q.lines.length) && (
        <details className="group rounded-xl border border-line bg-surface shadow-card">
          <summary className="cursor-pointer list-none border-line px-4 py-3 group-open:border-b">
            <span className="text-sm font-semibold">Compare by item</span>
            <span className="ml-2 text-xs text-muted">each of the customer&apos;s items and the factory lines that answer it, cheapest first (your cost per unit in {s.currency})</span>
          </summary>
          <div className="flex flex-col gap-5 p-4">
            {s.items.map((it) => (
              <section key={it.id} aria-label={`${it.parentId ? "Part" : "Item"} ${it.no}`}>
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="min-w-0 text-sm font-semibold">
                    <span className="mr-1.5 text-muted tabular">{it.no}</span>
                    <span className="whitespace-pre-line">{it.description}</span>
                    {it.model && <span className="ml-2 text-xs font-normal text-muted">{it.model}</span>}
                  </h3>
                  <span className="text-sm text-muted tabular">
                    {qty(it.quantity)} {it.unit}
                  </span>
                </div>
                {it.options.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-line px-3 py-3 text-sm text-muted">
                    {it.hasParts ? "No factory line answers it as a whole yet — see its parts below." : "No factory has answered this item yet."}
                  </p>
                ) : (
                  <OptionsTable options={it.options} cheapestLineId={it.cheapestLineId} currency={s.currency} />
                )}
              </section>
            ))}
          </div>
        </details>
      )}

      {s.items.length === 0 && s.products.length > 0 && <ProductMatrix view={s} />}
    </div>
  );
}

/** The factory lines for one item or product, cheapest first. */
function OptionsTable({ options, cheapestLineId, currency }: { options: SourcingView["items"][number]["options"]; cheapestLineId: string | null; currency: string }) {
  return (
    <div className="rounded-lg border border-line">
      <Table>
        <THead>
          <tr>
            <Th>Factory line</Th>
            <Th className="text-right">Their price</Th>
            <Th className="text-right">Your cost / unit</Th>
            <Th className="hidden text-right sm:table-cell">For their quantity</Th>
          </tr>
        </THead>
        <tbody>
          {options.map((o) => (
            <Tr key={o.id}>
              <Td>
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{o.factory.name}</span>
                  {o.id === cheapestLineId && options.length > 1 && <Badge tone="ok">Cheapest</Badge>}
                </span>
                <span className="block text-xs text-muted">
                  {o.no} {o.description.split("\n")[0]}
                  {o.model ? ` · ${o.model}` : ""}
                </span>
                <span className="mt-0.5 block text-xs text-text-2">{o.costNote}</span>
              </Td>
              <Td className="text-right whitespace-nowrap tabular">
                {money(o.unitPrice, o.currency)}
                <span className="block text-xs text-muted">without tax</span>
              </Td>
              <Td className="text-right font-medium whitespace-nowrap tabular">
                {Number(o.unitPrice) === 0 ? (
                  <span className="text-xs font-normal text-muted">Not priced on its own</span>
                ) : o.unitCost === null ? (
                  <span className="text-xs font-normal text-warn">No exchange rate</span>
                ) : (
                  money(o.unitCost, currency)
                )}
              </Td>
              <Td className="hidden text-right whitespace-nowrap text-text-2 tabular sm:table-cell">
                {o.unitCost === null ? "—" : `${formatMinor(multiplyMinor(toMinor(o.unitCost), o.quantity), currency)} (${qty(o.quantity)} ${o.unit})`}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

/**
 * Lines copied from one offer to another, side by side: one row per product,
 * one column per factory (its model and our cost per unit), cheapest marked.
 */
function ProductMatrix({ view }: { view: SourcingView }) {
  const offers = view.quotes.filter((q) => view.products.some((p) => p.options.some((o) => o.quoteId === q.id)));
  return (
    <details className="group rounded-xl border border-line bg-surface shadow-card" open={view.products.length <= 40}>
      <summary className="cursor-pointer list-none border-line px-4 py-3 group-open:border-b">
        <span className="text-sm font-semibold">Compare product by product</span>
        <span className="ml-2 text-xs text-muted">
          {view.products.length} products in more than one offer · your cost per unit in {view.currency}, with tax
        </span>
      </summary>
      <div className="overflow-x-auto">
        <Table>
          <THead>
            <tr>
              <Th>Product</Th>
              <Th className="text-right">Qty</Th>
              {offers.map((q) => (
                <Th key={q.id} className="text-right">
                  {q.factory.name}
                </Th>
              ))}
            </tr>
          </THead>
          <tbody>
            {view.products.map((p) => (
              <Tr key={p.key}>
                <Td className="max-w-80">
                  <span className="line-clamp-2 text-sm">{p.description}</span>
                </Td>
                <Td className="text-right whitespace-nowrap tabular">
                  {qty(p.quantity)} {p.unit}
                </Td>
                {offers.map((q) => {
                  const o = p.options.find((x) => x.quoteId === q.id);
                  return (
                    <Td key={q.id} className={cn("text-right whitespace-nowrap tabular", o && o.id === p.cheapestLineId && "bg-ok-soft")}>
                      {!o ? (
                        <span className="text-xs text-muted">not offered</span>
                      ) : (
                        <>
                          {Number(o.unitPrice) === 0 ? <span className="text-xs text-muted">no price</span> : o.unitCost === null ? "—" : money(o.unitCost, view.currency)}
                          <span className="block text-xs text-muted">{o.model ?? ""}</span>
                        </>
                      )}
                    </Td>
                  );
                })}
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>
    </details>
  );
}
