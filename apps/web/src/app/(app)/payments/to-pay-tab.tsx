import Link from "next/link";
import { FACTORY_DUE_RULE_LABEL, FACTORY_PLAN_STATUS_LABEL, PAYMENT_ROUTE_SHORT } from "@kebo/shared";
import { buildHref, Card, cn, EmptyState, LinkTabs, Pager, PhoneList, PhoneRow, Table, Td, Th, THead, toPage, Tr } from "@kebo/ui";
import { api } from "@/lib/api";
import { date, money } from "@/lib/format";
import { FilterCard } from "@/components/common/filter-card";
import type { ToPayList } from "@/lib/types-money";
import { recordPaymentHref } from "@/components/money/pay-links";

type Row = ToPayList["rows"][number];
type Chip = "all" | "due" | "late" | "later";

const CHIPS: { key: Chip; label: string }[] = [
  { key: "all", label: "All open" },
  { key: "due", label: "Due now" },
  { key: "late", label: "Late" },
  { key: "later", label: "Not due yet" },
];

const inChip = (r: Row, c: Chip) =>
  c === "all" ? true : c === "late" ? r.late > 0 : c === "due" ? r.status === "due" || r.late > 0 : r.late === 0 && r.status !== "due";

const PAGE = 20;

/** "Late 4 days", "Due", "Part paid", "Not due yet": where a part stands. */
export function partWords(r: { status: Row["status"]; late: number }) {
  return r.late > 0 ? `Late ${r.late} ${r.late === 1 ? "day" : "days"}` : FACTORY_PLAN_STATUS_LABEL[r.status];
}

/** The order's route and where the customer's money stands, as the person paying the factory reads it. */
export function CustomerMoney({ m, className }: { m: Row["customerMoney"]; className?: string }) {
  return (
    <span className={cn("block text-sm", className)}>
      <span className={m.warn ? "font-medium text-warn" : "text-text"}>{m.words}</span>
      <span className="block text-xs text-muted tabular">
        {m.route ? `${PAYMENT_ROUTE_SHORT[m.route]} · ` : ""}
        {money(m.received, m.currency)} of {money(m.total, m.currency)} in
      </span>
    </span>
  );
}

/**
 * Payments › To pay: every part of a supplier's plan still open, soonest first, with the one thing to do
 * (Pay). Beside each part: the order's payment route and what the customer has paid on that order, so
 * nobody pays a factory without seeing the other side. A part leaves this tab when it is paid in full
 * (its payment is then under Paid).
 */
