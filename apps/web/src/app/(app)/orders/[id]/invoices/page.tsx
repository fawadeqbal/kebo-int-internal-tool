import Link from "next/link";
import { FileText, Printer } from "lucide-react";
import { can, INVOICE_STATUS_LABEL, INVOICE_TYPE_LABEL, type InvoiceStatus } from "@kebo/shared";
import { Badge, buttonClass, Card, CardBody, CardHeader, EmptyState, cn } from "@kebo/ui";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { date, money } from "@/lib/format";
import type { OrderView } from "@/lib/types";
import type { Invoice, ShipmentsView } from "@/lib/types-orders";
import { InvoiceActions, NewInvoiceForm } from "@/components/orders/invoice-forms";
import { today } from "@/components/orders/today";
import { createInvoiceAction, issueInvoiceAction, updateInvoiceAction, voidInvoiceAction } from "./actions";

export const metadata = { title: "Invoices" };

const TONE: Record<InvoiceStatus, "neutral" | "ok" | "bad"> = { draft: "neutral", issued: "ok", void: "bad" };

export default async function InvoicesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ new?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const me = await requireUser();
  const [o, invoices, ship] = await Promise.all([
    api.get<OrderView>(`/orders/${id}`),
    api.get<Invoice[]>(`/orders/${id}/invoices`),
    api.get<ShipmentsView>(`/orders/${id}/shipments`),
  ]);
  const canInvoice = can(me.role, "invoices.manage") && o.status !== "cancelled";
  const canVoid = can(me.role, "orders.manage");
  const t = today();
  const live = invoices.filter((i) => i.status !== "void");
  const hasProforma = live.some((i) => i.type === "proforma");
  const billed = new Set(live.filter((i) => i.type === "commercial").map((i) => i.shipmentId));
  const unbilled = ship.shipments
    .filter((s) => !billed.has(s.id))
    .map((s) => ({
      id: s.id,
      label: `${s.refNo} · ${s.lines.map((l) => `${Number(l.quantity)} ${l.unit}`).join(", ")}${s.blNo ? ` · B/L ${s.blNo}` : ""}`,
    }));
  const shipmentRef = new Map(ship.shipments.map((s) => [s.id, s.refNo]));

  return (
    <div className="flex flex-col gap-5">
      {canInvoice && (
        <Card>
          <CardHeader
            title="Make an invoice"
            description="Invoices are made from the order and its shipments, so the amounts always match the order."
          />
          <CardBody className="flex flex-col gap-3">
            <NewInvoiceForm
              type="proforma"
              action={createInvoiceAction.bind(null, o.id)}
              today={t}
              defaultOpen={sp.new === "proforma"}
              disabledReason={hasProforma ? "This order has a proforma invoice. Void it to make a new one." : null}
            />
            <NewInvoiceForm
              type="commercial"
              action={createInvoiceAction.bind(null, o.id)}
              shipments={unbilled}
              today={t}
              defaultOpen={sp.new === "commercial"}
              disabledReason={
                ship.shipments.length === 0
                  ? "Commercial invoices bill a shipment: plan a shipment first."
                  : unbilled.length === 0
                    ? "Every shipment has its commercial invoice."
                    : null
              }
            />
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Invoices" description="Drafts can be changed; issued invoices are locked. A mistake is voided and made again." />
        {invoices.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No invoices yet"
            description="Start with the proforma invoice: the customer pays the deposit against it."
          />
        ) : (
          <ul className="divide-y divide-line">
            {invoices.map((inv) => (
              <li key={inv.id} className={cn("flex flex-col gap-3 px-4 py-3", inv.status === "void" && "text-muted")}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      <span className={cn(inv.status === "void" && "line-through")}>
                        {INVOICE_TYPE_LABEL[inv.type]} {inv.number ?? "(draft, no number yet)"}
                      </span>
                      <Badge tone={TONE[inv.status]} dot>
                        {INVOICE_STATUS_LABEL[inv.status]}
                      </Badge>
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {inv.type === "commercial" && inv.shipmentId && <>Shipment {shipmentRef.get(inv.shipmentId) ?? ""} · </>}
                      {inv.issueDate ? `Issued ${date(inv.issueDate)}` : "Not issued"}
                      {inv.dueDate ? ` · due ${date(inv.dueDate)}` : ""}
                      {inv.type === "proforma" && inv.deposit
                        ? ` · deposit ${inv.depositPercent}%: ${money(inv.deposit, inv.currency)}`
                        : ""}
                    </p>
                    {inv.status === "void" && inv.voidReason && <p className="mt-0.5 text-xs">Void: {inv.voidReason}</p>}
                    {inv.notes && inv.status !== "void" && <p className="mt-0.5 text-xs whitespace-pre-line text-text-2">{inv.notes}</p>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={cn("text-sm font-semibold tabular", inv.status === "void" && "line-through")}>
                      {money(inv.total, inv.currency)}
                    </span>
                    <Link href={`/print/invoices/${inv.id}`} className={buttonClass("ghost", "sm")}>
                      <Printer aria-hidden /> Print
                    </Link>
                  </div>
                </div>
                {(canInvoice || canVoid) && inv.status !== "void" && (
                  <InvoiceActions
                    status={inv.status}
                    issueDate={inv.issueDate}
                    dueDate={inv.dueDate}
                    notes={inv.notes}
                    today={t}
                    update={canInvoice ? updateInvoiceAction.bind(null, o.id, inv.id) : null}
                    issue={canInvoice ? issueInvoiceAction.bind(null, o.id, inv.id) : null}
                    voidIt={canVoid ? voidInvoiceAction.bind(null, o.id, inv.id) : null}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
