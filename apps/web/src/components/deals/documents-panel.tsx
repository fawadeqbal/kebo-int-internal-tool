"use client";

import { useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { Download, Eye, File as FileIcon, FileText, Image as ImageIcon, Pencil, UploadCloud, X } from "lucide-react";
import { ATTACHMENT_KIND_LABEL, ATTACHMENT_KINDS, type AttachmentKind } from "@kebo/shared";
import { Badge, Button, buttonClass, cn, Input, Select } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";
import type { DealFile } from "@/lib/types";
import { RemoveFile } from "@/app/(app)/inquiries/[id]/panels";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

export type DocumentRow = DealFile & {
  uploadedBy: string;
  when: string;
  /** The deal's handler, a manager or whoever uploaded it. */
  canChange: boolean;
  describe: Action;
  remove: Action;
};

/** What a deal's own documents can be (a factory's quotation is kept with its offer). */
const DEAL_KINDS = ATTACHMENT_KINDS.filter((k) => k !== "factory_quote");

/** URS first: it is what the factories price against. */
const ORDER: AttachmentKind[] = ["urs", "specification", "drawing", "photo", "other"];
const VIEWABLE = /^(application\/pdf|image\/(png|jpeg|gif|webp))$/;

const size = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

/** A first guess from the name and type; the person can change it before uploading. */
export function guessKind(name: string, type: string): AttachmentKind {
  const n = name.toLowerCase();
  if (/\burs\b|user requirement/.test(n)) return "urs";
  if (/\.(dwg|dxf|step|stp|igs|iges)$/.test(n) || /drawing|layout|\bga\b|p&id/.test(n)) return "drawing";
  if (type.startsWith("image/")) return "photo";
  if (/spec|datasheet|data sheet|technical|tds/.test(n)) return "specification";
  return "other";
}

export type Staged = { key: string; file: File; kind: AttachmentKind; note: string; progress: number | null; error: string | null };

/** Sends one file with progress (XHR: fetch cannot report upload progress). */
export function send(dealId: string, s: Staged, onProgress: (p: number) => void, extra: Record<string, string> = {}): Promise<string | null> {
  return new Promise((resolve) => {
    const body = new FormData();
    body.set("file", s.file, s.file.name);
    body.set("kind", s.kind);
    for (const [k, v] of Object.entries(extra)) body.set(k, v);
    if (s.note.trim()) body.set("note", s.note.trim());
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/files/inquiries/${dealId}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve(null);
      try {
        resolve((JSON.parse(xhr.responseText) as { error?: string }).error ?? `Upload failed (${xhr.status})`);
      } catch {
        resolve(xhr.status === 413 ? "This file is too large." : `Upload failed (${xhr.status})`);
      }
    };
    xhr.onerror = () => resolve("The connection dropped. Try again.");
    xhr.send(body);
  });
}

/**
 * The deal's URS & documents: drop several files at once, say what each is
 * (URS, drawing, photo, specification) with a note, preview PDFs and photos,
 * and download everything in one zip.
 */
