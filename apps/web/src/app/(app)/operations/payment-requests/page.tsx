import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock, FileText, List, Send } from "lucide-react";
import { buildHref, Card, EmptyState, LinkTabs, PageHeader, Pager, StatRow, StatTile, Table, Td, Th, THead, toPage, Tr } from "@kebo/ui";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { crumbsFor } from "@/lib/nav";
import { date, money, short } from "@/lib/format";
import { FilterCard } from "@/components/common/filter-card";
import type { RequestList } from "@/lib/types-money";
import { recordPaymentHref } from "@/components/money/pay-links";
import { RequestStatus } from "@/components/money/requests";
import { requestHref } from "@/lib/requests";

export const metadata = { title: "Payment requests" };

type Row = RequestList["rows"][number];

const CHIPS = [
  { key: "all", label: "All", icon: List },
  { key: "to_send", label: "To send", icon: Send },
  { key: "waiting", label: "Waiting for payment", icon: Clock },
  { key: "late", label: "Late", icon: AlertTriangle },
  { key: "paid", label: "Paid", icon: CheckCircle2 },
] as const;
type Chip = (typeof CHIPS)[number]["key"];

const inChip = (r: Row, c: Chip) =>
  c === "all"
    ? true
    : c === "to_send"
      ? (r.state === "not_sent" && r.through === "customer") || r.changed
      : c === "waiting"
        ? r.state === "sent" || r.state === "part_paid"
        : c === "late"
          ? r.late > 0
          : r.state === "paid";

const PAGE = 20;

/**
 * Operations › Payment requests (claude/core-plan.md, phase 1): every part of the plans of the orders that
 * still have money due, each a request with where it stands. Sent and recorded from here or from the order.
 */
