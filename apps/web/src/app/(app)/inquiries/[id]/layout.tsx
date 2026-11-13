import { ArrowRight, MessageSquareText } from "lucide-react";
import Link from "next/link";
import { can } from "@kebo/shared";
import { Banner, ButtonLink, cn, PageHeader, PriorityBadge, RefCode } from "@kebo/ui";
import { todayIn } from "@kebo/utils";
import { TZ } from "@/lib/format";
import { requireUser, hasFeature } from "@/lib/session";
import { dealOf } from "@/lib/deal-data";
import { MoreMenu, type MenuEntry } from "@/components/common/more-menu";
import { InquiryNext, InquiryTabs, type InquiryTab } from "@/components/deals/inquiry-nav";
import { offerFactsOf } from "./facts";
import { inquiryNext, quotationStatus, statusWords } from "./steps";

const TONE = { action: "text-action", ok: "text-ok", bad: "text-bad", mute: "text-text-2" } as const;

/**
 * Every page of an inquiry shares one top, the same shape as an order's: its title, then one line that
 * starts with its status in words ("Sourcing · 2 of 3 offers in") and goes on with its number, the
 * customer, the category and who handles it; ⋯ more; one row of tabs (Overview · Factory offers ·
 * Quotations · Costs · History · Order); and "Do next", the one thing it needs now.
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
  const status = statusWords(d, facts, todayIn(TZ));
  const next = inquiryNext(d, facts);
  const meta = [
    <span key="st" className={cn("font-semibold whitespace-nowrap", TONE[status.tone])}>
      {status.text}
    </span>,
    <RefCode key="r">{d.refNo}</RefCode>,
    <Link key="c" href={`/customers/${d.customer.id}`} className="text-primary underline underline-offset-2 hover:opacity-80">
      {d.customer.name}
    </Link>,
    d.category && <span key="cat">{d.category}</span>,
    d.priority !== "normal" && <PriorityBadge key="p" priority={d.priority} />,
    <span key="a">{d.assignee ? `${d.assignee.name} handles it` : "nobody handles it yet"}</span>,
  ].filter(Boolean);
  const tabs: InquiryTab[] = [
    { href: base, label: "Overview" },
    ...(facts ? [{ href: `${base}/sourcing`, label: "Factory offers", tag: facts.offers || facts.asked ? String(Math.max(facts.offers, facts.asked)) : undefined }] : []),
    { href: `${base}/quotation`, label: "Quotations", tag: d.quotation?.revisions.length ? quotationStatus(d) : undefined },
    ...(managers ? [{ href: `${base}/costs`, label: "Costs" }] : []),
    { href: `${base}/history`, label: "History" },
  ];
  const more: MenuEntry[] = [
    ...(d.allowed.edit ? [{ label: "Edit the request", href: `${base}?panel=edit-request` }] : []),
    { label: "All files", href: `${base}/files` },
    { label: `Open the customer ${d.customer.name}`, href: `/customers/${d.customer.id}` },
    { label: "Copy link to this inquiry", copy: base },
  ];

  return (
    <div>
      <PageHeader
        crumbs={[{ label: "Operations & trading" }, { label: "Inquiries", href: "/inquiries" }, { label: d.refNo }]}
        icon={MessageSquareText}
        title={d.title ? d.title : <span className="tabular">{d.refNo}</span>}
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
        primary={
          order && d.stage === "won" ? (
            <ButtonLink href={`/orders/${order.id}`} variant="primary">
              Go to the order <ArrowRight aria-hidden />
            </ButtonLink>
          ) : undefined
        }
        more={<MoreMenu label={`More for ${d.refNo}`} items={more} />}
      />
      {d.customer.country === "ZZ" && (
        <Banner meaning="warn" className="mt-3">
          This customer&apos;s country is not set.{" "}
          <Link href={`/customers/${d.customer.id}?panel=edit-customer&id=${d.customer.id}`} className="font-medium underline">
            Add it
          </Link>{" "}
          — it decides shipping.
        </Banner>
      )}
      <InquiryTabs base={base} tabs={tabs} order={order && d.stage === "won" ? { href: `/orders/${order.id}`, refNo: order.refNo } : null} />
      {next && <InquiryNext base={base} tab={next.tab} title={next.title} meta={next.meta} href={next.href} label={next.label} />}
      <div className="mt-4">{children}</div>
    </div>
  );
}
