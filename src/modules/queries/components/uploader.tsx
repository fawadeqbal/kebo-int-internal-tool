"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, UploadCloud, X } from "lucide-react";
import { Alert, Button } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Upload files to a query with real progress (fetch() cannot report upload progress). */
export function uploadFiles(queryId: string, files: File[], onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/queries/${queryId}/attachments`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      try {
        reject(new Error(JSON.parse(xhr.responseText).error ?? "Upload failed."));
      } catch {
        reject(new Error("Upload failed."));
      }
    };
    xhr.onerror = () => reject(new Error("Network error while uploading. Please try again."));
    xhr.send(form);
  });
}

/** Drag-and-drop file chooser (does not upload by itself). */
export function FilePicker({ files, onChange, maxMb }: { files: File[]; onChange: (files: File[]) => void; maxMb: number }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const add = (list: FileList | null) => {
    if (!list) return;
    const existing = new Set(files.map((f) => `${f.name}:${f.size}`));
    onChange([...files, ...Array.from(list).filter((f) => !existing.has(`${f.name}:${f.size}`))]);
  };
  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          add(e.dataTransfer.files);
        }}
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center transition-colors",
          dragging ? "border-brand-500 bg-brand-50" : "border-line bg-canvas/40",
        )}
      >
        <UploadCloud className="h-6 w-6 text-muted" aria-hidden />
        <p className="text-sm">
          Drag files here or{" "}
          <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => inputRef.current?.click()}>
            browse
          </button>
        </p>
        <p className="text-xs text-muted">PDF, images, Office, CAD (DWG/DXF/STEP) or ZIP · up to {maxMb} MB each</p>
        <input ref={inputRef} type="file" multiple className="sr-only" onChange={(e) => add(e.target.files)} tabIndex={-1} />
      </div>
      {files.length > 0 && (
        <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-3 px-3 py-2 text-sm">
              <Paperclip className="h-4 w-4 shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className={cn("text-xs", f.size > maxMb * 1024 * 1024 ? "font-semibold text-red-700" : "text-muted")}>
                {formatBytes(f.size)}
                {f.size > maxMb * 1024 * 1024 && " — too large"}
              </span>
              <button type="button" onClick={() => onChange(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`} className="rounded p-1 text-muted hover:bg-canvas hover:text-ink">
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Upload panel used on the query page. */
export function AttachmentUploader({ queryId, maxMb }: { queryId: string; maxMb: number }) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tooLarge = files.some((f) => f.size > maxMb * 1024 * 1024);

  return (
    <div className="flex flex-col gap-3">
      {error && <Alert tone="error">{error}</Alert>}
      <FilePicker files={files} onChange={setFiles} maxMb={maxMb} />
      {files.length > 0 && (
        <div className="flex items-center gap-3">
          <Button
            type="button"
            size="sm"
            disabled={progress !== null || tooLarge}
            onClick={async () => {
              setError(null);
              setProgress(0);
              try {
                await uploadFiles(queryId, files, setProgress);
                setFiles([]);
                router.refresh();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setProgress(null);
              }
            }}
          >
            {progress !== null ? `Uploading… ${progress}%` : `Upload ${files.length} file${files.length > 1 ? "s" : ""}`}
          </Button>
          {progress !== null && (
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-canvas" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-brand-500 transition-all" style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
