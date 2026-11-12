import Link from "next/link";
import { buildHref, Card, EmptyState, LinkTabs, Pager, PhoneList, PhoneRow, Table, Td, Th, THead, toPage, Tr } from "@kebo/ui";
import { api } from "@/lib/api";
import { date, money } from "@/lib/format";
import { FilterCard } from "@/components/common/filter-card";
import type { RequestList } from "@/lib/types-money";
import { recordPaymentHref } from "@/components/money/pay-links";
import { RequestStatus } from "@/components/money/requests";
import { requestHref, requestWords } from "@/lib/requests";

type Row = RequestList["rows"][number];
type Chip = "all" | "to_send" | "waiting" | "late";

const CHIPS: { key: Chip; label: string }[] = [
  { key: "all", label: "All open" },
  { key: "to_send", label: "To send" },
  { key: "waiting", label: "Waiting for payment" },
  { key: "late", label: "Late" },
];

const toSend = (r: Row) => (r.state === "not_sent" && r.through === "customer") || r.changed;
const inChip = (r: Row, c: Chip) =>
  c === "all" ? true : c === "to_send" ? toSend(r) : c === "waiting" ? (r.state === "sent" || r.state === "part_paid") && !r.changed : r.late > 0;

const PAGE = 20;

/**
 * Payments › Payment requests: every part of an order's plan that is still being asked for, with where it
 * stands and the one thing to do next. A request leaves this tab when it is paid in full (its payments and
 * receipts are then under Paid) or cancelled.
 */
export async function RequestsTab({ sp }: { sp: { status?: string; q?: string; mine?: string; page?: string } }) {
  const list = await api.get<RequestList>("/billing/requests", { mine: sp.mine === "1" ? "true" : undefined });
  const open = list.rows.filter((r) => r.state !== "paid" && r.state !== "cancelled");
  const chip: Chip = CHIPS.some((c) => c.key === sp.status) ? (sp.status as Chip) : "all";
  const q = sp.q?.trim().toLowerCase() ?? "";
  const rows = open.filter((r) => inChip(r, chip)).filter((r) => !q || [r.number, r.label, r.order.refNo, r.customer.name].join(" ").toLowerCase().includes(q));
  const page = toPage(sp.page);
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);
  const keep = { tab: "requests", status: chip === "all" ? undefined : chip, q: sp.q, mine: sp.mine === "1" ? "1" : undefined };
  const href = (p: Record<string, string | undefined>) => buildHref("/payments", keep, { ...p, page: undefined });
  const back = buildHref("/payments", keep, {});
  const quiet = "text-sm font-medium whitespace-nowrap text-primary hover:underline";
  /** The one thing to do next on a row. */
  const next = (r: Row) =>
    r.through === "bank" && r.state === "not_sent" ? (
      <Link href={`/orders/${r.order.id}/documents`} className={quiet}>
        Bank papers
      </Link>
    ) : toSend(r) && list.canSend ? (
      <Link href={requestHref(r.order.id, r.ref)} className={quiet}>
        {r.changed ? "Send again" : "Send request"}
      </Link>
    ) : list.canPay ? (
      <Link href={recordPaymentHref({ kind: "in", order: r.order.id, amount: r.open, back })} className={quiet}>
        Record payment
      </Link>
    ) : (
      <Link href={requestHref(r.order.id, r.ref)} className={quiet}>
        Open
      </Link>
    );

  return (
    <>
      <LinkTabs
        label="Which requests"
        className="mb-4"
        tabs={CHIPS.map((c) => ({
          href: href({ status: c.key === "all" ? undefined : c.key }),
          label: c.label,
          count: c.key === "to_send" || c.key === "late" ? open.filter((r) => inChip(r, c.key)).length || undefined : undefined,
          alert: c.key === "late",
          active: chip === c.key,
        }))}
      />
      <FilterCard
        search="Search request, order, customer…"
        value={sp.q}
        keep={{ tab: "requests", status: keep.status }}
        clearHref={href({ q: undefined })}
        selects={[{ name: "mine", label: "Whose orders", value: sp.mine, options: [{ value: "1", label: "My orders" }] }]}
      />
      <Card className="overflow-clip p-0">
        {shown.length === 0 ? (
          <EmptyState
            framed
            title={open.length ? "No request matches" : "Nothing is being asked for"}
            description={open.length ? "Clear the search or choose All open." : "Every part of every order is paid. Paid ones are under Paid."}
          />
        ) : (
          <>
            <PhoneList label="Payment requests">
              {shown.map((r) => (
                <PhoneRow
                  key={`${r.order.id}-${r.ref}`}
                  href={requestHref(r.order.id, r.ref)}
                  title={`${r.customer.name} · ${r.label}`}
                  line={`${r.number}${r.dueOn ? ` · due ${date(r.dueOn)}` : ""}`}
                  status={
                    <span className={r.late > 0 ? "font-medium text-bad" : "font-medium text-text"}>
                      {requestWords(r)}
                      {r.late > 0 ? ` · ${r.late}d late` : ""}
                    </span>
                  }
                  figure={money(r.open, r.currency)}
                />
              ))}
            </PhoneList>
            <div className="hidden overflow-x-auto sm:block">
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
                      <Td className="text-right font-semibold whitespace-nowrap tabular">{money(r.open, r.currency)}</Td>
                      <Td>
                        <RequestStatus r={r} late={r.late} />
                      </Td>
                      <Td className="text-right">{next(r)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </>
        )}
        <Pager base="/payments" params={keep} page={page} pageSize={PAGE} total={rows.length} />
      </Card>
    </>
  );
}
