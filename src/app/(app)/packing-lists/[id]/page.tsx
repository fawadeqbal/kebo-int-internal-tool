import Link from "next/link";
import { notFound } from "next/navigation";
import { FileDown, Pencil, Printer } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/session";
import { customerName } from "@/lib/utils/names";
import { isUuid } from "@/lib/utils/ids";
import { formatDate } from "@/lib/utils/dates";
import { formatCbm, formatKg, packingTotals } from "@/lib/packing";
import { getPackingListDetail } from "@/modules/packing/repository";
import { deletePackingListAction } from "@/modules/packing/actions";
import { getSettings } from "@/modules/settings/service";
import { buttonClass, ButtonLink, Card, CardBody, CardHeader } from "@/components/ui";
import { ConfirmSubmit } from "@/components/ui/client";
import { PackingListDocument } from "@/components/documents/packing-list-document";

export const metadata = { title: "Packing list" };

export default async function PackingListPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePagePermission("invoices.manage");
  const { id } = await params;
  const detail = isUuid(id) ? await getPackingListDetail(id) : null;
  if (!detail) notFound();
  const settings = await getSettings();
  const { packingList: pl, invoice, query, customer } = detail;
  const t = packingTotals(detail.items);

  return (
    <div>
      <header className="no-print mb-5">
        <Link href={`/queries/${query.id}`} className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-text">
          ← {query.refNo}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-mono text-xl font-semibold tracking-tight text-text">{pl.plNo}</h1>
            <p className="mt-1 text-sm text-muted">
              <Link href={`/customers/${customer.id}`} className="hover:underline">
                {customerName(customer)}
              </Link>{" "}
              · for{" "}
              <Link href={`/invoices/${invoice.id}`} className="hover:underline">
                {invoice.invoiceNo}
              </Link>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={`/packing-lists/${id}/edit`} variant="secondary" size="sm">
              <Pencil aria-hidden /> Edit
            </ButtonLink>
            <a href={`/print/packing-lists/${id}`} target="_blank" rel="noreferrer" className={buttonClass("ghost", "sm")}>
              <Printer aria-hidden /> Print
            </a>
            <a href={`/api/packing-lists/${id}/pdf`} className={buttonClass("primary", "sm")} download>
              <FileDown aria-hidden /> Download PDF
            </a>
          </div>
        </div>
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
        <div className="overflow-hidden rounded-xl border border-line shadow-card">
          <PackingListDocument detail={detail} settings={settings} />
        </div>
        <aside aria-label="Summary" className="no-print flex flex-col gap-5">
          <Card>
            <CardHeader title="Shipment summary" description={`Packed ${formatDate(pl.packDate)} · by ${detail.creatorName}`} />
            <CardBody>
              <dl className="flex flex-col divide-y divide-line text-sm">
                {[
                  ["Packages", String(t.packages)],
                  ["Net weight", formatKg(t.netKg)],
                  ["Gross weight", formatKg(t.grossKg)],
                  ["Volume", formatCbm(t.cbm)],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between py-2 first:pt-0 last:pb-0">
                    <dt className="text-muted">{k}</dt>
                    <dd className="font-medium text-text tabular">{v}</dd>
                  </div>
                ))}
              </dl>
            </CardBody>
          </Card>
          <form action={deletePackingListAction.bind(null, id)} className="text-right">
            <ConfirmSubmit variant="danger-ghost" size="sm" message={`Remove packing list ${pl.plNo}?`}>
              Remove packing list
            </ConfirmSubmit>
          </form>
        </aside>
      </div>
    </div>
  );
}
