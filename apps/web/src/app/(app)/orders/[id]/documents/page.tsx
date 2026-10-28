import Link from "next/link";
import { Download, Eye, FileText, Printer } from "lucide-react";
import { ATTACHMENT_KIND_LABEL, can } from "@kebo/shared";
import { Badge, buttonClass, Card, CardHeader } from "@kebo/ui";
import { ConfirmSubmit } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { orderOf } from "@/lib/order-data";
import { date } from "@/lib/format";
import type { DealDetail } from "@/lib/types";
import { optional } from "@/components/print/data";
import { DocumentsPanel } from "@/components/deals/documents-panel";
import { describeFileAction } from "../../../inquiries/actions";
import { issueProformaAction, orderRemoveFileAction } from "../../actions";
import { docHref } from "../shared";

export const metadata = { title: "Order documents" };

/** What the app makes from the order (always up to date), the customer's files and the factory's quotation. */
export default async function OrderDocuments({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const o = await orderOf(id);
  const deal = await optional(() => api.get<DealDetail>(`/inquiries/${o.inquiry.id}`));
  const open = o.status !== "cancelled";
  const canMove = can(me, "orders.update") && open;
  const name = (uid: string | null) => (uid ? (deal?.people[uid] ?? "Someone") : "System");

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader title="Made from the order" description="Made whenever you open them, so they are always up to date." />
        <ul className="flex flex-col divide-y divide-line">
          {o.documents.map((d) => {
            const h = docHref(o, d);
            return (
              <li key={d.kind} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span className="flex flex-col">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <FileText className="size-4 text-muted" aria-hidden /> {d.label}
                    {d.kind === "proforma" &&
                      (o.proforma ? (
                        <span className="font-normal text-text-2 tabular">
                          {o.proforma.number}
                          {o.proforma.issuedOn ? ` · issued ${date(o.proforma.issuedOn)}` : ""}
                        </span>
                      ) : (
                        <Badge tone="warn">Draft · no number yet</Badge>
                      ))}
                  </span>
                  {d.kind !== "packing-list" && (
                    <a href={`${h.pdf}${h.pdf.includes("?") ? "&" : "?"}copy=internal`} className="ml-6 text-xs text-muted underline-offset-2 hover:text-primary hover:underline">
                      Internal copy (all prices, costs, payments)
                    </a>
                  )}
                </span>
                <span className="flex flex-wrap gap-2">
                  {d.kind === "proforma" && !o.proforma && canMove && (
                    <ActionForm action={issueProformaAction.bind(null, o.id)} className="inline-flex">
                      <ConfirmSubmit
                        size="sm"
                        variant="primary"
                        pendingText="Issuing…"
                        message="Issue the proforma now? It gets its number dated today (KEB, the date, the customer's letters, the handler's count) and the number does not change afterwards."
                      >
                        Issue the proforma
                      </ConfirmSubmit>
                    </ActionForm>
                  )}
                  <Link href={h.view} target="_blank" className={buttonClass("secondary", "sm")} aria-label={`View or print the ${d.label.toLowerCase()}`}>
                    <Printer aria-hidden /> View / Print
                  </Link>
                  <a href={h.pdf} className={buttonClass("ghost", "sm")} aria-label={`Download the ${d.label.toLowerCase()} as PDF`}>
                    <Download aria-hidden /> Download PDF
                  </a>
                </span>
              </li>
            );
          })}
        </ul>
      </Card>

      {deal && (
        <Card>
          <CardHeader title="URS and documents" description={`From inquiry ${deal.refNo}, kept with the order`} />
          <div className="px-4 py-4">
            <DocumentsPanel
              dealId={deal.id}
              canUpload={open}
              files={deal.attachments.map((f) => ({
                ...f,
                uploadedBy: name(f.uploadedById),
                when: date(f.createdAt),
                canChange: f.uploadedById === me.id || deal.canWork,
                describe: describeFileAction.bind(null, deal.id, f.id),
                remove: orderRemoveFileAction.bind(null, o.id, deal.id, f.id),
              }))}
            />
          </div>
        </Card>
      )}

      {o.factoryFiles.length > 0 && (
        <Card>
          <CardHeader title="The factory's quotation" description="Internal, from the offer this order was made from" />
          <ul className="flex flex-col divide-y divide-line px-4">
            {o.factoryFiles.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="flex min-w-0 items-center gap-2">
                  <FileText className="size-4 shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0">
                    <a href={`/files/${f.id}`} className="block truncate text-sm font-medium hover:text-primary">
                      {f.fileName}
                    </a>
                    <span className="text-xs text-muted">
                      {f.factory} · {ATTACHMENT_KIND_LABEL[f.kind]} · {date(f.uploadedOn)}
                    </span>
                  </span>
                </span>
                <a href={`/files/${f.id}?view=1`} target="_blank" rel="noreferrer" className={buttonClass("ghost", "sm")}>
                  <Eye aria-hidden /> View
                </a>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
