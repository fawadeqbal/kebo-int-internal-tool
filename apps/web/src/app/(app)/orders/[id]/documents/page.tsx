import Link from "next/link";
import { BANK_STEP_LABEL, can, paperDone, type BankStepKind } from "@kebo/shared";
import { buttonClass } from "@kebo/ui";
import { api } from "@/lib/api";
import { orderFilesOf, orderPapersOf, orderPaymentsOf } from "@/lib/order-data";
import { optional } from "@/components/print/data";
import { Checklist } from "@/components/orders/checklist";
import { StepPage } from "@/components/orders/step-page";
import { StepChangesCompact } from "@/components/orders/side-panel";
import { expensePayTools, StepCosts } from "@/components/orders/costs-card";
import { PapersTable, type PaperLineRow, type PapersTab } from "@/components/orders/papers-table";
import { BankTracker, type BankStepLine, type BankStepTool } from "@/components/orders/bank-tracker";
import { FilesOfOrder, UploadButton } from "@/components/files/files-list";
import { ReachedForm } from "@/components/money/money-v2";
import { date } from "@/lib/format";
import { lightAction } from "../../light-actions";
import { addDocumentAction, updateDocumentAction } from "../../flow-actions";
import { issueProformaAction, paymentAction } from "../../actions";
import { docHref } from "../shared";
import { stepData } from "../step-data";

export const metadata = { title: "Order · documents and bank" };

const TABS: PapersTab[] = ["bank", "all", "missing"];

/**
 * Step 5, Documents & bank (Documents v3): one place for the papers, the bank
 * and the files, each once.
 * - Papers: every paper of the order (For the bank · All papers · Missing), made
 *   by the app, uploaded or kept elsewhere, with its one button and ⋯ menu.
 * - Through the banks: the route's bank steps as a tracker; only today's has its button.
 * - Files of this order: every file of the order, wherever it was added.
 * The papers and bank steps stay the step's count (the doc:* and bank:* items of
 * the checklist) without being listed again as checklist rows; the checklist
 * shows only the company's own items for this step, if any.
 */
