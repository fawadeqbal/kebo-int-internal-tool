import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, ChevronRight } from "lucide-react";
import { can } from "@kebo/shared";
import { Alert, ButtonLink, Card, CardBody, CardHeader, cn, RevisionBadge, StatusBadge } from "@kebo/ui";
import { requireUser } from "@/lib/session";
import { date, money } from "@/lib/format";
import { dealOf, quotationOf } from "@/lib/deal-data";
import type { QuotationOfDeal, RevisionView } from "@/lib/types-deals";
import { NewQuotationsButton } from "@/components/deals/quotation-tab";
import { checksOf, CheckChip, optionOf, termsFacts } from "@/components/deals/quote-view";
import { shortName } from "@/components/deals/offer-facts";
import { newQuotationsAction, offersAction } from "./actions";
import { inquiryTitle } from "@/lib/titles";
import { WithSide } from "../side";

export const generateMetadata = inquiryTitle("Quotation");

/** A quotation's total; a draft still without prices says so. */
const totalText = (r: RevisionView) => (r.status === "draft" && !(Number(r.total) > 0) ? "To price" : money(r.total, r.currency));

/** The revision a quotation shows first: its open draft, else its newest one. */
const currentOf = (q: QuotationOfDeal) => q.revisions.find((r) => r.status === "draft") ?? q.revisions[0]!;

/**
 * Quotations (design "one way, any number", 17 Nov: each on its own page): the deal's quotations, A, B, C…, one
 * row each (its number and offer, total, delivery, payment, warranty, status). A tap opens the quotation's own
 * page. "New quotations" makes one draft per offer.
 */
