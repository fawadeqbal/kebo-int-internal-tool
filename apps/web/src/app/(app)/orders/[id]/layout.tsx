import Link from "next/link";
import { Package, XCircle } from "lucide-react";
import { orderProgress, orderStatusLine, PAYMENT_ROUTE_SHORT, STEP_PATH, type FlowStep, type ProgressState } from "@kebo/shared";
import { cn, PageHeader, RefCode } from "@kebo/ui";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { orderFilesOf, orderFlowOf, orderOf, orderStepsOf } from "@/lib/order-data";
import { optional } from "@/components/print/data";
import { date, whole } from "@/lib/format";
import { today } from "@/components/orders/today";
import { MoreMenu, type MenuEntry } from "@/components/common/more-menu";
import { ScrolledBar } from "@/components/orders/scrolled-bar";
import { DoNext, OrderNav } from "@/components/orders/order-nav";
import { readable } from "@/components/orders/step-page";
import { orderCostsSetup } from "@/components/orders/costs-data";
import { FileToolsProvider } from "@/components/files/file-tools";
import { OrderDrop } from "@/components/files/order-drop";
import { docHref } from "./shared";

/**
 * Every page of an order shares one top (design system: page header): ← Orders,
 * the order number with its stage, one summary line (customer · inquiry · total
 * · route · who handles it), the proforma's View / Print and Download PDF (the
 * papers; in ⋯ on a phone) and ⋯ more; then the order's tabs (Overview, Items,
 * Payment, Purchase, Shipping, Documents, Costs, Notes: the six steps inside
 * them). Each step's own header has that page's one primary.
 */
export default async function OrderLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireUser();
  const o = await orderOf(id);
  const [steps, flow, costs, files, pos] = await Promise.all([
    optional(() => orderStepsOf(id)),
    optional(() => orderFlowOf(id)),
    orderCostsSetup(id),
    optional(() => orderFilesOf(id)),
    optional(() => api.get<{ items: { number: string; sentOn: string | null }[] }>(`/orders/${id}/purchase-orders`)),
  ]);
  // What each step box says (board): where it stands in a few words.
  const statusOf = (key: FlowStep, state: ProgressState, line: string): string => {
    if (key === "payment") {
      const deposit = Number(o.money.deposit);
      if (flow?.payment.depositIn || (deposit > 0 && Number(o.money.received) >= deposit)) return Number(o.money.due) <= 0 ? "Paid in full" : "Deposit received";
      if (deposit > 0) return `Deposit ${whole(o.money.deposit, o.currency)} ${Number(o.money.received) > 0 ? "part in" : "due"}`;
      return state === "done" ? "Done" : line;
    }
    if (key === "factory" && pos?.items.length) {
      const unsent = pos.items.filter((p) => !p.sentOn);
      if (!unsent.length) {
        const last = pos.items.map((p) => p.sentOn!).sort().at(-1)!;
        return `PO sent ${date(last)}`;
      }
      return unsent.length === 1 ? `${unsent[0]!.number} not sent` : `${unsent.length} POs not sent`;
    }
    if (key === "production") {
      const list = flow?.production?.steps ?? [];
      const ready = flow?.factory.readyOn ?? o.readyOn;
      const head = list.length ? `${list.filter((x) => x.doneOn).length} of ${list.length} steps` : null;
      if (head && ready) return `${head} · ready ${date(ready)}`;
      if (ready) return `Ready ${date(ready)}`;
      return head ?? (state === "wait" ? "" : "Ready date not known");
    }
    if (key === "shipping") {
      const sh = flow?.shipping?.shipments[0];
      if (sh?.arrivedOn) return `Arrived ${date(sh.arrivedOn)}`;
      if (sh?.departedOn) return sh.eta ? `At sea · ETA ${date(sh.eta)}` : `Left ${date(sh.departedOn)}`;
    }
    // The papers and bank steps: how many are in (their list is on the page).
    if (key === "documents") return "";
    return state === "wait" ? "" : readable(line);
  };
  // Where the order stands, read from its to-do items: the line of steps, the status in words and "Do next" agree.
  const todayIs = today();
  const progress = steps ? orderProgress(steps.items, steps.steps.map((s) => s.key)) : null;
  const status = orderStatusLine(steps?.items ?? [], { cancelled: o.status === "cancelled", closed: o.status === "closed", word: o.word }, todayIs);
  const statusText = (
    <span className={cn("font-semibold whitespace-nowrap", status.tone === "bad" ? "text-bad" : status.tone === "ok" ? "text-ok" : "text-action")}>
      {status.stage}
      {status.note ? ` · ${status.note}` : ""}
    </span>
  );
  const next = progress?.open[0] ?? null;
  const nextStep = next ? steps!.steps.find((s) => s.key === next.step) : null;
  const ship = flow?.shipping?.shipments[0];
  const base = `/orders/${o.id}`;
  const open = o.status !== "cancelled";
  const route = flow?.payment.route ? PAYMENT_ROUTE_SHORT[flow.payment.route] : null;
  const proforma = o.documents.find((d) => d.kind === "proforma");
  const pdf = proforma ? docHref(o, proforma) : null;
  const now = next && nextStep ? { step: next.step, title: next.title, late: next.late, dueOn: next.dueOn } : null;
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

      {steps && progress && (
        <OrderNav
          base={base}
          steps={steps.steps.map((s) => {
            const p = progress.steps.find((x) => x.step === s.key)!;
            return {
              key: s.key,
              number: s.number,
              label: s.label,
              state: p.state,
              // A date or an amount when there is one; else what the step waits for.
              fact: (p.state === "wait" ? p.waits : null) || statusOf(s.key, p.state, s.line) || p.waits || (p.state === "done" ? "Done" : `${p.done} of ${p.total} done`),
              href: `${base}/${STEP_PATH[s.key]}`,
            };
          })}
          pages={[
            { href: `${base}/items`, label: "Items" },
            { href: `${base}/money`, label: "Money" },
            ...(costs ? [{ href: `${base}/costs`, label: "Costs" }] : []),
            { href: `${base}/history`, label: "History" },
          ]}
        />
      )}
      {open && next && nextStep && (
        <DoNext
          base={base}
          step={next.step}
          stepLabel={nextStep.label}
          late={next.late}
          title={next.title}
          meta={[
            nextStep.label,
            next.dueOn ? `${next.late ? "was due" : "due"} ${date(next.dueOn)}` : null,
            next.assignee?.name ?? null,
            next.needs ? `needs ${next.needs}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
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
