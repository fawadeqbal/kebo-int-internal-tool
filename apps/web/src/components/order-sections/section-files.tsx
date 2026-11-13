"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { OrderSection } from "@kebo/shared";
import { cn } from "@kebo/ui";
import { FileChip, guessKind, uploadToOrder, useFileTools } from "@/components/files/file-tools";

/** The files of one section, from the order's one list (the layout loads it once). */
export function useSectionFiles(section: OrderSection) {
  const tools = useFileTools();
  return (tools?.files ?? []).filter((f) => f.section === section);
}

/** Sends the chosen files to the order as this section's files. */
function useSectionUpload(orderId: string, section: OrderSection) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const send = (files: FileList | File[] | null) =>
    start(async () => {
      setError(null);
      for (const f of [...(files ?? [])]) {
        const r = await uploadToOrder(orderId, f, { section, kind: guessKind(f.name, f.type) });
        if (r.error) return setError(`${f.name}: ${r.error}`);
      }
      router.refresh();
    });
  return { busy, error, send };
}

/**
 * The files row at the foot of a section: each file opens here (view,
 * download, its menu), and "+ Add a file" adds one to this section.
 */
export function SectionFiles({ orderId, section, canAdd }: { orderId: string; section: OrderSection; canAdd: boolean }) {
  const files = useSectionFiles(section);
  const input = useRef<HTMLInputElement>(null);
  const { busy, error, send } = useSectionUpload(orderId, section);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line px-[18px] py-2.5" data-section-files={section}>
      {files.length === 0 && <span className="text-[12.5px] text-text-2">No file yet</span>}
      {files.map((f) => (
        <FileChip key={f.id} file={f} set={files} />
      ))}
      <span className="flex-1" />
      {canAdd && (
        <>
          <input ref={input} type="file" multiple hidden onChange={(e) => (send(e.target.files), (e.target.value = ""))} />
          <button type="button" disabled={busy} className="text-[12.5px] font-medium text-text-2 hover:text-primary hover:underline disabled:opacity-60" onClick={() => input.current?.click()}>
            {busy ? "Sending…" : "+ Add a file"}
          </button>
        </>
      )}
      {error && (
        <span role="alert" className="basis-full text-xs text-bad">
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * The files part of a section's window: the files it has (each opens here),
 * and a box to drop or choose more. A file is kept the moment it is added;
 * it does not wait for Save.
 */
export function WindowFiles({ orderId, section, hint }: { orderId: string; section: OrderSection; /** What goes here: "the booking copy". */ hint: string }) {
  const files = useSectionFiles(section);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const { busy, error, send } = useSectionUpload(orderId, section);
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-4">
      <span className="text-xs font-bold text-text-2">Files</span>
      {files.length > 0 && (
        <span className="flex flex-wrap gap-1.5">
          {files.map((f) => (
            <FileChip key={f.id} file={f} set={files} />
          ))}
        </span>
      )}
      <input ref={input} type="file" multiple hidden onChange={(e) => (send(e.target.files), (e.target.value = ""))} />
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOver(false);
          send(e.dataTransfer.files);
        }}
        className={cn(
          "flex min-h-11 items-center justify-center rounded-lg border border-dashed border-line-strong px-3 py-2 text-center text-[12.5px] text-text-2 hover:border-primary/60 hover:text-text",
          over && "border-primary bg-primary-soft text-text",
        )}
      >
        {busy ? "Sending…" : `Drop or choose: ${hint}`}
      </button>
      {error && (
        <span role="alert" className="text-xs text-bad">
          {error}
        </span>
      )}
    </div>
  );
}
