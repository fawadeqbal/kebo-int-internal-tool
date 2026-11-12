import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { can, orderProgress, shipByVsLc, STEP_PATH, type PaymentRoute } from "@kebo/shared";
import { Avatar, Card, CardBody, CardHeader, cn, StatRow, StatTile, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { orderFilesOf, orderFlowOf, orderHistoryOf, orderMoneyOf, orderOf, orderStepsOf } from "@/lib/order-data";
import { date, money, whole } from "@/lib/format";
import { QuickNote } from "@/components/notes/note-forms";
import { addNoteAction } from "@/app/(app)/follow-ups/actions";
import type { DealDetail } from "@/lib/types";
import { optional } from "@/components/print/data";
import { today } from "@/components/orders/today";
import { orderCostsSetup } from "@/components/orders/costs-data";
import { overviewFacts } from "@/components/orders/overview";
import { LinkedDocuments } from "@/components/orders/overview-record";
import { KeyDates, OrderPeople } from "@/components/orders/order-facts";
import { SideFileRow, SidePanelCard, SideSection } from "@/components/orders/side-panel-parts";
import { UploadButton } from "@/components/files/files-list";
import { detailsAction } from "../actions";
import { DetailsCard } from "./forms";
import { incotermOf, termsOf } from "./shared";
import { stageTool } from "./close-tool";

const ROUTE_WORD: Record<PaymentRoute, string> = { informal: "Bank transfer (informal)", bank_contract: "Bank contract", letter_of_credit: "Letter of credit" };
const BALANCE_SHORT: Record<string, string> = {
  before_shipment: "before shipping",
  against_bl_copy: "vs B/L copy",
  after_arrival: "after arrival",
  letter_of_credit: "by the LC",
};

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const o = await orderOf(id);
  return { title: `Order ${o.refNo}` };
}

/**
 * The order's Overview (board: Order — Overview): the one thing to do now; the order (customer, terms,
 * dates, editable) and its items; beside them the money and the latest activity. The payment plan is on
 * Payment, the factory on Factory, every change on History.
 */
