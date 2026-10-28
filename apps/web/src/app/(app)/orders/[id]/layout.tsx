import Link from "next/link";
import { AlertTriangle, ArrowRight, XCircle } from "lucide-react";
import { Badge, cn, OrderStageBadge, PageHeader } from "@kebo/ui";
import { requireUser } from "@/lib/session";
import { orderMoneyOf, orderOf } from "@/lib/order-data";
import { date, money } from "@/lib/format";
import { OrderTabs, ScrolledBar, type OrderTabLink } from "@/components/orders/order-tabs";

/**
 * Every tab of an order shares a short top, so the tabs come first: the order
 * number with its step, the customer and the inquiry, and one link to what is
 * needed now. The steps themselves, with their checks and buttons, are on the
 * Overview tab only.
 */
export default async function OrderLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireUser();
  const o = await orderOf(id);
  const m = await orderMoneyOf(id);
  const base = `/orders/${o.id}`;
  const open = o.status !== "cancelled";
  const late = !!o.needs?.late;
  const due = Number(o.money.due);
  const short = o.goods.lines - o.goods.received;
  const latePlan = m.plan.items.some((i) => i.status === "late");

  const tabs: OrderTabLink[] = [
    { href: base, label: "Overview" },
    ...(o.goods.lines > 0
      ? [
          { href: `${base}/goods`, label: "Goods from factory", hint: short > 0 ? `${short} short` : undefined, alert: short > 0 && late && o.stage === "in_production" },
          { href: `${base}/packing`, label: "Packing list", hint: !o.goods.packed && o.stage === "in_production" ? "not made" : undefined },
        ]
      : []),
    { href: `${base}/money`, label: "Payments", hint: due > 0.005 ? `${money(o.money.due, o.currency)} due` : undefined, alert: latePlan },
    { href: `${base}/documents`, label: "Documents", hint: o.proforma ? undefined : "proforma not issued" },
    { href: `${base}/history`, label: "History" },
  ];

  const nextLink = open && o.needs && (
    <Link href={base} className={cn("inline-flex max-w-full items-center gap-1.5 text-sm font-medium hover:underline", late ? "text-bad" : "text-primary")}>
      {late ? <AlertTriangle className="size-4 shrink-0" aria-hidden /> : <ArrowRight className="size-4 shrink-0" aria-hidden />}
      <span className="truncate">
        Next: {o.needs.title}
        {late ? " · late" : ` · by ${date(o.needs.due)}`}
      </span>
    </Link>
  );

  return (
    <div>
      <ScrolledBar
        bar={
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
            <span className="flex items-center gap-2 font-medium">
              {o.refNo} <OrderStageBadge stage={o.stage} /> <span className="hidden font-normal text-muted sm:inline">{o.customer.name}</span>
            </span>
            {o.needs && open && (
              <span className={cn("truncate text-xs", late ? "text-bad" : "text-text-2")}>
                Next: {o.needs.title}
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
              <Link href={`/inquiries/${o.inquiry.id}`} className="hover:underline">
                inquiry {o.inquiry.refNo}
              </Link>
              {o.inquiry.assignee && <> · handled by {o.inquiry.assignee.name}</>}
            </>
          }
          actions={nextLink || undefined}
        />

        {o.cancelled && (
          <div role="status" className="flex items-start gap-2 rounded-xl border border-bad/25 bg-bad-soft p-4 text-sm">
            <XCircle className="mt-0.5 size-4 shrink-0 text-bad" aria-hidden />
            <div>
              <p className="font-medium">Cancelled{o.cancelled.at ? ` on ${date(o.cancelled.at)}` : ""}.</p>
              {o.cancelled.reason && <p className="mt-0.5 text-text-2">{o.cancelled.reason}</p>}
              <p className="mt-1 text-muted">The inquiry can be reopened and quoted again. Money already received stays recorded here.</p>
            </div>
          </div>
        )}
      </ScrolledBar>

      <OrderTabs base={base} tabs={tabs} />
      <div className="mt-5">{children}</div>
    </div>
  );
}
