import { X } from "lucide-react";
import { ORDER_WORD_TONE } from "@kebo/shared";
import {
  ButtonLink,
  Card,
  DataRow,
  EmptyState,
  PhoneList,
  PhoneRow,
  RefCode,
  StatusBadge,
  Td,
  Th,
  THead,
  type StatusMeaning,
} from "@kebo/ui";
import { todayIn } from "@kebo/utils";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { customerOf, customerPaymentsOf } from "@/lib/party-data";
import { date, TZ, whole } from "@/lib/format";
import type { DealRow, Paged } from "@/lib/types";
import type { CustomerPayments } from "@/lib/types-money";
import { DataTable } from "@/components/common/data-table";
import { FilterCard } from "@/components/common/filter-card";
import { late } from "../shared";

export const metadata = { title: "Customer orders" };

type PayOrder = CustomerPayments["orders"][number];

const STATUS = [
  { value: "open", label: "Open" },
  { value: "late", label: "Payment late" },
  { value: "closed", label: "Closed" },
  { value: "cancelled", label: "Cancelled" },
];

/** Where the order is, in a word: late money first, then its stage; closed or cancelled. */
function statusOf(o: PayOrder, today: string): { label: string; meaning: StatusMeaning } {
  if (o.status === "open" && late(o, today)) return { label: o.payStatus === "unpaid" ? "Deposit late" : "Payment late", meaning: "bad" };
  return { label: o.word, meaning: ORDER_WORD_TONE[o.word] };
}

/**
 * The customer's Orders tab (board "Customer — Orders tab"): search by number, Status and Year; each order with
 * its quotation, day, what was bought, total, received, what they owe and where it is; totals under the table.
 */
export default async function CustomerOrders({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; status?: string; year?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  await requireUser();
  const [c, pay, deals] = await Promise.all([
    customerOf(id),
    customerPaymentsOf(id),
    api.get<Paged<DealRow>>("/inquiries", { customerId: id, stage: "won", pageSize: 100 }).catch(() => null),
  ]);
  const today = todayIn(TZ);
  const byOrder = new Map((deals?.rows ?? []).filter((d) => d.order).map((d) => [d.order!.id, d]));
  // Without the payments (people who may not see them): the orders alone, money columns blank.
  const all: PayOrder[] = [
    ...(pay?.orders ??
      c.orders.map((o) => ({
        ...o,
        stage: "",
        received: "",
        due: "",
        depositDue: "",
        payStatus: "unpaid" as const,
        lastPaidOn: null,
        next: null,
      }))),
  ].sort((a, b) => b.orderedOn.localeCompare(a.orderedOn));
  const cash = (v: string, cur: string) => (pay ? whole(v, cur) : "—");
  const years = [...new Set(all.map((o) => o.orderedOn.slice(0, 4)))].sort().reverse();
  const q = sp.q?.trim().toLowerCase();
  const rows = all.filter(
    (o) =>
      (!q || o.refNo.toLowerCase().includes(q) || byOrder.get(o.id)?.title.toLowerCase().includes(q)) &&
      (!sp.year || o.orderedOn.startsWith(sp.year)) &&
      (!sp.status || (sp.status === "late" ? o.status === "open" && late(o, today) : o.status === sp.status)),
  );
  const filtered = !!(q || sp.year || sp.status);
  // Totals per currency (most customers have one).
  const sums = [...new Set(rows.map((o) => o.currency))].map((cur) => {
    const of = rows.filter((o) => o.currency === cur && o.status !== "cancelled");
    const add = (k: "total" | "received" | "due") => of.reduce((t, o) => t + Number(o[k]), 0);
    return { cur, total: add("total"), received: add("received"), due: add("due") };
  });
  const base = `/customers/${c.id}/orders`;

  return (
    <>
      <FilterCard
        search="Search order no…"
        value={sp.q}
        clearHref={base}
        selects={[
          { name: "status", label: "Status", value: sp.status, options: STATUS },
          { name: "year", label: "Year", value: sp.year, options: years.map((y) => ({ value: y, label: y })) },
        ]}
      />
      <Card className="overflow-clip p-0">
        {rows.length === 0 ? (
          <EmptyState
            title={filtered ? "No orders match" : "No orders yet"}
            description={filtered ? "Try another number, status or year." : "An order appears here when this customer accepts a quotation."}
            action={
              filtered ? (
                <ButtonLink href={base}>
                  <X aria-hidden /> Clear filters
                </ButtonLink>
              ) : undefined
            }
          />
        ) : (
          <>
            <PhoneList label="Orders">
              {rows.map((o) => {
                const s = statusOf(o, today);
                return (
                  <PhoneRow
                    key={o.id}
                    href={`/orders/${o.id}`}
                    title={o.refNo}
                    line={[date(o.orderedOn), byOrder.get(o.id)?.title].filter(Boolean).join(" · ")}
                    status={<StatusBadge meaning={s.meaning}>{s.label}</StatusBadge>}
                    figure={whole(o.total, o.currency)}
                  />
                );
              })}
            </PhoneList>
            <DataTable label="Orders" className="max-sm:hidden" tableClassName="min-w-[1000px] text-[13px]">
                <THead>
                  <tr>
                    <Th>Order</Th>
                    <Th>Quotation</Th>
                    <Th>Date</Th>
                    <Th>Items</Th>
                    <Th className="text-right">Total</Th>
                    <Th className="text-right">Received</Th>
                    <Th className="text-right">They owe</Th>
                    <Th>Status</Th>
                  </tr>
                </THead>
                <tbody>
                  {rows.map((o) => {
                    const d = byOrder.get(o.id);
                    const s = statusOf(o, today);
                    return (
                      <DataRow key={o.id} href={`/orders/${o.id}`}>
                        <Td>
                          <RefCode href={`/orders/${o.id}`}>{o.refNo}</RefCode>
                        </Td>
                        <Td>{d?.quotation ? <RefCode href={`/inquiries/${d.id}/quotation`}>{d.quotation.refNo}</RefCode> : "—"}</Td>
                        <Td className="whitespace-nowrap">{date(o.orderedOn)}</Td>
                        <Td className="max-w-72 truncate">{d?.title ?? "—"}</Td>
                        <Td className="text-right whitespace-nowrap tabular">{whole(o.total, o.currency)}</Td>
                        <Td className="text-right whitespace-nowrap tabular">{cash(o.received, o.currency)}</Td>
                        <Td className="text-right whitespace-nowrap tabular">
                          {Number(o.due) > 0.005 && o.status !== "cancelled" ? cash(o.due, o.currency) : "—"}
                        </Td>
                        <Td>
                          <StatusBadge meaning={s.meaning}>{s.label}</StatusBadge>
                        </Td>
                      </DataRow>
                    );
                  })}
                </tbody>
                <tfoot>
                  {sums.map((t) => (
                    <tr key={t.cur} className="border-t-2 border-line bg-[#f8faf9] font-bold dark:bg-surface-2">
                      <Td colSpan={3} />
                      <Td>Total{sums.length > 1 ? ` (${t.cur})` : ""}</Td>
                      <Td className="text-right whitespace-nowrap tabular">{whole(t.total, t.cur)}</Td>
                      <Td className="text-right whitespace-nowrap tabular">{cash(String(t.received), t.cur)}</Td>
                      <Td className="text-right whitespace-nowrap tabular">{cash(String(t.due), t.cur)}</Td>
                      <Td />
                    </tr>
                  ))}
                </tfoot>
            </DataTable>
          </>
        )}
      </Card>
    </>
  );
}
