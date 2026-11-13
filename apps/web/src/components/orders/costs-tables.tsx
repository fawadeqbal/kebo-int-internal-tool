"use client";

import { useMemo, useState } from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { expenseShort, lineNumbers } from "@kebo/shared";
import { Alert, Badge, Button } from "@kebo/ui";
import { useExcelAllowed } from "@/components/common/features";
import { LineTable, type LineColumn, type LineRow } from "@/components/lines/line-table";
import { lineExport } from "@/components/sheets/line-sheets";
import { downloadSheet } from "@/components/sheets/excel-menu";
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
              <a href={`/files/${e.receipt?.id}?view=1`} target="_blank" rel="noreferrer">
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

