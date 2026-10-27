"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Paperclip, Trash2, Upload, X } from "lucide-react";
import { Alert, Button, buttonClass, cn, Field, Input } from "@kebo/ui";
import type { ActionState } from "@/lib/actions";
import type { AttachedFileInfo } from "@/lib/types-money";

const VIEWABLE = /^(application\/pdf|image\/(png|jpeg|gif|webp))$/;
const size = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

/**
 * Sends a file to one of our /files routes (server actions cap bodies at 1 MB,
 * so files go through a route). Returns an error message, or null when it is kept.
 */
export async function uploadFile(url: string, file: File): Promise<string | null> {
  const body = new FormData();
  body.set("file", file, file.name);
  try {
    const res = await fetch(url, { method: "POST", body });
    if (res.ok) return null;
    if (res.status === 413) return "This file is too large.";
    return ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `Upload failed (${res.status})`;
  } catch {
    return "The connection dropped. Try again.";
  }
}

/** Choose a photo or PDF in a form; it is sent once the record is saved. */
export function FilePicker({
  id,
  label,
  file,
  onChange,
  current,
  hint = "A photo or PDF",
  className,
}: {
  id: string;
  label: string;
  file: File | null;
  onChange: (f: File | null) => void;
  /** The name of the file kept now (a new one replaces it). */
  current?: string | null;
  hint?: string;
  className?: string;
}) {
  return (
    <Field
      label={label}
      htmlFor={id}
      optional
      hint={file ? undefined : current ? `Kept: ${current}. A new one replaces it.` : hint}
      className={className}
    >
      {file ? (
        <span className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm">
          <Paperclip className="size-4 shrink-0 text-muted" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{file.name}</span>
          <Button type="button" size="xs" variant="ghost" onClick={() => onChange(null)} aria-label="Do not attach this file">
            <X aria-hidden />
          </Button>
        </span>
      ) : (
        <Input
          id={id}
          type="file"
          accept="image/*,application/pdf"
          className="file:mr-3 file:rounded-md file:border-0 file:bg-surface-2 file:px-2.5 file:py-1 file:text-xs file:font-medium"
          onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        />
      )}
    </Field>
  );
}

/**
 * The file kept with a record: a preview of a photo, a link to a PDF, and
 * add / replace / remove for those who may change it.
 */
export function AttachedFile({
  src,
  file,
  what,
  canChange,
  remove,
  empty = "None kept",
}: {
  /** Our /files route for this record (GET opens it, POST replaces it). */
  src: string;
  file: AttachedFileInfo | null;
  /** For the image's alt text: "Receipt", "Proof of payment". */
  what: string;
  canChange: boolean;
  remove: () => Promise<ActionState>;
  empty?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, startRemove] = useTransition();
  const inputId = `af-${src.replace(/[^a-z0-9]/gi, "-")}`;
  const send = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    setError(null);
    const err = await uploadFile(src, f);
    setBusy(false);
    if (err) setError(err);
    else router.refresh();
    if (input.current) input.current.value = "";
  };
  const viewable = !!file && VIEWABLE.test(file.type);
  return (
    <div className="flex flex-col gap-2">
      {file ? (
        <div className="flex flex-wrap items-center gap-3">
          {viewable && file.type.startsWith("image/") ? (
            <a href={`${src}?view=1`} target="_blank" rel="noreferrer" className="block shrink-0" aria-label={`Open ${file.name}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a private file from our own route, not an optimisable image */}
              <img src={`${src}?view=1`} alt={`${what}: ${file.name}`} className="h-20 w-28 rounded-md border border-line object-cover" />
            </a>
          ) : (
            <span className="flex size-12 items-center justify-center rounded-md border border-line bg-surface">
              <FileText className="size-5 text-muted" aria-hidden />
            </span>
          )}
          <span className="min-w-0 text-sm">
            <a
              href={`${src}${viewable ? "?view=1" : ""}`}
              target={viewable ? "_blank" : undefined}
              rel="noreferrer"
              className="block truncate font-medium hover:text-primary"
            >
              {file.name}
            </a>
            <span className="text-xs text-muted">{size(file.size)}</span>
          </span>
        </div>
      ) : (
        <span className="text-muted">{empty}</span>
      )}
      {canChange && (
        <div className="flex flex-wrap gap-1">
          <input
            ref={input}
            type="file"
            accept="image/*,application/pdf"
            className="sr-only"
            id={inputId}
            onChange={(ev) => send(ev.target.files?.[0])}
          />
          <label
            htmlFor={inputId}
            className={cn(buttonClass("secondary", "xs"), "cursor-pointer", busy && "pointer-events-none opacity-60")}
          >
            <Upload aria-hidden /> {busy ? "Sending…" : file ? "Replace" : "Add a photo or PDF"}
          </label>
          {file && (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              disabled={removing}
              onClick={() =>
                startRemove(async () => {
                  const res = await remove();
                  if (!res.ok) setError(res.message ?? "Could not remove it.");
                  router.refresh();
                })
              }
            >
              <Trash2 aria-hidden /> {removing ? "Removing…" : "Remove file"}
            </Button>
          )}
        </div>
      )}
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}
