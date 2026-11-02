import { Eye, FileText } from "lucide-react";
import { ATTACHMENT_KIND_LABEL, can } from "@kebo/shared";
import { Badge, buttonClass, Card, CardBody, CardHeader } from "@kebo/ui";
import { ConfirmSubmit } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { api } from "@/lib/api";
import { FileActions } from "@/components/common/file-actions";
import { BankChainPanel, PaperSetPanel } from "@/components/orders/flow-panels";
import { PAYMENT_ROUTE_LABEL, PAYMENT_ROUTE_SHORT, type OrderDocumentKind } from "@kebo/shared";
import { Checklist, type AutoTool } from "@/components/orders/checklist";
import { KeyFacts, StepChanges, StepFiles, StepPage } from "@/components/orders/step-page";
import { addDocumentAction, bankStepAction, clearBankStepAction, removeDocumentAction, updateDocumentAction } from "../../flow-actions";
import { date, money } from "@/lib/format";
import type { DealDetail } from "@/lib/types";
import { optional } from "@/components/print/data";
import { DocumentsPanel } from "@/components/deals/documents-panel";
import { describeFileAction } from "../../../inquiries/actions";
import { issueProformaAction, orderRemoveFileAction } from "../../actions";
import { docHref } from "../shared";
import { stepData } from "../step-data";

export const metadata = { title: "Order · documents and bank" };

/**
 * Step 5, Documents & bank: the papers the shipment needs and their trip
 * through the banks (each a checklist item), what the app makes from the
 * order, the customer's files and the factory's quotation.
 */
