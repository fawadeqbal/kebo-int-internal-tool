"use client";

import { FileRow as ChosenFile, FileZone } from "@/components/common/file-zone";

import { useTime } from "@/lib/time-client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Eye, FileText, Image as ImageIcon, MoreHorizontal } from "lucide-react";
import { ATTACHMENT_KIND_LABEL, ATTACHMENT_KINDS, fileSize, FLOW_STEP_LABEL, type AttachmentKind } from "@kebo/shared";
import { Button, buttonClass, cn, Field, Input, Select, Textarea, Notice, linkClass } from "@kebo/ui";
import { FloatingMenu, useIsPhone } from "@/components/common/floating";
import type { ActionState } from "@/lib/actions";
import type { AttachTarget, OrderFile } from "@/lib/types-files";
import { useFileViewer, type ViewFile } from "@/components/files/viewer";
import { fileAttachAction, fileRemoveAction, filesShareAction, fileUpdateAction } from "@/app/(app)/orders/files-actions";

/* ---------------------------------------------------------------- helpers */

const noop = () => () => {};
const useMounted = () =>
  useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );

const typeLabel = (f: OrderFile) => (f.name.split(".").pop() ?? "").toUpperCase() || f.type;

export function FileIcon({ file, className }: { file: Pick<OrderFile, "type">; className?: string }) {
  const Icon = file.type.startsWith("image/") ? ImageIcon : FileText;
  return <Icon className={cn("size-4 shrink-0 text-muted", className)} aria-hidden />;
}

/** A first guess at what a file is, from its name and type (the person can change it with "Say what it is"). */
export function guessKind(name: string, type: string): AttachmentKind {
  const n = name.toLowerCase();
  if (/\burs\b|user requirement/.test(n)) return "urs";
  if (/\.(dwg|dxf|step|stp|igs|iges)$/.test(n) || /drawing|layout|\bga\b|p&id/.test(n)) return "drawing";
  if (type.startsWith("image/")) return "photo";
  if (/spec|datasheet|data sheet|technical|tds/.test(n)) return "specification";
  return "other";
}

/** Sends a file to the order (multipart through /files/orders/:id): its step, what it is, and where to attach it. */
export async function uploadToOrder(
  orderId: string,
  file: File,
  meta: { step?: string | null; section?: string | null; kind?: AttachmentKind; note?: string; attachTo?: string } = {},
): Promise<{ id?: string; sourceId?: string; error?: string }> {
  const body = new FormData();
  body.set("file", file, file.name);
  for (const [k, v] of Object.entries(meta)) if (v) body.set(k, v);
  try {
    const res = await fetch(`/files/orders/${orderId}`, { method: "POST", body });
    const json = (await res.json().catch(() => null)) as { id?: string; sourceId?: string; error?: string } | null;
    if (res.ok) return { id: json?.id, sourceId: json?.sourceId };
    return { error: res.status === 413 ? "This file is too large." : (json?.error ?? `Upload failed (${res.status})`) };
  } catch {
    return { error: "The connection dropped. Try again." };
  }
}

