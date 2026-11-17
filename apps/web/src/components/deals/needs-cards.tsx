"use client";

import { useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { ATTACHMENT_KIND_LABEL } from "@kebo/shared";
import { cn } from "@kebo/ui";
import { PanelBody, SidePanel } from "@/components/common/panel";
import type { DealItem } from "@/lib/types";
import { ITEM_COLUMNS } from "./items-sheet";
import { DocumentsPanel, type DocumentRow } from "./documents-panel";
import { LinesExcel, LinesView } from "./lines-view";
import { addChipClass, FileChips } from "./inquiry-side";

const rowsOf = (items: DealItem[]) =>
  items.map((it) => ({
    key: it.id,
    parentKey: it.parentId,
    values: { description: it.description, model: it.model ?? "", quantity: it.quantity, unit: it.unit, targetPrice: it.targetPrice ?? "" },
  }));

/** The items as short lines on a phone (read only). */
function ItemsPhone({ items }: { items: DealItem[] }) {
  return (
    <ul className="flex flex-col divide-y divide-line text-sm">
      {items.map((it) => (
        <li key={it.id} className={cn("flex justify-between gap-3 py-2", it.parentId && "pl-4")}>
          <span className="min-w-0">
            <span className="mr-1.5 text-xs text-muted tabular">{it.no}</span>
            {it.description.split("\n")[0]}
            {it.model && <span className="block text-xs text-muted">{it.model}</span>}
          </span>
          <span className="shrink-0 text-text-2 tabular">
            {Number(it.quantity).toLocaleString("en-US", { maximumFractionDigits: 2 })} {it.unit}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** What the customer needs, read only: their items in the line table (Excel export in its menu). */
export function ItemsView({ items, requirements, phone = false }: { items: DealItem[]; requirements: string | null; phone?: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      {items.length > 0 && phone && <ItemsPhone items={items} />}
      {items.length > 0 && !phone && <LinesView label="What they need" rows={rowsOf(items)} columns={ITEM_COLUMNS} numbers={items.map((it) => it.no)} />}
      {requirements && <p className="rounded-lg bg-surface-2 p-3 text-sm whitespace-pre-line">{requirements}</p>}
      {!items.length && !requirements && <p className="text-sm text-muted">Nothing written yet.</p>}
    </div>
  );
}

/** The documents panel (upload with what each file is, change or remove one) behind a button or chip. */
export function DocumentsButton({
  dealId,
  files,
  children,
  className,
}: {
  dealId: string;
  files: DocumentRow[];
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className ?? addChipClass} onClick={() => setOpen(true)}>
        {children}
      </button>
      {open && (
        <SidePanel
          title="URS & documents"
          description="The customer's URS, drawings, photos and specifications. Also shown on the order."
          onClose={() => setOpen(false)}
        >
          <PanelBody>
            <DocumentsPanel dealId={dealId} files={files} canUpload />
          </PanelBody>
        </SidePanel>
      )}
    </>
  );
}

/** URS & documents as chips (each opens the file), "+ Add files" for the documents panel, and Download all. */
export function DocumentChips({ dealId, files, canAdd }: { dealId: string; files: DocumentRow[]; canAdd: boolean }) {
  return (
    <FileChips
      files={files.map((f) => ({
        id: f.id,
        name: f.fileName,
        tag: f.kind === "other" ? null : f.kind === "urs" ? "URS" : ATTACHMENT_KIND_LABEL[f.kind].toLowerCase(),
      }))}
      empty="No files yet."
      add={
        canAdd ? (
          <DocumentsButton dealId={dealId} files={files}>
            <Plus className="size-3.5" aria-hidden /> {files.length ? "Add files" : "Add the URS or drawings"}
          </DocumentsButton>
        ) : undefined
      }
    />
  );
}

/** "What they need" header's Excel: the customer's items as a file. */
export function ItemsExcel({ items }: { items: DealItem[] }) {
  return <LinesExcel name="Customer items" noun="items" rows={rowsOf(items)} columns={ITEM_COLUMNS} numbers={items.map((it) => it.no)} />;
}
