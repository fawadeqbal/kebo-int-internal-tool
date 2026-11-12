import { ArrowRight, Banknote, Eye, Factory, File, FileText, History, List, MessageSquareText, Package, Pencil } from "lucide-react";
import Link from "next/link";
import { can } from "@kebo/shared";
import { Banner, ButtonLink, PageHeader, PriorityBadge, RefCode, StageBadge } from "@kebo/ui";
import { date } from "@/lib/format";
import { askFactories } from "./ask";
import { requireUser, hasFeature } from "@/lib/session";
import { dealOf, sourcingOf } from "@/lib/deal-data";
import { StepNav } from "@/components/orders/step-nav";
import { guidance, inquirySteps } from "./steps";

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
  const g = guidance(d);
  // The one main action at the top (board): Ask factories while prices are wanted, else what comes next.
  const ask = d.canWork && (d.stage === "new" || d.stage === "sourcing") ? await askFactories(d, me, "primary") : null;
  const meta = [
    <RefCode key="r">{d.refNo}</RefCode>,
    <Link key="c" href={`/customers/${d.customer.id}`} className="text-primary underline underline-offset-2">
      {d.customer.name}
    </Link>,
    d.category && <span key="cat">{d.category}</span>,
    <PriorityBadge key="p" priority={d.priority} />,
    <span key="a">{d.assignee ? `${d.assignee.name} handles it` : "nobody handles it yet"}</span>,
    d.requiredBy && <span key="n">needed by {date(d.requiredBy)}</span>,
  ].filter(Boolean);

  return (
    <div>
      <PageHeader
        crumbs={[{ label: "Operations & trading" }, { label: "Inquiries", href: "/inquiries" }, { label: d.refNo }]}
        icon={MessageSquareText}
        title={d.title ? d.title : <span className="tabular">{d.refNo}</span>}
        badge={<StageBadge stage={d.stage} onHold={d.onHold} />}
        summary={
          <span className="flex min-w-0 flex-wrap items-center gap-y-1">
            {meta.map((m, i) => (
              <span key={i} className="inline-flex items-center">
                {i > 0 && (
                  <span aria-hidden className="px-1.5 text-muted">
                    ·
                  </span>
                )}
                {m}
              </span>
            ))}
          </span>
        }
        papers={
          d.allowed.edit && (
            <ButtonLink href={`${base}/edit`}>
              <Pencil aria-hidden /> Edit
            </ButtonLink>
          )
        }
        primary={
          ask?.button ??
          (g.href && g.label && (
            <ButtonLink href={g.href} variant="primary">
              {g.label} <ArrowRight aria-hidden />
            </ButtonLink>
          ))
        }
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
        files
        icons={{
          Overview: <Eye aria-hidden />,
          Needs: <List aria-hidden />,
          "Factory prices": <Factory aria-hidden />,
          Quotation: <FileText aria-hidden />,
          Costs: <Banknote aria-hidden />,
          Files: <File aria-hidden />,
          History: <History aria-hidden />,
          "Order →": <Package aria-hidden />,
        }}
        stages={{
          list: ["New", "Sourcing", "Quoted", d.stage === "lost" ? "Lost" : "Won"],
          current: d.stage === "new" ? 0 : d.stage === "sourcing" ? 1 : d.stage === "quoted" ? 2 : 3,
        }}
      />
      <div className="mt-5">{children}</div>
    </div>
  );
}
