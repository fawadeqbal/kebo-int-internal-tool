"use client";

import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { ArrowUpToLine } from "lucide-react";
import { cn } from "@kebo/ui";

/** "PDF" from "quote.pdf": the little tile in front of a file's name. */
export const extOf = (name: string) => (name.includes(".") ? name.split(".").pop()!.slice(0, 4).toUpperCase() : "FILE");

export const fileSize = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

/** One file in a list: its type tile, name, a line about it, a tag and its buttons. */
export function FileRow({ name, meta, tag, actions, children }: { name: string; meta?: ReactNode; tag?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <li className="flex flex-col gap-2 rounded-[10px] border border-line bg-surface px-2.5 py-2">
      <div className="flex items-center gap-2.5">
        <span className="grid size-9 flex-none place-items-center rounded-lg bg-primary-soft text-[10px] font-bold text-primary">{extOf(name)}</span>
        <span className="min-w-0 flex-1 text-[13px]">
          <strong className="block truncate">{name}</strong>
          {meta && <span className="text-xs text-muted">{meta}</span>}
        </span>
        {tag}
        {actions && <span className="flex flex-none gap-0.5">{actions}</span>}
      </div>
      {children}
    </li>
  );
}

/**
 * The board's upload box: a label (with "· optional"), an optional "what kind" select,
 * a dashed drop zone with "choose", and the files below it.
 */
export function FileZone({
  label,
  optional = true,
  hint = "PDF, photos, Excel or Word · up to 25 MB each",
  kind,
  onFiles,
  disabled,
  one,
  compact,
  children,
}: {
  label: ReactNode;
  optional?: boolean;
  hint?: ReactNode;
  /** The "what kind of file" select shown to the right of the label. */
  kind?: ReactNode;
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  /** One file only. */
  one?: boolean;
  compact?: boolean;
  /** The files already added (FileRow items). */
  children?: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const take = (list: FileList | null) => {
    // Read the list now: the input is cleared right after, which empties it.
    const files = list ? Array.from(list) : [];
    if (files.length) onFiles(one ? files.slice(0, 1) : files);
  };
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (!disabled) take(e.dataTransfer.files);
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold">
          {label}
          {optional && <span className="font-normal text-muted"> · optional</span>}
        </span>
        {kind}
      </div>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        className={cn(
          "relative flex cursor-pointer flex-wrap items-center justify-center gap-2.5 rounded-xl border-2 border-dashed border-primary-line bg-primary-soft/40 text-center text-[13px] transition-colors",
          compact ? "px-3.5 py-3" : "p-5",
          over && "border-primary bg-primary-soft",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <ArrowUpToLine className="size-[18px] text-primary" aria-hidden />
        <span>
          <strong>
            {one ? "Drop the file here or" : "Drop files here or"} <span className="text-primary underline">choose</span>
          </strong>
          <span className="block text-xs text-muted">{hint}</span>
        </span>
        <input
          ref={input}
          type="file"
          multiple={!one}
          disabled={disabled}
          className="sr-only"
          aria-label={typeof label === "string" ? label : "Choose files"}
          onChange={(e) => {
            take(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
      {children && <ul className="flex flex-col gap-1.5">{children}</ul>}
    </div>
  );
}
