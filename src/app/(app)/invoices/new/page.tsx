import { notFound, redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/session";
import { customerName } from "@/lib/utils/names";
import { isUuid } from "@/lib/utils/ids";
import { DomainError, NotFoundError } from "@/lib/utils/result";
import { invoiceDraft } from "@/modules/documents/drafts";
import { createInvoiceAction } from "@/modules/invoices/actions";
import { InvoiceForm } from "@/modules/invoices/components";
import { ButtonLink, Card, CardBody, CardHeader, PageHeader, Table, THead, Td, Th, Tr } from "@/components/ui";
import { formatMoney, toCents } from "@/lib/utils/money";
import { splitDescription } from "@/lib/line-items";

export const metadata = { title: "Generate invoice" };

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ quotation?: string }> }) {
  const user = await requirePagePermission("invoices.manage");
  const { quotation: quotationId } = await searchParams;
  if (!isUuid(quotationId)) notFound();
  const draft = await invoiceDraft(user, quotationId).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    if (e instanceof DomainError) redirect(`/quotations/${quotationId}?toast=${encodeURIComponent(e.message)}`);
    throw e;
  });
  const { detail } = draft;
  const q = detail.quotation;
  return (
    <>
      <PageHeader
        title="Generate invoice"
        description={`From ${q.refNo} (v${q.version}) · ${customerName(detail.customer)} · ${detail.query.refNo} · the accepted quotation, as the customer accepted it`}
        backHref={`/quotations/${q.id}`}
        backLabel={q.refNo}
      />
      <div className="max-w-5xl">
        <InvoiceForm
          action={createInvoiceAction.bind(null, q.id)}
          cancelHref={`/quotations/${q.id}`}
          initial={draft.initial}
          lines={
            <Card className="overflow-hidden">
              <CardHeader
                title="What is invoiced"
                description="Exactly the accepted quotation: lines, prices, discount and VAT. To change anything, make a new quotation version and have it accepted."
                actions={
                  <ButtonLink href={`/quotations/${q.id}`} variant="secondary" size="xs">
                    View quotation
                  </ButtonLink>
                }
              />
              <Table>
                <THead>
                  <tr>
                    <Th>Item</Th>
                    <Th className="text-right">Qty</Th>
                    <Th className="hidden text-right sm:table-cell">Unit price</Th>
                    <Th className="text-right">Amount</Th>
                  </tr>
                </THead>
                <tbody>
                  {detail.items.map((it) => (
                    <Tr key={it.id}>
                      <Td>
                        <span className="font-medium">{splitDescription(it.description).name}</span>
                        {it.model && <span className="block text-xs text-muted">Model {it.model}</span>}
                      </Td>
                      <Td className="text-right whitespace-nowrap tabular">
                        {Number(it.quantity)} {it.unit}
                      </Td>
                      <Td className="hidden text-right whitespace-nowrap tabular sm:table-cell">{formatMoney(it.unitPrice, q.currency)}</Td>
                      <Td className="text-right whitespace-nowrap tabular">{formatMoney(it.lineTotal, q.currency)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
              <CardBody>
                <dl className="ml-auto grid max-w-sm gap-1.5 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted">Subtotal</dt>
                    <dd className="tabular">{formatMoney(q.subtotal, q.currency)}</dd>
                  </div>
                  {toCents(q.discount) > 0 && (
                    <div className="flex justify-between">
                      <dt className="text-muted">Discount</dt>
                      <dd className="tabular">− {formatMoney(q.discount, q.currency)}</dd>
                    </div>
                  )}
                  {!q.pricesIncludeVat && Number(q.taxRate) > 0 && (
                    <div className="flex justify-between">
                      <dt className="text-muted">VAT {Number(q.taxRate)}%</dt>
                      <dd className="tabular">{formatMoney(q.taxAmount, q.currency)}</dd>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-line pt-2 text-base font-semibold text-text">
                    <dt>{q.pricesIncludeVat && Number(q.taxRate) > 0 ? "Total incl. VAT" : "Total"}</dt>
                    <dd className="tabular">{formatMoney(q.total, q.currency)}</dd>
                  </div>
                  {q.pricesIncludeVat && Number(q.taxRate) > 0 && (
                    <div className="flex justify-between text-xs text-muted">
                      <dt>of which VAT {Number(q.taxRate)}%</dt>
                      <dd className="tabular">{formatMoney(q.taxAmount, q.currency)}</dd>
                    </div>
                  )}
                </dl>
              </CardBody>
            </Card>
          }
        />
      </div>
    </>
  );
}