export default async function PaymentRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; mine?: string; page?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const list = await api.get<RequestList>("/billing/requests", { mine: sp.mine === "1" ? "true" : undefined });
  const all = list.rows;
  const chip: Chip = CHIPS.some((c) => c.key === sp.status) ? (sp.status as Chip) : "all";
  const q = sp.q?.trim().toLowerCase() ?? "";
  const rows = all
    .filter((r) => inChip(r, chip))
    .filter((r) => !q || [r.number, r.label, r.order.refNo, r.customer.name].join(" ").toLowerCase().includes(q));
  const page = toPage(sp.page);
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);
  const keep = { status: chip === "all" ? undefined : chip, q: sp.q, mine: sp.mine === "1" ? "1" : undefined };
  const href = (p: Record<string, string | undefined>) => buildHref("/operations/payment-requests", keep, { ...p, page: undefined });
  const sum = (rs: Row[]) => {
    const by = new Map<string, number>();
    for (const r of rs) by.set(r.currency, (by.get(r.currency) ?? 0) + Number(r.open));
    return [...by.entries()].sort((a, b) => b[1] - a[1]);
  };
  const tile = (rs: Row[]) => {
    const s = sum(rs);
    return {
      value: s.length ? short(s[0]![1], s[0]![0]) : "0",
      sub: `${rs.length} request${rs.length === 1 ? "" : "s"}${
        s.length > 1
          ? ` · ${s
              .slice(1)
              .map(([c, v]) => short(v, c))
              .join(" · ")}`
          : ""
      }`,
    };
  };
  const toSend = all.filter((r) => inChip(r, "to_send"));
  const waiting = all.filter((r) => inChip(r, "waiting"));
  const late = all.filter((r) => inChip(r, "late"));
  const back = buildHref("/operations/payment-requests", keep, {});

  return (
    <div>
      <PageHeader
        crumbs={crumbsFor("/operations/payment-requests")}
        icon={FileText}
        title="Payment requests"
        description="Each part of an order's plan, with where it stands"
      />
      <StatRow className="mb-4">
        <StatTile
          icon={Send}
          iconColor={2}
          label="To send"
          {...tile(toSend)}
          href={toSend.length ? href({ status: "to_send" }) : undefined}
        />
        <StatTile
          icon={Clock}
          iconColor={3}
          label="Waiting for payment"
          {...tile(waiting)}
          href={waiting.length ? href({ status: "waiting" }) : undefined}
        />
        <StatTile
          icon={AlertTriangle}
          iconColor={5}
          label="Late"
          {...tile(late)}
          tone={late.length ? "bad" : undefined}
          href={late.length ? href({ status: "late" }) : undefined}
        />
      </StatRow>

      <LinkTabs
        label="Which requests"
        className="mb-4"
        tabs={CHIPS.map((c) => {
          const n = c.key === "to_send" || c.key === "late" ? all.filter((r) => inChip(r, c.key)).length : 0;
          const Icon = c.icon;
          return {
            href: href({ status: c.key === "all" ? undefined : c.key }),
            label: (
              <>
                <Icon aria-hidden />
                {c.label}
                {n ? ` ${n}` : ""}
              </>
            ),
            active: chip === c.key,
          };
        })}
      />

      <FilterCard
        search="Search request, order, customer…"
        value={sp.q}
        keep={{ status: keep.status }}
        clearHref={href({ q: undefined })}
        selects={[{ name: "mine", label: "Whose orders", value: sp.mine, options: [{ value: "1", label: "My orders" }] }]}
      />

      <Card className="overflow-hidden">
        {shown.length === 0 ? (
          <EmptyState
            title={all.length ? "No request matches" : "No payment requests open"}
            description={all.length ? "Clear the search or choose All." : "Orders with money still due show their plan here, part by part."}
          />
        ) : (
          <Table className="min-w-[860px]">
            <THead>
              <tr>
                <Th>Request</Th>
                <Th>Customer · order</Th>
                <Th>Due</Th>
                <Th className="text-right">Amount</Th>
                <Th className="text-right">Still due</Th>
                <Th>Status</Th>
                <Th>
                  <span className="sr-only">Next</span>
                </Th>
              </tr>
            </THead>
            <tbody>
              {shown.map((r) => (
                <Tr key={`${r.order.id}-${r.ref}`}>
                  <Td>
                    <Link href={requestHref(r.order.id, r.ref)} className="font-medium whitespace-nowrap hover:text-primary">
                      {r.number}
                    </Link>
                    <span className="block text-xs text-muted">{r.label}</span>
                  </Td>
                  <Td>
                    <Link href={`/customers/${r.customer.id}`} className="hover:text-primary">
                      {r.customer.name}
                    </Link>
                    <span className="block text-xs text-muted">
                      <Link href={`/orders/${r.order.id}/payment`} className="hover:underline">
                        {r.order.refNo}
                      </Link>
                      {r.lookedAfterBy ? ` · ${r.lookedAfterBy.name}` : ""}
                    </span>
                  </Td>
                  <Td className="text-sm whitespace-nowrap">{r.dueOn ? date(r.dueOn) : <span className="text-muted">No date yet</span>}</Td>
                  <Td className="text-right whitespace-nowrap tabular">{money(r.amount, r.currency)}</Td>
                  <Td className="text-right font-semibold whitespace-nowrap tabular">
                    {Number(r.open) > 0 ? money(r.open, r.currency) : "—"}
                  </Td>
                  <Td>
                    <RequestStatus r={r} late={r.late} />
                  </Td>
                  <Td className="text-right">
                    {(r.state === "sent" || r.state === "part_paid") && !r.changed && list.canPay ? (
                      <Link
                        href={recordPaymentHref({ kind: "in", order: r.order.id, amount: r.open, back })}
                        className="text-sm font-medium whitespace-nowrap text-primary hover:underline"
                      >
                        Record payment
                      </Link>
                    ) : (
                      <Link
                        href={requestHref(r.order.id, r.ref)}
                        className="text-sm font-medium whitespace-nowrap text-primary hover:underline"
                      >
                        {((r.state === "not_sent" && r.through === "customer") || r.changed) && list.canSend ? "Open to send" : "View"}
                      </Link>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Pager base="/operations/payment-requests" params={keep} page={page} pageSize={PAGE} total={rows.length} bare />
    </div>
  );
}
