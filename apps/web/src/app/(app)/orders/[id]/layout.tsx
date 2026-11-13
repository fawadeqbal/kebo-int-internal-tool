import Link from "next/link";
import { Package, XCircle } from "lucide-react";
import { can, dayMonth, ORDER_TABS, ORDER_WORD_TONE, PAYMENT_ROUTE_SHORT, type FlowStep, type OrderTab } from "@kebo/shared";
import { cn, PageHeader, RefCode } from "@kebo/ui";
import { Suspense } from "react";
import { requireUser } from "@/lib/session";
import { orderFilesOf, orderFlowOf, orderOf, orderSectionsOf } from "@/lib/order-data";
import { optional } from "@/components/print/data";
import { date, whole } from "@/lib/format";
import { today } from "@/components/orders/today";
import { MoreMenu, type MenuEntry } from "@/components/common/more-menu";
import { ScrolledBar } from "@/components/orders/scrolled-bar";
import { OrderTabs } from "@/components/order-sections/order-tabs";
import { orderCostsSetup } from "@/components/orders/costs-data";
import { FileToolsProvider } from "@/components/files/file-tools";
import { OrderDrop } from "@/components/files/order-drop";
import { docHref } from "./shared";
import { CancelOrder } from "./cancel-order";

/**
 * Every page of an order shares one top (design "the order, final"): the path, the order's name, one
 * line (where it stands · number · customer · inquiry · incoterm and total · who handles it) and ⋯ more;
 * then its nine tabs — Overview, the six stages each with one small word read from its data, Costs and
 * History. No numbers, no ticks and no "do next": every tab is open from the first day. A tab's own
 * main button lands in the header.
 */
export default async function OrderLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const o = await orderOf(id);
  // Cancelling is a manager's: it sits last in ⋯, away from the everyday buttons.
  const canCancel = can(me, "orders.manage") && o.status !== "cancelled";
  const [sections, flow, costs, files] = await Promise.all([
    optional(() => orderSectionsOf(id)),
    optional(() => orderFlowOf(id)),
    orderCostsSetup(id),
    optional(() => orderFilesOf(id)),
  ]);
  // Where the order stands, in words: the one word worked out from what is stored, then the next two dates.
  const now = today();
  const ready = flow?.factory.readyOn ?? o.readyOn;
  const left = o.word !== "Confirmed" && o.word !== "In production";
  const notes =
    o.status !== "open"
      ? []
      : left
        ? [o.money && Number(o.money.due) <= 0 ? "paid in full" : null]
        : [ready ? `ready ${dayMonth(ready)}` : null, o.shipBy ? `ship by ${dayMonth(o.shipBy)}` : null];
  const late = o.status === "open" && !left && !!o.shipBy && o.shipBy < now;
  const tone = o.status === "cancelled" ? "bad" : o.status === "closed" ? "neutral" : late ? "bad" : ORDER_WORD_TONE[o.word];
  const statusText = (
    <span
      className={cn(
        "font-semibold whitespace-nowrap",
        tone === "bad" ? "text-bad" : tone === "ok" ? "text-ok" : tone === "neutral" ? "text-text-2" : tone === "info" ? "text-info" : "text-action",
      )}
    >
      {o.status === "closed" ? `Closed${o.stageSince ? ` ${date(o.stageSince)}` : ""}` : o.word}
      {notes.filter(Boolean).map((x) => ` · ${x}`)}
    </span>
  );
  const ship = flow?.shipping?.shipments[0];
  const base = `/orders/${o.id}`;
  const route = flow?.payment.route ? PAYMENT_ROUTE_SHORT[flow.payment.route] : null;
  const proforma = o.documents.find((d) => d.kind === "proforma");
  const pdf = proforma ? docHref(o, proforma) : null;
  // On a phone the paper buttons fold into ⋯ (design system: page header).
  const paperItems: MenuEntry[] = [{ label: "Papers", href: `${base}/documents` }];
  const proformaItems: MenuEntry[] = pdf
    ? [
        { label: "View / Print the proforma", href: pdf.view, newTab: true },
        { label: "Download the proforma PDF", href: pdf.pdf, download: true },
      ]
    : [];
  const moreItems: MenuEntry[] = [
    ...proformaItems,
    { label: `Open the inquiry ${o.inquiry.refNo}`, href: `/inquiries/${o.inquiry.id}` },
    { label: `Open the customer ${o.customer.name}`, href: `/customers/${o.customer.id}` },
    { label: "Copy link to this order", copy: base },
    ...(canCancel ? ([{ separator: true }, { label: "Cancel the order…", panel: "cancel-order", danger: true }] satisfies MenuEntry[]) : []),
  ];

  // Board: SO · customer · from RFQ · QUO R2 · CPT Kabul · USD 52,400 (route and who handles it after).
  const meta = [
    <span key="st">{statusText}</span>,
    <RefCode key="no">{o.refNo}</RefCode>,
    <Link key="c" href={`/customers/${o.customer.id}`} className="text-primary underline underline-offset-2 hover:opacity-80">
      {o.customer.name}
    </Link>,
    <Link key="i" href={`/inquiries/${o.inquiry.id}`} className="hover:opacity-80">
      from <RefCode>{o.inquiry.refNo}</RefCode>
    </Link>,
    o.quotation && (
      <Link key="q" href={`/inquiries/${o.inquiry.id}/quotation`} className="hover:opacity-80">
        <RefCode>
          {o.quotation.refNo} R{o.quotation.number}
        </RefCode>
      </Link>
    ),
    <span key="t" className="tabular">
      {o.incoterm}
      {o.incotermPlace ? ` ${o.incotermPlace}` : ""} · {whole(o.total, o.currency)}
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
              {o.refNo} <span className="text-xs">{statusText}</span>{" "}
              <span className="hidden font-normal text-muted sm:inline">{o.customer.name}</span>
            </span>
          </div>
        }
      >
        <PageHeader
          crumbs={[{ label: "Sales" }, { label: "Orders", href: "/orders" }, { label: o.refNo }]}
          icon={Package}
          title={o.inquiry.title || <span className="tabular">{o.refNo}</span>}
          summary={
            <p className="min-w-0">
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
          }
          papers={
            // A page's own main button lands here (HeaderSlot).
            <span id="order-header-slot" className="contents" />
          }
          more={<MoreMenu label={`More for ${o.refNo}`} items={[...paperItems, ...moreItems]} />}
        />

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

      <OrderTabs
        base={base}
        tabs={ORDER_TABS.filter((t) => {
          if (t === "overview" || t === "history") return true;
          if (t === "costs") return !!costs;
          // Without the shipping module the tab still holds the few shipping values of the order itself.
          if (t === "shipping") return true;
          // A stage whose module the company switched off has no tab.
          return !sections || sections.stages.includes(t as FlowStep);
        }).map((t): { key: OrderTab; word?: string } => ({ key: t, word: sections?.tabs[t] || undefined }))}
      />
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
      {canCancel && (
        <Suspense fallback={null}>
          <CancelOrder id={o.id} />
        </Suspense>
      )}
    </div>
  );
}
