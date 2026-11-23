import type { ReactNode } from "react";
import Link from "next/link";
import { cn, Table, Td, Th, THead, Tr, linkClass, Dash, RULES, PhoneList, PhoneRow } from "@kebo/ui";
import { costKind } from "@/components/money/cost-kinds";
import { RepayWindow } from "@/components/order-sections/costs-windows";
import { Section } from "@/components/order-sections/section";
import { date, money, num2 as n2 } from "@/lib/format";
import type { CostSheetRow, ExpenseView } from "@/lib/types-money";
import { COST_FROM } from "./cost-words";

const dash = <Dash />;

/** How a cost was paid, under "Comes from": "Sana's own money", "Office cash", "not paid yet". */
export function paidHow(e: Pick<ExpenseView, "ownMoney" | "payLater" | "paidBy" | "account" | "repaid">): string | null {
  if (e.ownMoney) return `${e.paidBy ? `${e.paidBy.name}'s` : "Someone's"} own money`;
  if (e.payLater) return e.repaid ? (e.repaid.account?.name ?? "paid") : "not paid yet";
  return e.account?.name ?? null;
}

/** An expense as a row of the cost sheet (an inquiry's costs, in the main currency): the same states as an order's. */
export function sheetRowOf(e: ExpenseView): CostSheetRow {
  const open = (e.payLater || e.ownMoney) && !e.repaid;
  return {
    key: e.id,
    kind: "cost",
    label: e.description,
    category: e.category,
    owedTo: e.payee ?? e.factory?.name ?? (e.ownMoney ? (e.paidBy?.name ?? null) : null),
    from: "typed",
    amount: e.amount,
    currency: e.currency,
    inOrder: e.inMain,
    paid: open ? "0.00" : e.amount,
    toPay: open ? e.amount : "0.00",
    paidInOrder: open ? "0.00" : e.inMain,
    toPayInOrder: open ? e.inMain : "0.00",
    state: !open ? "paid" : e.ownMoney ? "to_repay" : "to_pay",
    borneBy: "us",
    expenseId: e.id,
    on: e.repaid?.on ?? e.spentOn,
  };
}

/**
 * The cost sheet (an order's Costs tab, and an inquiry's): what for, who we owe, where it comes from and how it
 * was paid, the cost in one currency, paid, still to pay, and what can be done on the row. Total at the foot.
 */
