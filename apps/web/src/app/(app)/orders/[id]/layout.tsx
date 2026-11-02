import Link from "next/link";
import { ArrowLeft, XCircle } from "lucide-react";
import { PAYMENT_ROUTE_SHORT, STEP_PATH } from "@kebo/shared";
import { Badge, cn, OrderStageBadge } from "@kebo/ui";
import { requireUser } from "@/lib/session";
import { orderFilesOf, orderFlowOf, orderOf, orderStepsOf } from "@/lib/order-data";
import { optional } from "@/components/print/data";
import { date, money, whole } from "@/lib/format";
import { FileActions } from "@/components/common/file-actions";
import { ScrolledBar } from "@/components/orders/scrolled-bar";
import { StepNav } from "@/components/orders/step-nav";
import { orderCostsSetup } from "@/components/orders/costs-data";
import { FileToolsProvider } from "@/components/files/file-tools";
import { OrderDrop } from "@/components/files/order-drop";
import { docHref } from "./shared";

/**
 * Every page of an order shares one top: the order number with its stage, the
 * customer, total, route and who handles it, the proforma's View / Print and
 * Download PDF, and the order's navigation (Overview, the six steps, History).
 */
export default async function OrderLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireUser();
  const o = await orderOf(id);
  const [steps, flow, costs, files] = await Promise.all([
    optional(() => orderStepsOf(id)),
    optional(() => orderFlowOf(id)),
    orderCostsSetup(id),
    optional(() => orderFilesOf(id)),
  ]);
  const ship = flow?.shipping?.shipments[0];
  const base = `/orders/${o.id}`;
  const open = o.status !== "cancelled";
  const route = flow?.payment.route ? PAYMENT_ROUTE_SHORT[flow.payment.route] : null;
  const proforma = o.documents.find((d) => d.kind === "proforma");
  const pdf = proforma ? docHref(o, proforma) : null;
  const now = steps?.doNow;

  const meta = [
    <Link key="c" href={`/customers/${o.customer.id}`} className="font-medium text-text hover:underline">
      {o.customer.name}
    </Link>,
    <Link key="i" href={`/inquiries/${o.inquiry.id}`} className="hover:underline">
      {o.inquiry.title || o.inquiry.refNo}
    </Link>,
    <span key="t" className="tabular">
      {money(o.total, o.currency)}
    </span>,
    route && <span key="r">{route}</span>,
    o.inquiry.assignee && <span key="a">{o.inquiry.assignee.name}</span>,
  ].filter(Boolean);

  return (
    <div>
      <ScrolledBar
        bar={
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
            <span className="flex items-center gap-2 font-medium">
              {o.refNo} <OrderStageBadge stage={o.stage} />{" "}
              <span className="hidden font-normal text-muted sm:inline">{o.customer.name}</span>
            </span>
            {now && open && (
              <Link
                href={`${base}/${STEP_PATH[now.step]}`}
                className={cn("truncate text-xs hover:underline", now.late ? "text-bad" : "text-text-2")}
              >
                Now: {now.title}
                {now.dueOn ? ` · ${now.late ? "was due" : "due"} ${date(now.dueOn)}` : ""}
              </Link>
            )}
          </div>
        }
      >
        <header className="flex flex-col gap-1">
          <Link href="/orders" className="inline-flex w-fit items-center gap-1 text-xs text-muted hover:text-text">
            <ArrowLeft className="size-3.5" aria-hidden /> Orders
          </Link>
          <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between lg:gap-4">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="text-xl font-semibold tracking-tight tabular sm:text-2xl">{o.refNo}</h1>
              <OrderStageBadge stage={o.stage} />
              {!open && <Badge tone="bad">Cancelled</Badge>}
              <p className="min-w-0 basis-full text-sm text-text-2 sm:basis-auto">
                {meta.map((m, i) => (
                  <span key={i}>
                    {i > 0 && (
                      <span aria-hidden className="px-1.5 text-muted">
                        ·
                      </span>
                    )}
                    {m}
                  </span>
                ))}
              </p>
            </div>
            {pdf && <FileActions viewHref={pdf.view} pdfHref={pdf.pdf} of="proforma invoice" className="shrink-0" />}
          </div>
        </header>

        {o.cancelled && (
          <div role="status" className="mt-4 flex items-start gap-2 rounded-xl border border-bad/25 bg-bad-soft p-4 text-sm">
            <XCircle className="mt-0.5 size-4 shrink-0 text-bad" aria-hidden />
            <div>
              <p className="font-medium">Cancelled{o.cancelled.at ? ` on ${date(o.cancelled.at)}` : ""}.</p>
              {o.cancelled.reason && <p className="mt-0.5 text-text-2">{o.cancelled.reason}</p>}
              <p className="mt-1 text-muted">The inquiry can be reopened and quoted again. Money already received stays recorded here.</p>
            </div>
          </div>
        )}
      </ScrolledBar>

      {steps && (
        <StepNav
          base={base}
          steps={steps.steps.map((s) => ({
            key: s.key,
            number: s.number,
            label: s.label,
            state: s.state,
            done: s.done,
            total: s.total,
            href: `${base}/${STEP_PATH[s.key]}`,
          }))}
          costs={costs && { spent: whole(costs.costs.totals.spent, costs.costs.currency) }}
        />
      )}
      {/* Documents v3: the same file tools (viewer, menus, dialogs) on every page of the order, and drop anywhere. */}
      <FileToolsProvider
        orderId={o.id}
        files={files?.files ?? []}
        targets={files?.targets ?? []}
        share={{ refNo: o.refNo, greeting: `Dear ${o.customer.name}`, vessel: ship?.vessel ?? null, eta: ship?.eta ? date(ship.eta) : null }}
      >
        <div className="mt-5">{children}</div>
      </FileToolsProvider>
      {files?.canUpload && <OrderDrop orderId={o.id} refNo={o.refNo} />}
    </div>
  );
}