export function DocumentsPanel({ dealId, files, canUpload }: { dealId: string; files: DocumentRow[]; canUpload: boolean }) {
  const router = useRouter();
  const [staged, setStaged] = useState<Staged[]>([]);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const patch = (key: string, p: Partial<Staged>) => setStaged((s) => s.map((x) => (x.key === key ? { ...x, ...p } : x)));

  const uploadAll = async () => {
    setBusy(true);
    let done = 0;
    for (const s of staged) {
      if (s.progress === 100 && !s.error) continue;
      patch(s.key, { progress: 0, error: null });
      const error = await send(dealId, s, (p) => patch(s.key, { progress: p }));
      patch(s.key, { progress: error ? null : 100, error });
      if (!error) done += 1;
    }
    setBusy(false);
    if (done) router.refresh();
    // Keep only the ones that failed, so they can be tried again.
    setStaged((s) => s.filter((x) => x.error));
  };

  const groups = ORDER.map((k) => ({ kind: k, rows: files.filter((f) => f.kind === k) })).filter((g) => g.rows.length);

  return (
    <div className="flex flex-col gap-4">
      {canUpload && <FileDrop staged={staged} setStaged={setStaged} busy={busy} onUpload={uploadAll} />}

      {files.length === 0 ? (
        <p className="text-sm text-muted">No files yet.</p>
      ) : (
        <>
          {files.length > 1 && (
            <div>
              <a href={`/files/inquiries/${dealId}`} className={buttonClass("secondary", "sm")}>
                <Download aria-hidden /> Download all ({files.length})
              </a>
            </div>
          )}
          {groups.map((g) => (
            <section key={g.kind} aria-label={ATTACHMENT_KIND_LABEL[g.kind]}>
              <h3 className="mb-1 text-xs font-medium tracking-wide text-muted uppercase">
                {g.kind === "urs" ? "URS" : `${ATTACHMENT_KIND_LABEL[g.kind]}${g.kind === "other" ? "" : "s"}`} · {g.rows.length}
              </h3>
              <ul className="divide-y divide-line rounded-lg border border-line">
                {g.rows.map((f) => {
                  const viewable = VIEWABLE.test(f.mimeType);
                  return (
                    <li key={f.id} className="flex flex-col gap-2 p-2.5">
                      <div className="flex items-start gap-3">
                        {f.mimeType.startsWith("image/") && viewable ? (
                          // eslint-disable-next-line @next/next/no-img-element -- a private file behind the session, not a static asset
                          <img
                            src={`/files/${f.id}?view=1`}
                            alt=""
                            loading="lazy"
                            className="size-10 shrink-0 rounded border border-line object-cover"
                          />
                        ) : (
                          <span className="flex size-10 shrink-0 items-center justify-center rounded border border-line bg-surface-2 text-muted">
                            {f.mimeType === "application/pdf" ? (
                              <FileText className="size-5" aria-hidden />
                            ) : f.mimeType.startsWith("image/") ? (
                              <ImageIcon className="size-5" aria-hidden />
                            ) : (
                              <FileIcon className="size-5" aria-hidden />
                            )}
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-1.5">
                            <a href={`/files/${f.id}`} className="min-w-0 truncate text-sm font-medium hover:text-primary">
                              {f.fileName}
                            </a>
                            <Badge tone={f.kind === "urs" ? "primary" : "neutral"}>{ATTACHMENT_KIND_LABEL[f.kind]}</Badge>
                          </p>
                          {f.note && <p className="text-sm text-text-2">{f.note}</p>}
                          <p className="text-xs text-muted">
                            {size(f.size)} · {f.uploadedBy} · {f.when}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-0.5">
                          {viewable && (
                            <a
                              href={`/files/${f.id}?view=1`}
                              target="_blank"
                              rel="noopener"
                              className={buttonClass("ghost", "icon-sm")}
                              aria-label={`View ${f.fileName}`}
                              title="View"
                            >
                              <Eye aria-hidden />
                            </a>
                          )}
                          <a
                            href={`/files/${f.id}`}
                            className={buttonClass("ghost", "icon-sm")}
                            aria-label={`Download ${f.fileName}`}
                            title="Download"
                          >
                            <Download aria-hidden />
                          </a>
                          {f.canChange && (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => setEditing(editing === f.id ? null : f.id)}
                              aria-label={`Change what ${f.fileName} is`}
                              aria-pressed={editing === f.id}
                              title="Type and note"
                            >
                              <Pencil aria-hidden />
                            </Button>
                          )}
                        </div>
                      </div>
                      {editing === f.id && (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 sm:pl-13">
                          <ActionForm
                            action={f.describe}
                            onDone={() => setEditing(null)}
                            showSuccess={false}
                            className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
                          >
                            <Select name="kind" aria-label="Type" defaultValue={f.kind} className="w-40">
                              {DEAL_KINDS.map((k) => (
                                <option key={k} value={k}>
                                  {ATTACHMENT_KIND_LABEL[k]}
                                </option>
                              ))}
                            </Select>
                            <Input
                              name="note"
                              aria-label="Note"
                              defaultValue={f.note ?? ""}
                              maxLength={300}
                              placeholder="Note"
                              className="min-w-0 flex-1 basis-48"
                            />
                            <SubmitButton size="sm" variant="secondary" pendingText="Saving…">
                              Save
                            </SubmitButton>
                          </ActionForm>
                          <RemoveFile action={f.remove} name={f.fileName} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}

/**
 * A drop zone and the files waiting to go up, each with what it is and a note.
 * With onUpload it shows an Upload button; without, the files go up when the
 * surrounding form is saved (a new inquiry).
 */
export function FileDrop({
  staged,
  setStaged,
  busy,
  onUpload,
  kinds = DEAL_KINDS,
  guess = guessKind,
  title = "Drop the URS, drawings, photos or specs here",
}: {
  staged: Staged[];
  setStaged: (fn: (s: Staged[]) => Staged[]) => void;
  busy: boolean;
  onUpload?: () => void;
  /** The types a file can be here. */
  kinds?: readonly AttachmentKind[];
  guess?: (name: string, type: string) => AttachmentKind;
  title?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const add = (list: FileList | null) => {
    if (!list?.length) return;
    // Read the list now: the input is cleared right after, which empties it.
    const added = Array.from(list).map((file) => ({
      key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
      file,
      kind: guess(file.name, file.type),
      note: "",
      progress: null,
      error: null,
    }));
    setStaged((s) => [...s, ...added]);
  };
  const patch = (key: string, p: Partial<Staged>) => setStaged((s) => s.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (!busy) add(e.dataTransfer.files);
  };
  return (
    <>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        className={cn(
          "flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-line px-4 py-6 text-center transition-colors",
          over && "border-primary bg-primary-soft/50",
        )}
      >
        <UploadCloud className="size-6 text-muted" aria-hidden />
        <p className="text-sm">
          <span className="font-medium">{title}</span>
          <span className="block text-xs text-muted">Several at once is fine. You can say what each one is before uploading.</span>
        </p>
        <Button size="sm" variant="secondary" onClick={() => input.current?.click()} disabled={busy}>
          Choose files
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            add(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {staged.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
          <p className="text-sm font-medium">
            {staged.length} file{staged.length === 1 ? "" : "s"} to upload{onUpload ? "" : " with the inquiry"}
          </p>
          <ul className="flex flex-col gap-2">
            {staged.map((s) => (
              <li key={s.key} className="flex flex-col gap-1.5 rounded-md bg-surface-2/60 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm">
                    {s.file.name} <span className="text-xs text-muted">· {size(s.file.size)}</span>
                  </span>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    onClick={() => setStaged((x) => x.filter((y) => y.key !== s.key))}
                    disabled={busy}
                    aria-label={`Don't upload ${s.file.name}`}
                  >
                    <X aria-hidden />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Select
                    aria-label={`What ${s.file.name} is`}
                    value={s.kind}
                    onChange={(e) => patch(s.key, { kind: e.target.value as AttachmentKind })}
                    disabled={busy}
                    className="w-40"
                  >
                    {kinds.map((k) => (
                      <option key={k} value={k}>
                        {ATTACHMENT_KIND_LABEL[k]}
                      </option>
                    ))}
                  </Select>
                  <Input
                    aria-label={`Note for ${s.file.name}`}
                    placeholder="Note (optional), e.g. Rev B from the customer"
                    maxLength={300}
                    value={s.note}
                    onChange={(e) => patch(s.key, { note: e.target.value })}
                    disabled={busy}
                    className="min-w-0 flex-1 basis-48"
                  />
                </div>
                {s.progress !== null && (
                  <div
                    className="h-1.5 overflow-hidden rounded-full bg-surface-3"
                    role="progressbar"
                    aria-valuenow={s.progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Uploading ${s.file.name}`}
                  >
                    <div className="h-full bg-primary transition-[width]" style={{ width: `${s.progress}%` }} />
                  </div>
                )}
                {s.error && <p className="text-xs text-bad">{s.error}</p>}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            {onUpload && (
              <Button size="sm" variant="primary" onClick={onUpload} disabled={busy}>
                {busy ? "Uploading…" : `Upload ${staged.length === 1 ? "the file" : `${staged.length} files`}`}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setStaged(() => [])} disabled={busy}>
              Clear
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
