"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { ATTACHMENT_KIND_LABEL } from "@kebo/shared";
import { Alert, Badge, Button, cn, Field, Textarea } from "@kebo/ui";
import { LineTable, type LineRow } from "@/components/lines/line-table";
import { localLineHandlers } from "@/components/lines/local-lines";
import { PanelActions, PanelBody, SidePanel, useClosePanel, useReportDirty } from "@/components/common/panel";
import { linesDiff } from "@/components/edits/batch-lines";
import { useEditSave } from "@/components/edits/use-edit-save";
import type { EditCard, EditRef } from "@/lib/types-edits";
import type { ActionState } from "@/lib/actions";
import type { DealItem } from "@/lib/types";
import { ITEM_COLUMNS } from "./deal-form";
import { DocumentsPanel, type DocumentRow } from "./documents-panel";
import { rowKey } from "./form-bits";
import { LinesExcel, LinesView } from "./lines-view";
import { addChipClass, FileChips } from "./inquiry-side";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

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

interface ItemState {
  id: string | null;
  key: string;
  parentKey: string | null;
  description: string;
  model: string;
  quantity: string;
  unit: string;
  targetPrice: string;
  priced: boolean;
}

/**
 * Edit items (board "View first, edit on purpose"): the customer's items in
 * the line table (type, paste a list, Excel) and the written requirement, in
 * the edit panel, on a copy; Save changes saves them together. Items keep
 * their ids, so factory prices stay linked. The first list saves plainly;
 * changing a saved one asks why (Edit n), and a priced item always does.
 */
export function ItemsEditor({
  items,
  requirements,
  action,
  upload,
  edit,
  card,
}: {
  items: DealItem[];
  requirements: string | null;
  action: Action;
  upload: boolean;
  edit?: EditRef;
  card?: EditCard | null;
}) {
  const close = useClosePanel();
  const reportDirty = useReportDirty();
  const start = (): ItemState[] =>
    items.map((it) => ({
      id: it.id,
      key: it.id,
      parentKey: it.parentId,
      description: it.description,
      model: it.model ?? "",
      quantity: it.quantity,
      unit: it.unit,
      targetPrice: it.targetPrice ?? "",
      priced: it.priced,
    }));
  const [rows, setRows] = useState<ItemState[]>(start);
  const [text, setText] = useState(requirements ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const saver = useEditSave({ edit, card });
  const handlers = localLineHandlers(
    rows,
    (fn) => setRows((r) => fn(r)),
    (values, parentKey) => ({
      id: null,
      key: rowKey(),
      parentKey,
      description: values.description ?? "",
      model: values.model ?? "",
      quantity: values.quantity ?? "",
      unit: values.unit || (parentKey ? "sets" : "pcs"),
      targetPrice: values.targetPrice ?? "",
      priced: false,
    }),
    (row, values) => ({ ...row, ...values }),
  );
  const asRows = (list: ItemState[]): LineRow[] =>
    list.map((it) => ({
      key: it.key,
      parentKey: it.parentKey,
      values: { description: it.description, model: it.model, quantity: it.quantity, unit: it.unit, targetPrice: it.targetPrice },
      badge: it.priced ? (
        <span className="ml-1 align-middle" title="A factory has priced this: changing it will ask why">
          <Badge tone="info">Priced</Badge>
        </span>
      ) : undefined,
    }));
  const savedRows = useMemo(() => asRows(start()), [items]); // eslint-disable-line react-hooks/exhaustive-deps
  const diff = useMemo(() => linesDiff(savedRows, asRows(rows), ITEM_COLUMNS), [savedRows, rows]);
  const wasText = (requirements ?? "").trim();
  const textChanged = text.trim() !== wasText;
  const changes = [...diff.changes, ...(textChanged ? [`What they wrote: ${wasText ? "changed" : "added"}`] : [])];
  const dirty = changes.length > 0;
  useEffect(() => {
    reportDirty(dirty);
    return () => reportDirty(null);
  }, [dirty, reportDirty]);
  const askWhy = (items.length > 0 && (diff.filledChanged || diff.added)) || (textChanged && !!wasText);

  const save = () =>
    saver.save({
      changes,
      keys: diff.keys,
      askWhy,
      run: async (reason) => {
        const form = new FormData();
        form.set("items", JSON.stringify(rows));
        form.set("requirements", text);
        if (reason) form.set("reason", reason);
        const st = await action({}, form);
        if (st.ok) return { ok: true };
        const errs: Record<string, string> = {};
        for (const [k, v] of Object.entries(st.errors ?? {})) if (v?.[0]) errs[k] = v[0];
        setErrors(errs);
        return {
          ok: false,
          message: st.message ?? "Something went wrong. Please try again.",
          reasonChoices: st.code === "reason_needed" ? (st.choices ?? []) : undefined,
        };
      },
    });

  return (
    <PanelBody className="gap-4">
      {saver.error && <Alert tone="error">{saver.error}</Alert>}
      <LineTable
        rows={asRows(rows)}
        columns={ITEM_COLUMNS}
        noun="item"
        sheet={{ name: "Customer items", upload }}
        error={errors.items}
        empty="No list: the requirement below is enough."
        {...handlers}
      />
      <Field label="What they wrote" htmlFor="requirements" optional error={errors.requirements} hint="Standards, destination, anything else the customer said">
        <Textarea id="requirements" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <PanelActions>
        <Button size="sm" onClick={() => void save()} disabled={!dirty || saver.busy}>
          {saver.busy ? "Saving…" : "Save changes"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => close()} disabled={saver.busy}>
          Cancel
        </Button>
        <span className="text-xs text-muted">
          {changes.length
            ? `${changes.length} change${changes.length === 1 ? "" : "s"} not saved yet${askWhy ? " · Save asks why" : ""}`
            : "Nothing changed yet"}
        </span>
      </PanelActions>
      {saver.dialog}
    </PanelBody>
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