export default async function QuotationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; rev?: string; start?: string; offer?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const base = `/inquiries/${id}`;
  // Links from before each quotation had its own page (…/quotation?q=<id>&rev=<id>) open that page.
  if (sp.q && sp.q !== "none") redirect(`${base}/quotations/${sp.q}${sp.rev ? `?rev=${sp.rev}` : ""}`);
  const me = await requireUser();
  const [d, q] = await Promise.all([dealOf(id), quotationOf(id)]);
  const quoter = can(me, "quotations.manage");
  const manage = quoter && d.allowed.quote;
  const showCosts = can(me, "sourcing.manage");
  const quotations = q.quotations;

  // New quotations' offers, costed in its own currency.
  const loadOffers = offersAction.bind(null, d.id);
  const offersForNew = manage ? await loadOffers(q.newDefaults.currency) : null;
  // Which quotations each offer is in (an offer can be quoted again on other terms).
  const usedIn: Record<string, string[]> = {};
  for (const x of quotations) for (const o of currentOf(x).options) if (o.factoryQuoteId) (usedIn[o.factoryQuoteId] ??= []).push(x.letter);
  const letters = quotations.map((x) => x.letter);
  const newButton = (variant: "primary" | "secondary" = "secondary") =>
    manage ? (
      <NewQuotationsButton
        key={sp.start === "1" ? "start" : "button"}
        action={newQuotationsAction.bind(null, d.id)}
        offers={offersForNew}
        loadOffers={loadOffers}
        defaults={q.newDefaults}
        usedIn={usedIn}
        letters={letters}
        variant={variant}
        defaultOpen={sp.start === "1"}
        only={sp.start === "1" ? (sp.offer ?? null) : null}
        base={base}
      />
    ) : null;

  const accepted = quotations.flatMap((x) => x.revisions).find((r) => r.status === "accepted");
  const order = d.orders.find((o) => o.status !== "cancelled");

  const statusOf = (x: QuotationOfDeal) => {
    const c = currentOf(x);
    const before = x.revisions.find((r) => r.status !== "draft");
    if (c.status === "draft" && before) return <StatusBadge meaning="neutral">Draft R{c.number}</StatusBadge>;
    return <RevisionBadge status={c.status} />;
  };
  const COLS = "md:grid-cols-[minmax(0,1.5fr)_130px_minmax(0,1.1fr)_96px_20px] roomy:grid-cols-[minmax(0,1.5fr)_130px_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.1fr)_96px_20px]";

  return (
    // The same panel as every tab of the inquiry, beside its quotations.
    <WithSide id={id}>
    <div className="flex flex-col gap-4">
      {accepted && order && (
        <section aria-label="Order created" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ok/30 bg-ok-soft p-4">
          <p className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="size-5 shrink-0 text-ok" aria-hidden />
            <span>
              {d.customer.name} accepted R{accepted.number}
              {accepted.answeredOn ? ` on ${date(accepted.answeredOn)}` : ""}. Sales order <span className="font-medium">{order.refNo}</span> was made (
              {money(order.total, order.currency)}); the work continues there.
            </span>
          </p>
          <ButtonLink href={`/orders/${order.id}`} size="sm">
            Open the order
          </ButtonLink>
        </section>
      )}

      {quotations.length > 0 && !manage && !(accepted && order) && (
        <Alert tone="info">{quoter && q.whyNotStart ? q.whyNotStart : "Only the person handling this inquiry (or a manager) can change the quotations or record the customer's answer."}</Alert>
      )}

      {quotations.length === 0 ? (
        <Card>
          <CardHeader title="Quotations" actions={newButton("primary")} />
          <CardBody>
            <p className="text-sm text-text-2">
              {manage
                ? "None yet. New quotations makes one draft for each factory offer you tick, or one priced by hand."
                : (q.whyNotStart ?? "The person handling this inquiry makes the quotations.")}
            </p>
          </CardBody>
        </Card>
      ) : (
        <Card className="overflow-clip">
          <CardHeader
            title={
              <>
                Quotations<span className="font-normal text-text-2"> · {quotations.length}</span>
              </>
            }
            actions={newButton()}
          />
          <div aria-hidden className={cn("hidden items-center gap-x-4 border-b border-line bg-surface-2/60 px-5 py-2 text-xs font-medium text-text-2 md:grid", COLS)}>
            <span>Quotation</span>
            <span className="text-right">Total</span>
            <span>Delivery</span>
            <span className="hidden roomy:block">Payment</span>
            <span className="hidden roomy:block">Warranty</span>
            <span>Status</span>
            <span />
          </div>
          <ul>
            {quotations.map((x) => {
              const c = currentOf(x);
              const o = optionOf(c);
              const facts = termsFacts(c);
              const checks = showCosts ? checksOf(c, o) : [];
              const problem = checks.find((k) => !k.ok);
              const from = o?.factory ? shortName(o.factory.name) : o && !o.factoryQuoteId ? "Own prices" : null;
              return (
                <li key={x.id} className="border-b border-line last:border-b-0">
                  <Link
                    href={`${base}/quotations/${x.id}`}
                    className={cn(
                      "grid grid-cols-[minmax(0,1fr)_auto_20px] items-start gap-x-4 gap-y-1 px-5 py-3 text-[13px] hover:bg-surface-2/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-text",
                      COLS,
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block font-semibold text-text">{x.refNo}</span>
                      <span className="block truncate text-xs text-text-2">{[from, `R${c.number}`].filter(Boolean).join(" · ")}</span>
                      <span className="block text-xs font-semibold tabular md:hidden">{totalText(c)}</span>
                    </span>
                    <span className="text-right font-semibold whitespace-nowrap tabular max-md:hidden">{totalText(c)}</span>
                    <span className="min-w-0 max-md:hidden">
                      <span className="block">{facts.delivery}</span>
                      {facts.lead && <span className="block truncate text-xs text-text-2">{facts.lead}</span>}
                    </span>
                    <span className="hidden min-w-0 roomy:block">{facts.payment || "—"}</span>
                    <span className="hidden min-w-0 roomy:block">
                      <span className="block">{facts.warranty ?? "—"}</span>
                      {problem ? <CheckChip check={problem} /> : checks.length > 0 ? <CheckChip check={{ ...checks[0]!, word: "OK" }} /> : null}
                    </span>
                    <span className="justify-self-end md:justify-self-start">{statusOf(x)}</span>
                    <ChevronRight className="mt-0.5 size-4 self-center text-text-2" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
    </WithSide>
  );
}