export default async function OrderDocuments({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await stepData(id, "documents");
  const { me, o, flow, now } = d;
  const deal = await optional(() => api.get<DealDetail>(`/inquiries/${o.inquiry.id}`));
  const papers = flow?.documents ?? null;
  const canPapers = can(me, "documents.manage") && o.status !== "cancelled";
  const print = Object.fromEntries(
    o.documents
      .filter((d) => d.kind === "proforma" || d.kind === "packing-list")
      .map((d) => {
        const h = docHref(o, d);
        return [d.kind, <FileActions key={d.kind} viewHref={h.view} pdfHref={h.pdf} of={d.label.toLowerCase()} />];
      }),
  );
  const route = flow?.payment.route ?? null;
  const open = o.status !== "cancelled";
  const canMove = can(me, "orders.update") && open;
  const name = (uid: string | null) => (uid ? (deal?.people[uid] ?? "Someone") : "System");
  const files = (deal?.attachments ?? []).map((f) => ({ id: f.id, name: f.fileName, href: `/files/${f.id}` }));
  const shipmentList = (flow?.shipping?.shipments ?? []).map((s, i) => ({
    id: s.id,
    label: `Shipment ${i + 1}${s.blNo ? ` · ${s.blNo}` : ""}`,
  }));

  // Each paper and bank step of the checklist opens the form that records it.
  const tools: Record<string, AutoTool> = {};
  if (papers && canPapers) {
    for (const doc of papers.set) {
      if (!doc.required) continue;
      const key = `doc:${doc.kind}`;
      if (tools[key]) continue;
      if (doc.id)
        tools[key] = {
          kind: "document",
          label: doc.status === "ready" ? "Change" : "Mark ready",
          action: updateDocumentAction.bind(null, o.id, doc.id),
          doc,
          files,
          shipments: shipmentList,
        };
      else if (doc.printable === "proforma") tools[key] = { kind: "link", label: o.proforma ? "View" : "Issue it", href: "#made" };
      else if (doc.printable === "packing-list") tools[key] = { kind: "link", label: "Make it", href: `${d.base}/shipping#lines` };
      else
        tools[key] = {
          kind: "document",
          label: "Record it",
          action: addDocumentAction.bind(null, o.id),
          docKind: doc.kind as OrderDocumentKind,
          files,
          shipments: shipmentList,
        };
    }
    for (const b of papers.bankSteps)
      tools[`bank:${b.step}`] = {
        kind: "bankStep",
        label: "Mark done",
        action: bankStepAction.bind(null, o.id, b.step),
        step: b,
        today: now,
      };
  }
  const required = papers?.set.filter((x) => x.required) ?? [];
  const contract = flow?.payment.bankContract;

  return (
    <StepPage
      steps={d.steps}
      step="documents"
      base={d.base}
      side={
        <>
          <KeyFacts
            facts={[
              {
                label: "Route",
                value: route
                  ? `${PAYMENT_ROUTE_LABEL[route].replace(/ \(.*\)$/, "")}${contract?.number ? ` ${contract.number}` : ""}`
                  : "Not chosen",
              },
              ...(papers
                ? [{ label: "Papers ready", value: `${required.filter((x) => x.status === "ready").length} of ${required.length}` }]
                : []),
              ...(contract?.expiresOn
                ? [{ label: route === "letter_of_credit" ? "LC expires" : "Contract expires", value: date(contract.expiresOn) }]
                : []),
              { label: "Balance due", value: Number(o.money.due) > 0 ? money(o.money.due, o.currency) : "Nothing" },
            ]}
          />
          <StepFiles items={d.items} addHref={d.steps.canEdit ? "#files" : undefined} />
          <StepChanges entries={d.changes} historyHref={d.historyHref} />
        </>
      }
    >
      <Checklist
        step="documents"
        label="Documents & bank"
        items={d.items}
        current={d.current}
        canEdit={d.steps.canEdit}
        run={d.run}
        dealId={o.inquiry.id}
        people={d.people}
        tools={tools}
        listHref={d.listHref}
      />
      {papers && (
        <Card>
          <CardHeader
            title="Documents through the banks"
            description={
              route
                ? `${PAYMENT_ROUTE_SHORT[route]} route${flow?.payment.bankContract?.number ? ` · ${flow.payment.bankContract.number}` : ""}: the papers the shipment needs and where they are`
                : "Choose how the customer pays on Payments: it decides the papers and bank steps"
            }
          />
          <CardBody className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="flex min-w-0 flex-col gap-2">
              <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Document set</h3>
              <PaperSetPanel
                addAction={addDocumentAction.bind(null, o.id)}
                updateActions={Object.fromEntries(
                  papers.set.filter((d) => d.id).map((d) => [d.id!, updateDocumentAction.bind(null, o.id, d.id!)]),
                )}
                removeActions={Object.fromEntries(
                  papers.set.filter((d) => d.id).map((d) => [d.id!, removeDocumentAction.bind(null, o.id, d.id!)]),
                )}
                set={papers.set}
                files={files}
                shipments={shipmentList}
                printButtons={print}
                canEdit={canPapers}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">
                {route === "informal" || !route ? "To the customer" : "Through the banks"}
              </h3>
              <BankChainPanel
                stepActions={Object.fromEntries(papers.bankSteps.map((b) => [b.step, bankStepAction.bind(null, o.id, b.step)]))}
                clearActions={Object.fromEntries(papers.bankSteps.map((b) => [b.step, clearBankStepAction.bind(null, o.id, b.step)]))}
                steps={papers.bankSteps}
                today={now}
                canEdit={canPapers}
              />
            </div>
          </CardBody>
        </Card>
      )}
      <Card id="made" className="scroll-mt-24">
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
                    <a
                      href={`${h.pdf}${h.pdf.includes("?") ? "&" : "?"}copy=internal`}
                      className="ml-6 text-xs text-muted underline-offset-2 hover:text-primary hover:underline"
                    >
                      Internal copy (all prices, costs, payments)
                    </a>
                  )}
                </span>
                <span className="flex flex-wrap gap-2">
                  <FileActions viewHref={h.view} pdfHref={h.pdf} of={d.label.toLowerCase()} />
                  {d.kind === "proforma" && !o.proforma && canMove && (
                    <ActionForm action={issueProformaAction.bind(null, o.id)} className="inline-flex">
                      <ConfirmSubmit
                        size="sm"
                        variant="primary"
                        pendingText="Issuing…"
                        message="Issue the proforma now? It gets its number dated today (your letters, the date, the customer's letters, the handler's count) and the number does not change afterwards."
                      >
                        Issue the proforma
                      </ConfirmSubmit>
                    </ActionForm>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>

      {deal && (
        <Card id="files" className="scroll-mt-24">
          <CardHeader
            title="URS and documents"
            description={`From inquiry ${deal.refNo}, kept with the order`}
            actions={
              deal.attachments.length > 1 ? (
                <FileActions allHref={`/files/inquiries/${deal.id}`} allCount={deal.attachments.length} />
              ) : undefined
            }
          />
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
    </StepPage>
  );
}
