import { MessageSquareText } from "lucide-react";
import Link from "next/link";
import { can, CHANNEL_LABEL } from "@kebo/shared";
import { Banner, PageHeader, PriorityBadge, StageBadge } from "@kebo/ui";
import { MoreMenu, type MenuEntry } from "@/components/common/more-menu";
import { requireUser, hasFeature } from "@/lib/session";
import { dealOf, sourcingOf } from "@/lib/deal-data";
import { StepNav } from "@/components/orders/step-nav";
import { inquirySteps } from "./steps";

/**
 * Every page of an inquiry shares one top (design system: page header): its
 * number and stage, one summary line (what it is, the customer, how it came,
 * who handles it), ⋯ more (Edit details, the order once won), and the
 * inquiry's navigation: Overview · 1 Needs · 2 Factory prices · 3 Quotation ·
 * Costs (managers) · History, then "Order →" once won. Each step's own header
 * has that page's one primary.
 */
export default async function DealLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const d = await dealOf(id);
  const sourcing = can(me, "sourcing.manage");
  const offers = sourcing ? ((await sourcingOf(id).catch(() => null))?.quotes.length ?? 0) : null;
  const order = d.orders.find((o) => o.status !== "cancelled");
  const base = `/inquiries/${d.id}`;
  const managers = can(me, "expenses.manage") && (await hasFeature("expenses"));
  const moreItems: MenuEntry[] = [
    ...(d.allowed.edit ? [{ label: "Edit details", href: `${base}/edit` }] : []),
    ...(order ? [{ label: `Open the order ${order.refNo}`, href: `/orders/${order.id}` }] : []),
    { label: `Open the customer ${d.customer.name}`, href: `/customers/${d.customer.id}` },
    { label: "Copy link to this inquiry", copy: base },
  ];
  const meta = [
    d.title && (
      <span key="r" className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-text-2">
        {d.refNo}
      </span>
    ),
    <Link key="c" href={`/customers/${d.customer.id}`} className="hover:underline">
      {d.customer.name}
    </Link>,
    d.category && <span key="cat">{d.category}</span>,
    <span key="ch">{CHANNEL_LABEL[d.channel]}</span>,
    d.assignee && <span key="a">{d.assignee.name}</span>,
  ].filter(Boolean);

  return (
    <div>
      <PageHeader
        crumbs={[{ label: "Operations & trading" }, { label: "Inquiries", href: "/inquiries" }, { label: d.refNo }]}
        icon={MessageSquareText}
        title={d.title ? d.title : <span className="tabular">{d.refNo}</span>}
        badge={
          <>
            <StageBadge stage={d.stage} onHold={d.onHold} />
            <PriorityBadge priority={d.priority} />
          </>
        }
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
        more={<MoreMenu label={`More for ${d.refNo}`} items={moreItems} />}
      />
      {d.customer.country === "ZZ" && (
        <Banner meaning="warn" className="mb-3">
          This customer&apos;s country is not set.{" "}
          <Link href={`/customers/${d.customer.id}?panel=edit-customer&id=${d.customer.id}`} className="font-medium underline">
            Add it
          </Link>{" "}
          — it decides shipping.
        </Banner>
      )}
      <StepNav
        base={base}
        label="Inquiry steps"
        glance="The inquiry at a glance"
        steps={inquirySteps(d, offers).map((s) => ({ key: s.key, number: s.number, label: s.label, state: s.state, status: s.status, href: `${base}/${s.path}` }))}
        costs={managers ? {} : null}
        extra={order ? [{ href: `/orders/${order.id}`, label: "Order →" }] : []}
      />
      <div className="mt-5">{children}</div>
    </div>
  );
}
