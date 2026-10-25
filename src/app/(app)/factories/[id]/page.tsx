import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/session";
import { isUuid } from "@/lib/utils/ids";
import { formatDate } from "@/lib/utils/dates";
import { formatMoney } from "@/lib/utils/money";
import { splitDescription } from "@/lib/line-items";
import { findSupplier, offersOfSupplier } from "@/modules/sourcing/repository";
import { deleteSupplierAction, updateSupplierAction } from "@/modules/sourcing/actions";
import { SupplierProfileCard } from "@/modules/sourcing/components";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui";
import { ConfirmSubmit } from "@/components/ui/client";

export const metadata = { title: "Factory" };

export default async function FactoryPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("sourcing.manage");
  const { id } = await params;
  const supplier = isUuid(id) ? await findSupplier(id) : null;
  if (!supplier) notFound();
  const offers = await offersOfSupplier(id);
  const s = (v: string | null) => v ?? "";
  return (
    <>
      <PageHeader title={supplier.name} description={`${new Set(offers.map((o) => o.queryId)).size} ${new Set(offers.map((o) => o.queryId)).size === 1 ? "inquiry" : "inquiries"} with their price`} backHref="/factories" backLabel="Factories" />
      <div className="flex max-w-3xl flex-col gap-5">
        <SupplierProfileCard
          action={updateSupplierAction.bind(null, id)}
          supplier={{
            name: supplier.name,
            contactPerson: s(supplier.contactPerson),
            phone: s(supplier.phone),
            wechat: s(supplier.wechat),
            email: s(supplier.email),
            address: s(supplier.address),
            defaultVatRate: supplier.defaultVatRate,
            bankDetails: s(supplier.bankDetails),
            notes: s(supplier.notes),
          }}
        />
        <Card>
          <CardHeader title="Prices on inquiries" description="What they charge, per item (internal)" />
          <CardBody className="p-0">
            {offers.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">None yet. Add one on an inquiry: Factory prices → Add price.</p>
            ) : (
              <ul className="divide-y divide-line">
                {offers.map((o) => (
                  <li key={o.id}>
                    <Link href={`/queries/${o.queryId}`} className="flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-surface-2">
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-text">{splitDescription(o.description).name}</span>
                        <span className="block truncate text-xs text-muted">
                          <span className="font-mono">{o.queryRef}</span> · {o.queryTitle}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-xs text-muted">
                        <span className="block text-sm font-semibold text-text tabular">{formatMoney(o.unitPrice, o.currency)}</span>
                        {o.pricesIncludeVat ? "incl." : "+"} {Number(o.vatRate)}% VAT · {formatDate(o.quotedOn)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        {user.role !== "staff" && (
          <form action={deleteSupplierAction.bind(null, id)} className="text-right">
            <ConfirmSubmit variant="danger-ghost" size="sm" message={`Remove ${supplier.name}? It disappears from lists; its past offers stay on their inquiries.`}>
              Remove factory
            </ConfirmSubmit>
          </form>
        )}
      </div>
    </>
  );
}
