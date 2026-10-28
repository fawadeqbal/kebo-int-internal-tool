import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, FileText, XCircle } from "lucide-react";
import { can } from "@kebo/shared";
import { Badge, buttonClass, cn, OrderStageBadge, PageHeader } from "@kebo/ui";
import { requireUser } from "@/lib/session";
import { orderMoneyOf, orderOf, orderPaymentsOf } from "@/lib/order-data";
import { date, money } from "@/lib/format";
import { today } from "@/components/orders/today";
import { orderProgress } from "@/components/orders/progress";
import { OrderStepper } from "@/components/orders/order-progress";
import { OrderTabs, ScrolledBar, type OrderTabLink } from "@/components/orders/order-tabs";
import { moveStageAction } from "../actions";
import { StageActions } from "./forms";

/**
 * Every tab of an order shares a short top, so the tabs stay in view: who and
 * what with the money beside it, then one box with the four stages on a line
 * and what is needed now with its buttons. The checks of each stage are on the
 * Overview tab; the tabs hold the work itself.
 */
export default async function OrderLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const o = await orderOf(id);
  const [p, m] = await Promise.all([orderPaymentsOf(id), orderMoneyOf(id)]);
  const base = `/orders/${o.id}`;
  const open = o.status !== "cancelled";
  const canMove = can(me, "orders.update") && open;
  const now = today();
  const stages = orderProgress(o, p, m.factories?.rows ?? null);
  const nowCheck = stages.flatMap((s) => s.checkpoints).find((c) => c.state === "now" || c.state === "late") ?? null;
  const finished = o.status === "closed" && !o.needs;
  const late = !!o.needs?.late;
  const due = Number(o.money.due);
  const short = o.goods.lines - o.goods.received;
  const latePlan = m.plan.items.some((i) => i.status === "late");

  const tabs: OrderTabLink[] = [
    { href: base, label: "Overview" },
    ...(o.goods.lines > 0
      ? [
          {
            href: `${base}/goods`,
            label: "Goods and packing",
            hint: short > 0 ? `${short} short` : !o.goods.packed && o.stage === "in_production" ? "not packed" : undefined,
            alert: short > 0 && nowCheck?.key === "goods" && late,
          },
        ]
      : []),
    { href: `${base}/money`, label: "Money", hint: due > 0.005 ? `${money(o.money.due, o.currency)} due` : undefined, alert: latePlan },
    { href: `${base}/documents`, label: "Documents", hint: o.proforma ? undefined : "proforma not issued" },
    { href: `${base}/history`, label: "History" },
  ];

  const stageActions = canMove ? (
    <StageActions key={o.stage} next={o.next} back={o.back} action={moveStageAction.bind(null, o.id)} today={now} readyOn={o.readyOn} shippedOn={o.shippedOn} blNo={o.blNo} />
  ) : null;
  // What is needed now, joined under the stages (red when late).
  const nowBar = o.needs ? (
    <div
      aria-label="What is needed now"
      role="group"
      className={cn("flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between", late ? "border-bad/25 bg-bad-soft" : "border-primary/15 bg-primary-soft/50")}
    >
      <p className={cn("flex min-w-0 flex-1 items-start gap-2 text-sm", late && "text-bad")}>
        {late ? <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> : <ArrowRight className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />}
        <span>
          <span className="font-semibold">Next: {o.needs.title}</span>{" "}
          <span className={cn("text-sm", late ? "" : "text-text-2")}>{late ? `· late, was due ${date(o.needs.due)}` : `· by ${date(o.needs.due)}`}</span>
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
        {nowCheck?.action && (
          <Link href={nowCheck.tab ? `${base}/${nowCheck.tab}` : base} className={buttonClass("secondary", "sm")}>
            {nowCheck.action}
          </Link>
        )}
        {stageActions ?? (open && o.next && <p className="text-xs text-muted">The person handling the deal moves this order on.</p>)}
      </div>
    </div>
  ) : stageActions && o.next ? (
    <div aria-label="What is needed now" role="group" className="flex flex-wrap items-center justify-between gap-3 border-t border-primary/15 bg-primary-soft/50 px-4 py-3">
      <p className="text-sm font-medium">Ready for the next step.</p>
      {stageActions}
    </div>
  ) : null;

  const numbers = [
    { label: "Order total", value: money(o.money.total, o.currency) },
    { label: "Received", value: money(o.money.received, o.currency) },
    { label: "Still due", value: money(o.money.due, o.currency), tone: due > 0.005 ? "text-warn" : "text-ok" },
  ];
  const shipLate = !o.shippedOn && !!o.shipBy && o.shipBy < now;

  return (
    <div>
      <ScrolledBar
        bar={
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
            <span className="flex items-center gap-2 font-medium">
              {o.refNo} <OrderStageBadge stage={o.stage} /> <span className="hidden font-normal text-muted sm:inline">{o.customer.name}</span>
            </span>
            {o.needs && (
              <span className={cn("truncate text-xs", late ? "text-bad" : "text-text-2")}>
                Now: {o.needs.title}
                {late ? " · late" : ` · by ${date(o.needs.due)}`}
              </span>
            )}
          </div>
        }
      >
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
              · {o.inquiry.title} ·{" "}
              <Link href={`/deals/${o.inquiry.id}`} className="hover:underline">
                deal {o.inquiry.refNo}
              </Link>
              {o.proforma && <> · PI {o.proforma.number}</>}
              {o.inquiry.assignee && <> · handled by {o.inquiry.assignee.name}</>}
              {" · "}
              <span className={cn(shipLate && "font-medium text-bad")}>
                {o.shippedOn ? `shipped ${date(o.shippedOn)}` : o.shipBy ? `ship by ${date(o.shipBy)}${shipLate ? " (late)" : ""}` : "ship date not set"}
              </span>
            </>
          }
          actions={
            <>
              {/* The money beside the title on a wide screen; under it (three tiles) on smaller ones. */}
              <dl className="hidden gap-6 xl:flex">
                {numbers.map((n) => (
                  <div key={n.label} className="min-w-0">
                    <dt className="text-xs text-muted">{n.label}</dt>
                    <dd className={cn("font-semibold whitespace-nowrap tabular", n.tone)}>{n.value}</dd>
                  </div>
                ))}
              </dl>
              <Link href={`${base}/documents`} className={buttonClass("secondary", "sm")}>
                <FileText aria-hidden /> Documents
              </Link>
            </>
          }
        >
          <dl className="mt-3 grid grid-cols-3 gap-2 sm:max-w-xl xl:hidden">
            {numbers.map((n, i) => (
              <div key={n.label} className="min-w-0 rounded-lg border border-line bg-surface px-2.5 py-1.5">
                {/* The currency once, in the first label, so the amounts fit a phone. */}
                <dt className="truncate text-xs text-muted">
                  {i === 0 ? `Total (${o.currency})` : n.label}
                </dt>
                <dd className={cn("truncate text-sm font-semibold tabular", n.tone)}>{n.value.replace(/^[A-Z]{3}\s+/, "")}</dd>
              </div>
            ))}
          </dl>
        </PageHeader>

        {o.cancelled ? (
          <div role="status" className="flex items-start gap-2 rounded-xl border border-bad/25 bg-bad-soft p-4 text-sm">
            <XCircle className="mt-0.5 size-4 shrink-0 text-bad" aria-hidden />
            <div>
              <p className="font-medium">Cancelled{o.cancelled.at ? ` on ${date(o.cancelled.at)}` : ""}.</p>
              {o.cancelled.reason && <p className="mt-0.5 text-text-2">{o.cancelled.reason}</p>}
              <p className="mt-1 text-muted">The deal can be reopened and quoted again. Money already received stays recorded here.</p>
            </div>
          </div>
        ) : (
          <section aria-label="Where the order is" className="overflow-hidden rounded-xl border border-line bg-surface">
            <div className="px-4 py-3">
              <OrderStepper stages={stages} />
            </div>
            {finished ? (
              <p className="flex items-center gap-2 border-t border-ok/25 bg-ok-soft px-4 py-3 text-sm">
                <CheckCircle2 className="size-4 shrink-0 text-ok" aria-hidden />
                <span className="font-medium">Done: paid in full and closed.</span>
              </p>
            ) : (
              nowBar
            )}
          </section>
        )}
      </ScrolledBar>

      <OrderTabs base={base} tabs={tabs} />
      <div className="mt-5">{children}</div>
    </div>
  );
}
