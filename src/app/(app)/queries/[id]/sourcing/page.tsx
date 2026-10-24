import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, Pencil, Plus } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { isUuid } from "@/lib/utils/ids";
import { formatDate } from "@/lib/utils/dates";
import { formatCents } from "@/lib/utils/money";
import { getAccessibleQuery, canWorkOn } from "@/modules/queries/service";
import { sourcingForQuery } from "@/modules/sourcing/repository";
import { chooseOffersAction, deleteOfferAction } from "@/modules/sourcing/actions";
import { ChooseOffersForm } from "@/modules/sourcing/components";
import { getSettings } from "@/modules/settings/service";
import { latestVersion } from "@/modules/quotations/service";
import { Alert, ButtonLink, Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { ConfirmSubmit } from "@/components/ui/client";
import { splitDescription } from "@/lib/line-items";

export const metadata = { title: "Factory offers" };

export default async function SourcingPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("sourcing.manage");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const query = await getAccessibleQuery(user, id).catch(() => null);
  if (!query) notFound();
  const settings = await getSettings();
  const s = await sourcingForQuery(id, settings.currency, settings.currency, settings.exchangeRates);
  const editable = canWorkOn(user, query);
  const quoted = await latestVersion(id);

  return (
    <>
      <PageHeader
        title="Factory offers"
        description={`${query.refNo}: ${query.title} · internal, never shown to the customer`}
        backHref={`/queries/${id}`}
        backLabel={query.refNo}
        actions={
          <>
            {editable && (
              <ButtonLink href={`/queries/${id}/offers/new`} variant={s.offers.length ? "secondary" : "primary"} size="sm">
                <Plus aria-hidden /> Add factory offer
              </ButtonLink>
            )}
            {can(user.role, "quotations.manage") && s.offers.length > 0 && (
              <ButtonLink href={`/quotations/new?query=${id}`} variant="primary" size="sm">
                <FileText aria-hidden /> {quoted ? "New quotation version" : "Create quotation"}
              </ButtonLink>
            )}
          </>
        }
      />
      {s.missingRates.length > 0 && (
        <Alert tone="warning">
          No exchange rate for {s.missingRates.join(", ")}: those prices cannot be compared or costed. Add the rate under Settings → Money &amp; defaults.
        </Alert>
      )}
      {s.offers.length === 0 ? (
        <Card>
          <EmptyState
            title="No factory offers yet"
            description="When a factory sends its price, record it here: per item, its price and VAT. Then compare factories and quote the customer from the one you choose."
          />
        </Card>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
          <section aria-label="Compare and choose" className="flex min-w-0 flex-col gap-4">
            <div>
              <h2 className="text-base font-semibold text-text">Compare and choose</h2>
              <p className="text-sm text-muted">
                Cost per unit incl. VAT, in {settings.currency} ({Object.entries(settings.exchangeRates).map(([c, r]) => `1 ${settings.currency} = ${r} ${c}`).join(", ") || "no rates set"}). The quotation is priced from the chosen
                line at {settings.defaultMarginPercent}% margin; you can change each price there.
              </p>
            </div>
            <ChooseOffersForm
              action={chooseOffersAction.bind(null, id)}
              currency={settings.currency}
              canEdit={editable}
              items={s.items.map((it) => ({
                id: it.id,
                description: it.description,
                quantity: it.quantity,
                unit: it.unit,
                chosenId: it.chosen?.id ?? null,
                options: it.options.map((o) => ({
                  id: o.id,
                  supplierName: o.supplierName,
                  description: o.description,
                  model: o.model,
                  quantity: o.quantity,
                  unit: o.unit,
                  offerCurrency: o.offerCurrency,
                  unitPrice: o.unitPrice,
                  vatRate: o.vatRate,
                  unitPriceWithVat: o.unitPriceWithVat,
                  unitCost: o.unitCost,
                  leadTime: o.leadTime,
                })),
              }))}
            />
          </section>
          <aside aria-label="Offers" className="flex flex-col gap-4">
            <h2 className="text-base font-semibold text-text">Offers ({s.offers.length})</h2>
            {s.offers.map((o) => (
              <Card key={o.id}>
                <CardHeader
                  title={o.supplierName}
                  description={[formatDate(o.quotedOn), o.reference && `ref. ${o.reference}`, o.validUntil && `valid to ${formatDate(o.validUntil)}`].filter(Boolean).join(" · ")}
                  actions={
                    editable && (
                      <Link href={`/queries/${id}/offers/${o.id}/edit`} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                        <Pencil className="size-3" aria-hidden /> Edit
                      </Link>
                    )
                  }
                />
                <CardBody className="flex flex-col gap-2 text-sm">
                  <ul className="flex flex-col gap-1">
                    {o.lines.map((l) => (
                      <li key={l.id} className="flex justify-between gap-3">
                        <span className="min-w-0 truncate text-text-2">
                          {Number(l.quantity)} × {splitDescription(l.description).name}
                        </span>
                        <span className="shrink-0 text-xs text-muted tabular">{Number(l.vatRate)}% VAT</span>
                      </li>
                    ))}
                  </ul>
                  <p className="flex justify-between border-t border-line pt-2 font-medium">
                    <span>Total incl. VAT</span>
                    <span className="tabular">{formatCents(o.totalWithVatCents, o.currency)}</span>
                  </p>
                  <p className="text-xs text-muted">
                    {[o.pricesIncludeVat ? "Prices included VAT" : "VAT added to their prices", o.priceBasis, o.leadTime && `lead time ${o.leadTime}`, o.paymentTerms].filter(Boolean).join(" · ")}
                  </p>
                  {o.notes && <p className="text-xs text-text-2">{o.notes}</p>}
                  {editable && (
                    <form action={deleteOfferAction.bind(null, o.id, id)} className="text-right">
                      <ConfirmSubmit variant="danger-ghost" size="xs" message={`Remove the offer from ${o.supplierName}?`}>
                        Remove
                      </ConfirmSubmit>
                    </form>
                  )}
                </CardBody>
              </Card>
            ))}
          </aside>
        </div>
      )}
    </>
  );
}
