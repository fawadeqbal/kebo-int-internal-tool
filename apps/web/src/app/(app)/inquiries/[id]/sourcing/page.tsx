import Link from "next/link";
import { ArrowLeft, Factory, FileText, Package, Pencil } from "lucide-react";
import { basisText, offerTaxTag, REQUEST_CHANNEL_LABEL } from "@kebo/shared";
import { api } from "@/lib/api";
import type { FactoryRequests } from "@/lib/types-flow";
import { Alert, Badge, buttonClass, ButtonLink, Card, CardHeader, cn, EmptyState, StatusBadge, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { todayIn } from "@kebo/utils";
import { requirePermission } from "@/lib/session";
import { date, money, qty, TZ } from "@/lib/format";
import { dealOf, quotationOf, sourcingOf } from "@/lib/deal-data";
import type { FactoryQuoteView, SourcingView } from "@/lib/types-deals";
import { optional } from "@/components/print/data";
import { cheapestComplete, shortName } from "@/components/deals/offer-facts";
import { AddOfferButton, OfferDetails, OfferLines } from "@/components/deals/offer-work";
import { removeFileAction } from "../../actions";
import { askFactories } from "../ask";
import { RequestMore } from "@/components/deals/ask-window";
import { factoryRequestStatusAction, removeFactoryRequestAction } from "../../factory-request-actions";
import { addOfferLinesAction, copyOfferLinesAction, editOfferLineAction, moveOfferLineAction, offerFieldsAction, removeFactoryQuoteAction, removeOfferLineAction, saveFactoryQuoteAction, searchFactoriesAction } from "./actions";
import { getSettings } from "@/lib/loaders";
import { editsOf } from "@/lib/edit-data";

export const metadata = { title: "Factory prices" };


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
  const [d, s, settings, q] = await Promise.all([
    dealOf(id),
    sourcingOf(id),
    getSettings(),
    optional(() => quotationOf(id)),
  ]);
  const canEdit = d.allowed.source;
  const base = `/inquiries/${d.id}/sourcing`;
  const today = todayIn(TZ);
  const ask = await askFactories(d, me, "secondary", { label: "Ask more factories", size: "sm" });
  const compare = sp.view === "compare";
  const cheapest = cheapestComplete(s.quotes);
  // Which quotation option each offer is, on the newest revision (a draft when one is open).
  const revs = [...(q?.revisions ?? [])].sort((a, b) => b.number - a.number);
  const current = revs[0] ?? null;
  const letterOf = new Map((current?.options ?? []).filter((o) => o.factoryQuoteId).map((o) => [o.factoryQuoteId!, o.letter]));
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
        refNo={d.refNo}
        items={s.items}
        today={today}
        mainCurrency={s.currency}
        rates={settings.sales.exchangeRates}
        searchFactories={searchFactoriesAction}
        createAction={saveFactoryQuoteAction.bind(null, d.id, null)}
        addLines={lines.add}
        taxDefault={{ included: settings.sales.factoryTaxIncluded ?? false, rate: settings.sales.factoryTaxRate ?? 0 }}
        variant={props.variant}
        size={props.size}
        label={props.label}
        defaultOpen={props.open}
      />
    ) : null;
  const quotationHref = `/inquiries/${d.id}/quotation`;

  const requests = await optional(() => api.get<FactoryRequests>(`/inquiries/${d.id}/factory-requests`));
  const waiting = (requests?.items ?? []).filter((r) => !r.factoryQuoteId && r.status === "sent");
  const editing = s.quotes.find((x) => x.id === sp.offer) ?? null;
  const offerEdits = editing ? await editsOf("factory_quote", editing.id) : null;

  return (
    <div className="flex flex-col gap-4">
      {!canEdit && (
        <Alert tone="info">
          {d.stage === "won" || d.stage === "lost"
            ? "This inquiry is closed, so its factory prices can no longer change."
            : "Only the person handling this inquiry (or a manager) can change its factory prices."}
        </Alert>
      )}

      {/* Requests (board): who was asked, how, when the answer is due, and where each stands. */}
      {requests && !compare && (
        <Card className="overflow-clip">
          <CardHeader title="Requests" actions={<span className="flex flex-wrap gap-2">{ask?.button}{s.quotes.length > 0 && addOffer({ variant: "primary", label: "Enter an offer", open: sp.add === "1" })}</span>} />
          {requests.items.length === 0 ? (
            <EmptyState title="Nobody asked yet" description="Send the customer's list to two or three factories; each one shows here with when its answer is due." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-[13px]">
                <THead>
                  <tr>
                    <Th>Factory</Th>
                    <Th>Asked by</Th>
                    <Th>Sent</Th>
                    <Th>Reply by</Th>
                    <Th>Status</Th>
                    <Th className="text-right">
                      <span className="sr-only">Actions</span>
                    </Th>
                  </tr>
                </THead>
                <tbody>
                  {requests.items.map((r) => (
                    <Tr key={r.id}>
                      <Td>
                        <Link href={`/factories/${r.factory.id}`} className="font-semibold hover:text-primary">
                          {r.factory.name}
                        </Link>
                        {r.note && <span className="block text-xs text-text-2">{r.note}</span>}
                      </Td>
                      <Td>{r.channel ? REQUEST_CHANNEL_LABEL[r.channel] : "—"}</Td>
                      <Td className="whitespace-nowrap">{date(r.sentOn)}</Td>
                      <Td className="whitespace-nowrap">{r.replyBy ? date(r.replyBy) : "—"}</Td>
                      <Td>
                        <StatusBadge meaning={r.status === "quoted" ? "ok" : r.status === "declined" ? "bad" : r.status === "no_reply" ? "neutral" : r.late ? "warn" : "info"}>
                          {r.status === "sent" ? (r.late ? "Sent · reply due" : "Sent") : r.statusLabel}
                        </StatusBadge>
                      </Td>
                      <Td className="text-right whitespace-nowrap">
                        {r.factoryQuoteId ? (
                          <ButtonLink href={`${base}?offer=${r.factoryQuoteId}#offer`} size="sm">
                            Open offer
                          </ButtonLink>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            {r.status === "sent" && addOffer({ variant: "primary", size: "sm", label: "Enter offer" })}
                            {canEdit && (
                              <RequestMore
                                name={r.factory.name}
                                status={r.status}
                                setStatus={factoryRequestStatusAction.bind(null, d.id, r.id)}
                                remove={removeFactoryRequestAction.bind(null, d.id, r.id)}
                              />
                            )}
                          </span>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {s.quotes.length === 0 && waiting.length === 0 ? (
        <NoOffers items={s.items} add={addOffer({ variant: "primary", label: "Add the first offer", open: sp.add === "1" })} />
      ) : compare ? (
        <>
          <Link href={base} className={buttonClass("ghost", "sm", "self-start px-1")}>
            <ArrowLeft aria-hidden /> Back to the offers
          </Link>
          {requests && requests.counts.asked > 0 && (
            <Alert tone={requests.counts.waiting ? "info" : "success"}>
              <strong>
                {requests.counts.quoted} of {requests.counts.asked} replied.
              </strong>{" "}
              {requests.counts.waiting ? `${requests.counts.waiting} still to answer.` : "Every factory asked has answered."}
            </Alert>
          )}
          <CompareView view={s} dealId={d.id} />
        </>
      ) : (
        <>
          {/* One card per offer (board), and one per factory still to answer. */}
          <div className="grid items-start gap-4 lg:grid-cols-2">
            {s.quotes.map((x) => (
              <OfferCard key={x.id} q={x} base={base} letter={letterOf.get(x.id)} cheapest={cheapest?.id === x.id} canEdit={canEdit} />
            ))}
            {waiting.map((r) => (
              <Card key={r.id}>
                <CardHeader title={r.factory.name} />
                <EmptyState
                  icon={Package}
                  title={`Waiting for ${shortName(r.factory.name)}`}
                  description={`${r.replyBy ? `Reply due ${date(r.replyBy)}. ` : ""}Enter the offer when it comes, or mark “No reply” under Ask factories.`}
                  action={addOffer({ variant: "secondary", label: "Enter offer" })}
                />
              </Card>
            ))}
          </div>
          {s.quotes.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
              <span>Our cost = their price to our basis, plus tax unless it is included, in {s.currency}.</span>
              <span className="flex flex-wrap gap-2">
                {s.quotes.length > 1 && (
                  <ButtonLink href={`${base}?view=compare`} size="sm">
                    Compare side by side
                  </ButtonLink>
                )}
                {withLines && (
                  <Link href={current ? quotationHref : `${quotationHref}?start=1`} className={buttonClass("primary", "sm")}>
                    {current ? "Open the quotation" : "Make the quotation"}
                  </Link>
                )}
              </span>
            </div>
          )}
          {editing && (
            <div id="offer" className="flex scroll-mt-24 flex-col gap-4">
              <OfferDetails
                key={`d-${editing.id}`}
                dealId={d.id}
                q={editing}
                canEdit={canEdit}
                today={today}
                mainCurrency={s.currency}
                rates={settings.sales.exchangeRates}
                searchFactories={searchFactoriesAction}
                saveAction={saveFactoryQuoteAction.bind(null, d.id, editing.id)}
                fieldsAction={offerFieldsAction.bind(null, d.id, editing.id)}
                removeAction={removeFactoryQuoteAction.bind(null, d.id, editing.id)}
                removeFile={lines.removeFile}
              />
              <OfferLines
                key={`l-${editing.id}`}
                q={editing}
                others={s.quotes.filter((x) => x.id !== editing.id && x.lines.length)}
                items={s.items}
                canEdit={canEdit}
                mainCurrency={s.currency}
                lines={lines}
                edits={offerEdits?.cards.lines}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** One factory's offer as the board draws it: its total and tax, basis, lead time, MOQ, payment, validity, their ref., the lines, the files, Edit. */
function OfferCard({ q, base, letter, cheapest, canEdit }: { q: FactoryQuoteView; base: string; letter?: string; cheapest: boolean; canEdit: boolean }) {
  const tax = offerTaxTag(q.taxRate, q.taxIncluded);
  const facts: [string, string | null][] = [
    ["Basis", q.basis ? basisText(q.basis, q.basisPlace) : null],
    ["Lead time", q.leadTime],
    ["MOQ", q.moq],
    ["Payment", q.paymentTerms ?? (q.advancePercent !== null ? `${q.advancePercent}% advance` : null)],
    ["Valid until", q.validUntil ? date(q.validUntil) : null],
    ["Their ref.", q.reference],
  ];
  return (
    <Card>
      <CardHeader
        title={q.factory.name}
        actions={
          <span className="flex gap-1.5">
            {letter && <Badge tone="info">Option {letter}</Badge>}
            {cheapest && <Badge tone="ok">Cheapest complete</Badge>}
          </span>
        }
      />
      <div className="flex flex-col gap-3.5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <strong className="text-2xl font-bold tabular">{money(q.factoryTotal, q.currency)}</strong>
          {tax && <Badge tone="ok">{q.taxIncluded ? `Tax included ${q.taxRate}%` : `+${q.taxRate}% tax`}</Badge>}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          {facts.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted">{k}</dt>
              <dd className="text-sm">{v ?? "—"}</dd>
            </div>
          ))}
        </dl>
        {q.lines.length > 0 && (
          <ul className="flex flex-col gap-1.5 border-t border-surface-2 pt-3 text-[13px]">
            {q.lines.map((l) => (
              <li key={l.id} className="flex justify-between gap-3">
                <span className="min-w-0">
                  {l.answersNo ? `${l.no}` : "Extra"} · {l.description.split("\n")[0]} × {qty(l.quantity)} {l.unit}
                </span>
                <span className="tabular">{(Number(l.quantity) * Number(l.unitPrice)).toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>
              </li>
            ))}
          </ul>
        )}
        {q.files.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {q.files.map((f) => (
              <a key={f.id} href={`/files/${f.id}?view=1`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                <FileText className="size-3.5" aria-hidden /> {f.fileName}
              </a>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={`${base}?offer=${q.id}#offer`} size="sm">
            <Pencil aria-hidden /> {canEdit ? "Edit" : "Open"}
          </ButtonLink>
          {q.unpriced > 0 && <Badge tone="warn">{q.unpriced} line{q.unpriced === 1 ? "" : "s"} without a price</Badge>}
        </div>
      </div>
    </Card>
  );
}

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
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3.5 sm:px-5">
          <h2 className="text-base font-bold">
            Side by side<span className="text-xs font-normal text-muted"> · our cost per unit in {view.currency}, after tax; the cheapest in each row is marked</span>
          </h2>
          <ButtonLink href={`/inquiries/${dealId}/quotation`} variant="primary" size="sm">
            <FileText aria-hidden /> Make quotation
          </ButtonLink>
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
      {/* Terms (board): each offer's basis, lead time, payment, validity and their reference. */}
      <Card className="overflow-hidden">
        <CardHeader title="Terms" />
        <Table className="min-w-[560px]">
          <THead>
            <tr>
              <Th className="w-40" />
              {offers.map((q) => (
                <Th key={q.id}>{q.factory.name}</Th>
              ))}
            </tr>
          </THead>
          <tbody>
            {(
              [
                ["Basis", (q: FactoryQuoteView) => (q.basis ? basisText(q.basis, q.basisPlace) : "—")],
                ["Lead time", (q: FactoryQuoteView) => q.leadTime ?? "—"],
                ["Payment", (q: FactoryQuoteView) => q.paymentTerms ?? (q.advancePercent !== null ? `${q.advancePercent}% advance` : "—")],
                ["Valid until", (q: FactoryQuoteView) => (q.validUntil ? date(q.validUntil) : "—")],
                ["Their ref.", (q: FactoryQuoteView) => q.reference ?? "—"],
              ] as const
            ).map(([label, value]) => (
              <Tr key={label}>
                <Td className="text-text-2">{label}</Td>
                {offers.map((q) => (
                  <Td key={q.id}>{value(q)}</Td>
                ))}
              </Tr>
            ))}
          </tbody>
        </Table>
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
