import Link from "next/link";
import { ArrowRight, Eye } from "lucide-react";
import { can, dayMonth, ORDER, ORDER_TABS, orderNextStep, RECORD_KIND, type FlowStep, type OrderTab } from "@kebo/shared";
import { ButtonLink, cn, Notice } from "@kebo/ui";
import { Suspense } from "react";
import { requireUser } from "@/lib/session";
import { orderFilesOf, orderFlowOf, orderMoneyOf, orderOf, orderPapersOf, orderSectionsOf } from "@/lib/order-data";
import { optional } from "@/components/print/data";
import { date } from "@/lib/format";
import { orderName } from "@/lib/titles";
import { today } from "@/components/orders/today";
import { MoreMenu, type MenuEntry } from "@/components/common/more-menu";
import { RecordFrame } from "@/components/records/record-frame";
import { RecordTop } from "@/components/records/record-page";
import { OrderSide } from "@/components/order-sections/order-side";
import { OrderTabs } from "@/components/order-sections/order-tabs";
import { orderCostsSetup } from "@/components/orders/costs-data";
import { orderStepFacts } from "@/components/orders/order-facts";
import { FileToolsProvider } from "@/components/files/file-tools";
import { OrderDrop } from "@/components/files/order-drop";
import { docHref } from "./shared";
import { CancelOrder } from "./cancel-order";
import { moveStageAction } from "../actions";
import { StageActions } from "./forms";

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
  const tone = o.status === "cancelled" ? "bad" : o.status === "closed" ? "neutral" : late ? "bad" : ORDER.states[o.word].tone;
  const statusText = (
    <span
      className={cn(
        "font-semibold sm:whitespace-nowrap",
        tone === "bad" ? "text-bad" : tone === "ok" ? "text-ok" : tone === "neutral" ? "text-text-2" : tone === "info" ? "text-info" : "text-action",
      )}
    >
      {o.status === "closed" ? `Closed${o.stageSince ? ` ${date(o.stageSince)}` : ""}` : o.word}
      {notes.filter(Boolean).map((x) => ` · ${x}`)}
    </span>
  );
  const ship = flow?.shipping?.shipments[0];
  const base = `/orders/${o.id}`;
  // The header's one strong button: the order's next step (packages/shared orderNextStep), the same on every tab;
  // it opens its tab, and the window there that does it. Closing and reopening are done right here.
  // The supplier's money (people who see it) and the shipping advice paper, for the steps that read them.
  const [money, papers] = await Promise.all([
    can(me, "sourcing.manage") ? optional(() => orderMoneyOf(id)) : Promise.resolve(null),
    optional(() => orderPapersOf(id)),
  ]);
  const advice = papers?.papers.find((p) => p.kind === "shipping-advice") ?? null;
  const step = orderNextStep(orderStepFacts(o, flow, sections?.stages ?? null, { update: can(me, "orders.update") }, { money, advice }), now);
  const primary =
    step?.key === "close" || step?.key === "reopen" ? (
      <StageActions
        key={o.stage}
        next={step.key === "close" ? o.next : null}
        back={step.key === "reopen" ? o.back : null}
        action={moveStageAction.bind(null, o.id)}
        today={now}
        readyOn={o.readyOn}
        shippedOn={o.shippedOn}
        blNo={o.blNo}
      />
    ) : step ? (
      <ButtonLink href={`${base}${step.tab === "overview" ? "" : `/${step.tab}`}${step.window ? `?do=${step.window}` : ""}`} variant="primary" scroll={false}>
        {step.label} <ArrowRight aria-hidden />
      </ButtonLink>
    ) : undefined;
  const proforma = o.documents.find((d) => d.kind === "proforma");
  const pdf = proforma ? docHref(o, proforma) : null;
  // On a phone the paper buttons fold into ⋯ (design system: page header).
  const paperItems: MenuEntry[] = [{ label: "Documents", href: `${base}/documents` }];
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

  // The status and the customer. Each other fact is said once, where it belongs: the number in the path
  // (and the phone's top bar), the quotation and their PO in Their order, the terms in Agreed with the
  // customer, the money in Money and who handles it in People; the inquiry is in ⋯.
  const meta = [
    <span key="st">{statusText}</span>,
    <Link key="c" href={`/customers/${o.customer.id}`} className="text-primary underline underline-offset-2 hover:opacity-80">
      {o.customer.name}
    </Link>,
  ];

  const tabs = ORDER_TABS.filter((t) => {
    if (t === "overview" || t === "history") return true;
    if (t === "costs") return !!costs;
    // Without the shipping module the tab still holds the few shipping values of the order itself.
    if (t === "shipping") return true;
    // A stage whose module the company switched off has no tab.
    return !sections || sections.stages.includes(t as FlowStep);
  }).map((t): { key: OrderTab; word?: string } => ({ key: t, word: sections?.tabs[t] || undefined }));

  return (
    <div>
      {/* The top (header, notice, tabs) and the panel are drawn here once (canvas board "The top and the panel
          stay; only the body moves"): they stay as the tabs change and while a long tab scrolls. A paper being
          made takes the page's whole width. */}
      <RecordFrame
        wide={["papers"]}
        panelLabel="Beside the order"
        panel={<OrderSide id={id} />}
        folds
        top={
          <RecordTop
            header={{
              crumbs: [{ label: "Sales" }, { label: "Orders", href: "/orders" }, { label: o.refNo }],
              title: orderName(o),
              record: { kind: RECORD_KIND.order, number: o.refNo },
              summary: (
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
              ),
              papers: pdf ? (
                <ButtonLink href={pdf.view} target="_blank" rel="noopener">
                  <Eye aria-hidden /> Proforma
                </ButtonLink>
              ) : undefined,
              primary,
              more: <MoreMenu label={`More for ${o.refNo}`} items={[...paperItems, ...moreItems]} />,
            }}
            notice={
              o.cancelled && (
                <Notice tone="bad" title={`Cancelled${o.cancelled.at ? ` on ${date(o.cancelled.at)}` : ""}.`}>
                  {o.cancelled.reason && <p>{o.cancelled.reason}</p>}
                  <p className="mt-1">The inquiry can be reopened and quoted again. Money already received stays recorded here.</p>
                </Notice>
              )
            }
            tabs={<OrderTabs base={base} tabs={tabs} />}
          />
        }
      >
      {/* Documents v3: the same file tools (viewer, menus, dialogs) on every page of the order, and drop anywhere. */}
      <FileToolsProvider
        orderId={o.id}
        files={files?.files ?? []}
        targets={files?.targets ?? []}
        share={{ refNo: o.refNo, greeting: `Dear ${o.customer.name}`, vessel: ship?.vessel ?? null, eta: ship?.eta ? date(ship.eta) : null }}
      >
        {children}
      </FileToolsProvider>
      </RecordFrame>
      {files?.canUpload && <OrderDrop orderId={o.id} refNo={o.refNo} />}
      {canCancel && (
        <Suspense fallback={null}>
          <CancelOrder id={o.id} />
        </Suspense>
      )}
    </div>
  );
}
