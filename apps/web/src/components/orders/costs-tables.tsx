"use client";

import { useMemo, useState } from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { COST_ROW_STATUS_LABEL, expenseShort, lineNumbers, type CostRowStatus } from "@kebo/shared";
import { Alert, Badge, Button, Field, Input, Select } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { useExcelAllowed } from "@/components/common/features";
import { LineTable, type LineColumn, type LineRow } from "@/components/lines/line-table";
import { lineExport } from "@/components/sheets/line-sheets";
import { downloadSheet } from "@/components/sheets/excel-menu";
import { useAccounts } from "@/components/money/accounts";
import { repayAction } from "@/app/(app)/money/actions";
import { date, money } from "@/lib/format";
import type { CostExpense, OrderCosts } from "@/lib/types-money";
import { EditOrderExpense, type ExpenseSetup } from "./expense-form";

/** The Costs tables are shown only: changes go through the expense form. */
const shownOnly = {
  readOnly: true,
  onAdd: async () => ({ ok: true as const }),
  onEdit: async () => ({ ok: true as const }),
  onRemove: async () => ({ ok: true as const }),
  onMove: async () => ({ ok: true as const }),
};

const n2 = (v: string) => Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS_TONE: Record<CostRowStatus, "neutral" | "ok" | "warn" | "bad" | "info"> = {
  not_spent: "neutral",
  within: "info",
  spent: "ok",
  over: "bad",
  not_planned: "warn",
};

/** "Planned and spent": each planned cost of the quote against what was spent, then what nobody planned. */
export function PlannedTable({ costs }: { costs: OrderCosts }) {
  const c = costs.currency;
  const columns: LineColumn[] = [
    // Fixed widths that fit the page beside the side cards (the table still fills the width).
    { key: "label", label: "Cost", width: "11rem", format: (v) => v.label! },
    { key: "planned", label: `Planned ${c}`, width: "6.5rem", align: "right", format: (v) => (v.planned ? n2(v.planned) : "—") },
    { key: "spent", label: `Spent ${c}`, width: "6.5rem", align: "right", format: (v) => n2(v.spent!) },
    {
      key: "difference",
      label: "Difference",
      width: "8rem",
      align: "right",
      phoneHidden: true,
      format: (v) => (Number(v.difference) >= 0 ? `${n2(v.difference!)} left` : `${n2(String(-Number(v.difference)))} over`),
    },
    {
      key: "status",
      label: "Status",
      width: "7.5rem",
      format: (v) => (
        <Badge tone={STATUS_TONE[v.status as CostRowStatus]} className="whitespace-nowrap">
          {COST_ROW_STATUS_LABEL[v.status as CostRowStatus]}
        </Badge>
      ),
    },
  ];
  const rows: LineRow[] = costs.planned.map((r) => ({
    key: r.key,
    parentKey: null,
    values: { label: r.note ? `${r.label} · ${r.note}` : r.label, planned: r.planned ?? "", spent: r.spent, difference: r.difference, status: r.status },
  }));
  return (
    <LineTable
      {...shownOnly}
      rows={rows}
      columns={columns}
      noun="cost"
      flat
      empty="Nothing was planned on the quote and nothing spent yet."
      footer={
        <p className="flex flex-wrap justify-end gap-x-6 gap-y-1 px-3 py-2.5 text-sm text-text-2">
          <span>
            Planned <span className="font-semibold text-text tabular">{money(costs.totals.planned, c)}</span>
          </span>
          <span>
            Spent <span className="font-semibold text-text tabular">{money(costs.totals.spent, c)}</span>
          </span>
          <span>
            Not planned <span className="font-semibold text-text tabular">{money(costs.totals.notPlanned, c)}</span>
          </span>
        </p>
      }
    />
  );
}

/** The expense columns (also what the Excel file has). */
function expenseColumns(c: string, setup: ExpenseSetup | null, byId: Map<string, CostExpense>): LineColumn[] {
  const cols: LineColumn[] = [
    // Fixed widths that fit the page beside the side cards (the table still fills the width).
    { key: "date", label: "Date", width: "4.25rem", format: (v) => v.date! },
    { key: "for", label: "For", width: "6rem", phoneHidden: true, format: (v) => v.for! },
    {
      key: "description",
      label: "Description",
      width: "10.5rem",
      format: (v, r) => {
        const e = byId.get(r.key)!;
        const tag = e.borneBy === "customer" ? "charged to the customer" : e.borneBy === "factory" ? `${e.factory?.name ?? "the factory"} bears it` : null;
        return (
          <span className={e.voided ? "text-muted line-through" : undefined}>
            {v.description}
            {tag && <span className="block text-xs text-muted">{tag}</span>}
          </span>
        );
      },
    },
    { key: "amount", label: "Amount", width: "7rem", align: "right", format: (v) => v.amount! },
    { key: "inOrder", label: c, width: "4.5rem", align: "right", phoneHidden: true, format: (v) => v.inOrder! },
    { key: "paid", label: "Paid by · from", width: "5.75rem", phoneHidden: true, format: (v) => v.paid! },
    {
      key: "receipt",
      label: "Receipt",
      width: "6.5rem",
      format: (v, r) => {
        const e = byId.get(r.key)!;
        return (
          <span className="flex items-center justify-between gap-1">
            {e.voided ? (
              <Badge tone="neutral">Removed</Badge>
            ) : v.receipt === "yes" ? (
              <a href={`/files/expenses/${r.key}?view=1`} target="_blank" rel="noreferrer">
                <Badge tone="ok">Receipt</Badge>
              </a>
            ) : (
              <Badge tone="warn">Missing</Badge>
            )}
            {setup && <EditOrderExpense setup={setup} expense={e} />}
          </span>
        );
      },
    },
  ];
  return cols;
}

