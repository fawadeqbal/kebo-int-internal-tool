import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { offerTaxText, REQUEST_CHANNEL_LABEL } from "@kebo/shared";
import { ButtonLink, cn, PageHeader, RevisionBadge } from "@kebo/ui";
import { MoreMenu } from "@/components/common/more-menu";
import { requirePermission } from "@/lib/session";
import { companyToday, date } from "@/lib/format";
import { dealOf, quotationOf, sourcingOf } from "@/lib/deal-data";
import { optional } from "@/components/print/data";
import { coverOf } from "@/components/deals/offer-facts";
import { OfferEdit, OfferLines, OfferTerms, type OfferKit } from "@/components/deals/offer-work";
import { OwnPagerTop, OwnPagerUnder } from "@/components/deals/own-pager";
import { getSettings } from "@/lib/loaders";
import { editsOf } from "@/lib/edit-data";
import { inquiryTitle } from "@/lib/titles";
import { removeFileAction } from "../../../actions";
import { requestsOf } from "../../facts";
import {
  addOfferLinesAction,
  copyOfferLinesAction,
  editOfferLineAction,
  moveOfferLineAction,
  removeFactoryQuoteAction,
  removeOfferLineAction,
  saveFactoryQuoteAction,
  searchFactoriesAction,
} from "../../sourcing/actions";

export const generateMetadata = inquiryTitle("Factory offer");

/**
 * One factory offer on its own page (design 17 Nov: each on its own page). Its top: the factory, its reference,
 * when it came and how long it holds, its tax; Quote this offer; ‹ 2 of 5 › through the inquiry's offers. Its
 * lines (Edit lines) and its details (Edit); beside them the quotations made from it and when it was asked.
 */