export default async function OrderDocuments({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const d = await stepData(id, "documents");
  const { me, o, flow, now } = d;
  const [papers, files] = await Promise.all([optional(() => orderPapersOf(id)), optional(() => orderFilesOf(id))]);
  const route = flow?.payment.route ?? null;
  const open = o.status !== "cancelled";
  const tab: PapersTab = TABS.includes(sp.tab as PapersTab) ? (sp.tab as PapersTab) : papers?.papers.some((p) => p.inSet) ? "bank" : "all";

  // Papers: the API's list, with the quotation the order was made from (its own print page) and the proforma's internal copy.
  const quotation = o.documents.find((x) => x.kind === "quotation");
  const proforma = o.documents.find((x) => x.kind === "proforma");
  const rows: PaperLineRow[] = [
    ...(quotation
      ? [
          {
            key: "quotation",
            kind: "quotation",
            source: "app" as const,
            label: quotation.label,
            step: "payment" as const,
            state: "ready" as const,
            stateLabel: "Ready",
            number: null,
            version: null,
            sub: "accepted",
            ref: null,
            printable: true,
            makeable: false,
            live: true,
            inSet: false,
            doc: null,
            docKind: null,
            links: { ...docHref(o, quotation), internal: `${docHref(o, quotation).pdf}?copy=internal` },
          },
        ]
      : []),
    ...(papers?.papers ?? []).map((p) =>
      p.kind === "proforma" && proforma
        ? { ...p, links: { ...docHref(o, proforma), internal: `${docHref(o, proforma).pdf}?copy=internal` } }
        : p,
    ),
  ];
  const bank = rows.filter((r) => r.inSet);
  const ready = bank.filter((r) => paperDone(r.state));
  const missing = bank.filter((r) => r.state === "miss").map((r) => r.label);

  // Through the banks: the route's steps, each once; only the first not done has its button.
  const bankSteps = flow?.documents?.bankSteps ?? [];
  const at = bankSteps.findIndex((b) => !b.doneOn);
  const current = at >= 0 ? bankSteps[at]! : null;
  const contract = flow?.payment.bankContract ?? null;
  const subOf = (step: BankStepKind): string | null =>
    step === "sent_to_our_bank"
      ? (contract?.ourBank ?? null)
      : step === "couriered_to_customer_bank"
        ? "asks the tracking no."
        : step === "customer_bank_received" && route === "letter_of_credit"
          ? "starts the LC's days"
          : step === "bank_paid_us"
            ? "records the payment"
            : null;
  const lines: BankStepLine[] = bankSteps.map((b) => ({
    step: b.step,
    label: b.label,
    done: b.doneOn ? date(b.doneOn) : null,
    sub: b.doneOn ? [b.courier, b.reference].filter(Boolean).join(" ") || null : subOf(b.step),
  }));
  const canBank = can(me, "documents.manage") && open;
  let tool: BankStepTool | null = null;
  if (current && canBank && current.step !== "bank_paid_us") {
    const action = lightAction.bind(null, o.id, `bank:${current.step}`);
    tool =
      current.step === "couriered_to_customer_bank"
        ? {
            kind: "light",
            label: "Add the tracking no.",
            note: "The courier's tracking no. and the day it went: ticks the step.",
            action,
            fields: [
              { name: "reference", label: "Tracking no.", value: current.reference, required: true },
              { name: "courier", label: "Courier", value: current.courier ?? "DHL" },
              { name: "doneOn", label: "Sent on", type: "date", value: now, max: now, required: true },
            ],
            chips: [{ label: "Note", field: { name: "note", label: "Note" } }],
          }
        : { kind: "tap", tap: { label: "Done today", action, on: now } };
  }
  // "Money reached us" is the payment itself: recording it (credited amount, bank charges, account, MT103) ticks the step.
  if (current?.step === "bank_paid_us" && can(me, "payments.record") && open) {
    const [pays, settings] = await Promise.all([
      orderPaymentsOf(o.id),
      api.get<{ sales: { currency: string; exchangeRates: Record<string, number> } }>("/settings"),
    ]);
    tool = {
      kind: "form",
      label: "Record it",
      note: "Ticks the bank step and records the payment together.",
      form: (
        <ReachedForm
          action={paymentAction.bind(null, o.id, o.currency)}
          currency={o.currency}
          customer={o.customer.name}
          due={pays.due}
          depositDue={pays.depositDue}
          fx={{ main: settings.sales.currency, rates: settings.sales.exchangeRates }}
          today={now}
        />
      ),
    };
  }

  // The header's one line: papers for the bank, what is missing, where the bank stands.
  const line = [
    bank.length ? `${ready.length} of ${bank.length} papers for the bank ready` : null,
    missing.length ? `${missing.slice(0, 2).join(", ")}${missing.length > 2 ? ` and ${missing.length - 2} more` : ""} still missing` : null,
    current ? `bank: ${BANK_STEP_LABEL[current.step].toLowerCase()}` : bankSteps.length ? "bank: every step done" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // The checklist: only the company's own items for this step (papers and bank steps are the cards below).
  const own = d.items.filter((i) => !i.key?.startsWith("doc:") && !i.key?.startsWith("bank:"));
  const shipNumber = flow?.shipping?.shipments.find((s) => s.blNo)?.blNo ?? o.blNo ?? null;
  const routeLine = route
    ? `${route === "letter_of_credit" ? "The LC" : route === "bank_contract" ? "The bank contract" : "The route"}${contract?.number ? ` ${contract.number}` : ""} asks for these. Made by the app, uploaded or kept elsewhere all count as ready.`
    : "Choose how the customer pays on Payment: it decides the papers for the bank. Made by the app, uploaded or kept elsewhere all count as ready.";

  return (
    <StepPage
      steps={d.steps}
      step="documents"
      base={d.base}
      line={line || undefined}
      action={
        files?.canUpload || papers?.canMake ? (
          <>
            {files?.canUpload && <UploadButton orderId={o.id} step="documents" label="Upload files" variant="ghost" />}
            {papers?.canMake && (
              <Link href={`${d.base}/documents?tab=all#papers`} className={buttonClass("secondary", "sm")}>
                Make a paper
              </Link>
            )}
          </>
        ) : undefined
      }
      side={<StepChangesCompact entries={d.changes} historyHref={d.historyHref} />}
    >
      {own.length > 0 && (
        <Checklist
          payFor={await expensePayTools(o.id, own)}
          step="documents"
          label="Documents & bank"
          items={own}
          current={d.current}
          canEdit={d.steps.canEdit}
          run={d.run}
          dealId={o.inquiry.id}
          people={d.people}
          tools={{}}
          listHref={d.listHref}
          me={me.name}
          today={now}
        />
      )}
      {papers && (
        <PapersTable
          orderId={o.id}
          dealId={o.inquiry.id}
          rows={rows}
          tab={tab}
          canMake={papers.canMake}
          canRecord={papers.canRecord}
          addAction={addDocumentAction.bind(null, o.id)}
          updateActions={Object.fromEntries(
            rows.filter((r) => r.doc).map((r) => [r.doc!.id, updateDocumentAction.bind(null, o.id, r.doc!.id)]),
          )}
          description={routeLine}
          shipNumber={shipNumber}
          today={now}
          issueProforma={!o.proforma && can(me, "orders.update") && open ? issueProformaAction.bind(null, o.id) : undefined}
        />
      )}
      {bankSteps.length > 0 && (
        <BankTracker
          title={route === "informal" || !route ? "To the customer" : "Through the banks"}
          description="Each bank step once. Today's step has the button; the rest wait their turn."
          steps={lines}
          tool={tool}
          dealId={o.inquiry.id}
          reference={contract?.number ?? null}
        />
      )}
      {files && <FilesOfOrder data={files} step="documents" />}
      <StepCosts id={o.id} step="documents" />
    </StepPage>
  );
}