export function CostSheetTable({
  rows,
  currency,
  totals,
  action,
  receiptOf,
  howOf,
  fromHref = {},
}: {
  rows: CostSheetRow[];
  /** The currency of the Cost, Paid and Still to pay columns. */
  currency: string;
  totals: { costs: string; paid: string; toPay: string } | null;
  action: (r: CostSheetRow) => ReactNode;
  receiptOf: (r: CostSheetRow) => { id: string } | null;
  /** How a row was paid, under where it comes from. */
  howOf?: (r: CostSheetRow) => string | null;
  fromHref?: Partial<Record<CostSheetRow["from"], string>>;
}) {
  const c = currency;
  const toPay = Number(totals?.toPay ?? 0);
  const kindOf = (r: CostSheetRow) =>
    r.kind === "goods"
      ? "Goods from the supplier"
      : r.kind === "estimate"
        ? "Estimated on the quotation"
        : r.category && r.kind === "cost"
          ? costKind(r.category)
          : r.label;
  return (
    <>
      {/* A phone: the shared two-line rows (what for and the cost; who and where from, and what is still to pay), the
        row's button under it, the total last. */}
      <PhoneList label="Costs">
        {rows.map((r) => {
          const due = Number(r.toPayInOrder ?? 0) > 0 && r.kind !== "estimate";
          const receipt = receiptOf(r);
          const act = action(r);
          return (
            <PhoneRow
              key={r.key}
              muted={r.kind === "estimate" || r.borneBy !== "us"}
              title={kindOf(r)}
              figure={r.inOrder !== null ? n2(r.inOrder) : money(r.amount, r.currency)}
              line={[r.owedTo, COST_FROM[r.from], howOf?.(r)].filter(Boolean).join(" · ")}
              status={
                due ? (
                  <span className="font-semibold text-warn">{n2(r.toPayInOrder!)} to pay</span>
                ) : r.kind === "estimate" ? (
                  <span className="text-text-2">estimate</span>
                ) : (
                  <span className="text-ok">paid</span>
                )
              }
              extra={
                act || receipt ? (
                  <div className="flex items-center justify-end gap-3 px-4 pb-3">
                    {receipt && (
                      <a href={`/files/${receipt.id}?view=1`} className={cn(linkClass, "mr-auto text-sm")}>
                        Their bill
                      </a>
                    )}
                    {act}
                  </div>
                ) : undefined
              }
            />
          );
        })}
        {totals && (
          <li className="flex items-baseline justify-between gap-3 px-4 py-3 text-sm font-bold">
            <span>Total {c}</span>
            <span className="tabular">
              {n2(totals.costs)}
              {toPay > 0 && <span className="ml-2 font-semibold text-warn">{n2(totals.toPay)} to pay</span>}
            </span>
          </li>
        )}
      </PhoneList>
      <div className="max-sm:hidden">
        <Table>
          <THead>
            <tr>
              <Th>What for</Th>
              <Th>Payable to</Th>
              <Th>Comes from</Th>
              <Th className="text-right">Cost {c}</Th>
              <Th className="text-right">Paid</Th>
              <Th className="text-right">Still to pay</Th>
              <Th>
                <span className="sr-only">Pay or change</span>
              </Th>
            </tr>
          </THead>
          <tbody>
            {rows.map((r) => {
              const ours = r.borneBy === "us";
              const receipt = receiptOf(r);
              const kind = kindOf(r);
              const detail = r.kind === "cost" && r.label !== kind ? r.label : r.kind === "estimate" ? r.label : null;
              const how = howOf?.(r);
              return (
                <Tr key={r.key} className={r.kind === "estimate" || !ours ? "text-text-2" : undefined}>
                  <Td>
                    <span className="font-semibold">{kind}</span>
                    {detail && <span className="block text-xs text-text-2">{detail}</span>}
                    {receipt && (
                      <a href={`/files/${receipt.id}?view=1`} className={cn(linkClass, "block text-xs")}>
                        Their bill
                      </a>
                    )}
                  </Td>
                  <Td>{r.owedTo ?? dash}</Td>
                  <Td className="text-text-2">
                    {fromHref[r.from] ? (
                      <Link href={fromHref[r.from]!} className="hover:text-primary hover:underline">
                        {COST_FROM[r.from]}
                      </Link>
                    ) : (
                      COST_FROM[r.from]
                    )}
                    {how && <span className="block text-xs">{how}</span>}
                  </Td>
                  <Td className="text-right whitespace-nowrap tabular">
                    {r.inOrder !== null ? n2(r.inOrder) : dash}
                    {(r.currency !== c || r.inOrder === null) && (
                      <span className="block text-xs text-text-2">{money(r.amount, r.currency)}</span>
                    )}
                  </Td>
                  <Td className="text-right whitespace-nowrap tabular">
                    {r.paidInOrder !== null && r.kind !== "estimate" ? n2(r.paidInOrder) : dash}
                  </Td>
                  <Td className={cn("text-right whitespace-nowrap tabular", Number(r.toPayInOrder ?? 0) > 0 && "font-semibold text-warn")}>
                    {r.toPayInOrder !== null && r.kind !== "estimate" ? n2(r.toPayInOrder) : dash}
                  </Td>
                  <Td className="text-right">{action(r)}</Td>
                </Tr>
              );
            })}
          </tbody>
          {totals && (
            <tfoot>
              <tr className="border-t-2 border-line-strong font-bold">
                <td className="px-3.5 py-3" colSpan={3}>
                  Total
                </td>
                <td className="px-3.5 py-3 text-right tabular">{n2(totals.costs)}</td>
                <td className="px-3.5 py-3 text-right tabular">{n2(totals.paid)}</td>
                <td className={cn("px-3.5 py-3 text-right tabular", toPay > 0 && "text-warn")}>{n2(totals.toPay)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </Table>
      </div>
    </>
  );
}

/** Someone who paid costs here from their own money and is not paid back yet. */
export interface OwedPerson {
  person: { id: string; name: string };
  currency: string;
  amount: string;
  ids: string[];
  /** The oldest of their costs here. */
  since: string;
}

/** Costs paid from someone's own money, not paid back yet, per person and currency. */
export function owedOf(
  rows: Pick<ExpenseView, "id" | "ownMoney" | "repaid" | "paidBy" | "currency" | "amount" | "spentOn" | "voided">[],
): OwedPerson[] {
  const by = new Map<string, OwedPerson>();
  for (const e of rows) {
    if (!e.ownMoney || e.repaid || !e.paidBy || e.voided) continue;
    const key = `${e.paidBy.id}:${e.currency}`;
    const o = by.get(key) ?? { person: e.paidBy, currency: e.currency, amount: "0", ids: [], since: e.spentOn };
    o.amount = (Number(o.amount) + Number(e.amount)).toFixed(2);
    o.ids.push(e.id);
    if (e.spentOn < o.since) o.since = e.spentOn;
    by.set(key, o);
  }
  return [...by.values()];
}

/**
 * "Owed back" (design "spending"): who paid costs here from their own money and is not paid back yet, with
 * Pay back. The same money shows under Owed back on their page and on Finance › Receivables & payables.
 */
export function OwedBack({
  owed,
  where,
  orderId,
  today,
  canPay,
  canFiles = false,
}: {
  owed: OwedPerson[];
  where: string;
  orderId: string | null;
  today: string;
  canPay: boolean;
  canFiles?: boolean;
}) {
  if (!owed.length) return null;
  return (
    <Section title="Owed back" state={`${owed.length} ${owed.length === 1 ? "person" : "people"}`} tone="warn">
      <ul className="flex flex-col divide-y divide-line border-t border-line">
        {owed.map((o) => {
          const amount = money(o.amount, o.currency);
          return (
            <li
              key={`${o.person.id}:${o.currency}`}
              className={cn(RULES.box.inset, "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3")}
            >
              <span className="min-w-0 text-md">
                <span className="block font-semibold">{o.person.name}</span>
                <span className="block text-text-2">
                  Paid {o.ids.length === 1 ? "1 cost" : `${o.ids.length} costs`} {where} with their own money · since {date(o.since)}
                </span>
              </span>
              {canPay ? (
                <RepayWindow
                  orderId={orderId}
                  ids={o.ids}
                  currency={o.currency}
                  name={o.person.name}
                  amount={amount}
                  today={today}
                  canFiles={canFiles}
                  label={`Pay back ${o.person.name} · ${amount}`}
                />
              ) : (
                <span className="text-sm font-semibold tabular">{amount}</span>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
