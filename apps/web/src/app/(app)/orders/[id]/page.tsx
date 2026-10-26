import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Download, FileText, Printer } from "lucide-react";
import { BALANCE_TERMS_LABEL, can, ORDER_STAGE_HINT, ORDER_STAGE_LABEL, PAYMENT_KIND_LABEL, PAYMENT_METHOD_LABEL, STAGE_FLOW, type OrderStage } from "@kebo/shared";
import { Badge, buttonClass, Card, CardBody, CardHeader, cn, OrderStageBadge, PageHeader } from "@kebo/ui";
import { api } from "@/lib/api";
import { load, requireUser } from "@/lib/session";
import { date, dateTime, money } from "@/lib/format";
import type { DealDetail } from "@/lib/types";
import type { OrderView, PaymentsView, PaymentStatus } from "@/lib/types-orders";
import { optional } from "@/components/print/data";
import { today } from "@/components/orders/today";
import { NoteForm, RemoveFile, UploadForm } from "../../deals/[id]/panels";
import { cancelOrderAction, detailsAction, moveStageAction, orderNoteAction, orderRemoveFileAction, orderTaxAction, orderUploadAction, packingAction, paymentAction, receiptAction, voidPaymentAction } from "../actions";
import { CancelOrderForm, DetailsForm, PaymentForm, StageActions, VoidPayment } from "./forms";
import { GoodsReceipt, PackingList, type GoodsLine } from "./goods";
import { RebateCard } from "./rebate";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const o = await load(() => api.get<OrderView>(`/orders/${id}`));
  return { title: `Order ${o.refNo}` };
}

const PAY_STATUS: Record<PaymentStatus, { label: string; tone: "neutral" | "warn" | "info" | "ok" }> = {
  unpaid: { label: "Nothing received", tone: "warn" },
  partly_paid: { label: "Part-paid", tone: "warn" },
  deposit_paid: { label: "Deposit received", tone: "info" },
  paid: { label: "Paid in full", tone: "ok" },
  overpaid: { label: "Overpaid", tone: "warn" },
};

const size = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

/** The four stages as a bar, each with the day the order got there. */
function StageBar({ o }: { o: OrderView }) {
  const at = STAGE_FLOW.indexOf(o.stage);
  const reachedOn = (s: OrderStage): string | null => {
    if (s === "confirmed") return o.orderedOn;
    if (s === "shipped" && o.shippedOn) return o.shippedOn;
    const h = o.history.findLast((x) => x.to === s);
    return h ? h.at : null;
  };
  const off = o.status === "cancelled";
  return (
    <ol className="grid grid-cols-4 gap-1.5" aria-label="Stages">
      {STAGE_FLOW.map((s, i) => {
        const reached = i <= at;
        const when = reached ? reachedOn(s) : null;
        return (
          <li key={s} className="min-w-0" aria-current={i === at ? "step" : undefined}>
            <div className={cn("h-2 rounded-full", reached ? (off ? "bg-line-strong" : i === at && s !== "done" ? "bg-primary" : "bg-primary/60") : "bg-surface-3")} aria-hidden />
            <p className={cn("mt-1.5 text-xs leading-tight font-medium", i === at ? "text-text" : reached ? "text-text-2" : "text-muted")}>
              {ORDER_STAGE_LABEL[s]}
              {i === at && <span className="sr-only"> (now)</span>}
            </p>
            <p className="text-xs text-muted tabular">{when ? date(when) : reached ? "" : "—"}</p>
          </li>
        );
      })}
    </ol>
  );
}

const docHref = (o: OrderView, d: OrderView["documents"][number]) =>
  d.kind === "quotation"
    ? { view: `/print/revisions/${d.revisionId}?back=/orders/${o.id}`, pdf: `/pdf/revisions/${d.revisionId}` }
    : { view: `/print/orders/${o.id}/${d.kind}?back=/orders/${o.id}`, pdf: `/pdf/${d.kind}/${o.id}` };

/**
 * One order: where it is (four stages), the one button that moves it, the
 * money, its documents, details, history, and the deal's notes and files.
 */
