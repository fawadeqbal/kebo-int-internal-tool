import { BANK_STEP_LABEL, can, dayMonth, type BankStepKind } from "@kebo/shared";
import { Badge } from "@kebo/ui";
import { getSettings } from "@/lib/loaders";
import { orderMoneyOf, orderPapersOf, orderPaymentsOf } from "@/lib/order-data";
import { optional } from "@/components/print/data";
import { date } from "@/lib/format";
import { OrderPage } from "@/components/order-sections/order-side";
import { EmptySection, Section } from "@/components/order-sections/section";
import { SectionFiles } from "@/components/order-sections/section-files";
import { FieldsWindow } from "@/components/order-sections/fields-window";
import { RecordPaymentWindow } from "@/components/order-sections/payment-windows";
import { PapersTable, type PaperLineRow, type PapersTab } from "@/components/orders/papers-table";
import type { BankStepView } from "@/lib/types-flow";
import { lightAction } from "../../light-actions";
import { addDocumentAction, updateDocumentAction } from "../../flow-actions";
import { issueProformaAction } from "../../actions";
import { bankPaidAction } from "../../section-actions";
import { docHref } from "../shared";
import { stageData } from "../stage-data";

export const metadata = { title: "Order · documents" };

const TABS: PapersTab[] = ["bank", "all", "missing"];

/**
 * Documents (design "the order, final"): every paper of the order in one list, each with its one button
 * (Make it from the order's data, Upload it when it comes from outside, or View it); then, by the
 * payment route, the originals couriered to the customer, or the bank's steps. Papers are made and
 * uploaded here and nowhere else on the order.
 */
export default async function OrderDocuments({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const d = await stageData(id, "documents");
  const { me, o, flow, now } = d;
  const papers = await optional(() => orderPapersOf(id));
  const route = flow?.payment.route ?? null;
  const open = d.open;
  const tab: PapersTab = TABS.includes(sp.tab as PapersTab) ? (sp.tab as PapersTab) : "all";

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

  const bankSteps = flow?.documents?.bankSteps ?? [];
  const contract = flow?.payment.bankContract ?? null;
  const canBank = can(me, "documents.manage") && open;
  const viaBank = route === "bank_contract" || route === "letter_of_credit";
  const done = bankSteps.filter((b) => b.doneOn).length;
  const sub = `${o.refNo} · ${o.customer.name}`;
  // "Money reached us" is the payment itself: recording it here records the payment and marks the step.
  const reached = bankSteps.find((b) => b.step === "bank_paid_us" && !b.doneOn) && can(me, "payments.record") && open;
  const [pays, money, settings] = reached ? await Promise.all([orderPaymentsOf(o.id), orderMoneyOf(o.id), getSettings()]) : [null, null, null];

  const stepWindow = (b: BankStepView, originals = false) =>
    canBank && (
      <FieldsWindow
        button={b.doneOn ? { label: "Edit" } : { label: "Add", kind: "plain" }}
        title={originals ? "Originals to the customer" : BANK_STEP_LABEL[b.step]}
        sub={originals ? sub : `${sub}${contract?.number ? ` · ${contract.number}` : ""}`}
        plain={!b.doneOn}
        action={lightAction.bind(null, o.id, `bank:${b.step}`)}
        files={d.canFiles ? { orderId: o.id, section: originals ? "originals" : "bank_steps", hint: originals ? "the courier slip" : "the slip or the bank’s message" } : undefined}
        fields={[
          { name: "doneOn", label: originals ? "Sent on" : "Done on", type: "date", value: b.doneOn, max: now },
          ...(originals || b.step === "couriered_to_customer_bank" ? [{ name: "courier", label: "Courier", value: b.courier, placeholder: "e.g. DHL" }] : []),
          { name: "reference", label: originals || b.step === "couriered_to_customer_bank" ? "Tracking no." : "Reference", value: b.reference },
          { name: "note", label: "Note", type: "textarea" as const, value: b.note, wide: true },
        ]}
      />
    );
  const hintOf = (step: BankStepKind): string =>
    step === "sent_to_our_bank" ? (contract?.ourBank ?? "") : step === "customer_bank_received" ? (contract?.customerBank ?? "") : step === "bank_paid_us" ? "recorded with the payment" : "";
  const originals = !viaBank ? (bankSteps.find((b) => b.step === "copies_to_customer") ?? null) : null;

  return (
    <OrderPage id={id}>
      {papers && (
        <PapersTable
          orderId={o.id}
          dealId={o.inquiry.id}
          rows={rows}
          tab={tab}
          canMake={papers.canMake}
          canRecord={papers.canRecord}
          addAction={addDocumentAction.bind(null, o.id)}
          updateActions={Object.fromEntries(rows.filter((r) => r.doc).map((r) => [r.doc!.id, updateDocumentAction.bind(null, o.id, r.doc!.id)]))}
          shipNumber={o.blNo}
          today={now}
          issueProforma={!o.proforma && can(me, "orders.update") && open ? issueProformaAction.bind(null, o.id) : undefined}
        />
      )}

      {originals &&
        (originals.doneOn ? (
          <Section
            title="Originals to the customer"
            state={`Sent ${dayMonth(originals.doneOn)}`}
            tone="ok"
            cols={3}
            rows={[
              { label: "Courier", value: originals.courier },
              { label: "Tracking no.", value: originals.reference },
              { label: "Sent on", value: date(originals.doneOn) },
              ...(originals.note ? [{ label: "Note", value: originals.note }] : []),
            ]}
            actions={stepWindow(originals, true)}
            files={<SectionFiles orderId={o.id} section="originals" canAdd={d.canFiles} />}
          />
        ) : (
          <EmptySection title="Originals to the customer" text="Not sent yet." action={stepWindow(originals, true)} />
        ))}

      {viaBank && bankSteps.length > 0 && (
        <Section title="The bank’s steps" state={`${done} of ${bankSteps.length}`} tone={done === bankSteps.length ? "ok" : "neutral"} files={<SectionFiles orderId={o.id} section="bank_steps" canAdd={d.canFiles} />}>
          <ul>
            {bankSteps.map((b) => (
              <li key={b.step} className="grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-t border-line px-[18px] py-2 text-[13px] sm:grid-cols-[220px_120px_minmax(0,1fr)_auto]">
                <b className="font-semibold">{b.label}</b>
                <span className="justify-self-end sm:justify-self-start">
                  <Badge tone={b.doneOn ? "ok" : "neutral"}>{b.doneOn ? dayMonth(b.doneOn) : "Waiting"}</Badge>
                </span>
                <span className="col-span-2 text-text-2 sm:col-span-1">{b.doneOn ? [b.courier, b.reference, b.note].filter(Boolean).join(" · ") || hintOf(b.step) : hintOf(b.step)}</span>
                <span className="col-span-2 justify-self-end sm:col-span-1">
                  {b.step === "bank_paid_us"
                    ? !b.doneOn &&
                      reached &&
                      pays &&
                      money &&
                      settings && (
                        <RecordPaymentWindow
                          main={false}
                          action={bankPaidAction.bind(null, o.id, o.currency)}
                          currency={o.currency}
                          customer={o.customer.name}
                          refNo={o.refNo}
                          due={pays.due}
                          depositDue={pays.depositDue}
                          forWhat={money.plan.next?.label ?? null}
                          fx={{ main: settings.sales.currency, rates: settings.sales.exchangeRates }}
                          today={now}
                        />
                      )
                    : stepWindow(b)}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </OrderPage>
  );
}