export async function ToPayTab({ sp }: { sp: { status?: string; q?: string; mine?: string; page?: string } }) {
  const list = await api.get<ToPayList>("/billing/to-pay", { mine: sp.mine === "1" ? "true" : undefined });
  const chip: Chip = CHIPS.some((c) => c.key === sp.status) ? (sp.status as Chip) : "all";
  const q = sp.q?.trim().toLowerCase() ?? "";
  const rows = list.rows
    .filter((r) => inChip(r, chip))
    .filter(
      (r) =>
        !q ||
        [r.po, r.label, r.supplierRef, r.supplier.name, r.order.refNo, r.customer.name].filter(Boolean).join(" ").toLowerCase().includes(q),
    );
  const page = toPage(sp.page);
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);
  const keep = { tab: "to-pay", status: chip === "all" ? undefined : chip, q: sp.q, mine: sp.mine === "1" ? "1" : undefined };
  const href = (p: Record<string, string | undefined>) => buildHref("/payments", keep, { ...p, page: undefined });
  const back = buildHref("/payments", keep, {});
  const payHref = (r: Row) =>
    recordPaymentHref({ kind: "out", order: r.order.id, factory: r.supplier.id, amount: r.open, part: r.part, back });
  const planHref = (r: Row) => `/orders/${r.order.id}/factory#plan-${r.supplier.id}`;
  const quiet = "text-sm font-medium whitespace-nowrap text-primary hover:underline";

  return (
    <>
      {list.totals.length > 0 && (
        <p className="mb-3 text-sm text-text-2">
          Still to pay:{" "}
          {list.totals.map((t, i) => (
            <span key={t.currency}>
              {i > 0 && " · "}
              <span className="font-semibold text-text tabular">{money(t.open, t.currency)}</span>
              {Number(t.late) > 0 && <span className="text-bad"> ({money(t.late, t.currency)} late)</span>}
            </span>
          ))}
        </p>
      )}
      <LinkTabs
        label="Which parts"
        className="mb-4"
        tabs={CHIPS.map((c) => ({
          href: href({ status: c.key === "all" ? undefined : c.key }),
          label: c.label,
          count: c.key === "due" || c.key === "late" ? list.rows.filter((r) => inChip(r, c.key)).length || undefined : undefined,
          alert: c.key === "late",
          active: chip === c.key,
        }))}
      />
      <FilterCard
        search="Search supplier, PO, order, customer…"
        value={sp.q}
        keep={{ tab: "to-pay", status: keep.status }}
        clearHref={href({ q: undefined })}
        selects={[{ name: "mine", label: "Whose suppliers", value: sp.mine, options: [{ value: "1", label: "My suppliers" }] }]}
      />
      <Card className="overflow-clip p-0">
        {shown.length === 0 ? (
          <EmptyState
            framed
            title={list.rows.length ? "No part matches" : "Nothing to pay"}
            description={
              list.rows.length
                ? "Clear the search or choose All open."
                : "Every supplier is paid for every order. Payments made are under Paid."
            }
          />
        ) : (
          <>
            <PhoneList label="To pay suppliers">
              {shown.map((r) => (
                <PhoneRow
                  key={r.key}
                  href={list.canPay ? payHref(r) : planHref(r)}
                  title={r.supplier.name}
                  line={`${r.label} · ${r.customerMoney.words}`}
                  status={
                    <span className={r.late > 0 ? "font-medium text-bad" : "font-medium text-text"}>
                      {r.late > 0 || !r.dueOn ? partWords(r) : `Due ${date(r.dueOn)}`}
                    </span>
                  }
                  figure={money(r.open, r.currency)}
                />
              ))}
            </PhoneList>
            <div className="hidden overflow-x-auto sm:block">
              <Table className="min-w-[980px]">
                <THead>
                  <tr>
                    <Th>Supplier · order</Th>
                    <Th>Part</Th>
                    <Th>Due</Th>
                    <Th className="text-right">Still to pay</Th>
                    <Th>Status</Th>
                    <Th>Customer&apos;s money</Th>
                    <Th>
                      <span className="sr-only">Next</span>
                    </Th>
                  </tr>
                </THead>
                <tbody>
                  {shown.map((r) => (
                    <Tr key={r.key}>
                      <Td>
                        <Link href={`/factories/${r.supplier.id}`} className="font-medium hover:text-primary">
                          {r.supplier.name}
                        </Link>
                        <span className="block text-xs text-muted">
                          <Link href={planHref(r)} className="hover:underline">
                            {r.po ? `${r.po} · ` : ""}
                            {r.order.refNo}
                          </Link>{" "}
                          · {r.customer.name}
                        </span>
                      </Td>
                      <Td>
                        {r.label}
                        <span className="block text-xs text-muted tabular">
                          {Number(r.paid) > 0
                            ? `${money(r.paid, r.currency)} of ${money(r.amount, r.currency)} paid`
                            : money(r.amount, r.currency)}
                          {r.supplierRef ? ` · inv. ${r.supplierRef}` : ""}
                        </span>
                      </Td>
                      <Td className="text-sm whitespace-nowrap">
                        {r.dueOn ? date(r.dueOn) : <span className="text-muted">No date yet</span>}
                        <span className="block text-xs text-muted">{FACTORY_DUE_RULE_LABEL[r.dueRule]}</span>
                      </Td>
                      <Td className="text-right font-semibold whitespace-nowrap tabular">{money(r.open, r.currency)}</Td>
                      <Td className="whitespace-nowrap">
                        <span className={r.late > 0 ? "font-medium text-bad" : r.status === "due" ? "font-medium text-warn" : "text-text"}>
                          {partWords(r)}
                        </span>
                      </Td>
                      <Td>
                        <CustomerMoney m={r.customerMoney} />
                      </Td>
                      <Td className="text-right">
                        <Link href={list.canPay ? payHref(r) : planHref(r)} className={quiet}>
                          {list.canPay ? "Pay" : "Open"}
                        </Link>
                      </Td>
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
