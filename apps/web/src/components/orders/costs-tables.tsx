"use client";

import { useState } from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { expenseShort, lineNumbers } from "@kebo/shared";
import { Alert, Button } from "@kebo/ui";
import { useExcelAllowed } from "@/components/common/features";
import type { LineColumn, LineRow } from "@/components/lines/line-table";
import { lineExport } from "@/components/sheets/line-sheets";
import { downloadSheet } from "@/components/sheets/excel-menu";
import type { OrderCosts } from "@/lib/types-money";
import { COST_FROM, costState } from "./cost-words";

const n2 = (v: string | null) => (v === null ? "" : Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/** "Excel": the order's cost sheet as a file, with the same columns. */
export function CostsExcel({ costs }: { costs: OrderCosts }) {
  const allowed = useExcelAllowed();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!allowed) return null;
  const c = costs.currency;
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="h-8 px-2.5 text-[13px]"
        disabled={busy || !costs.sheet.rows.length}
        onClick={async () => {
          setBusy(true);
          const text = (key: string, label: string, align?: "right"): LineColumn => ({ key, label, width: "8rem", align, format: (v) => v[key] ?? "" });
          const columns = [text("what", "What for"), text("owedTo", "Who we owe"), text("from", "Comes from"), text("cost", "Cost", "right"), text("inOrder", `In ${c}`, "right"), text("paid", "Paid", "right"), text("toPay", "Still to pay", "right"), text("state", "Status")];
          const rows: LineRow[] = costs.sheet.rows.map((r) => ({
            key: r.key,
            parentKey: null,
            values: {
              what: r.kind === "cost" && r.category ? `${expenseShort(r.category)}: ${r.label}` : r.label,
              owedTo: r.owedTo ?? "",
              from: COST_FROM[r.from],
              cost: `${r.currency} ${n2(r.amount)}`,
              inOrder: n2(r.inOrder),
              paid: n2(r.paidInOrder),
              toPay: n2(r.toPayInOrder),
              state: r.borneBy === "customer" ? "Charged to the customer" : r.borneBy === "factory" ? "Taken off the factory" : costState(r),
            },
          }));
          const numbers = lineNumbers(rows.map((r) => ({ key: r.key, parentKey: null })));
          setError(await downloadSheet(lineExport({ name: `${costs.refNo} costs`, columns, rows, numbers })));
          setBusy(false);
        }}
      >
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : <FileSpreadsheet aria-hidden />} Excel
      </Button>
      {error && <Alert tone="error">{error}</Alert>}
    </>
  );
}