/** Starts a download in the browser (a link the browser follows; nothing is sent anywhere). */
export function downloadHref(href: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/* ---------------------------------------------------------------- the shared state */

type Dialog =
  | { kind: "rename"; file: OrderFile }
  | { kind: "describe"; file: OrderFile }
  | { kind: "attach"; file: OrderFile }
  | { kind: "replace"; file: OrderFile }
  | { kind: "delete"; files: OrderFile[] }
  | { kind: "attach-many"; files: OrderFile[] }
  | { kind: "share"; files: OrderFile[]; papers: { key: string; label: string; draft?: boolean }[] };

export interface ShareContext {
  refNo: string;
  /** "Dear Dr. Imran": who the message is for (the customer's contact), when known. */
  greeting: string | null;
  vessel: string | null;
  eta: string | null;
}

interface Tools {
  orderId: string;
  files: OrderFile[];
  targets: AttachTarget[];
  share: ShareContext;
  view: (file: OrderFile, set?: OrderFile[]) => void;
  open: (d: Dialog) => void;
}

const FileToolsContext = createContext<Tools | null>(null);

/** The file tools of an order page: the viewer and the dialogs, once for every chip and row on it. */
export function useFileTools() {
  return useContext(FileToolsContext);
}

/**
 * Documents v3: the same tools on every file of an order — a chip on a section
 * row or a paper, a row in the Files list, a payment's proof — and one viewer
 * and one set of dialogs for all of them. Put it around an order page with the
 * order's files (GET /orders/:id/files).
 */
export function FileToolsProvider({
  orderId,
  files,
  targets,
  share,
  children,
}: {
  orderId: string;
  files: OrderFile[];
  targets: AttachTarget[];
  share: ShareContext;
  children: ReactNode;
}) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const viewer = useFileViewer();
  const t = useTime();
  const view = useCallback(
    (file: OrderFile, set?: OrderFile[]) => {
      if (!viewer) return downloadHref(file.href);
      const all = set?.some((f) => f.id === file.id) ? set : [file];
      viewer.open(
        all.map((f) => toView(f, t, setDialog, viewer.close, orderId, share)),
        all.findIndex((f) => f.id === file.id),
      );
    },
    [viewer, t, orderId, share],
  );
  const tools = useMemo<Tools>(() => ({ orderId, files, targets, share, view, open: setDialog }), [orderId, files, targets, share, view]);
  return (
    <FileToolsContext.Provider value={tools}>
      {children}
      {dialog && <FileDialog dialog={dialog} tools={tools} onClose={() => setDialog(null)} />}
    </FileToolsContext.Provider>
  );
}

/* ---------------------------------------------------------------- the ⋯ menu */

const itemClass =
  "flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-surface-2 focus:bg-surface-2 focus:outline-none";

function MenuItem({ label, hint, onClick, danger }: { label: string; hint?: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" role="menuitem" className={cn(itemClass, danger && "text-bad")} onClick={onClick}>
      <span>{label}</span>
      {hint && <span className="truncate text-xs text-muted">{hint}</span>}
    </button>
  );
}

const Sep = () => <span role="separator" className="my-1 block h-px bg-line" />;

/** One file's menu: View, Download, Share…, Rename, Say what it is, Attach to…, Replace with a newer one, Delete. */
export function FileMenu({
  file,
  anchor,
  onClose,
  set,
}: {
  file: OrderFile;
  anchor: () => HTMLElement | null;
  onClose: () => void;
  set?: OrderFile[];
}) {
  const t = useTime();
  const tools = useFileTools();
  if (!tools) return null;
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <FloatingMenu
      anchor={anchor}
      onClose={onClose}
      label={`${file.name}: tools`}
      width={280}
      header={
        <div className="px-2.5 pt-1 pb-2">
          <p className="truncate text-sm font-semibold">{file.name}</p>
          <p className="text-xs text-muted">
            {[file.attachedTo.label, file.by?.name, t.dayMonth(file.at), fileSize(file.size)].filter(Boolean).join(" · ")}
          </p>
        </div>
      }
    >
      <MenuItem label="View" onClick={run(() => tools.view(file, set))} />
      <MenuItem label="Download" onClick={run(() => downloadHref(file.href))} />
      <MenuItem label="Share…" onClick={run(() => tools.open({ kind: "share", files: [file], papers: [] }))} />
      {(file.can.rename || file.can.describe || file.can.attach || file.can.replace) && <Sep />}
      {file.can.rename && <MenuItem label="Rename" onClick={run(() => tools.open({ kind: "rename", file }))} />}
      {file.can.describe && (
        <MenuItem
          label="Say what it is"
          hint={file.note ?? file.kindLabel ?? undefined}
          onClick={run(() => tools.open({ kind: "describe", file }))}
        />
      )}
      {file.can.attach && <MenuItem label="Attach to…" onClick={run(() => tools.open({ kind: "attach", file }))} />}
      {file.can.replace && (
        <MenuItem
          label="Replace with a newer one"

          onClick={run(() => tools.open({ kind: "replace", file }))}
        />
      )}
      {file.versions.length > 0 && (
        <MenuItem label="Versions" hint={String(file.versions.length + 1)} onClick={run(() => tools.view(file, set))} />
      )}
      {file.can.remove && (
        <>
          <Sep />
          <MenuItem label="Delete" danger onClick={run(() => tools.open({ kind: "delete", files: [file] }))} />
        </>
      )}
    </FloatingMenu>
  );
}

