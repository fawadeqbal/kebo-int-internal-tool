"use client";

import { useRef, useState } from "react";
import { ChevronDown, Download, FileSpreadsheet, FileUp, Loader2, Table2 } from "lucide-react";
import { Button, cn } from "@kebo/ui";
import { FloatingMenu } from "@/components/common/floating";
import type { ReadSheet, SheetSpec } from "@/lib/sheet-spec";

/** Makes the file on the server and saves it in the browser. Returns a message when it could not. */
export async function downloadSheet(spec: SheetSpec): Promise<string | null> {
  try {
    const res = await fetch("/sheets/write", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(spec) });
    if (!res.ok) return ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Could not make the file.";
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `${spec.name}.xlsx`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return null;
  } catch {
    return "Could not make the file. Check the connection and try again.";
  }
}

/** Reads an uploaded file's headings and rows (nothing is saved). */
export async function readSheetFile(file: File): Promise<{ ok: true; sheet: ReadSheet } | { ok: false; message: string }> {
  const body = new FormData();
  body.set("file", file, file.name);
  try {
    const res = await fetch("/sheets/read", { method: "POST", body });
    const json = (await res.json().catch(() => null)) as (ReadSheet & { error?: string }) | null;
    if (!res.ok || !json) return { ok: false, message: json?.error ?? "Could not read the file." };
    return { ok: true, sheet: json };
  } catch {
    return { ok: false, message: "Could not upload the file. Check the connection and try again." };
  }
}

const itemClass = "flex items-start gap-2.5 rounded-md px-2.5 py-2 text-left text-sm hover:bg-surface-2 [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted";

function Item({ icon, title, hint, onClick, href }: { icon: React.ReactNode; title: string; hint: string; onClick: () => void; href?: string }) {
  const body = (
    <>
      {icon}
      <span className="min-w-0">
        <span className="block font-medium">{title}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </>
  );
  return href ? (
    <a role="menuitem" href={href} download onClick={onClick} className={itemClass}>
      {body}
    </a>
  ) : (
    <button type="button" role="menuitem" onClick={onClick} className={itemClass}>
      {body}
    </button>
  );
}

/**
 * The same Excel button everywhere: download a template to fill in, upload
 * the filled file (it is shown to check before anything is saved), and
 * export what is on screen. Each part shows only where it is allowed.
 */
export function ExcelMenu({
  template,
  onUpload,
  exportSheet,
  exportHref,
  noun = "rows",
  className,
}: {
  /** The template to download; none: no template or upload. */
  template?: () => SheetSpec;
  /** The rows read from an uploaded file, to show for checking. */
  onUpload?: (sheet: ReadSheet, fileName: string) => void;
  /** What is on screen, as a file (made in the page, or by a link: every row of a list). */
  exportSheet?: () => SheetSpec;
  exportHref?: string;
  /** "lines", "customers": used in the hints. */
  noun?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  if (!template && !onUpload && !exportSheet && !exportHref) return null;

  const download = async (make: () => SheetSpec) => {
    setOpen(false);
    setBusy(true);
    setError(null);
    setError(await downloadSheet(make()));
    setBusy(false);
  };

  const pick = async (file: File | undefined) => {
    if (!file || !onUpload) return;
    setBusy(true);
    setError(null);
    const r = await readSheetFile(file);
    setBusy(false);
    if (r.ok) onUpload(r.sheet, file.name);
    else setError(r.message);
  };

  return (
    <span className={cn("inline-flex flex-wrap items-center gap-2", className)}>
      <Button ref={button} size="xs" variant="ghost" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} disabled={busy}>
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : <FileSpreadsheet aria-hidden />} Excel <ChevronDown aria-hidden />
      </Button>
      {onUpload && (
        <input
          ref={picker}
          type="file"
          accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            void pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      )}
      {error && (
        <span role="alert" className="text-xs text-bad">
          {error}
        </span>
      )}
      {open && (
        <FloatingMenu anchor={() => button.current} onClose={() => setOpen(false)} label="Excel" width={290} align="start">
          {template && (
            <Item icon={<Download aria-hidden />} title="Download a template" hint={`An Excel file with the right columns, to fill in the ${noun}.`} onClick={() => void download(template)} />
          )}
          {onUpload && (
            <Item
              icon={<FileUp aria-hidden />}
              title="Upload a filled file"
              hint="Shown here to check first; nothing is saved until you add it."
              onClick={() => {
                setOpen(false);
                picker.current?.click();
              }}
            />
          )}
          {exportSheet && <Item icon={<Table2 aria-hidden />} title="Export to Excel" hint={`The ${noun} as they are now.`} onClick={() => void download(exportSheet)} />}
          {!exportSheet && exportHref && (
            <Item icon={<Table2 aria-hidden />} title="Export to Excel" hint={`Every one of the ${noun} shown, with the filters on.`} href={exportHref} onClick={() => setOpen(false)} />
          )}
        </FloatingMenu>
      )}
    </span>
  );
}
