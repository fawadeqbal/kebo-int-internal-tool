import { ArrowRight, MessageSquareText } from "lucide-react";
import Link from "next/link";
import { countryName } from "@/lib/countries";
import { can, MANUAL_MOVES } from "@kebo/shared";
import { ButtonLink, cn, PriorityBadge } from "@kebo/ui";
import { companyToday } from "@/lib/format";
import { requireUser, hasFeature } from "@/lib/session";
import { dealOf } from "@/lib/deal-data";
import { recordActions, type RecordAction } from "@/components/records/actions";
import { Notice } from "@/components/records/notice";
import { InquiryNextButton, InquiryTabs, type InquiryTab } from "@/components/deals/inquiry-nav";
import { DealBody, DealChrome } from "@/components/deals/deal-chrome";
import { RecordTop } from "@/components/records/record-page";
import { holdAction, moveStageAction } from "../actions";
import { offerFactsOf } from "./facts";
import { DecisionWindows } from "./panels";
import { inquiryNext, quotationStatus, statusWords } from "./steps";

const TONE = { action: "text-action", ok: "text-ok", bad: "text-bad", mute: "text-text-2" } as const;

/**
 * Every page of an inquiry shares one top (design "the record page", 17 Nov): its title, then one line with
 * its status in words ("Sourcing · 2 of 3 offers in"), the customer and the category; the next thing it
 * needs is the header's orange button, and everything else is in ⋯ (edit, hold, lost, files, link); one
 * row of tabs (Overview · Factory offers · Quotations · Costs · History · Order).
 */
export default async function DealLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const d = await dealOf(id);
  const sourcing = can(me, "sourcing.manage");
  const facts = sourcing ? await offerFactsOf(id) : null;
  const order = d.orders.find((o) => o.status !== "cancelled");
  const base = `/inquiries/${d.id}`;
  const managers = can(me, "expenses.manage") && (await hasFeature("expenses"));
  const status = statusWords(d, facts, companyToday());
  const next = inquiryNext(d, facts);
  const meta = [
    <span key="st" className={cn("font-semibold sm:whitespace-nowrap", TONE[status.tone])}>
      {status.text}
    </span>,
    <Link key="c" href={`/customers/${d.customer.id}`} className="text-primary underline underline-offset-2 hover:opacity-80">
      {d.customer.name}
    </Link>,
    // Each fact once (design rules 18 Nov): the category is in the Details box; the country says where they are.
    d.customer.country !== "ZZ" && <span key="country">{countryName(d.customer.country)}</span>,
    d.priority !== "normal" && <PriorityBadge key="p" priority={d.priority} />,
    // (The number is in the path above and the phone's top bar; who handles it, beside: each said once.)
  ].filter(Boolean);
  const tabs: InquiryTab[] = [
    { href: base, label: "Overview" },
    ...(facts ? [{ href: `${base}/sourcing`, label: "Supplier offers", tag: facts.offers || facts.asked ? String(Math.max(facts.offers, facts.asked)) : undefined }] : []),
    { href: `${base}/quotation`, label: "Quotations", tag: d.quotation?.revisions.length ? quotationStatus(d) : undefined },
    ...(managers ? [{ href: `${base}/costs`, label: "Costs" }] : []),
    { href: `${base}/history`, label: "History" },
  ];
  // The decisions (hold, lost, start, reopen) are in ⋯; each opens its window on the tab it is on.
  const canHold = d.canWork && d.allowed.hold;
  const moves = d.canWork ? MANUAL_MOVES[d.stage].filter((m) => !m.reopen || d.allowed.reopen) : [];
  // The inquiry's list of actions (canvas board "Actions: one list per record type"): the next step, the rest in ⋯.
  const actions = recordActions(`More for ${d.refNo}`, [
    {
      id: "next",
      place: "primary",
      node:
        order && d.stage === "won" ? (
          <ButtonLink href={`/orders/${order.id}`} variant="primary">
            Go to the order <ArrowRight aria-hidden />
          </ButtonLink>
        ) : next?.href && next.label ? (
          <InquiryNextButton base={base} tab={next.tab} href={next.href} label={next.label} />
        ) : undefined,
    },
    { id: "edit", place: "more", when: d.allowed.edit, label: "Edit inquiry", href: `${base}?panel=edit-request` },
    { id: "hold", place: "more", when: canHold, label: d.onHold ? "Take off hold" : "Put on hold", panel: "hold-inquiry" },
    ...moves
      .filter((m) => m.to !== "lost")
      .map((m): RecordAction => ({ id: `move-${m.to}`, place: "more", label: m.label, panel: "move-inquiry", panelId: m.to })),
    { id: "files", place: "more", label: "All files", href: `${base}/files` },
    { id: "customer", place: "more", label: `Open the customer ${d.customer.name}`, href: `/customers/${d.customer.id}` },
    { id: "link", place: "more", label: "Copy link to this inquiry", copy: base },
    { id: "lost", place: "more", when: moves.some((m) => m.to === "lost"), label: "Mark lost…", panel: "move-inquiry", panelId: "lost", danger: true },
  ]);

  return (
    <div>
      <DealChrome>
        <RecordTop
          header={{
            crumbs: [{ label: "Sales" }, { label: "Inquiries", href: "/inquiries" }, { label: d.refNo }],
            icon: MessageSquareText,
            title: d.title ? d.title : <span className="tabular">{d.refNo}</span>,
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
            ...actions,
          }}
          notice={
            d.customer.country === "ZZ" && (
              <Notice tone="todo" title="This customer’s country is not set." className="mt-3">
                It decides shipping.{" "}
                <Link href={`/customers/${d.customer.id}?panel=edit-customer&id=${d.customer.id}`}>Add it</Link>
              </Notice>
            )
          }
          tabs={<InquiryTabs base={base} tabs={tabs} order={order && d.stage === "won" ? { href: `/orders/${order.id}`, refNo: order.refNo } : null} />}
        />
      </DealChrome>
      <DealBody>{children}</DealBody>
      <DecisionWindows
        refNo={d.refNo}
        stage={d.stage}
        onHold={d.onHold}
        canHold={canHold}
        canReopen={d.allowed.reopen}
        stageAction={moveStageAction.bind(null, d.id)}
        holdAction={holdAction.bind(null, d.id)}
      />
    </div>
  );
}
