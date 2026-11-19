"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { OrderSection } from "@kebo/shared";
import { FileChip, guessKind, uploadToOrder, useFileTools } from "@/components/files/file-tools";
import { FileZone } from "@/components/common/file-zone";

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
export function SectionFiles({ orderId, section, canAdd, quiet }: { orderId: string; section: OrderSection; canAdd: boolean; /** Nothing at all while it has no file (a record box: files are added in its window). */ quiet?: boolean }) {
  const files = useSectionFiles(section);
  const input = useRef<HTMLInputElement>(null);
  const { busy, error, send } = useSectionUpload(orderId, section);
  // No file and none to add here: nothing at all (no "No file yet" rows: canvas "The order's Overview today", 8).
  if (files.length === 0 && (quiet || !canAdd)) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line px-5 py-2.5 max-sm:px-4" data-section-files={section}>
      {files.map((f) => (
        <FileChip key={f.id} file={f} set={files} />
      ))}
      <span className="flex-1" />
      {canAdd && (
        <>
          <input ref={input} type="file" multiple hidden onChange={(e) => (send(e.target.files), (e.target.value = ""))} />
          <button type="button" disabled={busy} className="tap text-xs font-medium text-text-2 hover:text-primary hover:underline disabled:opacity-60" onClick={() => input.current?.click()}>
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
export function WindowFiles({ orderId, section }: { orderId: string; section: OrderSection; /** (Unused: the drop zone says "a file", nothing more; white label, 17 Nov.) */ hint?: string }) {
  const files = useSectionFiles(section);
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
      <FileZone label="Add files" optional={false} compact disabled={busy} hint={busy ? "Sending…" : undefined} onFiles={send} />
      {error && (
        <span role="alert" className="text-xs text-bad">
          {error}
        </span>
      )}
    </div>
  );
}
