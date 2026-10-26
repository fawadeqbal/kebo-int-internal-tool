import { Receipt } from "lucide-react";
import { Card, EmptyState, FilterBar, PageHeader, SearchField } from "@kebo/ui";
import { api } from "@/lib/api";
import { requirePermission } from "@/lib/session";
import type { HsCodeRow } from "@/lib/types-deals";
import { removeHsCodeAction, saveHsCodeAction } from "./actions";
import { AddHsCode, HsCodeItem } from "./forms";

export const metadata = { title: "Export rebate by HS code" };

/**
 * The export rebate % remembered per HS code: saved when factory prices are
 * entered, corrected here when the official rate changes. Prices already
 * entered keep the rate they were entered with.
 */
export default async function HsCodeRebatesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requirePermission("sourcing.manage");
  const sp = await searchParams;
  const q = sp.q?.trim() || undefined;
  const rows = await api.get<HsCodeRow[]>("/hs-codes", { q });
  return (
    <div>
      <PageHeader
        backHref="/factories"
        backLabel="Factories"
        title="Export rebate by HS code"
        description="Rebate % per product, remembered when you enter factory prices. Change it here when the official rate changes; prices already entered keep theirs."
      />
      <Card className="overflow-hidden p-0">
        <FilterBar>
          <form className="flex flex-1 flex-wrap items-center gap-2">
            <SearchField defaultValue={q} placeholder="Search HS code or description…" clearHref="/factories/rebates" className="min-w-0 flex-1 sm:max-w-80" />
          </form>
          <span className="text-xs text-muted">
            {rows.length} code{rows.length === 1 ? "" : "s"}
          </span>
          <AddHsCode action={saveHsCodeAction.bind(null, null)} />
        </FilterBar>
        {rows.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title={q ? `No HS code matches "${q}"` : "No HS codes yet"}
            description={q ? "Try the first digits of the code, or part of the description." : "Each HS code typed on a factory price is remembered here with its rebate, so the next price starts from it."}
          />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <HsCodeItem key={`${r.code}-${r.updatedAt}`} row={r} saveAction={saveHsCodeAction.bind(null, r.code)} removeAction={removeHsCodeAction.bind(null, r.code)} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
