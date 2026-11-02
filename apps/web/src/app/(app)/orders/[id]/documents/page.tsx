import { Eye, FileText } from "lucide-react";
import { ATTACHMENT_KIND_LABEL, can, ORDER_DOCUMENT_STATUS_LABEL, ORDER_DOCUMENT_STATUS_TONE } from "@kebo/shared";
import { Badge, buttonClass, Card, CardHeader } from "@kebo/ui";
import { ConfirmSubmit } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { api } from "@/lib/api";
import { FileActions } from "@/components/common/file-actions";
import { DOCUMENT_PAPER, PAYMENT_ROUTE_SHORT, type OrderDocumentKind } from "@kebo/shared";
import { Checklist, type AutoTool } from "@/components/orders/checklist";
import { StepChanges, StepFiles, StepPage, StepViewDivider, ViewPair } from "@/components/orders/step-page";
import { ViewCard } from "@/components/orders/step-view";
import { BankChainEdit, PaperSetEdit } from "@/components/orders/view-panels";
import { lightAction } from "../../light-actions";
import type { FlowDocument } from "@/lib/types-flow";
import { expensePayTools, StepCosts } from "@/components/orders/costs-card";
import { addDocumentAction, bankStepAction, clearBankStepAction, removeDocumentAction, updateDocumentAction } from "../../flow-actions";
import { date } from "@/lib/format";
import type { DealDetail } from "@/lib/types";
import { optional } from "@/components/print/data";
import { DocumentsPanel } from "@/components/deals/documents-panel";
import { describeFileAction } from "../../../inquiries/actions";
import { issueProformaAction, orderRemoveFileAction, paymentAction } from "../../actions";
import { ReceivedForm } from "@/components/money/money-v2";
import { orderPaymentsOf } from "@/lib/order-data";
import { docHref } from "../shared";
import { stepData } from "../step-data";
import { StepPapers } from "../papers";

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
      // Papers the app makes open their Make page.
      const made = DOCUMENT_PAPER[doc.kind as OrderDocumentKind];
      if (made && (!doc.id || doc.paperId)) {
        tools[key] = { kind: "link", label: doc.status === "ready" ? "View" : "Make", href: `${d.base}/papers/${made}` };
        continue;
      }
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
        // A paper from outside (the B/L, the certificate of origin…): its file, the number if it has one.
        tools[key] = {
          kind: "light",
          label: "Upload it",
          action: addDocumentAction.bind(null, o.id),
          fixed: { kind: doc.kind, status: "ready" },
          fields: [
            { name: "attachmentId", label: "The file (PDF or photo)", type: "file", required: true },
            { name: "number", label: "Number", value: doc.kind === "bill_of_lading" || doc.kind === "airway_bill" ? (o.blNo ?? "") : "" },
            { name: "issuedOn", label: "Issued on", type: "date", value: now, max: now },
          ],
          chips: [{ label: "Note", field: { name: "note", label: "Note", placeholder: "e.g. original + 3 copies" } }],
          hint: "Kept with the item and in the deal's files. Kept elsewhere instead? Say where in Papers below.",
          save: "Save and tick",
        };
    }
    for (const b of papers.bankSteps) {
      if (b.step === "bank_paid_us") continue;
      const action = lightAction.bind(null, o.id, `bank:${b.step}`);
      tools[`bank:${b.step}`] =
        b.step === "couriered_to_customer_bank"
          ? {
              kind: "light",
              label: "Add the tracking no.",
              action,
              fields: [
                { name: "reference", label: "Tracking no.", value: b.reference, required: true },
                { name: "courier", label: "Courier", value: b.courier ?? "DHL" },
                { name: "doneOn", label: "Sent on", type: "date", value: b.doneOn ?? now, max: now, required: true },
              ],
              chips: [{ label: "Note", field: { name: "note", label: "Note" } }],
            }
          : { kind: "tap", tap: { label: "Done today", action, on: now } };
    }
  }
  // "Money reached us" is the payment itself: recording it (credited amount, bank charges, account, MT103) ticks the step.
  const canPay = can(me, "payments.record") && open && !!papers?.bankSteps.some((b) => b.step === "bank_paid_us" && !b.doneOn);
  const [pays, settings] = canPay
    ? await Promise.all([orderPaymentsOf(o.id), api.get<{ sales: { currency: string; exchangeRates: Record<string, number> } }>("/settings")])
    : [null, null];
  const reached =
    pays && settings ? (
      <ReceivedForm
        quiet
        label="Record it"
        action={paymentAction.bind(null, o.id, o.currency)}
        currency={o.currency}
        customer={o.customer.name}
        refNo={o.refNo}
        due={pays.due}
        depositDue={pays.depositDue}
        forWhat="Balance"
        fx={{ main: settings.sales.currency, rates: settings.sales.exchangeRates }}
        today={now}
        reached={{ title: `Money reached us${flow?.payment.bankContract?.number ? ` · ${route === "letter_of_credit" ? "LC" : "contract"} ${flow.payment.bankContract.number}` : ""}` }}
      />
    ) : null;
  if (reached) tools["bank:bank_paid_us"] = { kind: "node", node: reached };
  const required = papers?.set.filter((x) => x.required) ?? [];
  const extra = papers?.set.filter((x) => !x.required && x.id) ?? [];
  const sourceOf = (x: FlowDocument) =>
    x.paperId
      ? "made by the app"
      : x.file
        ? `uploaded · ${x.file.name}`
        : x.status === "elsewhere"
          ? `kept elsewhere${x.keptWhere ? `: ${x.keptWhere}` : ""}`
          : x.printable
            ? "made from the order"
            : x.id
              ? "recorded"
              : "not in yet";
  const paperRow = (x: FlowDocument) => (
    <li key={x.id ?? x.kind} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 py-2.5">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{x.label}</span>
        <span className="block text-xs text-muted">
          {[x.number, x.issuedOn ? date(x.issuedOn) : null, sourceOf(x)].filter(Boolean).join(" · ")}
        </span>
      </span>
      <Badge tone={ORDER_DOCUMENT_STATUS_TONE[x.status]}>{ORDER_DOCUMENT_STATUS_LABEL[x.status]}</Badge>
    </li>
  );
  const readyCount = required.filter((x) => x.status === "ready" || x.status === "elsewhere").length;

  return (
    <StepPage
      steps={d.steps}
      step="documents"
      base={d.base}
      side={
        <>
          <StepFiles items={d.items} addHref={d.steps.canEdit ? "#files" : undefined} />
          <StepChanges entries={d.changes} historyHref={d.historyHref} />
        </>
      }
    >
      <Checklist
        payFor={await expensePayTools(o.id, d.items)}
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
        me={me.name}
        today={now}
      />
      <StepViewDivider />
      {papers && (
        <ViewCard
          title="Paper set"
          description={
            route
              ? `${PAYMENT_ROUTE_SHORT[route]} route${flow?.payment.bankContract?.number ? ` · ${flow.payment.bankContract.number}` : ""}: the papers the shipment needs and where each is`
              : "Choose how the customer pays on Payment: it decides the papers and bank steps"
          }
          meter={{ n: readyCount, of: required.length, word: "ready" }}
          canEdit={canPapers}
          panel={{
            title: "Edit the paper set",
            description: "Record, change or remove each paper. Made by the app, uploaded or kept elsewhere: all three count as done.",
            body: (
              <PaperSetEdit
                addAction={addDocumentAction.bind(null, o.id)}
                updateActions={Object.fromEntries(papers.set.filter((x) => x.id).map((x) => [x.id!, updateDocumentAction.bind(null, o.id, x.id!)]))}
                removeActions={Object.fromEntries(papers.set.filter((x) => x.id).map((x) => [x.id!, removeDocumentAction.bind(null, o.id, x.id!)]))}
                set={papers.set}
                files={files}
                shipments={shipmentList}
                printButtons={print}
              />
            ),
          }}
        >
          <ul className="flex flex-col divide-y divide-line px-4">{[...required, ...extra].map(paperRow)}</ul>
        </ViewCard>
      )}
      {papers && papers.bankSteps.length > 0 && (
        <ViewCard
          title={route === "informal" || !route ? "To the customer" : "Bank steps"}
          meter={{ n: papers.bankSteps.filter((b) => b.doneOn).length, of: papers.bankSteps.length, word: "done" }}
          canEdit={canPapers}
          panel={{
            title: "Edit the bank steps",
            description: "Each step's date, and the courier and tracking number. Saving updates the checklist.",
            body: (
              <BankChainEdit
                stepActions={Object.fromEntries(papers.bankSteps.map((b) => [b.step, bankStepAction.bind(null, o.id, b.step)]))}
                clearActions={Object.fromEntries(papers.bankSteps.map((b) => [b.step, clearBankStepAction.bind(null, o.id, b.step)]))}
                steps={papers.bankSteps}
                today={now}
              />
            ),
          }}
        >
          <ol className="flex flex-col divide-y divide-line px-4">
            {papers.bankSteps.map((b, i) => (
              <li key={b.step} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="mr-1.5 text-xs text-muted tabular">{i + 1}</span>
                  <span className={b.doneOn ? "font-medium" : "text-text-2"}>{b.label}</span>
                  {(b.courier || b.reference) && (
                    <span className="block pl-4 text-xs text-muted">{[b.courier, b.reference].filter(Boolean).join(" · ")}</span>
                  )}
                </span>
                <span className="text-xs text-muted tabular">{b.doneOn ? date(b.doneOn) : "—"}</span>
              </li>
            ))}
          </ol>
        </ViewCard>
      )}
      <ViewPair>
        <StepPapers id={o.id} dealId={o.inquiry.id} step="documents" title="Papers" outsideSet={!!papers} />
        <StepCosts id={o.id} step="documents" />
      </ViewPair>
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
