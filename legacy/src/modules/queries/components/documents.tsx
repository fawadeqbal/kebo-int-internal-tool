import Link from "next/link";
import { Check, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { ButtonLink, Card, CardHeader } from "@/components/ui";
import { InvoiceStatusBadge, QuotationStatusBadge } from "@/components/ui/badge";
import { formatCbm, formatKg } from "@/lib/packing";
import { formatDate } from "@/lib/utils/dates";
import { formatMoney } from "@/lib/utils/money";
import { cn } from "@/lib/utils/cn";
import { invoiceDisplayStatus } from "@/modules/invoices/status";
import type { getQueryDetail } from "@/modules/queries/repository";
import type { listPackingListsForQuery } from "@/modules/packing/repository";

type Detail = NonNullable<Awaited<ReturnType<typeof getQueryDetail>>>;
type PackingRow = Awaited<ReturnType<typeof listPackingListsForQuery>>[number];

function Step({ n, title, done, hint, action, children, last }: { last?: boolean; n: number; title: string; done: boolean; hint?: ReactNode; action?: ReactNode; children?: ReactNode }) {
  return (
    <li className={cn("relative flex gap-3", !last && "pb-5")}>
      {!last && <span aria-hidden className="absolute top-7 bottom-0 left-[13px] w-px bg-line" />}
      <span
        className={cn(
          "relative z-10 flex size-[27px] shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular",
          done ? "border-primary-solid bg-primary-solid text-primary-fg" : "border-line bg-surface text-muted",
        )}
      >
        {done ? <Check className="size-3.5" aria-hidden /> : n}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-text">{title}</h3>
          {action}
        </div>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
        {children && <ul className="mt-2 flex flex-col divide-y divide-line rounded-lg border border-line">{children}</ul>}
      </div>
    </li>
  );
}

function Row({ href, number, label, badge, right, sub }: { href: string; number: string; label: string; badge?: ReactNode; right?: ReactNode; sub?: ReactNode }) {
  return (
    <li>
      <Link href={href} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2.5 hover:bg-surface-2/70">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono text-[13px] font-medium text-text">{number}</span>
          <span className="text-xs text-muted">{label}</span>
          {badge}
        </span>
        <span className="text-right">
          {right && <span className="block text-sm font-medium text-text tabular">{right}</span>}
          {sub && <span className="block text-xs text-muted">{sub}</span>}
        </span>
      </Link>
    </li>
  );
}

/**
 * Everything the customer receives for this inquiry, in the order it is made:
 * quotation → invoice → packing list, each with the next thing to do.
 */
export function DocumentsCard({
  detail,
  packingLists,
  currency,
  today,
  canQuote,
  canInvoice,
}: {
  detail: Detail;
  packingLists: PackingRow[];
  currency: string;
  today: string;
  canQuote: boolean;
  canInvoice: boolean;
}) {
  const { query } = detail;
  const quotes = detail.quotations;
  // Only the newest version is live: an older accepted version was replaced by a revision.
  const accepted = quotes[0]?.status === "accepted" ? quotes[0] : undefined;
  const invoices = canInvoice ? detail.invoices : [];
  const liveInvoice = detail.invoices.find((i) => i.status !== "cancelled");
  const closedLost = query.status === "not_completed";

  const quoteAction =
    canQuote && !closedLost && quotes.length === 0 ? (
      <ButtonLink href={`/quotations/new?query=${query.id}`} variant="primary" size="sm">
        <Plus aria-hidden /> Create quotation
      </ButtonLink>
    ) : null;
  const invoiceAction =
    canInvoice && accepted && !liveInvoice ? (
      <ButtonLink href={`/invoices/new?quotation=${accepted.id}`} variant="primary" size="sm">
        <Plus aria-hidden /> Generate invoice
      </ButtonLink>
    ) : null;
  // One packing list per invoice: offered once, then it is opened from the list below.
  const packingAction =
    canInvoice && liveInvoice && !packingLists.some((p) => p.invoiceId === liveInvoice.id) ? (
      <ButtonLink href={`/packing-lists/new?invoice=${liveInvoice.id}`} variant="primary" size="sm">
        <Plus aria-hidden /> Create packing list
      </ButtonLink>
    ) : null;

  return (
    <Card>
      <CardHeader title="Documents" description="Quotation, invoice and packing list for this inquiry" />
      <ol className="px-4 py-4 sm:px-5">
        <Step
          n={1}
          title="Quotation"
          done={quotes.some((q) => q.status !== "draft")}
          action={quoteAction}
          hint={quotes.length === 0 ? (closedLost ? "This inquiry was closed without a quotation." : "When the factory price is in, quote the customer.") : accepted ? "Accepted by the customer." : undefined}
        >
          {quotes.length > 0 &&
            quotes.map((q) => (
              <Row
                key={q.id}
                href={`/quotations/${q.id}`}
                number={q.refNo}
                label={`v${q.version}`}
                badge={<QuotationStatusBadge status={q.status} />}
                right={formatMoney(q.total, currency)}
                sub={`Valid until ${formatDate(q.dueDate)}`}
              />
            ))}
        </Step>

        <Step
          n={2}
          title="Invoice"
          done={!!liveInvoice}
          action={invoiceAction}
          hint={
            !canInvoice
              ? liveInvoice
                ? "Invoice issued by a manager."
                : "A manager issues the invoice once the quotation is accepted."
              : invoices.length === 0
                ? accepted
                  ? "The quotation is accepted: issue the invoice."
                  : "Available once the customer accepts a quotation."
                : undefined
          }
        >
          {invoices.length > 0 &&
            invoices.map((inv) => (
              <Row
                key={inv.id}
                href={`/invoices/${inv.id}`}
                number={inv.invoiceNo}
                label={`Issued ${formatDate(inv.issueDate)}`}
                badge={<InvoiceStatusBadge status={invoiceDisplayStatus(inv, today)} />}
                right={formatMoney(inv.total, currency)}
                sub={inv.status === "paid" ? "Paid in full" : inv.status === "cancelled" ? "Cancelled" : `Due ${formatDate(inv.dueDate)}`}
              />
            ))}
        </Step>

        <Step
          n={3}
          last
          title="Packing list"
          done={packingLists.length > 0}
          action={packingAction}
          hint={
            packingLists.length > 0
              ? undefined
              : !canInvoice
                ? "Made by a manager when the goods are packed."
                : liveInvoice
                  ? "When the goods are packed: cases, weights and volume for the shipment."
                  : "Available once the invoice is issued."
          }
        >
          {canInvoice &&
            packingLists.length > 0 &&
            packingLists.map((pl) => (
              <Row
                key={pl.id}
                href={`/packing-lists/${pl.id}`}
                number={pl.plNo}
                label={`${formatDate(pl.packDate)} · for ${pl.invoiceNo}`}
                right={`${pl.packages} pkg${pl.packages === 1 ? "" : "s"}`}
                sub={`${formatKg(Number(pl.grossWeight))} · ${formatCbm(Number(pl.cbm))}`}
              />
            ))}
        </Step>
      </ol>
    </Card>
  );
}