export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const o = await load(() => api.get<OrderView>(`/orders/${id}`));
  const [p, deal] = await Promise.all([api.get<PaymentsView>(`/orders/${id}/payments`), optional(() => api.get<DealDetail>(`/inquiries/${o.inquiry.id}`))]);
  const open = o.status !== "cancelled";
  const canMove = can(me.role, "orders.update") && open;
  const canPay = can(me.role, "payments.record") && open;
  const canManage = can(me.role, "orders.manage");
  const now = today();
  const st = PAY_STATUS[o.money.status] ?? { label: o.money.status, tone: "neutral" as const };
  const name = (uid: string | null) => (uid ? (deal?.people[uid] ?? "Someone") : "System");
  const incoterm = `${o.incoterm}${o.incotermPlace ? ` ${o.incotermPlace}` : ""}`;
  const balance = BALANCE_TERMS_LABEL[o.balanceTerms];
  const terms = o.depositPercent > 0 ? `${o.depositPercent}% deposit, ${balance.charAt(0).toLowerCase()}${balance.slice(1)}` : balance;
  // Goods from the factory and the packing list (goods lines only; charges are not shipped).
  const goods: GoodsLine[] = o.lines
    .filter((l) => l.type === "goods")
    .map((l) => ({ id: l.id, description: l.description, model: l.model, quantity: l.quantity, unit: l.unit, factory: l.factory?.name ?? null, receivedQty: l.receivedQty, receivedOn: l.receivedOn ? date(l.receivedOn) : null, packing: l.packing }));
  const showPacking = goods.length > 0 && (o.goods.allReceived || o.stage !== "confirmed");
  const packingDoc = docHref(o, { kind: "packing-list", label: "Packing list" });

  return (
    <div>
      <PageHeader
        backHref="/orders"
        backLabel="Orders"
        title={
          <span className="flex flex-wrap items-center gap-2">
            {o.refNo} <OrderStageBadge stage={o.stage} />
            {!open && <Badge tone="bad">Cancelled</Badge>}
          </span>
        }
        description={
          <>
            <Link href={`/customers/${o.customer.id}`} className="font-medium text-text hover:underline">
              {o.customer.name}
            </Link>{" "}
            · deal{" "}
            <Link href={`/deals/${o.inquiry.id}`} className="hover:underline">
              {o.inquiry.refNo}
            </Link>{" "}
            · {o.inquiry.title}
            {o.inquiry.assignee && <> · handled by {o.inquiry.assignee.name}</>}
          </>
        }
      />

      {o.cancelled && (
        <div role="status" className="mb-5 rounded-xl border border-bad/25 bg-bad-soft p-4 text-sm">
          <p className="font-medium">This order was cancelled{o.cancelled.at ? ` on ${date(o.cancelled.at)}` : ""}.</p>
          {o.cancelled.reason && <p className="mt-0.5 text-text-2">{o.cancelled.reason}</p>}
          <p className="mt-1 text-muted">The deal can be reopened and quoted again. Money already received stays recorded here.</p>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHeader title="Where it is" description={ORDER_STAGE_HINT[o.stage]} />
            <CardBody className="flex flex-col gap-4">
              <StageBar o={o} />
              {o.needs && (
                <p className={cn("flex items-start gap-2 rounded-lg px-3 py-2 text-sm", o.needs.late ? "bg-bad-soft text-bad" : "bg-surface-2 text-text")}>
                  {o.needs.late ? <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> : <ArrowRight className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />}
                  <span>
                    <span className="font-medium">Now: {o.needs.title}</span>
                    <span className="block text-xs">{o.needs.late ? `Late — was due ${date(o.needs.due)}` : `By ${date(o.needs.due)}`}</span>
                  </span>
                </p>
              )}
              {o.stage === "done" && <p className="text-sm text-muted">Closed. Nothing more to do on this order.</p>}
              {canMove ? (
                <StageActions key={o.stage} next={o.next} back={o.back} action={moveStageAction.bind(null, o.id)} today={now} readyOn={o.readyOn} shippedOn={o.shippedOn} blNo={o.blNo} />
              ) : (
                open && o.next && <p className="text-sm text-muted">The person handling the deal moves this order on.</p>
              )}
            </CardBody>
          </Card>

          {goods.length > 0 && (
            <Card>
              <CardHeader
                title="Goods from the factory"
                description={o.goods.allReceived ? "Everything has come in." : `${o.goods.received} of ${o.goods.lines} item${o.goods.lines === 1 ? "" : "s"} complete. Record what comes in as it arrives.`}
                actions={o.goods.allReceived ? <Badge tone="ok">All in</Badge> : undefined}
              />
              <CardBody>
                <GoodsReceipt key={goods.map((l) => l.receivedQty).join()} lines={goods} canEdit={canMove} action={receiptAction.bind(null, o.id)} today={now} />
              </CardBody>
            </Card>
          )}

          {showPacking && (
            <Card>
              <CardHeader
                title="Packing list"
                description={o.goods.packed ? undefined : "Packages, weights and volume for each line, before shipping."}
                actions={o.goods.packed ? undefined : <Badge tone="warn">Not made yet</Badge>}
              />
              <CardBody>
                <PackingList
                  lines={goods}
                  containerNo={o.goods.containerNo}
                  shippingMarks={o.goods.shippingMarks}
                  packed={o.goods.packed}
                  totals={o.goods.totals}
                  canEdit={canMove}
                  action={packingAction.bind(null, o.id)}
                  links={packingDoc}
                />
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Money" description={`In ${o.currency}. Bank charges the banks deducted count as paid.`} actions={<Badge tone={st.tone}>{st.label}</Badge>} />
            <CardBody className="flex flex-col gap-4">
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                {[
                  { label: "Order total", value: money(o.money.total, o.currency) },
                  {
                    label: o.depositPercent > 0 ? `Deposit (${o.depositPercent}%)` : "Deposit",
                    value: o.depositPercent > 0 ? money(o.money.deposit, o.currency) : "None",
                    hint: o.depositPercent > 0 ? (Number(o.money.depositDue) > 0 ? `${money(o.money.depositDue, o.currency)} still missing` : "Received") : undefined,
                    warn: Number(o.money.depositDue) > 0,
                  },
                  { label: "Received", value: money(o.money.received, o.currency), hint: Number(o.money.bankCharges) ? `incl. ${money(o.money.bankCharges, o.currency)} bank charges` : undefined },
                  { label: "Still due", value: money(o.money.due, o.currency), strong: Number(o.money.due) > 0 },
                ].map((x) => (
                  <div key={x.label} className="min-w-0 rounded-lg border border-line p-3">
                    <dt className="text-xs text-muted">{x.label}</dt>
                    <dd className={cn("mt-0.5 font-semibold tabular", x.strong && "text-text")}>{x.value}</dd>
                    {x.hint && <dd className={cn("text-xs", x.warn ? "text-warn" : "text-muted")}>{x.hint}</dd>}
                  </div>
                ))}
              </dl>

              {p.payments.length === 0 ? (
                <p className="text-sm text-muted">No payments yet. {canPay ? "Record the deposit when it reaches the bank." : "Accounts records payments when they reach the bank."}</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line rounded-lg border border-line" aria-label="Payments">
                  {p.payments.map((x) => (
                    <li key={x.id} className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-3 py-2.5 text-sm", x.voided && "text-muted")}>
                      <div className="min-w-0">
                        <p>
                          <span className={cn("font-medium tabular", x.voided && "line-through")}>{money(x.amount, x.currency)}</span>{" "}
                          <span className="text-text-2">{PAYMENT_KIND_LABEL[x.kind]}</span>
                          {Number(x.bankCharges) > 0 && <span className={cn("text-xs text-muted", x.voided && "line-through")}> + {money(x.bankCharges, x.currency)} bank charges</span>}
                        </p>
                        <p className="text-xs text-muted">
                          {date(x.paidOn)} · {PAYMENT_METHOD_LABEL[x.method]}
                          {x.reference && ` · ${x.reference}`}
                        </p>
                        {x.note && <p className="text-xs text-text-2">{x.note}</p>}
                        {x.voided && (
                          <p className="text-xs">
                            <Badge tone="bad">Removed</Badge> {x.voided.reason}
                          </p>
                        )}
                      </div>
                      {canManage && !x.voided && (
                        <div className="w-full sm:w-auto">
                          <VoidPayment action={voidPaymentAction.bind(null, o.id, x.id)} />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {canPay && <PaymentForm action={paymentAction.bind(null, o.id, o.currency)} currency={o.currency} depositDue={p.depositDue} due={p.due} today={now} />}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Documents" description="Made from the order whenever you open them, so they are always up to date." />
            <ul className="flex flex-col divide-y divide-line">
              {o.documents.map((d) => {
                const h = docHref(o, d);
                return (
                  <li key={d.kind} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <span className="flex flex-col">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        <FileText className="size-4 text-muted" aria-hidden /> {d.label}
                      </span>
                      {d.kind !== "packing-list" && (
                        <a href={`${h.pdf}${h.pdf.includes("?") ? "&" : "?"}copy=internal`} className="ml-6 text-xs text-muted underline-offset-2 hover:text-primary hover:underline">
                          Internal copy (all prices, costs, payments)
                        </a>
                      )}
                    </span>
                    <span className="flex flex-wrap gap-2">
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
              <CardHeader title="Notes and files" description={`Shared with deal ${deal.refNo}`} />
              <CardBody className="flex flex-col gap-4">
                <NoteForm action={orderNoteAction.bind(null, o.id, deal.id)} />
                {deal.notes.length > 0 && (
                  <ul className="flex flex-col gap-3">
                    {deal.notes.map((n) => (
                      <li key={n.id} className="rounded-lg border border-line p-3">
                        <p className="text-sm whitespace-pre-line">{n.body}</p>
                        <p className="mt-1 text-xs text-muted">
                          {name(n.authorId)} · {dateTime(n.createdAt)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex flex-col gap-3 border-t border-line pt-4">
                  <UploadForm action={orderUploadAction.bind(null, o.id, deal.id)} />
                  {deal.attachments.length > 0 && (
                    <ul className="divide-y divide-line">
                      {deal.attachments.map((f) => (
                        <li key={f.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-2">
                          <a href={`/files/${f.id}`} className="min-w-0 truncate text-sm font-medium hover:text-primary">
                            {f.fileName}
                          </a>
                          <span className="shrink-0 text-xs text-muted">
                            {size(f.size)} · {name(f.uploadedById)} · {date(f.createdAt)}{" "}
                            {(f.uploadedById === me.id || can(me.role, "inquiries.updateAny")) && <RemoveFile action={orderRemoveFileAction.bind(null, o.id, deal.id, f.id)} name={f.fileName} />}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </CardBody>
            </Card>
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <DetailsForm
                action={detailsAction.bind(null, o.id)}
                canEdit={can(me.role, "orders.update") && open}
                today={now}
                fixed={[
                  { label: "Incoterm", value: incoterm },
                  { label: "Payment terms", value: terms },
                  { label: "Ordered on", value: date(o.orderedOn) },
                ]}
                values={{ shipBy: o.shipBy, readyOn: o.readyOn, shippedOn: o.shippedOn, blNo: o.blNo, documentTitle: o.documentTitle, portOfDischarge: o.portOfDischarge }}
                shown={{
                  shipBy: o.shipBy ? date(o.shipBy) : "Not set",
                  readyOn: o.readyOn ? date(o.readyOn) : "Not known yet",
                  shippedOn: o.shippedOn ? date(o.shippedOn) : "Not shipped",
                  blNo: o.blNo ?? "—",
                }}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Export rebate" />
            <CardBody>
              <RebateCard tax={o.tax} action={orderTaxAction.bind(null, o.id)} canEdit={can(me.role, "orders.update") && open} today={now} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="History" description="Every move, newest first" />
            <CardBody>
              <ol className="flex flex-col gap-3">
                {[...o.history].reverse().map((h) => (
                  <li key={h.id} className="text-sm">
                    <p className="font-medium">{h.from ? `${ORDER_STAGE_LABEL[h.from]} → ${ORDER_STAGE_LABEL[h.to]}` : `Order ${ORDER_STAGE_LABEL[h.to].toLowerCase()}`}</p>
                    {h.confirmed && (
                      <p className="mt-0.5">
                        <Badge tone="warn">
                          <AlertTriangle aria-hidden /> Went ahead despite a warning
                        </Badge>
                      </p>
                    )}
                    {h.note && <p className="text-xs whitespace-pre-line text-text-2">{h.note}</p>}
                    <p className="text-xs text-muted">
                      {h.by?.name ?? "System"} · {dateTime(h.at)}
                    </p>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>

          {canManage && open && (
            <Card>
              <CardHeader title="Cancel the order" description="Only if the customer called it off. The deal becomes lost and can be reopened." />
              <CardBody>
                <CancelOrderForm action={cancelOrderAction.bind(null, o.id)} />
              </CardBody>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
