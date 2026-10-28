"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { CheckCircle2, X } from "lucide-react";
import { Button, cn } from "@kebo/ui";
import type { CustomerInput, FactoryInput, ImportResult } from "@kebo/shared";
import type { ReadSheet, SheetSpec } from "@/lib/sheet-spec";
import { ExcelMenu } from "./excel-menu";
import { customersFromSheet, customersTemplate, factoriesFromSheet, factoriesTemplate, type PartyRead } from "./party-sheets";

type ImportAction<T> = (items: T[], fileName: string) => Promise<{ ok: true; result: ImportResult } | { ok: false; message: string }>;

type Props =
  | { kind: "customers"; importAction?: ImportAction<CustomerInput>; exportSheet?: () => SheetSpec }
  | { kind: "factories"; importAction?: ImportAction<FactoryInput>; exportSheet?: () => SheetSpec };

/**
 * The Excel button on the customers or factories list: a template, a filled
 * file shown to check (new ones only are added, together), and an export.
 */
export function PartyExcel(props: Props) {
  const { kind, importAction, exportSheet } = props;
  const [review, setReview] = useState<{ file: string; read: PartyRead<CustomerInput | FactoryInput> } | null>(null);
  const one = kind === "customers" ? "customer" : "factory";
  const many = kind;

  const upload = (sheet: ReadSheet, file: string) =>
    setReview({ file, read: kind === "customers" ? customersFromSheet(sheet) : factoriesFromSheet(sheet) });

  return (
    <>
      <ExcelMenu
        noun={many}
        template={importAction ? (kind === "customers" ? customersTemplate : factoriesTemplate) : undefined}
        onUpload={importAction ? upload : undefined}
        exportSheet={exportSheet}
      />
      {review && importAction && (
        <Review
          file={review.file}
          read={review.read}
          one={one}
          many={many}
          add={(items) => (importAction as ImportAction<CustomerInput | FactoryInput>)(items, review.file)}
          onClose={() => setReview(null)}
        />
      )}
    </>
  );
}

function Review({
  file,
  read,
  one,
  many,
  add,
  onClose,
}: {
  file: string;
  read: PartyRead<CustomerInput | FactoryInput>;
  one: string;
  many: string;
  add: (items: (CustomerInput | FactoryInput)[]) => ReturnType<ImportAction<CustomerInput | FactoryInput>>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const good = read.items.filter((i) => i.input);
  const bad = read.items.length - good.length;
  const count = (k: number, word = one) => `${k} ${k === 1 ? word : word === "factory" ? "factories" : `${word}s`}`;

  useEffect(() => {
    title.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [busy, onClose]);

  const go = async () => {
    setBusy(true);
    setError(null);
    const r = await add(good.map((i) => i.input!));
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setDone(r.result);
    router.refresh();
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-6">
      <button type="button" aria-label="Close" tabIndex={-1} className="absolute inset-0 bg-black/40" onClick={() => !busy && onClose()} />
      <div role="dialog" aria-modal="true" aria-labelledby="party-review-title" className="relative flex max-h-[90dvh] w-full max-w-3xl flex-col rounded-t-2xl border border-line bg-surface shadow-pop sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-line p-4">
          <div className="min-w-0">
            <h2 ref={title} tabIndex={-1} id="party-review-title" className="text-base font-semibold outline-none">
              {done ? `${count(done.added)} added` : `New ${many} from ${file}`}
            </h2>
            {!done && !read.error && (
              <p className="mt-0.5 text-sm text-text-2">
                {count(good.length)} to add.
                {bad > 0 && <span className="text-bad"> {count(bad)} with a problem {bad === 1 ? "is" : "are"} left out: fix the file and upload it again.</span>}
                {read.unused.length > 0 && <span className="text-muted"> Not used: {read.unused.map((h) => `“${h}”`).join(", ")}.</span>}
              </p>
            )}
          </div>
          <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={onClose} disabled={busy}>
            <X aria-hidden />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {read.error ? (
            <p className="text-sm text-bad">{read.error}</p>
          ) : done ? (
            <div className="flex flex-col gap-3 text-sm">
              <p className="flex items-center gap-2 text-ok">
                <CheckCircle2 className="size-4" aria-hidden /> {count(done.added)} added. Each is in History as added from {file}.
              </p>
              {done.skipped.length > 0 && (
                <div>
                  <p className="font-medium">{count(done.skipped.length)} already here, left out:</p>
                  <ul className="mt-1 list-disc pl-5 text-text-2">
                    {done.skipped.map((s) => (
                      <li key={s.name}>
                        {s.name}: {s.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <ol className="divide-y divide-line rounded-lg border border-line text-sm">
              {read.items.map((i) => (
                <li key={i.rows.join()} className={cn("flex items-start justify-between gap-3 px-3 py-2", i.problem && "bg-bad-soft/50")}>
                  <span className="min-w-0">
                    <span className="block font-medium">{i.name}</span>
                    {i.detail && <span className="block text-xs text-muted">{i.detail}</span>}
                    {i.problem && (
                      <span className="block text-xs text-bad">
                        Row {i.rows.join(", ")}: {i.problem}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-muted tabular">row {i.rows.join(", ")}</span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-line p-4">
          {!done && !read.error && (
            <Button variant="primary" size="sm" onClick={() => void go()} disabled={!good.length || busy}>
              {busy ? "Adding…" : `Add ${count(good.length)}`}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            {done || read.error ? "Close" : "Cancel"}
          </Button>
          {!done && !read.error && <span className="text-xs text-muted">Only new {many} are added; any already here are left out.</span>}
          {error && (
            <span role="alert" className="text-xs text-bad">
              {error}
            </span>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
