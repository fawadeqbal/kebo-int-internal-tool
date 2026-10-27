import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, FileText, XCircle } from "lucide-react";
import { can } from "@kebo/shared";
import { Badge, buttonClass, cn, OrderStageBadge, PageHeader } from "@kebo/ui";
import { requireUser } from "@/lib/session";
import { orderMoneyOf, orderOf, orderPaymentsOf } from "@/lib/order-data";
import { date, money } from "@/lib/format";
import { today } from "@/components/orders/today";
import { orderProgress } from "@/components/orders/progress";
import { OrderProgress } from "@/components/orders/order-progress";
import { OrderTabs, ScrolledBar, type OrderTabLink } from "@/components/orders/order-tabs";
import { moveStageAction } from "../actions";
import { StageActions } from "./forms";

/**
 * Every tab of an order shares its top: who and what, the four stages with
 * their checkpoints, what is needed now with the button that does it, and the
 * money in four numbers. The tabs below hold the work itself.
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

  const nowBar = o.needs ? (
    <section
      aria-label="What is needed now"
      className={cn("flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-start sm:justify-between", late ? "border-bad/30 bg-bad-soft" : "border-primary/25 bg-primary-soft/40")}
    >
      <p className={cn("flex items-start gap-2 text-sm", late && "text-bad")}>
        {late ? <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> : <ArrowRight className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />}
        <span>
          <span className="font-medium">Now: {o.needs.title}</span>
          <span className="block text-xs">{late ? `Late: was due ${date(o.needs.due)}` : `By ${date(o.needs.due)}`}</span>
        </span>
      </p>
      <div className="flex flex-wrap items-start gap-2">
        {nowCheck?.action && (
          <Link href={nowCheck.tab ? `${base}/${nowCheck.tab}` : base} className={buttonClass("secondary", "sm")}>
            {nowCheck.action}
          </Link>
        )}
        {canMove ? (
          <StageActions
            key={o.stage}
            next={o.next}
            back={o.back}
            action={moveStageAction.bind(null, o.id)}
            today={now}
            readyOn={o.readyOn}
            shippedOn={o.shippedOn}
            blNo={o.blNo}
          />
        ) : (
          open && o.next && <p className="text-xs text-muted">The person handling the deal moves this order on.</p>
        )}
      </div>
    </section>
  ) : canMove && o.next ? (
    <section aria-label="What is needed now" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/25 bg-primary-soft/40 p-3">
      <p className="text-sm font-medium">Ready for the next step.</p>
      <StageActions key={o.stage} next={o.next} back={o.back} action={moveStageAction.bind(null, o.id)} today={now} readyOn={o.readyOn} shippedOn={o.shippedOn} blNo={o.blNo} />
    </section>
  ) : null;

  const numbers = [
    { label: "Order total", value: money(o.money.total, o.currency) },
    { label: "Received", value: money(o.money.received, o.currency) },
    { label: "Still due", value: money(o.money.due, o.currency), tone: due > 0.005 ? "text-warn" : "text-ok" },
    {
      label: o.shippedOn ? "Shipped" : "Ship by",
      value: o.shippedOn ? date(o.shippedOn) : o.shipBy ? date(o.shipBy) : "Not set",
      tone: !o.shippedOn && o.shipBy && o.shipBy < now ? "text-bad" : undefined,
    },
  ];

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
              · deal{" "}
              <Link href={`/deals/${o.inquiry.id}`} className="hover:underline">
                {o.inquiry.refNo}
              </Link>{" "}
              · {o.inquiry.title}
              {o.inquiry.assignee && <> · handled by {o.inquiry.assignee.name}</>}
              {o.proforma && <> · PI {o.proforma.number}</>}
            </>
          }
          actions={
            <Link href={`${base}/documents`} className={buttonClass("secondary", "sm")}>
              <FileText aria-hidden /> Documents
            </Link>
          }
        />

        <div className="flex flex-col gap-3">
          {o.cancelled ? (
            <div role="status" className="flex items-start gap-2 rounded-xl border border-bad/25 bg-bad-soft p-4 text-sm">
              <XCircle className="mt-0.5 size-4 shrink-0 text-bad" aria-hidden />
              <div>
                <p className="font-medium">Cancelled{o.cancelled.at ? ` on ${date(o.cancelled.at)}` : ""}.</p>
                {o.cancelled.reason && <p className="mt-0.5 text-text-2">{o.cancelled.reason}</p>}
                <p className="mt-1 text-muted">The deal can be reopened and quoted again. Money already received stays recorded here.</p>
              </div>
            </div>
          ) : finished ? (
            <details className="group rounded-xl border border-ok/30 bg-ok-soft">
              <summary className="flex cursor-pointer list-none items-center gap-2 p-3 text-sm">
                <CheckCircle2 className="size-4 shrink-0 text-ok" aria-hidden />
                <span className="font-medium">Done: paid in full and closed.</span>
                <span className="ml-auto text-xs text-muted group-open:hidden">Show the steps</span>
              </summary>
              <div className="border-t border-ok/20 p-3">
                <OrderProgress stages={stages} base={base} />
              </div>
            </details>
          ) : (
            <OrderProgress stages={stages} base={base} />
          )}

          {open && nowBar}

          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {numbers.map((n) => (
              <div key={n.label} className="min-w-0 rounded-lg border border-line bg-surface px-3 py-2">
                <dt className="text-xs text-muted">{n.label}</dt>
                <dd className={cn("truncate font-semibold tabular", n.tone)}>{n.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </ScrolledBar>

      <OrderTabs base={base} tabs={tabs} />
      <div className="mt-5">{children}</div>
    </div>
  );
}
