import Link from "next/link";
import { ArrowRight, Eye } from "lucide-react";
import { can, ORDER_TABS, orderNextStep, orderTabPath, orderStanding, RECORD_KIND, type FlowStep, type OrderTab } from "@kebo/shared";
import { ButtonLink, cn, Notice } from "@kebo/ui";
import { Suspense } from "react";
import { requireUser } from "@/lib/session";
import { orderCustomerContactsOf, orderFilesOf, orderFlowOf, orderMoneyOf, orderOf, orderPapersOf, orderSectionsOf } from "@/lib/order-data";
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
import { ReopenOrderForm, StageActions } from "./forms";

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
  const [sections, flow, costs, files, contacts] = await Promise.all([
    optional(() => orderSectionsOf(id)),
    optional(() => orderFlowOf(id)),
    orderCostsSetup(id),
    optional(() => orderFilesOf(id)),
    // Who the order's Email and Share go to: the customer's main contact (read as is: no page change if it cannot be).
    optional(() => orderCustomerContactsOf(id)),
  ]);
  const contact = contacts?.find((c) => c.isPrimary) ?? contacts?.[0] ?? null;
  // Where the order stands, in words: the one word worked out from what is stored, then what orderStanding
  // (packages/shared) says beside it: the next two dates, or that it is paid.
  const now = today();
  const { notes, tone } = orderStanding(
    {
      status: o.status,
      word: o.word,
      readyOn: flow?.factory.readyOn ?? o.readyOn,
      shipBy: o.shipBy,
      // Every item in from the supplier (Production "received"): no longer "In production · ready …" but ready to ship.
      goodsIn: sections?.tabs.production === "received",
      due: o.money ? Number(o.money.due) : null,
    },
    now,
  );
  const statusText = (
    <span
      className={cn(
        "font-semibold sm:whitespace-nowrap",
        tone === "bad" ? "text-bad" : tone === "ok" ? "text-ok" : tone === "neutral" ? "text-text-2" : tone === "info" ? "text-info" : "text-action",
      )}
    >
      {/* The one word, as in the list and on the board ("goods in" is a note beside it, not another word). */}
      {o.status === "closed" ? `${o.word}${o.stageSince ? ` · closed ${date(o.stageSince)}` : ""}` : o.word}
      {notes.map((x) => ` · ${x}`)}
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
  const requests = papers?.papers.filter((p) => p.kind === "payment-request") ?? [];
  const step = orderNextStep(orderStepFacts(o, flow, sections?.stages ?? null, { update: can(me, "orders.update") }, { money, advice, requests }), now);
  // Closing with papers not made says so first (Documents "2 of 5"): closed only on a yes.
  const docs = /^(\d+) of (\d+)$/.exec(sections?.tabs.documents ?? "");
  const papersLeft = docs ? Number(docs[2]) - Number(docs[1]) : 0;
  const closeCheck = papersLeft > 0 ? `${papersLeft} of the order's ${docs![2]} documents ${papersLeft === 1 ? "is" : "are"} not made yet (Documents tab). Close ${o.refNo} anyway?` : null;
  // A closed order's way back is in ⋯ (Reopen the order…), never its main button (pinned at a phone's foot).
  const reopen = step?.key === "reopen" && o.back ? o.back : null;
  const primary =
    step?.key === "close" ? (
      <StageActions
        key={o.stage}
        next={o.next}
        back={null}
        action={moveStageAction.bind(null, o.id)}
        today={now}
        readyOn={o.readyOn}
        shippedOn={o.shippedOn}
        blNo={o.blNo}
        closeCheck={closeCheck}
      />
    ) : step && step.key !== "reopen" ? (
      <ButtonLink href={`${base}${step.path ? `/${step.path}` : step.tab === "overview" ? "" : `/${orderTabPath(step.tab)}`}${step.window ? `?do=${step.window}` : ""}`} variant="primary" scroll={false}>
        {step.label} <ArrowRight aria-hidden />
      </ButtonLink>
    ) : undefined;
  const proforma = o.documents.find((d) => d.kind === "proforma");
  const pdf = proforma ? docHref(o, proforma) : null;
  // On a phone the paper buttons fold into ⋯ (design system: page header).
  const paperItems: MenuEntry[] = [{ label: "Documents", href: `${base}/documents` }];
  const proformaItems: MenuEntry[] = pdf
    ? [
        { label: "View / Print the proforma", href: pdf.view },
        { label: "Download the proforma PDF", href: pdf.pdf, download: true },
      ]
    : [];
  const moreItems: MenuEntry[] = [
    ...proformaItems,
    { label: `Open the inquiry ${o.inquiry.refNo}`, href: `/inquiries/${o.inquiry.id}` },
    { label: `Open the customer ${o.customer.name}`, href: `/customers/${o.customer.id}` },
    { label: "Copy link to this order", copy: base },
    ...(reopen ? ([{ label: "Reopen the order…", panel: "reopen-order" }] satisfies MenuEntry[]) : []),
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
                <ButtonLink href={pdf.view}>
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
        share={{
          refNo: o.refNo,
          greeting: `Dear ${contact?.name.split(" ")[0] ?? o.customer.name}`,
          vessel: ship?.vessel ?? null,
          eta: ship?.eta ? date(ship.eta) : null,
          to: { name: contact?.name ?? o.customer.name, email: contact?.email ?? null, phone: contact?.whatsapp ?? contact?.phone ?? null },
          today: now,
        }}
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
      {reopen && <ReopenOrderForm action={moveStageAction.bind(null, o.id)} back={reopen} refNo={o.refNo} />}
    </div>
  );
}
