import { notFound, redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/session";
import { isUuid } from "@/lib/utils/ids";
import { todayISO } from "@/lib/utils/dates";
import { getQueryDetail } from "@/modules/queries/repository";
import { canWorkOn } from "@/modules/queries/service";
import { allSuppliers } from "@/modules/sourcing/repository";
import { createOfferAction } from "@/modules/sourcing/actions";
import { OfferForm } from "@/modules/sourcing/components";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Add factory offer" };

export default async function NewOfferPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("sourcing.manage");
  const { id } = await params;
  const detail = isUuid(id) ? await getQueryDetail(user, id) : null;
  if (!detail) notFound();
  if (!canWorkOn(user, detail.query)) redirect(`/queries/${id}`);
  const suppliers = await allSuppliers();
  const requested = detail.items.map((i) => ({ id: i.id, description: i.description, quantity: String(Number(i.quantity)), unit: i.unit }));
  return (
    <>
      <PageHeader title="Add factory offer" description={`${detail.query.refNo}: ${detail.query.title}`} backHref={`/queries/${id}/sourcing`} backLabel="Factory offers" />
      <div className="max-w-4xl">
        <OfferForm
          action={createOfferAction.bind(null, id)}
          suppliers={suppliers}
          requested={requested}
          cancelHref={`/queries/${id}/sourcing`}
          submitLabel="Save offer"
          initial={{
            supplierId: "",
            reference: "",
            quotedOn: todayISO(),
            validUntil: "",
            currency: "CNY",
            pricesIncludeVat: true,
            priceBasis: "",
            leadTime: "",
            paymentTerms: "",
            notes: "",
            items: requested.map((r) => ({ sourceId: r.id, description: r.description, model: "", quantity: r.quantity, unit: r.unit, unitPrice: "", vatRate: "13" })),
          }}
        />
      </div>
    </>
  );
}
