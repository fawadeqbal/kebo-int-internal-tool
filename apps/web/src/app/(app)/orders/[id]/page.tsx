import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react";
import { can, shipByVsLc, STEP_PATH } from "@kebo/shared";
import { Avatar, buttonClass, Card, CardBody, CardHeader, cn, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { orderFlowOf, orderHistoryOf, orderMoneyOf, orderOf, orderStepsOf } from "@/lib/order-data";
import { date, money } from "@/lib/format";
import type { DealDetail } from "@/lib/types";
import { optional } from "@/components/print/data";
import { today } from "@/components/orders/today";
import { orderCostsSetup } from "@/components/orders/costs-data";
import { overviewFacts } from "@/components/orders/overview";
import { detailsAction } from "../actions";
import { DetailsCard } from "./forms";
import { incotermOf, termsOf } from "./shared";

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
  const [steps, m, flow, deal, costs, history] = await Promise.all([
    orderStepsOf(id),
    optional(() => orderMoneyOf(id)),
    optional(() => orderFlowOf(id)),
    optional(() => api.get<DealDetail>(`/inquiries/${o.inquiry.id}`)),
    orderCostsSetup(id).then((x) => x?.costs ?? null),
    optional(() => orderHistoryOf(id, undefined, 5)),
  ]);
  const base = `/orders/${o.id}`;
  const open = o.status !== "cancelled";
  const now = today();
  const doNow = steps.doNow;
  const finished = o.status === "closed" && !doNow;
  const f = overviewFacts({ o, steps, flow, m, costs, deal, now });
  // Shipped on, the B/L and the container are Shipment 1's: edited on Shipping when the company has the module.
  const onShipping = flow?.modules.shipping ?? true;
  const lcLatest = flow?.payment.route === "letter_of_credit" ? (flow.payment.bankContract?.latestShipOn ?? null) : null;


  return (
    <div className="flex flex-col gap-4">
      {open && doNow ? (
        <section
          aria-label="Do this now"
          className={cn(
            "flex flex-col gap-3 rounded-2xl border px-5 py-4 sm:flex-row sm:items-center sm:justify-between",
            doNow.late ? "border-[#f3c7c2] bg-bad-soft dark:border-bad/40" : "border-[#f6d3bd] bg-action-soft dark:border-action/30",
          )}
        >
          <p className="flex min-w-0 items-start gap-2">
            {doNow.late && <AlertTriangle className="mt-0.5 size-4 shrink-0 text-bad" aria-hidden />}
            <span>
              <strong className={cn("block font-bold", doNow.late ? "text-bad" : "text-[#8a3a07] dark:text-action")}>Next: {doNow.title}.</strong>
              <span className="block text-sm text-text-2">
                {doNow.dueOn ? `${doNow.late ? "Was due" : "Due"} ${date(doNow.dueOn)}` : doNow.needs ? `Needs ${doNow.needs}` : ""} · {doNow.label}
              </span>
            </span>
          </p>
          <Link href={`${base}/${STEP_PATH[doNow.step]}`} className={buttonClass("primary", "md", "w-fit")}>
            Open {doNow.label} <ArrowRight aria-hidden />
          </Link>
        </section>
      ) : finished ? (
        <p className="flex items-center gap-2 rounded-xl border border-ok/25 bg-ok-soft px-4 py-3 text-sm">
          <CheckCircle2 className="size-4 shrink-0 text-ok" aria-hidden />
          <span className="font-medium">Done: every step is ticked and the order is closed.</span>
        </p>
      ) : null}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          {/* The order (board): customer, terms, route, supplier, dates; Edit opens the same fields as before. */}
          <DetailsCard
            action={detailsAction.bind(null, o.id)}
            canEdit={can(me, "orders.update") && open}
            today={now}
            fixed={[
              { label: "Customer", value: o.customer.name },
              { label: "Incoterm", value: incotermOf(o) },
              { label: "Payment terms", value: termsOf(o) },
              { label: "Ordered on", value: date(o.orderedOn) },
              { label: "Supplier", value: [...new Set(o.lines.map((l) => l.factory?.name).filter(Boolean))].join(", ") || "—" },
            ]}
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
          {/* Money (board). */}
          <Card>
            <CardHeader
              title="Money"
              actions={
                <Link href={`${base}/payment`} className="text-[13px] font-semibold text-primary hover:underline">
                  Payment
                </Link>
              }
            />
            <CardBody className="flex flex-col gap-2.5 text-[13px]">
              {(
                [
                  ["Order total", money(o.money.total, o.currency)],
                  [`Deposit ${o.money.depositPercent}%`, money(o.money.deposit, o.currency)],
                  ["Received", money(o.money.received, o.currency)],
                  ["They owe", money(o.money.due, o.currency)],
                  ...(f.profit ? [["Margin", f.profit.margin !== null ? `${f.profit.margin.toFixed(1)}%` : money(f.profit.expected, o.currency)] as [string, string]] : []),
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
            <CardBody>
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
        </aside>
      </div>
    </div>
  );
}
