import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { basisText } from "@kebo/shared";
import { Alert, Badge, ButtonLink, Card, cn, Segmented, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { todayIn } from "@kebo/utils";
import { api } from "@/lib/api";
import { load, requirePermission } from "@/lib/session";
import { date, money, qty } from "@/lib/format";
import type { DealDetail } from "@/lib/types";
import type { FactoryQuoteView, SalesSettings, SourcingView } from "@/lib/types-deals";
import { FactoryQuotes } from "@/components/deals/sourcing-board";
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
 * The factories' offers for the deal, in two views: "Offers" (one offer at a
 * time: its details, what is still missing, its lines and files) and "Compare
 * side by side" (each of the customer's items across the offers, cheapest
 * marked, then each whole offer's cost, coverage and terms). The quotation
 * offers whole offers as options A, B…
 */
export default async function SourcingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string; offer?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  await requirePermission("sourcing.manage");
  const [d, s, settings] = await Promise.all([
    load(() => api.get<DealDetail>(`/inquiries/${id}`)),
    load(() => api.get<SourcingView>(`/inquiries/${id}/sourcing`)),
    api.get<{ sales: SalesSettings }>("/settings"),
  ]);
  const canEdit = d.allowed.source;
  const compare = sp.view === "compare";
  const withLines = s.quotes.filter((q) => q.lines.length);
  const base = `/inquiries/${d.id}/sourcing`;

  return (
    <div className="flex flex-col gap-4">
      {!canEdit && (
        <Alert tone="info">
          {d.stage === "won" || d.stage === "lost"
            ? "This inquiry is closed, so its factory prices can no longer change."
            : "Only the person handling this inquiry (or a manager) can change its factory prices."}
        </Alert>
      )}

      {s.quotes.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented
            label="View"
            options={[
              { href: base, label: `Offers (${s.quotes.length})`, active: !compare },
              { href: `${base}?view=compare`, label: "Compare side by side", active: compare },
            ]}
          />
          {withLines.length > 0 && (
            <ButtonLink href={`/inquiries/${d.id}/quotation`} variant="primary" size="sm">
              Go to the quotation <ArrowRight aria-hidden />
            </ButtonLink>
          )}
        </div>
      )}

      {compare ? (
        <CompareView view={s} dealId={d.id} />
      ) : (
        <FactoryQuotes
          dealId={d.id}
          quotes={s.quotes}
          items={s.items}
          canEdit={canEdit}
          today={todayIn(TZ)}
          mainCurrency={s.currency}
          rates={settings.sales.exchangeRates}
          initialOffer={sp.offer ?? null}
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
      )}
    </div>
  );
}