function expenseRows(expenses: CostExpense[]): LineRow[] {
  return expenses.map((e) => ({
    key: e.id,
    parentKey: null,
    values: {
      date: date(e.spentOn).replace(/ \d{4}$/, ""),
      for: expenseShort(e.category),
      description: e.description,
      amount: `${e.currency} ${n2(e.amount)}`,
      inOrder: e.voided ? "—" : n2(e.inOrder),
      paid: [e.paidBy?.name, e.ownMoney ? (e.repaid ? `repaid ${date(e.repaid.on)}` : "own money") : e.account?.name].filter(Boolean).join(" · ") || "—",
      receipt: e.receipt ? "yes" : "",
    },
  }));
}

/** "Expenses": every expense of the order (or of one step), with its receipt and Change. */
export function ExpensesTable({ costs, expenses, setup }: { costs: OrderCosts; expenses: CostExpense[]; setup: ExpenseSetup | null }) {
  const c = costs.currency;
  const byId = useMemo(() => new Map(costs.expenses.map((e) => [e.id, e])), [costs.expenses]);
  return (
    <LineTable
      {...shownOnly}
      rows={expenseRows(expenses)}
      columns={expenseColumns(c, setup, byId)}
      noun="expense"
      flat
      empty="No expense here yet."
      footer={
        <p className="flex flex-wrap justify-end gap-x-6 gap-y-1 px-3 py-2.5 text-sm text-text-2">
          <span>
            Borne by us <span className="font-semibold text-text tabular">{money(costs.totals.borneByUs, c)}</span>
          </span>
          <span>
            Charged to the customer <span className="font-semibold text-text tabular">{money(costs.totals.chargedToCustomer, c)}</span>
          </span>
          <span>
            Taken off the factory <span className="font-semibold text-text tabular">{money(costs.totals.takenOffFactory, c)}</span>
          </span>
        </p>
      }
    />
  );
}

/** "Excel": the order's expenses as a file. */
export function CostsExcel({ costs }: { costs: OrderCosts }) {
  const allowed = useExcelAllowed();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!allowed) return null;
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={busy || !costs.expenses.length}
        onClick={async () => {
          setBusy(true);
          const byId = new Map(costs.expenses.map((e) => [e.id, e]));
          const rows = expenseRows(costs.expenses);
          const cols = expenseColumns(costs.currency, null, byId).map((col) =>
            col.key === "description" ? { ...col, format: (v: Record<string, string>) => v.description! } : col.key === "receipt" ? { ...col, format: (v: Record<string, string>) => (v.receipt ? "Receipt" : "Missing") } : col,
          );
          const numbers = lineNumbers(rows.map((r) => ({ key: r.key, parentKey: null })));
          setError(await downloadSheet(lineExport({ name: `${costs.refNo} costs`, columns: cols, rows, numbers })));
          setBusy(false);
        }}
      >
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : <FileSpreadsheet aria-hidden />} Excel
      </Button>
      {error && <Alert tone="error">{error}</Alert>}
    </>
  );
}

/** "Repay": pays back what one person paid from their own money on this order, on a day, from one of our accounts. */
export function RepayButton({ orderId, ids, currency, name, today }: { orderId: string; ids: string[]; currency: string; name: string; today: string }) {
  const [open, setOpen] = useState(false);
  const accounts = useAccounts().filter((a) => a.currency === currency && !a.archived);
  if (!open)
    return (
      <Button type="button" size="xs" variant="secondary" onClick={() => setOpen(true)}>
        Repay
      </Button>
    );
  return (
    <ActionForm action={repayAction.bind(null, orderId, ids)} onDone={() => setOpen(false)} className="mt-2 flex w-full flex-col gap-3 rounded-lg border border-line bg-surface-2/60 p-3">
      {(s) => (
        <>
          <p className="text-sm font-medium">Repay {name}</p>
          <Field label="Repaid on" htmlFor={`repay-${ids[0]}`} error={s.errors?.repaidOn}>
            <Input id={`repay-${ids[0]}`} name="repaidOn" type="date" max={today} defaultValue={s.values?.repaidOn ?? today} />
          </Field>
          {accounts.length > 0 && (
            <Field label="From account" htmlFor={`repay-acc-${ids[0]}`} optional error={s.errors?.accountId}>
              <Select id={`repay-acc-${ids[0]}`} name="accountId" defaultValue="">
                <option value="">Not said</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <div className="flex gap-2">
            <SubmitButton size="sm" pendingText="Saving…">
              Repaid
            </SubmitButton>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </ActionForm>
  );
}