export default async function OfferOwnPage({ params }: { params: Promise<{ id: string; offerId: string }> }) {
  const { id, offerId } = await params;
  await requirePermission("sourcing.manage");
  const [d, s, settings, q, requests] = await Promise.all([dealOf(id), sourcingOf(id), getSettings(), optional(() => quotationOf(id)), requestsOf(id)]);
  const at = s.quotes.findIndex((x) => x.id === offerId);
  const x = s.quotes[at];
  if (!x) notFound();
  const canEdit = d.allowed.source;
  const today = companyToday();
  const base = `/inquiries/${d.id}`;
  const edits = await editsOf("factory_quote", x.id);
  const cover = coverOf(x, s.items);
  const asked = (requests?.items ?? []).find((r) => r.factoryQuoteId === x.id) ?? null;
  const lines = {
    add: addOfferLinesAction.bind(null, d.id),
    edit: editOfferLineAction.bind(null, d.id),
    move: moveOfferLineAction.bind(null, d.id),
    remove: removeOfferLineAction.bind(null, d.id),
    copy: copyOfferLinesAction.bind(null, d.id),
    removeFile: removeFileAction.bind(null, d.id),
  };
  // The quotations made from this offer (their newest revision quotes it).
  const quotedIn = (q?.quotations ?? []).flatMap((y) => {
    const c = y.revisions.find((r) => r.status === "draft") ?? y.revisions[0];
    return c && c.options.some((o) => o.factoryQuoteId === x.id) ? [{ id: y.id, refNo: y.refNo, number: c.number, status: c.status }] : [];
  });
  // Every Edit on the page opens the offer's steps window on its step (Lines · Delivery · Payment · Warranty & conditions).
  const kit: OfferKit = {
    dealId: d.id,
    today,
    mainCurrency: s.currency,
    rates: settings.sales.exchangeRates,
    searchFactories: searchFactoriesAction,
    saveAction: saveFactoryQuoteAction.bind(null, d.id, x.id),
    removeAction: removeFactoryQuoteAction.bind(null, d.id, x.id),
    removeFile: lines.removeFile,
    items: s.items,
    others: s.quotes.filter((o) => o.id !== x.id && o.lines.length),
    lineActions: lines,
    linesCard: edits?.cards.lines,
  };
  const prev = at > 0 ? s.quotes[at - 1]! : null;
  const next = at < s.quotes.length - 1 ? s.quotes[at + 1]! : null;
  // What it covers; its reference, dates, currency and tax are in Details beside (each said once).
  const summary = [
    !x.lines.length ? "no lines yet" : cover ? (cover.all ? (cover.of === 1 ? "covers the 1 item" : `covers all ${cover.of} items`) : `covers ${cover.n} of ${cover.of} items`) : null,
  ].filter(Boolean);

  return (
    <div className="relative">
      <OwnPagerTop
        label={`Factory offers of ${d.refNo}`}
        what="offer"
        at={at}
        of={s.quotes.length}
        prev={prev ? { href: `${base}/offers/${prev.id}`, name: prev.factory.name } : null}
        next={next ? { href: `${base}/offers/${next.id}`, name: next.factory.name } : null}
      />
      <PageHeader
        phoneStack
        crumbs={[{ label: "Sales" }, { label: "Inquiries", href: "/inquiries" }, { label: d.refNo, href: base }, { label: x.factory.name }]}
        back={{ href: `${base}/sourcing`, label: `${d.refNo} · Factory offers` }}
        title={x.factory.name}
        summary={summary.length ? <p className="min-w-0">{summary.join(" · ")}</p> : undefined}
        actions={canEdit ? <OfferEdit kit={kit} q={x} step="lines" words="Edit" size="sm" /> : undefined}
        primary={
          d.allowed.quote && x.lines.length > 0 ? (
            <ButtonLink href={`${base}/quotation?start=1&offer=${x.id}`} variant="primary" size="sm">
              <Plus aria-hidden /> Quote this offer
            </ButtonLink>
          ) : undefined
        }
        more={
          <MoreMenu
            label={`More for ${x.factory.name}’s offer`}
            items={[
              { label: `Open the factory ${x.factory.name}`, href: `/factories/${x.factory.id}` },
              { label: "Compare the offers side by side", href: `${base}/sourcing?view=compare` },
              { label: "Copy link to this offer", copy: `${base}/offers/${x.id}` },
            ]}
          />
        }
      >
        <OwnPagerUnder
          label={`Factory offers of ${d.refNo}`}
          what="offer"
          at={at}
          of={s.quotes.length}
          prev={prev ? { href: `${base}/offers/${prev.id}`, name: prev.factory.name } : null}
          next={next ? { href: `${base}/offers/${next.id}`, name: next.factory.name } : null}
        />
      </PageHeader>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-4">
          <OfferLines kit={kit} q={x} items={s.items} canEdit={canEdit} mainCurrency={s.currency} edits={edits?.cards.lines} />
          <section aria-labelledby="o-terms" className="flex flex-col gap-2">
            <h2 id="o-terms" className="text-[15px] font-semibold">
              Terms
            </h2>
            <OfferTerms q={x} kit={canEdit ? kit : undefined} />
          </section>
        </div>
        <aside aria-label="About this offer" className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface">
          <Side title="Quoted in" id="o-quoted">
            {quotedIn.length ? (
              quotedIn.map((y) => (
                <Link key={y.id} href={`${base}/quotations/${y.id}`} className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-[13px] hover:bg-surface-2">
                  <span className="font-semibold">
                    {y.refNo} <span className="font-normal text-text-2">R{y.number}</span>
                  </span>
                  <RevisionBadge status={y.status} />
                </Link>
              ))
            ) : (
              <p className="text-[13px] text-text-2">Not quoted yet.</p>
            )}
          </Side>
          <Side title="Their files" id="o-files">
            {x.files.length ? (
              <ul className="flex flex-col gap-1">
                {x.files.map((f) => (
                  <li key={f.id}>
                    <a href={`/files/${f.id}?view=1`} target="_blank" rel="noreferrer" className="text-[13px] font-semibold text-primary underline underline-offset-2">
                      {f.fileName}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-text-2">None yet.</p>
            )}
          </Side>
          <Side title="Details" id="o-who" last>
            <dl className="flex flex-col gap-1.5">
              {asked && <Row label="Asked">{`${date(asked.sentOn)}${asked.channel ? ` by ${REQUEST_CHANNEL_LABEL[asked.channel].toLowerCase()}` : ""}`}</Row>}
              {x.reference && <Row label="Their ref.">{x.reference}</Row>}
              <Row label="Received">{date(x.receivedOn)}</Row>
              {x.validUntil && <Row label="Valid until">{date(x.validUntil)}</Row>}
              <Row label="Currency">{x.currency}</Row>
              <Row label="Tax">{offerTaxText(x.taxRate, x.taxIncluded)}</Row>
            </dl>
          </Side>
        </aside>
      </div>
    </div>
  );
}

function Side({ title, id, last, children }: { title: string; id: string; last?: boolean; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className={cn("flex flex-col gap-1 px-4 py-3", !last && "border-b border-line")}>
      <h2 id={id} className="mb-1 text-[15px] font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-[13px]">
      <dt className="text-text-2">{label}</dt>
      <dd className="min-w-0 text-right font-medium break-words text-text">{children}</dd>
    </div>
  );
}