/** "Compare side by side": the customer's items down the side, one column per offer. */
function CompareView({ view, dealId }: { view: SourcingView; dealId: string }) {
  const offers = view.quotes.filter((q) => q.lines.length);
  const base = `/inquiries/${dealId}/sourcing`;
  if (offers.length < 2)
    return (
      <Card className="flex flex-col items-center gap-3 px-6 py-10 text-center">
        <h2 className="text-base font-semibold">{offers.length === 0 ? "No offer has lines yet" : "Only one offer so far"}</h2>
        <p className="max-w-md text-sm text-text-2">
          Comparing needs at least two offers with their lines. Ask another factory and add its offer
          {offers.length === 1 ? `; you can still make a quotation from ${offers[0]!.factory.name} alone.` : "."}
        </p>
        <ButtonLink href={base} variant="secondary" size="sm">
          Back to the offers
        </ButtonLink>
      </Card>
    );

  // Offers on different price bases (EXW vs FOB) are not like for like on cost alone.
  const bases = [...new Set(offers.map((q) => q.basis ?? "?"))];
  const mixed = bases.length > 1;
  const cheapestTotal = mixed ? NaN : Math.min(...offers.filter((q) => q.totalCost !== null && !q.coverage.missing.length && !q.unpriced).map((q) => Number(q.totalCost)));
  const head = (q: FactoryQuoteView) => (
    <Th key={q.id} className="min-w-36 border-l border-line align-bottom sm:min-w-44">
      <Link href={`${base}?offer=${q.id}`} className="block text-sm font-semibold text-text hover:text-primary">
        {q.factory.name}
      </Link>
      <span className="block text-xs font-normal text-muted normal-case">
        {[q.basis ? basisText(q.basis, q.basisPlace) : "Basis not said", q.leadTime].filter(Boolean).join(" · ")}
      </span>
    </Th>
  );

  return (
    <div className="flex flex-col gap-3">
      {view.missingRates.length > 0 && (
        <Alert tone="warning">
          There is no exchange rate for {view.missingRates.join(", ")} in Settings, so those prices cannot be turned into {view.currency} and are left out
          here. Ask an admin to add the rate (1 {view.currency} = ? {view.missingRates[0]}).
        </Alert>
      )}
      {mixed && (
        <Alert tone="warning">
          Not like for like: these offers are on different price bases ({bases.map((b) => (b === "?" ? "not said" : b)).join(", ")}). The quotation adds
          freight and the like to each before comparing margins.
        </Alert>
      )}
      <Card className="overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">Compare side by side</h2>
          <p className="text-xs text-muted">Our cost per unit in {view.currency}, with tax. The cheapest in each row is marked.</p>
        </div>
        <div className="overflow-x-auto">
          <Table className="min-w-[640px]">
            <THead>
              <tr>
                <Th className="sticky left-0 z-10 min-w-36 bg-surface-2 sm:min-w-48">{view.items.length ? "Customer's item" : "Product"}</Th>
                <Th className="hidden text-right sm:table-cell">Qty</Th>
                {offers.map(head)}
              </tr>
            </THead>
            <tbody>
              {view.items.length > 0
                ? view.items.map((it) => (
                    <Tr key={it.id}>
                      <Td className={cn("sticky left-0 z-10 bg-surface", it.parentId && "pl-8")}>
                        <span className="mr-1.5 rounded bg-surface-2 px-1.5 py-0.5 text-xs font-medium text-text-2 tabular">{it.no}</span>
                        <span className={cn("text-sm", !it.parentId && "font-medium")}>{it.description.split("\n")[0]}</span>
                        <span className="block text-xs text-muted tabular sm:hidden">
                          {qty(it.quantity)} {it.unit}
                        </span>
                      </Td>
                      <Td className="hidden text-right whitespace-nowrap text-text-2 tabular sm:table-cell">
                        {qty(it.quantity)} {it.unit}
                      </Td>
                      {offers.map((q) => {
                        const mine = it.options.filter((o) => o.quoteId === q.id);
                        const o = mine.find((x) => x.id === it.cheapestLineId) ?? mine[0];
                        return (
                          <Cell
                            key={q.id}
                            empty={!o ? (it.hasParts ? "In its parts" : "Not offered") : null}
                            emptyWarn={!o && !it.hasParts}
                            noPrice={!!o && Number(o.unitPrice) === 0}
                            noRate={!!o && o.unitCost === null}
                            cheapest={!!o && o.id === it.cheapestLineId && it.options.length > 1}
                            value={o?.unitCost ? money(o.unitCost, view.currency) : null}
                            model={o?.model ?? null}
                          />
                        );
                      })}
                    </Tr>
                  ))
                : view.products.map((p) => (
                    <Tr key={p.key}>
                      <Td className="sticky left-0 z-10 max-w-80 bg-surface">
                        <span className="line-clamp-2 text-sm">{p.description}</span>
                        <span className="block text-xs text-muted tabular sm:hidden">
                          {qty(p.quantity)} {p.unit}
                        </span>
                      </Td>
                      <Td className="hidden text-right whitespace-nowrap text-text-2 tabular sm:table-cell">
                        {qty(p.quantity)} {p.unit}
                      </Td>
                      {offers.map((q) => {
                        const o = p.options.find((x) => x.quoteId === q.id);
                        return (
                          <Cell
                            key={q.id}
                            empty={!o ? "Not offered" : null}
                            emptyWarn={false}
                            noPrice={!!o && Number(o.unitPrice) === 0}
                            noRate={!!o && o.unitCost === null}
                            cheapest={!!o && o.id === p.cheapestLineId}
                            value={o?.unitCost ? money(o.unitCost, view.currency) : null}
                            model={o?.model ?? null}
                          />
                        );
                      })}
                    </Tr>
                  ))}
              <SummaryRow label="Our cost, whole offer" strong>
                {offers.map((q) => (
                  <Td key={q.id} className="border-l border-line text-right font-semibold whitespace-nowrap tabular">
                    {q.totalCost === null ? <span className="text-xs font-medium text-warn">No exchange rate</span> : money(q.totalCost, view.currency)}
                    {q.totalCost !== null && Number(q.totalCost) === cheapestTotal && (
                      <Badge tone="ok" className="ml-1.5">
                        Cheapest complete
                      </Badge>
                    )}
                  </Td>
                ))}
              </SummaryRow>
              {view.items.length > 0 && (
                <SummaryRow label="Covers the customer's list">
                  {offers.map((q) => (
                    <Td key={q.id} className={cn("border-l border-line text-right text-sm font-medium", q.coverage.missing.length ? "text-warn" : "text-ok")}>
                      {q.coverage.missing.length ? `Missing ${q.coverage.missing.join(", ")}` : "All items"}
                    </Td>
                  ))}
                </SummaryRow>
              )}
              <SummaryRow label="Lines without a price">
                {offers.map((q) => (
                  <Td key={q.id} className={cn("border-l border-line text-right text-sm", q.unpriced ? "font-medium text-warn" : "text-muted")}>
                    {q.unpriced || "None"}
                  </Td>
                ))}
              </SummaryRow>
              <SummaryRow label="Valid until">
                {offers.map((q) => (
                  <Td key={q.id} className="border-l border-line text-right text-sm whitespace-nowrap">
                    {q.validUntil ? date(q.validUntil) : <span className="text-muted">—</span>}
                  </Td>
                ))}
              </SummaryRow>
              <SummaryRow label="Factory's quotation file">
                {offers.map((q) => (
                  <Td key={q.id} className={cn("border-l border-line text-right text-sm font-medium", q.files.length ? "text-ok" : "text-warn")}>
                    {q.files.length ? "Attached" : "Missing"}
                  </Td>
                ))}
              </SummaryRow>
            </tbody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

function SummaryRow({ label, strong, children }: { label: string; strong?: boolean; children: React.ReactNode }) {
  return (
    <Tr className="bg-surface-2/50">
      <Td className={cn("sticky left-0 z-10 bg-surface-2 text-sm", strong ? "font-semibold" : "text-text-2")}>{label}</Td>
      <Td className="hidden sm:table-cell" />
      {children}
    </Tr>
  );
}

function Cell({
  empty,
  emptyWarn,
  noPrice,
  noRate,
  cheapest,
  value,
  model,
}: {
  empty: string | null;
  emptyWarn: boolean;
  noPrice: boolean;
  noRate: boolean;
  cheapest: boolean;
  value: string | null;
  model: string | null;
}) {
  if (empty)
    return (
      <Td className={cn("border-l border-line text-right text-xs font-medium", emptyWarn ? "bg-warn-soft/40 text-warn" : "text-muted")}>{empty}</Td>
    );
  return (
    <Td className={cn("border-l border-line text-right whitespace-nowrap tabular", cheapest && "bg-ok-soft")}>
      {noPrice ? (
        <span className="text-xs font-medium text-warn">No price yet</span>
      ) : noRate ? (
        <span className="text-xs font-medium text-warn">No exchange rate</span>
      ) : (
        <span className={cn("font-medium", cheapest && "text-ok")}>
          {value}
          {cheapest && <span className="ml-1 text-xs">· cheapest</span>}
        </span>
      )}
      {model && <span className="block text-xs text-muted">{model}</span>}
    </Td>
  );
}