export default async function OrderOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const o = await orderOf(id);
  const [steps, m, flow, deal, costs, history, pos, files] = await Promise.all([
    orderStepsOf(id),
    optional(() => orderMoneyOf(id)),
    optional(() => orderFlowOf(id)),
    optional(() => api.get<DealDetail>(`/inquiries/${o.inquiry.id}`)),
    orderCostsSetup(id).then((x) => x?.costs ?? null),
    optional(() => orderHistoryOf(id, undefined, 5)),
    optional(() => api.get<{ items: { number: string; total: string | null; currency: string | null }[] }>(`/orders/${id}/purchase-orders`)),
    optional(() => orderFilesOf(id)),
  ]);
  // The purchase orders' total in their currency ("CNY 292,860"), for those who see factory prices.
  const poCur = pos?.items.find((p) => p.currency)?.currency;
  const poSum = (pos?.items ?? []).reduce((t, p) => t + Number(p.total ?? 0), 0);
  const poTotal = poCur && poSum > 0 && (pos?.items ?? []).every((p) => !p.currency || p.currency === poCur) ? whole(poSum, poCur) : null;
  const base = `/orders/${o.id}`;
  const progress = orderProgress(steps.items, steps.steps.map((s) => s.key));
  // The first open item is "Do next" (on top of every page); the rest are listed here.
  const also = progress.open.slice(1, 7);
  const open = o.status !== "cancelled";
  const now = today();
  const doNow = steps.doNow;
  const finished = o.status === "closed" && !doNow;
  const f = overviewFacts({ o, steps, flow, m, costs, deal, now });
  // Shipped on, the B/L and the container are Shipment 1's: edited on Shipping when the company has the module.
  const onShipping = flow?.modules.shipping ?? true;
  const lcLatest = flow?.payment.route === "letter_of_credit" ? (flow.payment.bankContract?.latestShipOn ?? null) : null;
  // Every step done (board OrderDone): ready to close, or closed.
  const allDone = open && !doNow && (o.next?.to === "done" || o.stage === "done");
  const closeTool = allDone ? stageTool(me, o, "done", now) : null;
  const openClaims = flow?.delivery?.claims.filter((c) => c.status === "open" || c.status === "with_factory").length ?? 0;
  const satOn = flow?.delivery?.satDoneOn ?? flow?.delivery?.deliveredOn ?? null;
  // Where this order came from and what it led to.
  const linked = [
    { kind: "Inquiry", label: o.inquiry.refNo, href: `/inquiries/${o.inquiry.id}` },
    ...(o.quotation ? [{ kind: "Quotation", label: `${o.quotation.refNo} R${o.quotation.number}`, href: `/inquiries/${o.inquiry.id}/quotation` }] : []),
    ...(pos?.items ?? []).map((x) => ({ kind: "Purchase order", label: x.number, href: `${base}/factory` })),
    { kind: "Payments", label: m ? `${money(m.received, m.currency)} in` : "View", href: `/payments?order=${o.id}` },
  ];
  const days = o.orderedOn ? Math.round((Date.parse(satOn ?? now) - Date.parse(o.orderedOn)) / 86_400_000) : null;
  /** "+ USD 400" over the plan, "– USD 400" under it. */
  const diff = (n: number) => (!costs || Math.abs(n) < 0.5 ? "—" : `${n > 0 ? "+" : "–"} ${whole(Math.abs(n), costs.currency)}`);


  return (
    <div className="flex flex-col gap-4">
      {allDone ? (
        <>
          <section
            aria-label="All steps done"
            className="flex flex-col gap-3 rounded-2xl border border-ok/25 bg-ok-soft px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <p>
              <strong className="block font-bold text-ok">
                All steps done. {Number(o.money.due) > 0 ? `${money(o.money.due, o.currency)} still to come.` : "Paid in full."}
              </strong>
              <span className="block text-sm text-text-2">
                {finished
                  ? "The order is closed."
                  : openClaims
                    ? `${openClaims === 1 ? "One claim is" : `${openClaims} claims are`} still with the factory. You can close now and keep the claim open.`
                    : "Close the order to finish it."}
              </span>
            </p>
            {closeTool}
          </section>
          {costs?.profit && (
            <StatRow>
              <StatTile label="Sale" value={whole(costs.profit.sale, costs.currency)} />
              <StatTile label="Cost" value={whole(Number(costs.profit.sale) - Number(costs.profit.expected), costs.currency)} />
              <StatTile
                label="Profit"
                value={whole(costs.profit.expected, costs.currency)}
                sub={[costs.profit.margin !== null ? `${costs.profit.margin.toFixed(1)}%` : null, costs.profit.onQuoteMargin !== null ? `planned ${costs.profit.onQuoteMargin.toFixed(1)}%` : null].filter(Boolean).join(" · ")}
                tone={Number(costs.profit.expected) < 0 ? "bad" : "ok"}
              />
              <StatTile label="Days" value={days ?? "—"} sub={flow?.delivery?.satDoneOn ? "order → SAT" : satOn ? "order → delivery" : "order → today"} />
            </StatRow>
          )}
          {costs?.profit && (
            <Card className="p-0">
              <CardHeader title="Planned vs actual" />
              <Table>
                <THead>
                  <tr>
                    <Th />
                    <Th className="text-right">Planned</Th>
                    <Th className="text-right">Actual</Th>
                    <Th className="text-right">Difference</Th>
                  </tr>
                </THead>
                <tbody>
                  {costs.planned.filter((r) => r.planned !== null).map((r) => (
                    <Tr key={r.key}>
                      <Td>{r.label}</Td>
                      <Td className="text-right tabular">{r.planned === null ? "—" : whole(r.planned, costs.currency)}</Td>
                      <Td className="text-right tabular">{whole(r.spent, costs.currency)}</Td>
                      <Td className="text-right tabular">{diff(r.planned === null ? 0 : Number(r.spent) - Number(r.planned))}</Td>
                    </Tr>
                  ))}
                  <Tr>
                    <Td>Other costs</Td>
                    <Td className="text-right tabular">—</Td>
                    <Td className="text-right tabular">{Number(costs.profit.notPlanned) ? whole(costs.profit.notPlanned, costs.currency) : "—"}</Td>
                    <Td className="text-right tabular">{diff(Number(costs.profit.notPlanned))}</Td>
                  </Tr>
                  <Tr className="border-t-2 border-line font-semibold">
                    <Td>Profit</Td>
                    <Td className="text-right tabular">{whole(costs.profit.onQuote, costs.currency)}</Td>
                    <Td className="text-right tabular">{whole(costs.profit.expected, costs.currency)}</Td>
                    <Td className="text-right tabular">{diff(Number(costs.profit.expected) - Number(costs.profit.onQuote))}</Td>
                  </Tr>
                </tbody>
              </Table>
            </Card>
          )}
        </>
      ) : null}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          {/* What else can be done today, from every step ("Do next" above is the first). */}
          {open && also.length > 0 && (
            <Card className="overflow-hidden">
              <CardHeader
                title="Also open now"
                actions={
                  progress.waiting.length > 0 ? (
                    <span className="text-[13px] text-text-2">
                      {progress.waiting.length} waiting · {steps.items.filter((i) => i.done || i.skipped).length} done
                    </span>
                  ) : undefined
                }
              />
              <ul className="flex flex-col divide-y divide-line">
                {also.map((i) => (
                  <li key={i.id ?? i.key ?? i.title} className="flex flex-wrap items-center gap-x-4 gap-y-0.5 px-4 py-2.5 text-[13px]">
                    <span className="min-w-0 flex-1 basis-56">
                      <span className="font-semibold">{i.title}</span>{" "}
                      <span className="text-text-2">· {steps.steps.find((x) => x.key === i.step)?.label}</span>
                      {i.needs && <span className="block text-xs text-text-2">Needs {i.needs}</span>}
                    </span>
                    <span className={cn("w-24 tabular", i.late ? "font-semibold text-bad" : "text-text-2")}>
                      {i.dueOn ? `${i.late ? "was " : ""}${date(i.dueOn)}` : ""}
                    </span>
                    <span className="w-24 truncate text-text-2">{i.assignee?.name ?? ""}</span>
                    <Link href={`${base}/${STEP_PATH[i.step]}#todo`} className="font-semibold text-primary hover:underline">
                      Open
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {/* The order: customer, terms, route, supplier, dates; Edit opens every field. */}
          <DetailsCard
            action={detailsAction.bind(null, o.id)}
            canEdit={can(me, "orders.update") && open}
            today={now}
            compact
            fixed={[
              {
                label: "Customer",
                value: (
                  <>
                    <Link href={`/customers/${o.customer.id}`} className="text-primary underline underline-offset-2 hover:opacity-80">
                      {o.customer.name}
                    </Link>
                    {o.contactName ? ` · ${o.contactName}` : ""}
                  </>
                ),
              },
              { label: "Their PO", value: o.customerRef ?? null },
              {
                label: "Accepted",
                value: o.quotation?.acceptedOn
                  ? `${date(o.quotation.acceptedOn)}${o.quotation.option ? ` · Option ${o.quotation.option}` : ""}`
                  : date(o.orderedOn),
              },
              { label: "Incoterm", value: incotermOf(o) },
              { label: "Payment", value: termsOf(o) },
              { label: "Route", value: flow?.payment.route ? ROUTE_WORD[flow.payment.route] : null },
              { label: "Supplier", value: [...new Set(o.lines.map((l) => l.factory?.name).filter(Boolean))].join(", ") || "—" },
            ]}
            after={o.quotation?.deliveryTerms ? [{ label: "Delivery terms", value: o.quotation.deliveryTerms }] : []}
            values={{
              shipBy: o.shipBy,
              readyOn: o.readyOn,
              shippedOn: o.shippedOn,
              blNo: o.blNo,
              containerNo: o.goods.containerNo,
              documentTitle: o.documentTitle,
              portOfDischarge: o.portOfDischarge,
            }}
            readyEach={
              (o.readyBy ?? []).filter((r) => r.factoryId).length > 1
                ? { count: (o.readyBy ?? []).filter((r) => r.factoryId).length, href: `/orders/${o.id}/factory#factory` }
                : null
            }
            shown={{
              shipBy: o.shipBy ? date(o.shipBy) : null,
              readyOn: o.readyOn ? date(o.readyOn) : null,
              shippedOn: o.shippedOn ? date(o.shippedOn) : null,
              blNo: o.blNo,
            }}
            shipment={{
              onShipping,
              label: "Shipment 1",
              href: `${base}/shipping#goto=shipment.departedOn,shipment.blNo,shipment.containerNo`,
            }}
            lc={lcLatest ? { latest: date(lcLatest), late: !!shipByVsLc(o.shipBy, lcLatest)?.late } : null}
            suggestShipBy={o.shipBySuggested ? { on: o.shipBySuggested, shown: date(o.shipBySuggested) } : null}
          />

          {/* Items (board): the order's lines and the total. */}
          <Card className="overflow-hidden">
            <CardHeader
              title="Items"
              actions={
                <Link href={`${base}/items`} className="text-[13px] font-semibold text-primary hover:underline">
                  All lines
                </Link>
              }
            />
            <Table>
              <THead>
                <tr>
                  <Th>Item</Th>
                  <Th className="text-right">Qty</Th>
                  <Th className="text-right">Price</Th>
                  <Th className="text-right">Amount</Th>
                </tr>
              </THead>
              <tbody>
                {o.lines.map((l) => (
                  <Tr key={l.id}>
                    <Td>
                      <span className="font-semibold">{l.description}</span>
                      {l.no.includes(".") && <span className="block text-xs text-muted">part of {l.no.split(".")[0]}</span>}
                    </Td>
                    <Td className="text-right whitespace-nowrap tabular">
                      {Number(l.quantity).toLocaleString("en-US")} {l.unit}
                    </Td>
                    <Td className="text-right whitespace-nowrap tabular">{money(l.unitPrice, o.currency)}</Td>
                    <Td className="text-right whitespace-nowrap tabular">{money(l.lineTotal, o.currency)}</Td>
                  </Tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line-strong bg-[#f8faf9] font-bold dark:bg-surface-2">
                  <td className="px-3.5 py-3" colSpan={3}>
                    Total {o.currency}
                  </td>
                  <td className="px-3.5 py-3 text-right tabular">{money(o.total, o.currency)}</td>
                </tr>
              </tfoot>
            </Table>
          </Card>
        </div>

        <aside aria-label="Beside the order" className="flex min-w-0 flex-col gap-4">
          <SidePanelCard>
            <KeyDates o={o} flow={flow} now={now} />
            <OrderPeople o={o} flow={flow} />
            {f.watch.length > 0 && (
              <SideSection title="Keep an eye on">
                {f.watch.map((w, k) => (
                  <li key={k} className="py-1 text-[13px] text-text-2">
                    <b className={cn("font-semibold", w.tone === "bad" ? "text-bad" : w.tone === "warn" ? "text-warn" : "text-text")}>{w.strong}</b> {w.rest}
                  </li>
                ))}
              </SideSection>
            )}
            <SideSection
              title="Files"
              count={files?.files.length ?? 0}
              action={
                files?.canUpload ? (
                  <UploadButton orderId={o.id} step={null} label="Upload" variant="ghost" size="sm" />
                ) : undefined
              }
              empty="None yet. Drop a file anywhere on the order, or upload."
            >
              {(files?.files ?? []).slice(0, 5).map((x) => (
                <SideFileRow key={x.id} file={x} set={files!.files} meta={x.attachedTo.label} />
              ))}
            </SideSection>
          </SidePanelCard>
          {/* Money. */}
          <Card>
            <CardHeader
              title="Money"
              actions={
                <Link href={`${base}/money`} className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary hover:underline">
                  <ArrowRight className="size-3.5" aria-hidden /> Money tab
                </Link>
              }
            />
            <CardBody className="flex flex-col gap-2.5 text-[13px]">
              {(
                [
                  ["Order total", whole(o.money.total, o.currency)],
                  [
                    `Deposit ${o.money.depositPercent}%`,
                    `${whole(o.money.deposit, o.currency)}${Number(o.money.received) >= Number(o.money.deposit) && Number(o.money.deposit) > 0 ? " · received" : Number(o.money.deposit) > 0 ? " · to come" : ""}`,
                  ],
                  ...(o.money.depositPercent < 100
                    ? [[`Balance ${100 - o.money.depositPercent}%`, `${whole(Number(o.money.total) - Number(o.money.deposit), o.currency)} · ${BALANCE_SHORT[o.balanceTerms] ?? "later"}`] as [string, string]]
                    : []),
                  ["They owe", whole(o.money.due, o.currency)],
                  ...(poTotal ? [["Purchase order", poTotal] as [string, string]] : []),
                  ...(f.profit
                    ? [["Planned profit", `${whole(f.profit.expected, o.currency)}${f.profit.margin !== null ? ` · ${f.profit.margin.toFixed(1)}%` : ""}`] as [string, string]]
                    : []),
                ] as [string, string][]
              ).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <span className="text-muted">{k}</span>
                  <strong className="tabular">{v}</strong>
                </div>
              ))}
            </CardBody>
          </Card>

          {/* Activity (board): the latest changes. */}
          <Card>
            <CardHeader
              title="Activity"
              actions={
                <Link href={`${base}/history`} className="text-[13px] font-semibold text-primary hover:underline">
                  History
                </Link>
              }
            />
            <CardBody className="flex flex-col gap-4">
              {open && <QuickNote action={addNoteAction.bind(null, { key: "orderId", id: o.id })} />}
              {history?.length ? (
                <ol className="flex flex-col gap-3">
                  {history.slice(0, 5).map((e) => (
                    <li key={e.id} className="flex gap-2.5">
                      <Avatar name={e.by?.name ?? "System"} size={30} />
                      <span className="min-w-0 text-[13px]">
                        <span className="line-clamp-2">{e.summary ?? e.action}</span>
                        <span className="block text-xs text-muted">
                          {e.by?.name ?? "System"} · {date(e.at)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted">Nothing yet.</p>
              )}
            </CardBody>
          </Card>
          <LinkedDocuments links={linked} />
        </aside>
      </div>
    </div>
  );
}
