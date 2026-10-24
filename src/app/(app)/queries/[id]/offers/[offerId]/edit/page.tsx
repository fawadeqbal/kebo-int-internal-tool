import { notFound, redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/session";
import { isUuid } from "@/lib/utils/ids";
import { getQueryDetail } from "@/modules/queries/repository";
import { canWorkOn } from "@/modules/queries/service";
import { allSuppliers, findOffer } from "@/modules/sourcing/repository";
import { updateOfferAction } from "@/modules/sourcing/actions";
import { OfferForm } from "@/modules/sourcing/components";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Edit factory offer" };

export default async function EditOfferPage({ params }: { params: Promise<{ id: string; offerId: string }> }) {
  const user = await requirePagePermission("sourcing.manage");
  const { id, offerId } = await params;
  const [detail, offer] = isUuid(id) && isUuid(offerId) ? await Promise.all([getQueryDetail(user, id), findOffer(offerId)]) : [null, null];
  if (!detail || !offer || offer.offer.queryId !== id) notFound();
  if (!canWorkOn(user, detail.query)) redirect(`/queries/${id}/sourcing`);
  const o = offer.offer;
  return (
    <>
      <PageHeader title={`Offer from ${offer.supplier.name}`} description={`${detail.query.refNo}: ${detail.query.title}`} backHref={`/queries/${id}/sourcing`} backLabel="Factory offers" />
      <div className="max-w-4xl">
        <OfferForm
          action={updateOfferAction.bind(null, offerId, id)}
          suppliers={await allSuppliers()}
          requested={detail.items.map((i) => ({ id: i.id, description: i.description, quantity: String(Number(i.quantity)), unit: i.unit }))}
          cancelHref={`/queries/${id}/sourcing`}
          submitLabel="Save changes"
          initial={{
            supplierId: o.supplierId,
            reference: o.reference ?? "",
            quotedOn: o.quotedOn,
            validUntil: o.validUntil ?? "",
            currency: o.currency,
            pricesIncludeVat: o.pricesIncludeVat,
            priceBasis: o.priceBasis ?? "",
            leadTime: o.leadTime ?? "",
            paymentTerms: o.paymentTerms ?? "",
            notes: o.notes ?? "",
            items: offer.items.map((l) => ({
              id: l.id,
              sourceId: l.queryItemId ?? "",
              description: l.description,
              model: l.model ?? "",
              quantity: String(Number(l.quantity)),
              unit: l.unit,
              unitPrice: String(Number(l.unitPrice)),
              vatRate: String(Number(l.vatRate)),
            })),
          }}
        />
      </div>
    </>
  );
}
