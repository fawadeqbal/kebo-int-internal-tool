import Link from "next/link";
import { ArrowLeft, Factory } from "lucide-react";
import { basisText } from "@kebo/shared";
import { Alert, Badge, buttonClass, ButtonLink, Card, cn, EmptyState, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { todayIn } from "@kebo/utils";
import { api } from "@/lib/api";
import { requirePermission } from "@/lib/session";
import { date, money, qty } from "@/lib/format";
import { dealHistoryOf, dealOf, quotationOf, sourcingOf } from "@/lib/deal-data";
import type { FactoryQuoteView, SalesSettings, SourcingView } from "@/lib/types-deals";
import { optional } from "@/components/print/data";
import { StepChanges, StepFrame, StepHeader, StepPrevNext } from "@/components/orders/step-page";
import { ViewCard } from "@/components/orders/step-view";
import { changesIn, FilesCard } from "@/components/deals/inquiry-side";
import { cheapestComplete, coverOf, detailsFilled, offerNeeds, shortName, theirTotalMinor } from "@/components/deals/offer-facts";
import { AddOfferButton, CoverBadge, OfferDetails, OfferLines } from "@/components/deals/offer-work";
import { removeFileAction } from "../../actions";
import { askFactories } from "../ask";
import { inquirySteps, plural } from "../steps";
import {
  addOfferLinesAction,
  copyOfferLinesAction,
  editOfferLineAction,
  moveOfferLineAction,
  offerFieldsAction,
  removeFactoryQuoteAction,
  removeOfferLineAction,
  saveFactoryQuoteAction,
  searchFactoriesAction,
} from "./actions";

export const metadata = { title: "Factory prices" };

const TZ = process.env.APP_TIME_ZONE ?? process.env.NEXT_PUBLIC_APP_TIME_ZONE ?? "Asia/Shanghai";

/** "USD 51,741": whole units for the step's header line. */
const whole = (v: string | number, currency: string) => `${currency} ${Math.round(Number(v)).toLocaleString("en-US")}`;

/**
 * Step 2, Factory prices (board InqV4Prices): the offers as one compare table
 * (click a row to open it below: its details and its lines, read only until
 * Edit), Add an offer in a short side panel, and "Compare side by side" for
 * each of the customer's items across the offers. The quotation offers whole
 * offers as options A, B…
 */
export default async function SourcingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string; offer?: string; add?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await requirePermission("sourcing.manage");
  const [d, s, settings, q, history] = await Promise.all([
    dealOf(id),
    sourcingOf(id),
    api.get<{ sales: SalesSettings }>("/settings"),
    optional(() => quotationOf(id)),
    optional(() => dealHistoryOf(id)),
  ]);
  const canEdit = d.allowed.source;
  const base = `/inquiries/${d.id}/sourcing`;
  const today = todayIn(TZ);
  const step = inquirySteps(d, s.quotes.length).find((x) => x.key === "sourcing")!;
  const ask = await askFactories(d, me, "ghost");
  const compare = sp.view === "compare";
  const selected = s.quotes.find((x) => x.id === sp.offer) ?? s.quotes[0] ?? null;
  const cheapest = cheapestComplete(s.quotes);
  // Which quotation option each offer is, on the newest revision (a draft when one is open).
  const revs = [...(q?.revisions ?? [])].sort((a, b) => b.number - a.number);
  const current = revs[0] ?? null;
  const letterOf = new Map((current?.options ?? []).filter((o) => o.factoryQuoteId).map((o) => [o.factoryQuoteId!, o.letter]));
  const needing = (selected && offerNeeds(selected, s.items).length ? selected : null) ?? s.quotes.find((x) => offerNeeds(x, s.items).length) ?? null;
  const line = s.quotes.length
    ? [
        `${plural(s.quotes.length, "offer")} in`,
        needing ? `${shortName(needing.factory.name)}'s offer needs ${offerNeeds(needing, s.items).join(", ")}` : "every offer is complete",
        cheapest?.totalCost ? `cheapest that covers everything: ${shortName(cheapest.factory.name)} ${whole(cheapest.totalCost, s.currency)}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "No offers yet: ask two or three factories, then add each one's prices.";
  const withLines = s.quotes.some((x) => x.lines.length);
  const lines = {
    add: addOfferLinesAction.bind(null, d.id),
    edit: editOfferLineAction.bind(null, d.id),
    move: moveOfferLineAction.bind(null, d.id),
    remove: removeOfferLineAction.bind(null, d.id),
    copy: copyOfferLinesAction.bind(null, d.id),
    removeFile: removeFileAction.bind(null, d.id),
  };
  const addOffer = (props: { variant?: "primary" | "secondary" | "ghost"; size?: "xs" | "sm" | "md"; label?: string; open?: boolean }) =>
    canEdit ? (
      <AddOfferButton
        dealId={d.id}
        items={s.items}
        today={today}
        mainCurrency={s.currency}
        rates={settings.sales.exchangeRates}
        searchFactories={searchFactoriesAction}
        createAction={saveFactoryQuoteAction.bind(null, d.id, null)}
        addLines={lines.add}
        variant={props.variant}
        size={props.size}
        label={props.label}
        defaultOpen={props.open}
      />
    ) : null;
  const quotationHref = `/inquiries/${d.id}/quotation`;
  const offerFiles = s.quotes.flatMap((x) => x.files.map((f) => ({ id: f.id, name: f.fileName, offer: x.factory.name })));

  return (
    <StepFrame
      header={
        <StepHeader
          step={{ number: step.number, label: step.label, state: step.state, stateLabel: step.stateLabel, line }}
          action={
            <>
              {ask?.button}
              {s.quotes.length > 0 && addOffer({ variant: "secondary", open: sp.add === "1" })}
              {withLines && (
                <Link href={current ? quotationHref : `${quotationHref}?start=1`} className={buttonClass("primary", "md")}>
                  {current ? "Open the quotation" : "Make the quotation"}
                </Link>
              )}
            </>
          }
        />
      }
      side={
        <>
          <FilesCard files={offerFiles.map((f) => ({ id: f.id, name: f.name }))} empty="No factory files yet." />
          {history && <StepChanges entries={changesIn(history, "sourcing", offerFiles.map((f) => f.name))} historyHref={`/inquiries/${d.id}/history`} />}
        </>
      }
      prevNext={<StepPrevNext prev={{ href: `/inquiries/${d.id}/needs`, label: "Needs" }} next={{ href: quotationHref, label: "Quotation" }} />}
    >
      {!canEdit && (
        <Alert tone="info">
          {d.stage === "won" || d.stage === "lost"
            ? "This inquiry is closed, so its factory prices can no longer change."
            : "Only the person handling this inquiry (or a manager) can change its factory prices."}
        </Alert>
      )}

      {s.quotes.length === 0 ? (
        <NoOffers items={s.items} add={addOffer({ variant: "primary", label: "Add the first offer", open: sp.add === "1" })} />
      ) : compare ? (
        <>
          <Link href={base} className={buttonClass("ghost", "sm", "self-start px-1")}>
            <ArrowLeft aria-hidden /> Back to the offers
          </Link>
          <CompareView view={s} dealId={d.id} />
        </>
      ) : (
        <>
          <ViewCard title={`Offers · ${s.quotes.length}`} canEdit={false} actions={addOffer({ variant: "secondary", size: "xs" })}>
            <OffersTable quotes={s.quotes} view={s} selected={selected?.id ?? null} base={base} letterOf={letterOf} />
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-3 text-xs text-muted">
              <span>Click a factory to see its offer below. Our cost = their price to our basis, with tax, in {s.currency}.</span>
              <Link href={`${base}?view=compare`} className={buttonClass("ghost", "xs")}>
                Compare side by side
              </Link>
            </div>
          </ViewCard>
          {selected && (
            <>
              <OfferDetails
                key={`d-${selected.id}`}
                dealId={d.id}
                q={selected}
                canEdit={canEdit}
                today={today}
                mainCurrency={s.currency}
                rates={settings.sales.exchangeRates}
                searchFactories={searchFactoriesAction}
                saveAction={saveFactoryQuoteAction.bind(null, d.id, selected.id)}
                fieldsAction={offerFieldsAction.bind(null, d.id, selected.id)}
                removeAction={removeFactoryQuoteAction.bind(null, d.id, selected.id)}
                removeFile={lines.removeFile}
              />
              <OfferLines
                key={`l-${selected.id}`}
                q={selected}
                others={s.quotes.filter((x) => x.id !== selected.id && x.lines.length)}
                items={s.items}
                canEdit={canEdit}
                mainCurrency={s.currency}
                lines={lines}
              />
            </>
          )}
        </>
      )}
    </StepFrame>
  );
}

/** One row per offer: who and on what basis, valid until, their total, our cost, what it covers, how complete it is, and its quotation option. */
function OffersTable({
  quotes,
  view,
  selected,
  base,
  letterOf,
}: {
  quotes: FactoryQuoteView[];
  view: SourcingView;
  selected: string | null;
  base: string;
  letterOf: Map<string, string>;
}) {
  return (
    <div className="overflow-x-auto px-4 pt-2 pb-3">
      <Table>
        <THead>
          <tr>
            <Th>Factory</Th>
            <Th className="hidden md:table-cell">Valid until</Th>
            <Th className="hidden text-right lg:table-cell">Their total</Th>
            <Th className="text-right">Our cost</Th>
            <Th className="hidden sm:table-cell">Covers</Th>
            <Th className="hidden xl:table-cell">Details</Th>
            <Th className="hidden md:table-cell">Quotation</Th>
          </tr>
        </THead>
        <tbody>
          {quotes.map((x) => {
            const on = x.id === selected;
            const filled = detailsFilled(x);
            const letter = letterOf.get(x.id);
            return (
              <Tr key={x.id} className={cn("relative", on ? "bg-primary-soft/60 shadow-[inset_3px_0_0_var(--color-primary)]" : "hover:bg-surface-2/60")}>
                <Td>
                  <Link href={`${base}?offer=${x.id}`} scroll={false} aria-current={on ? "true" : undefined} className="block font-medium after:absolute after:inset-0">
                    {x.factory.name}
                  </Link>
                  <span className="block text-xs text-muted">
                    {[x.basis ? basisText(x.basis, x.basisPlace) : "Basis not said", x.leadTime].filter(Boolean).join(" · ")}
                  </span>
                  <span className="mt-1 block sm:hidden">
                    <CoverBadge cover={coverOf(x, view.items)} />
                  </span>
                </Td>
                <Td className="hidden whitespace-nowrap text-text-2 md:table-cell">{x.validUntil ? date(x.validUntil) : <span className="text-muted">—</span>}</Td>
                <Td className="hidden text-right whitespace-nowrap tabular lg:table-cell">{x.lines.length ? whole(theirTotalMinor(x) / 100, x.currency) : <span className="text-muted">—</span>}</Td>
                <Td className="text-right font-semibold whitespace-nowrap tabular">
                  {x.totalCost === null ? <span className="text-xs font-medium text-warn">No rate</span> : x.lines.length ? whole(x.totalCost, view.currency) : <span className="text-muted">—</span>}
                </Td>
                <Td className="hidden sm:table-cell">
                  <CoverBadge cover={coverOf(x, view.items)} />
                </Td>
                <Td className="hidden text-xs whitespace-nowrap text-text-2 tabular xl:table-cell">
                  {filled.n} of {filled.of}
                </Td>
                <Td className="hidden md:table-cell">{letter ? <Badge tone="primary">Option {letter}</Badge> : <span className="text-muted">—</span>}</Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}

/** No offer yet: what to do, and what the factories quote on. */
function NoOffers({ items, add }: { items: SourcingView["items"]; add: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-5">
      <Card className="flex items-center justify-center">
        <EmptyState
          icon={Factory}
          title="No factory offers yet"
          description="Send the customer's list to two or three factories (Ask factories, above). When each one replies, add its offer here: the customer's items are listed with a price box each."
          action={add ?? undefined}
        />
      </Card>
      {items.length > 0 && (
        <Card className="flex flex-col gap-2 p-4">
          <h3 className="text-sm font-semibold">What the factories quote on</h3>
          <ul className="flex flex-col divide-y divide-line">
            {items.map((it) => (
              <li key={it.id} className={cn("flex items-baseline justify-between gap-3 py-2 text-sm", it.parentId && "pl-5")}>
                <span className="min-w-0">
                  <span className="mr-1.5 rounded bg-surface-2 px-1.5 py-0.5 text-xs font-medium text-text-2 tabular">{it.no}</span>
                  {it.description.split("\n")[0]}
                </span>
                <span className="shrink-0 text-text-2 tabular">
                  {qty(it.quantity)} {it.unit}
                </span>
              </li>
            ))}
          </ul>
        </Card>
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
