"use client";

import { useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { ATTACHMENT_KIND_LABEL } from "@kebo/shared";
import { Badge, Button, cn, Field, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { LineTable } from "@/components/lines/line-table";
import { localLineHandlers } from "@/components/lines/local-lines";
import { EditPanel, PanelBody, useCloseLines } from "@/components/orders/step-view";
import type { ActionState } from "@/lib/actions";
import type { DealItem } from "@/lib/types";
import { ITEM_COLUMNS } from "./deal-form";
import { DocumentsPanel, type DocumentRow } from "./documents-panel";
import { READ_ONLY_LINES, rowKey } from "./form-bits";
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
      {items.length > 0 && !phone && (
        <LineTable
          rows={rowsOf(items)}
          columns={ITEM_COLUMNS}
          noun="item"
          readOnly
          sheet={{ name: "Customer items" }}
          {...READ_ONLY_LINES}
        />
      )}
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
 * Edit lines: the customer's items in the same line table as the inquiry form
 * (type, paste a list, Excel), and the written requirement; saved together.
 * Items keep their ids, so factory prices stay linked; a priced item asks why.
 */
export function ItemsEditor({
  items,
  requirements,
  action,
  upload,
}: {
  items: DealItem[];
  requirements: string | null;
  action: Action;
  upload: boolean;
}) {
  const close = useCloseLines();
  const [rows, setRows] = useState<ItemState[]>(() =>
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
    })),
  );
  const [text, setText] = useState(requirements ?? "");
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
  return (
    <ActionForm action={action} onDone={close} className="flex flex-col gap-4">
      {(s) => (
        <>
          <input type="hidden" name="items" value={JSON.stringify(rows)} />
          <LineTable
            rows={rows.map((it) => ({
              key: it.key,
              parentKey: it.parentKey,
              values: { description: it.description, model: it.model, quantity: it.quantity, unit: it.unit, targetPrice: it.targetPrice },
              badge: it.priced ? (
                <span className="ml-1 align-middle" title="A factory has priced this: changing it will ask why">
                  <Badge tone="info">Priced</Badge>
                </span>
              ) : undefined,
            }))}
            columns={ITEM_COLUMNS}
            noun="item"
            sheet={{ name: "Customer items", upload }}
            error={s.errors?.items?.[0]}
            empty="No list: the requirement below is enough."
            {...handlers}
          />
          <Field
            label="What they wrote"
            htmlFor="requirements"
            optional
            error={s.errors?.requirements}
            hint="Standards, destination, anything else the customer said"
          >
            <Textarea id="requirements" name="requirements" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <SubmitButton size="sm" pendingText="Saving…">
              Save the lines
            </SubmitButton>
            <Button size="sm" variant="ghost" onClick={close}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </ActionForm>
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
        <EditPanel
          title="URS & documents"
          description="The customer's URS, drawings, photos and specifications. Also shown on the order."
          onClose={() => setOpen(false)}
        >
          <PanelBody>
            <DocumentsPanel dealId={dealId} files={files} canUpload />
          </PanelBody>
        </EditPanel>
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