/** The ⋯ button of a file, with its menu. */
export function FileMenuButton({ file, set, className }: { file: OrderFile; set?: OrderFile[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={`More for ${file.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(buttonClass("ghost", "icon-xs"), className)}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreHorizontal aria-hidden />
      </button>
      {open && <FileMenu file={file} set={set} anchor={() => ref.current} onClose={() => setOpen(false)} />}
    </>
  );
}

/* ---------------------------------------------------------------- chip and row */

/**
 * A file as a chip (on a section, a paper, a payment): its name opens it,
 * then View · Download · ⋯. On a phone the chip opens the file's sheet.
 * Without the tools around it (another page), it is a plain link.
 */
export function FileChip({
  file,
  set,
  className,
  compact,
}: {
  file: OrderFile | { id: string; name: string; href: string; viewHref?: string | null };
  set?: OrderFile[];
  className?: string;
  /** Only the name (it opens the file; the row around it has the menu): for narrow cells. */
  compact?: boolean;
}) {
  const tools = useFileTools();
  const phone = useIsPhone();
  const ref = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState(false);
  const full = "source" in file ? file : tools?.files.find((f) => f.sourceId === file.id || f.id === file.id);
  const pill =
    "inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-surface-2 py-0.5 pr-1 pl-2.5 text-xs font-medium";
  if (!tools || !full)
    return (
      <a
        href={file.viewHref ?? `${file.href}?view=1`}
        data-file-name={file.name}
        className={cn(pill, "pr-2.5 hover:border-line-strong", className)}
      >
        <FileText className="size-3.5 shrink-0 text-muted" aria-hidden />
        <span className="truncate">{file.name}</span>
      </a>
    );
  if (compact)
    return (
      <button
        type="button"
        className={cn(pill, "max-w-full pr-2.5 hover:border-primary/50", className)}
        onClick={() => tools.view(full, set)}
        title={`${full.name} · open it here`}
      >
        <FileIcon file={full} className="size-3.5" />
        <span className="truncate">{full.name}</span>
      </button>
    );
  return (
    <span className={cn(pill, "hover:border-primary/50", menu && "border-primary", className)} data-file-chip>
      <button
        ref={ref}
        type="button"
        className="inline-flex min-w-0 items-center gap-1.5 py-0.5 text-left"
        onClick={() => (phone ? setMenu(true) : tools.view(full, set))}
        title="Open it here"
      >
        <FileIcon file={full} className="size-3.5" />
        <span className="truncate">{full.name}</span>
      </button>
      <span className="hidden items-center sm:inline-flex">
        <button
          type="button"
          className={buttonClass("ghost", "icon-sm")}
          aria-label={`View ${full.name}`}
          onClick={() => tools.view(full, set)}
        >
          <Eye aria-hidden />
        </button>
        <a href={full.href} download className={buttonClass("ghost", "icon-sm")} aria-label={`Download ${full.name}`}>
          <Download aria-hidden />
        </a>
        <FileMenuButton file={full} set={set} className="size-6" />
      </span>
      {menu && phone && <FileMenu file={full} set={set} anchor={() => ref.current} onClose={() => setMenu(false)} />}
    </span>
  );
}

/* ---------------------------------------------------------------- the viewer */

/**
 * An order's file as the app's viewer shows it (components/files/viewer.tsx): where it belongs, what it is, who
 * added it, its earlier versions, and Share, Replace and Delete. What it is and where it is attached change
 * from its Details.
 */
function toView(
  file: OrderFile,
  t: ReturnType<typeof useTime>,
  open: (d: Dialog) => void,
  close: () => void,
  orderId: string,
  share: ShareContext,
): ViewFile {
  const then = (d: Dialog) => () => {
    close();
    open(d);
  };
  return {
    key: file.id,
    name: file.name,
    href: file.href,
    viewHref: file.viewHref,
    type: file.type,
    size: file.size,
    where: [file.stepLabel, file.attachedTo.label].filter(Boolean).join(" · "),
    facts: [
      [
        "What it is",
        <span key="w">
          {[file.note, file.kindLabel].filter(Boolean).join(" · ") || "—"}
          {file.can.describe && (
            <button type="button" className={cn(linkClass, "ml-1.5")} onClick={then({ kind: "describe", file })}>
              change
            </button>
          )}
        </span>,
      ],
      [
        "Attached to",
        <Link key="a" href={file.attachedTo.href} className={linkClass}>
          {file.attachedTo.label}
        </Link>,
      ],
      ["Added", `${file.by?.name ?? "System"} · ${t.dateTime(file.at)}`],
      ["Size", `${fileSize(file.size)} · ${typeLabel(file)}`],
    ],
    versions: file.versions.map((v) => ({ key: v.id, label: `v${v.version} · ${v.name} · ${t.date(v.at)}`, href: v.href })),
    // Send from the window's panel, noted in the order's History like Share… (the app sends nothing itself).
    send: { message: shareMessage(share, [file.name]), onNoted: (via, message) => filesShareAction(orderId, { files: [file.id], papers: [], via, message }) },
    actions: [
      ...(file.can.rename ? [{ label: "Rename", onClick: then({ kind: "rename", file }) }] : []),
      ...(file.can.replace ? [{ label: "Replace", main: true, onClick: then({ kind: "replace", file }) }] : []),
      ...(file.can.remove ? [{ label: "Delete", danger: true, onClick: then({ kind: "delete", files: [file] }) }] : []),
    ],
  };
}

/* ---------------------------------------------------------------- dialogs */

function Modal({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const id = useId();
  const mounted = useMounted();
  const head = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  useEffect(() => {
    if (mounted) head.current?.focus();
  }, [mounted]);
  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center sm:p-4">
      <button type="button" aria-label="Close" tabIndex={-1} className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        className="relative flex max-h-[90dvh] w-full flex-col scroll-y rounded-t-2xl border border-line bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-pop sm:max-w-md sm:rounded-xl"
      >
        <h2 id={`${id}-t`} ref={head} tabIndex={-1} className="text-base font-semibold outline-none">
          {title}
        </h2>
        {description && <div className="mt-1 text-xs text-muted">{description}</div>}
        <div className="mt-4 flex flex-col gap-3">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

function useRun(onClose: () => void) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionState | { error?: string } | null>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      const failed = r && ("error" in r ? r.error : "ok" in r && !r.ok ? (r.message ?? "Something went wrong. Please try again.") : null);
      if (failed) return setError(failed);
      onClose();
      router.refresh();
    });
  return { pending, error, run, setError };
}

function Buttons({ pending, save, onClose, danger }: { pending: boolean; save: string; onClose: () => void; danger?: boolean }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <Button type="submit" size="sm" variant={danger ? "danger" : "primary"} disabled={pending}>
        {pending ? "Saving…" : save}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onClose}>
        Cancel
      </Button>
    </div>
  );
}

const sourceOf = (f: OrderFile) => [f.source, f.sourceId] as const;

function FileDialog({ dialog, tools, onClose }: { dialog: Dialog; tools: Tools; onClose: () => void }) {
  const id = useId();
  const { pending, error, run, setError } = useRun(onClose);
  const { orderId } = tools;
  const [file, setFile] = useState<File | null>(null);

  if (dialog.kind === "rename") {
    const f = dialog.file;
    const ext = /\.[^.]{1,10}$/.exec(f.name)?.[0] ?? "";
    return (
      <Modal title="Rename" description={`Keeps its type (${ext || "no extension"}).`} onClose={onClose}>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const name = String(new FormData(e.currentTarget).get("name") ?? "").trim();
            run(() => fileUpdateAction(orderId, ...sourceOf(f), { name }));
          }}
        >
          {error && <Notice tone="bad">{error}</Notice>}
          <Field label="Name" htmlFor={`${id}-n`}>
            <Input
              id={`${id}-n`}
              name="name"
              required
              maxLength={200}
              defaultValue={ext ? f.name.slice(0, -ext.length) : f.name}
              autoFocus
            />
          </Field>
          <Buttons pending={pending} save="Rename" onClose={onClose} />
        </form>
      </Modal>
    );
  }

  if (dialog.kind === "describe") {
    const f = dialog.file;
    return (
      <Modal title="Say what it is" description={f.name} onClose={onClose}>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const v = new FormData(e.currentTarget);
            run(() =>
              fileUpdateAction(orderId, ...sourceOf(f), { kind: v.get("kind") as AttachmentKind, note: String(v.get("note") ?? "") }),
            );
          }}
        >
          {error && <Notice tone="bad">{error}</Notice>}
          <Field label="Kind" htmlFor={`${id}-k`}>
            <Select id={`${id}-k`} name="kind" defaultValue={f.kind ?? "other"}>
              {ATTACHMENT_KINDS.filter((k) => k !== "factory_quote").map((k) => (
                <option key={k} value={k}>
                  {ATTACHMENT_KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="What it is" htmlFor={`${id}-w`} optional>
            <Input id={`${id}-w`} name="note" maxLength={300} defaultValue={f.note ?? ""} />
          </Field>
          <Buttons pending={pending} save="Save" onClose={onClose} />
        </form>
      </Modal>
    );
  }

  if (dialog.kind === "attach" || dialog.kind === "attach-many") {
    const files = dialog.kind === "attach" ? [dialog.file] : dialog.files.filter((f) => f.can.attach);
    const groups: [string, AttachTarget[]][] = [
      ["Documents", tools.targets.filter((t) => t.to === "paper")],
      ["A stage's files", tools.targets.filter((t) => t.to === "step")],
    ];
    return (
      <Modal
        title={files.length === 1 ? "Attach to…" : `Attach ${files.length} files to…`}
        description={
          files.length === 1
            ? `${files[0]!.name} · now: ${files[0]!.attachedTo.label}`
            : "Only the inquiry's own files move; payments' proofs stay with their payment."
        }
        onClose={onClose}
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const v = String(new FormData(e.currentTarget).get("target") ?? "");
            const [to, ...rest] = v.split("|");
            const target = rest.join("|");
            if (!to || !target) return setError("Choose where to attach it.");
            run(async () => {
              for (const f of files) {
                const r = await fileAttachAction(orderId, ...sourceOf(f), { to, target } as never);
                if (!r.ok) return r;
              }
              return null;
            });
          }}
        >
          {error && <Notice tone="bad">{error}</Notice>}
          {!files.length ? (
            <p className="text-sm text-muted">None of these files can be moved.</p>
          ) : (
            <Field label="Attach to" htmlFor={`${id}-t`}>
              <Select id={`${id}-t`} name="target" defaultValue="">
                <option value="" disabled>
                  Choose…
                </option>
                {groups
                  .filter(([, t]) => t.length)
                  .map(([g, t]) => (
                    <optgroup key={g} label={g}>
                      {t.map((x) => (
                        <option key={`${x.to}|${x.target}`} value={`${x.to}|${x.target}`}>
                          {x.label}
                          {x.to !== "step" ? ` · ${FLOW_STEP_LABEL[x.step]}` : ""}
                        </option>
                      ))}
                    </optgroup>
                  ))}
              </Select>
            </Field>
          )}
          <Buttons pending={pending} save="Attach" onClose={onClose} />
        </form>
      </Modal>
    );
  }

  if (dialog.kind === "replace") {
    const f = dialog.file;
    return (
      <Modal
        title="Replace with a newer one"
        description={
          f.source === "attachment"
            ? `${f.name} stays as version ${f.version}; whatever it is attached to gets the new one.`
            : `${f.name} is replaced.`
        }
        onClose={onClose}
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!file) return setError("Choose the newer file.");
            run(async () => {
              const body = new FormData();
              body.set("file", file, file.name);
              try {
                const res = await fetch(`/files/orders/${orderId}/${f.source}/${f.sourceId}`, { method: "POST", body });
                if (res.ok) return null;
                return {
                  error: ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `Upload failed (${res.status})`,
                };
              } catch {
                return { error: "The connection dropped. Try again." };
              }
            });
          }}
        >
          {error && <Notice tone="bad">{error}</Notice>}
          <FileZone label="The newer file" inputId={`${id}-f`} optional={false} compact one onFiles={(fs) => setFile(fs[0] ?? null)}>
            {file && <ChosenFile name={file.name} />}
          </FileZone>
          <Buttons pending={pending} save="Replace" onClose={onClose} />
        </form>
      </Modal>
    );
  }

  if (dialog.kind === "delete") {
    const files = dialog.files.filter((f) => f.can.remove);
    const one = files.length === 1 ? files[0]! : null;
    return (
      <Modal
        title={one ? `Delete ${one.name}?` : `Delete ${files.length} files?`}
        description={
          one
            ? `It is taken off ${one.attachedTo.label}. The deletion is noted in History.`
            : `${dialog.files.length - files.length ? `${dialog.files.length - files.length} of those chosen are not yours to delete and stay. ` : ""}The deletions are noted in History.`
        }
        onClose={onClose}
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              for (const f of files) {
                const r = await fileRemoveAction(orderId, ...sourceOf(f));
                if (!r.ok) return r;
              }
              return null;
            });
          }}
        >
          {error && <Notice tone="bad">{error}</Notice>}
          <Buttons pending={pending || !files.length} save="Delete" onClose={onClose} danger />
        </form>
      </Modal>
    );
  }

  return <ShareDialog files={dialog.files} papers={dialog.papers} tools={tools} onClose={onClose} />;
}

/** The message prepared for a share: the order, the papers, the vessel and ETA. */
export function shareMessage(ctx: ShareContext, names: string[]) {
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : (names[0] ?? "the documents");
  const ship = [ctx.vessel && `Vessel ${ctx.vessel}`, ctx.eta && `ETA ${ctx.eta}`].filter(Boolean).join(", ");
  return `${ctx.greeting ? `${ctx.greeting}, please` : "Please"} find the documents for ${ctx.refNo}: ${list}.${ship ? ` ${ship}.` : ""}`;
}

/**
 * Share…: on a phone, the share sheet with the files themselves (WhatsApp,
 * email, WeChat); on a computer, the files download (one zip when several) and
 * the message is copied to paste. The app sends nothing; the share is noted in
 * History.
 */
function ShareDialog({
  files,
  papers,
  tools,
  onClose,
}: {
  files: OrderFile[];
  papers: { key: string; label: string; draft?: boolean }[];
  tools: Tools;
  onClose: () => void;
}) {
  const id = useId();
  // A paper not issued yet goes out marked DRAFT: said before it is sent (review 24 Nov, O-30).
  const drafts = papers.filter((p) => p.draft).map((p) => p.label);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const names = [...papers.map((p) => p.label), ...files.map((f) => f.name)];
  const [message, setMessage] = useState(() => shareMessage(tools.share, names));
  const count = files.length + papers.length;
  const downloadUrl =
    papers.length && !files.length
      ? `/pdf/set/${tools.orderId}?as=pdf&keys=${papers.map((p) => encodeURIComponent(p.key)).join(",")}`
      : files.length === 1 && !papers.length
        ? files[0]!.href
        : `/files/orders/${tools.orderId}?files=${files.map((f) => f.id).join(",")}`;
  const note = (via: "share" | "download") =>
    filesShareAction(tools.orderId, { files: files.map((f) => f.id), papers: papers.map((p) => p.key), via, message });

  const share = () =>
    start(async () => {
      setError(null);
      // The share sheet on a phone or a tablet; a computer downloads instead.
      const canShareFiles = "canShare" in navigator && window.matchMedia("(max-width: 639px), (pointer: coarse)").matches;
      if (canShareFiles) {
        try {
          const blobs = await Promise.all(
            (papers.length && !files.length
              ? [{ href: downloadUrl, name: `${tools.share.refNo} documents.pdf` }]
              : files.map((f) => ({ href: f.href, name: f.name }))
            ).map(async (f) => {
              const res = await fetch(f.href);
              if (!res.ok) throw new Error(`${f.name} could not be fetched (${res.status}).`);
              const b = await res.blob();
              return new File([b], f.name, { type: b.type });
            }),
          );
          if (navigator.canShare({ files: blobs })) {
            await navigator.share({ files: blobs, text: message, title: tools.share.refNo });
            await note("share");
            onClose();
            router.refresh();
            return;
          }
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") return; // closed the share sheet
        }
      }
      // A computer (or a browser that cannot share files): download and copy the message.
      await downloadOnly();
    });

  const downloadOnly = async () => {
    downloadHref(downloadUrl);
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
    } catch {
      setCopied(false);
    }
    const r = await note("download");
    if (!r.ok) return setError(r.message ?? "The share could not be noted.");
    router.refresh();
  };

  return (
    <Modal
      title={`Share ${count === 1 ? names[0] : `${count} files`}`}
      description="Share opens the share sheet with the files themselves (WhatsApp, email, WeChat) where the device has one. WhatsApp and Email download the files (several as one zip) and open the chat or a new email with the message, to attach them."
      onClose={onClose}
    >
      {drafts.length > 0 && (
        <Notice tone="todo">
          {drafts.join(", ")} {drafts.length === 1 ? "is a draft" : "are drafts"}: not issued yet, so {drafts.length === 1 ? "it goes" : "they go"} out marked DRAFT, without a number. Issue it first to send the real one.
        </Notice>
      )}
      {error && <Notice tone="bad">{error}</Notice>}
      {copied && <Notice tone="ok">Downloaded, and the message is copied: attach the file in WhatsApp or your email (📎).</Notice>}
      <Field label="Message" htmlFor={`${id}-m`}>
        <Textarea id={`${id}-m`} rows={4} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" disabled={pending} onClick={share}>
          {pending ? "Preparing…" : "Share"}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              // WhatsApp with the message written; the files download to attach (the app sends nothing).
              window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank", "noopener");
              await downloadOnly();
            })
          }
        >
          WhatsApp
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await downloadOnly();
              window.location.assign(`mailto:?subject=${encodeURIComponent(tools.share.refNo)}&body=${encodeURIComponent(message)}`);
            })
          }
        >
          Email
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(downloadOnly)}>
          Download only
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          {copied ? "Done" : "Cancel"}
        </Button>
      </div>
      <p className="text-xs text-muted">The share is noted in History (who, what, when). Nothing is sent by the app itself.</p>
    </Modal>
  );
}
