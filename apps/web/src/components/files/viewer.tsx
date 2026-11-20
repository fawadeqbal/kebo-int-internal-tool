"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  Copy,
  Mail,
  MessageCircle,
  ChevronRight,
  Download,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Info,
  Minus,
  MoreHorizontal,
  Plus,
  Printer,
  Share2,
  X,
} from "lucide-react";
import { fileSize } from "@kebo/shared";
import { Button, buttonClass, capsClass, cn, linkClass } from "@kebo/ui";
import { useIsPhone, FloatingMenu } from "@/components/common/floating";
import { useMounted } from "@/components/common/dialog";
import { lockScroll } from "@/lib/scroll-lock";
import { toast } from "@kebo/ui/client";

/* ---------------------------------------------------------------- what is shown */

/** What the viewer can draw: a PDF, a photo, an Excel sheet, a CSV or text file, one of our own papers, or none. */
export type ViewKind = "pdf" | "image" | "sheet" | "csv" | "text" | "paper" | "other";

/** One file (or paper) to show. Only `key`, `name` and `href` are needed; the rest makes it richer. */
export interface ViewFile {
  key: string;
  name: string;
  /** Where it downloads from (/files/:id). */
  href: string;
  /** Where it shows inline (/files/:id?view=1, or a paper's /print/… page). */
  viewHref?: string | null;
  kind?: ViewKind;
  /** Its content type and size, when known (else asked of the server once it opens). */
  type?: string | null;
  size?: number | null;
  /** Where it belongs: "Payment received · SO-2026-0010". */
  where?: string | null;
  /** "About this file": label · value. */
  facts?: [string, ReactNode][];
  /** Earlier versions: their name, day and download. */
  versions?: { key: string; label: string; href: string }[];
  /** More things to do (Replace, Delete…), in ⋯ and under the details. */
  actions?: { label: string; onClick: () => void; danger?: boolean }[];
  onShare?: () => void;
}

const EXT_KIND: Record<string, ViewKind> = {
  pdf: "pdf",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  xlsx: "sheet",
  csv: "csv",
  txt: "text",
};

/** What a file is, from its kind given, its content type or its name. */
export function kindOf(f: Pick<ViewFile, "kind" | "type" | "name" | "viewHref">): ViewKind {
  if (f.kind) return f.kind;
  if (f.viewHref?.startsWith("/print/")) return "paper";
  const t = (f.type ?? "").toLowerCase();
  if (t === "application/pdf") return "pdf";
  if (/^image\/(png|jpe?g|gif|webp)$/.test(t)) return "image";
  if (t.includes("spreadsheetml")) return "sheet";
  if (t === "text/csv") return "csv";
  if (t === "text/plain") return "text";
  return EXT_KIND[(f.name.split(".").pop() ?? "").toLowerCase()] ?? "other";
}

const KIND_WORD: Record<ViewKind, string> = {
  pdf: "PDF",
  image: "Photo",
  sheet: "Excel file",
  csv: "CSV file",
  text: "Text file",
  paper: "Document",
  other: "File",
};

/* ---------------------------------------------------------------- one viewer for the app */

interface Viewer {
  /** Shows `set[at]`, with ‹ › through the others of the set. */
  open: (set: ViewFile[], at?: number) => void;
  close: () => void;
}

const ViewerContext = createContext<Viewer | null>(null);

/** The app's one file viewer (null outside the app's pages). */
export function useFileViewer() {
  return useContext(ViewerContext);
}

/** A stored file's link (/files/:id?view=1) or one of our own papers (/print/…), from any page. */
const FILE_LINK = /^\/files\/[\w-]+(\?|$)/;
const PAPER_LINK = /^\/print\//;

/** The words of a link (its aria-label, else its text) without "Open", "View / Print the", "in a new tab". */
const nameOfLink = (a: HTMLAnchorElement) =>
  (a.dataset.fileName ?? a.getAttribute("aria-label") ?? a.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(Open|View \/ Print|View|See how)( the)?\s+/i, "")
    .replace(/\s+(prints|in a new tab)$/i, "");

/** A link the viewer shows: a stored file opened to view, or a paper. Never one that downloads. */
function viewable(a: HTMLAnchorElement): ViewFile | null {
  if (a.hasAttribute("download") || a.dataset.newTab !== undefined) return null;
  const url = new URL(a.href, window.location.href);
  if (url.origin !== window.location.origin) return null;
  const path = url.pathname + url.search;
  if (FILE_LINK.test(path) && url.searchParams.get("view") === "1") {
    const href = url.pathname;
    return { key: href, name: nameOfLink(a) || "File", href, viewHref: path };
  }
  if (PAPER_LINK.test(url.pathname)) return { key: path, name: nameOfLink(a) || "Document", href: path, viewHref: path, kind: "paper" };
  return null;
}

/**
 * Around the app's pages: every stored file and every paper opens here, over the page, instead of in a new tab
 * (Fawad 21 Nov). Links need nothing special: a click on /files/…?view=1 or /print/… is caught, and the other
 * such links next to it (its list, table or box) are the set ‹ › go through. Ctrl/⌘-click or a middle click
 * still open a new tab; a link marked data-new-tab always does.
 */
export function FileViewerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ set: ViewFile[]; at: number } | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const open = useCallback((set: ViewFile[], at = 0) => {
    if (!set.length) return;
    opener.current = document.activeElement as HTMLElement | null;
    setState({ set, at: Math.min(Math.max(at, 0), set.length - 1) });
  }, []);
  const close = useCallback(() => {
    setState(null);
    opener.current?.focus?.({ preventScroll: true });
  }, []);
  const viewer = useMemo<Viewer>(() => ({ open, close }), [open, close]);

  useEffect(() => {
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.closest("[data-file-viewer]")) return;
      const file = viewable(a);
      if (!file) return;
      e.preventDefault();
      // The set: the links of the same kind in the same list, table or box, in page order.
      const scope = a.closest("[data-file-set], ul, ol, table, section, [role=dialog]") ?? document.body;
      const seen = new Set<string>();
      const set = [...scope.querySelectorAll<HTMLAnchorElement>("a[href]")]
        .map((x) => viewable(x))
        .filter((f): f is ViewFile => !!f && f.kind === file.kind && !seen.has(f.key) && !!seen.add(f.key));
      const at = set.findIndex((f) => f.key === file.key);
      open(at >= 0 ? set : [file], Math.max(at, 0));
    };
    // Before the page's own handlers (a Next <Link> would go to the page itself).
    document.addEventListener("click", click, true);
    return () => document.removeEventListener("click", click, true);
  }, [open]);

  return (
    <ViewerContext.Provider value={viewer}>
      {children}
      {state && <FileViewer set={state.set} at={state.at} onMove={(at) => setState((s) => s && { ...s, at })} onClose={close} />}
    </ViewerContext.Provider>
  );
}

/** Opens a link to a stored file or a paper in the viewer, from a menu rather than a link: false when it is not one. */
export function useOpenHere() {
  const viewer = useFileViewer();
  return useCallback(
    (href: string, name: string) => {
      if (!viewer) return false;
      const a = document.createElement("a");
      a.href = href;
      a.dataset.fileName = name;
      const file = viewable(a);
      if (file) viewer.open([file]);
      return !!file;
    },
    [viewer],
  );
}

/* ---------------------------------------------------------------- the viewer */

/** What the server says of a stored file once it opens (its name, type and size), when the link did not. */
function useHeadOf(f: ViewFile) {
  const [head, setHead] = useState<{ type: string | null; size: number | null; name: string | null } | null>(null);
  const known = !!(f.type && f.size !== undefined && f.size !== null) || kindOf(f) === "paper";
  useEffect(() => {
    if (known) return;
    let live = true;
    fetch(f.href, { method: "HEAD" })
      .then((r) => {
        if (!live || !r.ok) return;
        const cd = r.headers.get("content-disposition") ?? "";
        const named = /filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1] ?? /filename="?([^";]+)"?/i.exec(cd)?.[1] ?? null;
        setHead({
          type: (r.headers.get("content-type") ?? "").split(";")[0]!.trim() || null,
          size: Number(r.headers.get("content-length")) || null,
          name: named ? decodeURIComponent(named) : null,
        });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [f.href, known]);
  return head;
}

/** A paper inside the viewer tells it its buttons (the PDF, Excel, the customer's or internal copy). */
interface PaperInfo {
  title: string;
  pdfHref: string;
  excelHref?: string;
  copies?: { current: "customer" | "internal"; customer: string; internal: string };
}

function FileViewer({ set, at, onMove, onClose }: { set: ViewFile[]; at: number; onMove: (at: number) => void; onClose: () => void }) {
  const mounted = useMounted();
  const phone = useIsPhone();
  const id = useId();
  const given = set[at]!;
  const head = useHeadOf(given);
  const file: ViewFile = {
    ...given,
    name: given.name && given.name !== "File" ? given.name : (head?.name ?? given.name),
    type: given.type ?? head?.type ?? null,
    size: given.size ?? head?.size ?? null,
  };
  const kind = kindOf(file);
  const prev = at > 0 ? at - 1 : null;
  const next = at < set.length - 1 ? at + 1 : null;
  const [details, setDetails] = useState(!phone && !!file.facts?.length);
  const [more, setMore] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [sharing, setSharing] = useState<HTMLElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  // What the paper in the frame said, and the copy picked: both for this file only.
  const [paperOf, setPaperOf] = useState<{ key: string; info?: PaperInfo; href?: string } | null>(null);
  const paper = paperOf?.key === given.key ? (paperOf.info ?? null) : null;
  const paperHref = paperOf?.key === given.key ? (paperOf.href ?? null) : null;
  const setPaperHref = (href: string) => setPaperOf((p) => ({ ...(p?.key === given.key ? p : null), key: given.key, href }));
  const shown = kind === "paper" ? (paperHref ?? file.viewHref ?? file.href) : (file.viewHref ?? file.href);

  // Esc closes, ← → move; the page under it stays still; the phone's Back closes it.
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !more) onClose();
      else if (e.key === "ArrowLeft" && prev !== null && !(e.target as HTMLElement).closest("input,textarea")) onMove(prev);
      else if (e.key === "ArrowRight" && next !== null && !(e.target as HTMLElement).closest("input,textarea")) onMove(next);
    };
    window.addEventListener("keydown", keys);
    const unlock = lockScroll();
    return () => {
      window.removeEventListener("keydown", keys);
      unlock();
    };
  }, [onClose, onMove, prev, next, more]);
  useEffect(() => {
    window.history.pushState({ fileViewer: true }, "");
    const back = () => onClose();
    window.addEventListener("popstate", back);
    return () => {
      window.removeEventListener("popstate", back);
      if (window.history.state?.fileViewer) window.history.back();
    };
  }, [onClose]);
  useEffect(() => {
    if (mounted) titleRef.current?.focus({ preventScroll: true });
  }, [mounted, given.key]);
  // A paper in the frame says what its toolbar held.
  useEffect(() => {
    const got = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return;
      const d = e.data as { type?: string } & PaperInfo;
      if (d?.type === "kebo-paper")
        setPaperOf((p) => ({
          ...(p?.key === key ? p : null),
          key,
          info: { title: d.title, pdfHref: d.pdfHref, excelHref: d.excelHref, copies: d.copies },
        }));
    };
    const key = given.key;
    window.addEventListener("message", got);
    return () => window.removeEventListener("message", got);
  }, [given.key]);

  if (!mounted) return null;
  const title = kind === "paper" && paper?.title ? paper.title : file.name;
  const where = [
    set.length > 1 ? `${at + 1} of ${set.length}` : null,
    file.where,
    kind !== "paper" && file.size ? `${fileSize(file.size)} · ${KIND_WORD[kind]}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const download = kind === "paper" ? (paper?.pdfHref ?? null) : file.href;
  const canPrint = kind === "paper" || kind === "image";
  // Share: an order's file has its own (noted in History); any other file or paper, the share menu here.
  const shareThis = download ? { href: download, name: kind === "paper" ? `${title}.pdf` : file.name } : null;
  const share = (e: { currentTarget: HTMLElement }) => (file.onShare ? file.onShare() : setSharing(e.currentTarget));
  const canShare = !!file.onShare || !!shareThis;
  const print = () => {
    if (kind === "paper") frame.current?.contentWindow?.print();
    else printImage(file.viewHref ?? file.href, title);
  };
  const actions = [
    ...(paper?.excelHref ? [{ label: "Download Excel", onClick: () => (window.location.href = paper.excelHref!) }] : []),
    ...(file.actions ?? []),
  ];
  const hasDetails = !!(file.facts?.length || file.versions?.length);
  const Icon = kind === "image" ? ImageIcon : kind === "sheet" || kind === "csv" ? FileSpreadsheet : FileText;

  const iconButton =
    "grid size-9 shrink-0 place-items-center rounded-[10px] border border-line-strong bg-surface text-text-2 hover:bg-surface-2 disabled:opacity-40 max-sm:size-11 max-sm:rounded-full max-sm:border-0";

  return createPortal(
    <div className="fixed inset-0 z-[80] flex" data-file-viewer="">
      <button type="button" aria-label="Close the viewer" tabIndex={-1} className="absolute inset-0 bg-black/50" onClick={onClose} />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        className="relative m-0 flex w-full flex-col overflow-hidden bg-surface shadow-pop sm:m-6 sm:rounded-2xl"
      >
        {/* Head: what it is, where it belongs, n of N; then ‹ ›, Print, Download, Share, ⋯, Details, ✕ (design 21 Nov). */}
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line pr-1 pl-1 sm:h-16 sm:gap-3 sm:pr-3 sm:pl-5">
          <Button size="icon" variant="ghost" aria-label="Close the viewer" onClick={onClose} className="sm:hidden">
            <X aria-hidden />
          </Button>
          <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-primary-soft text-primary max-sm:hidden">
            <Icon className="size-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={`${id}-t`} ref={titleRef} tabIndex={-1} className="truncate text-base font-semibold outline-none max-sm:font-bold">
              {title}
            </h2>
            {where && <p className="truncate text-xs text-muted sm:text-md">{where}</p>}
          </div>
          {set.length > 1 && (
            <div className="flex items-center gap-1 max-sm:hidden">
              <button
                type="button"
                className={iconButton}
                disabled={prev === null}
                aria-label={prev !== null ? `Previous: ${set[prev]!.name}` : "No previous file"}
                onClick={() => prev !== null && onMove(prev)}
              >
                <ChevronLeft className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                className={iconButton}
                disabled={next === null}
                aria-label={next !== null ? `Next: ${set[next]!.name}` : "No next file"}
                onClick={() => next !== null && onMove(next)}
              >
                <ChevronRight className="size-4" aria-hidden />
              </button>
            </div>
          )}
          {set.length > 1 && <span aria-hidden className="h-6 w-px bg-line max-sm:hidden" />}
          <div className="flex items-center gap-2 max-sm:hidden">
            {paper?.copies && (
              <div role="group" aria-label="Which copy" className="flex rounded-[10px] bg-surface-2 p-0.5">
                {(["customer", "internal"] as const).map((k) => {
                  const on = paperHref ? paperHref === paper.copies![k] : paper.copies!.current === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setPaperHref(paper.copies![k])}
                      className={cn(
                        "h-8 rounded-lg px-2.5 text-md",
                        on ? "bg-surface font-semibold shadow-card" : "text-text-2 hover:text-text",
                      )}
                    >
                      {k === "customer" ? "Customer copy" : "Internal copy"}
                    </button>
                  );
                })}
              </div>
            )}
            {download && (
              <a href={download} download={kind === "paper" ? undefined : file.name} className={buttonClass("secondary", "md")}>
                <Download aria-hidden /> {kind === "paper" ? "Download PDF" : "Download"}
              </a>
            )}
            {canShare && (
              <Button variant="secondary" onClick={share} aria-haspopup={file.onShare ? "dialog" : "menu"} aria-expanded={!!sharing}>
                <Share2 aria-hidden /> Share
              </Button>
            )}
            {canPrint && (
              <Button variant={kind === "paper" ? "primary" : "secondary"} onClick={print}>
                <Printer aria-hidden /> Print
              </Button>
            )}
          </div>
          {(actions.length > 0 || phone) && (
            <button
              ref={moreRef}
              type="button"
              className={iconButton}
              aria-label="More"
              aria-haspopup="menu"
              aria-expanded={more}
              onClick={() => setMore((m) => !m)}
            >
              <MoreHorizontal className="size-4 max-sm:size-5" aria-hidden />
            </button>
          )}
          {hasDetails && !phone && (
            <button
              type="button"
              className={cn(iconButton, details && "border-primary bg-primary-soft text-primary hover:bg-primary-soft")}
              aria-label="Details"
              aria-pressed={details}
              onClick={() => setDetails((d) => !d)}
            >
              <Info className="size-4" aria-hidden />
            </button>
          )}
          <Button size="icon-sm" variant="ghost" aria-label="Close the viewer (Esc)" onClick={onClose} className="max-sm:hidden">
            <X aria-hidden />
          </Button>
          {sharing && shareThis && <ShareMenu file={shareThis} anchor={sharing} phone={phone} onClose={() => setSharing(null)} />}
          {more && (
            <FloatingMenu anchor={() => moreRef.current} onClose={() => setMore(false)} label="More">
              {phone && canPrint && <MenuItem label="Print" onClick={print} close={() => setMore(false)} />}
              {phone &&
                paper?.copies &&
                (["customer", "internal"] as const).map((k) => (
                  <MenuItem
                    key={k}
                    label={k === "customer" ? "Customer copy" : "Internal copy"}
                    onClick={() => setPaperHref(paper.copies![k])}
                    close={() => setMore(false)}
                  />
                ))}
              {actions.map((x) => (
                <MenuItem key={x.label} label={x.label} danger={x.danger} onClick={x.onClick} close={() => setMore(false)} />
              ))}
              {phone && download && (
                <MenuItem
                  label={kind === "paper" ? "Download PDF" : "Download"}
                  onClick={() => (window.location.href = download)}
                  close={() => setMore(false)}
                />
              )}
            </FloatingMenu>
          )}
        </header>

        <div className="flex min-h-0 flex-1">
          {/* The stage: the file on grey, ‹ › at its sides on a phone. */}
          <div className="relative flex min-w-0 flex-1 flex-col bg-surface-3">
            <div className="relative min-h-0 flex-1">
              <Stage
                key={`${given.key}:${shown}`}
                file={file}
                kind={kind}
                src={shown}
                frame={frame}
                onShare={canShare ? share : undefined}
              />
              {set.length > 1 && phone && (
                <>
                  {prev !== null && (
                    <button
                      type="button"
                      aria-label={`Previous: ${set[prev]!.name}`}
                      onClick={() => onMove(prev)}
                      className="absolute top-1/2 left-2 grid size-11 -translate-y-1/2 place-items-center rounded-full border border-line bg-surface/90 shadow-card"
                    >
                      <ChevronLeft className="size-5" aria-hidden />
                    </button>
                  )}
                  {next !== null && (
                    <button
                      type="button"
                      aria-label={`Next: ${set[next]!.name}`}
                      onClick={() => onMove(next)}
                      className="absolute top-1/2 right-2 grid size-11 -translate-y-1/2 place-items-center rounded-full border border-line bg-surface/90 shadow-card"
                    >
                      <ChevronRight className="size-5" aria-hidden />
                    </button>
                  )}
                </>
              )}
            </div>
            {/* The set, along the bottom (laptop): the others of the same place. */}
            {set.length > 1 && !phone && (
              <nav
                aria-label="Files here"
                className="flex h-[76px] shrink-0 items-center gap-2.5 overflow-x-auto border-t border-line bg-surface px-5"
              >
                {set.map((f, i) => {
                  const k = kindOf(f);
                  return (
                    <button
                      key={f.key}
                      type="button"
                      aria-current={i === at ? "true" : undefined}
                      onClick={() => onMove(i)}
                      className={cn(
                        "flex h-12 max-w-56 shrink-0 items-center gap-2 rounded-[10px] border pr-3 pl-1.5 text-left text-md",
                        i === at ? "border-2 border-primary bg-primary-soft font-semibold" : "border-line hover:border-line-strong",
                      )}
                    >
                      <span
                        aria-hidden
                        className="grid size-9 shrink-0 place-items-center rounded-md bg-surface-2 text-2xs font-bold text-text-2 uppercase"
                      >
                        {k === "paper" ? "Doc" : (f.name.split(".").pop() ?? "").slice(0, 4) || KIND_WORD[k].slice(0, 3)}
                      </span>
                      <span className="truncate">{f.name}</span>
                    </button>
                  );
                })}
              </nav>
            )}
            {/* Phone: the things to do, along the bottom. */}
            {phone && (
              <nav
                aria-label="This file"
                className="flex shrink-0 justify-around gap-2 border-t border-line bg-surface px-3 pt-2.5 pb-[max(0.875rem,env(safe-area-inset-bottom))]"
              >
                {download ? (
                  <a
                    href={download}
                    download={kind === "paper" ? undefined : file.name}
                    className="flex h-14 min-w-20 flex-col items-center justify-center gap-1 rounded-xl text-xs font-medium"
                  >
                    <Download className="size-5" aria-hidden /> {kind === "paper" ? "PDF" : "Download"}
                  </a>
                ) : null}
                {canShare && (
                  <button
                    type="button"
                    onClick={share}
                    className="flex h-14 min-w-20 flex-col items-center justify-center gap-1 rounded-xl text-xs font-medium"
                  >
                    <Share2 className="size-5" aria-hidden /> Share
                  </button>
                )}
                {canPrint && !hasDetails ? (
                  <button
                    type="button"
                    onClick={print}
                    className="flex h-14 min-w-20 flex-col items-center justify-center gap-1 rounded-xl text-xs font-medium"
                  >
                    <Printer className="size-5" aria-hidden /> Print
                  </button>
                ) : null}
                {hasDetails ? (
                  <button
                    type="button"
                    onClick={() => setDetails(true)}
                    className="flex h-14 min-w-20 flex-col items-center justify-center gap-1 rounded-xl text-xs font-medium"
                  >
                    <Info className="size-5" aria-hidden /> Details
                  </button>
                ) : null}
              </nav>
            )}
          </div>

          {/* About this file: beside the stage on a laptop, a sheet from the bottom on a phone. */}
          {hasDetails && details && <Details file={file} phone={phone} onClose={() => setDetails(false)} onDone={onClose} />}
        </div>
      </section>
    </div>,
    document.body,
  );
}

function MenuItem({ label, onClick, close, danger }: { label: string; onClick: () => void; close: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        close();
        onClick();
      }}
      className={cn(
        "flex min-h-10 w-full items-center rounded-md px-3 text-left text-md hover:bg-surface-2 focus:bg-surface-2 focus:outline-none",
        danger && "text-bad",
      )}
    >
      {label}
    </button>
  );
}

function Details({ file, phone, onClose, onDone }: { file: ViewFile; phone: boolean; onClose: () => void; onDone: () => void }) {
  const body = (
    <>
      {!!file.facts?.length && (
        // The records' facts: label at the left, the value beside it. A link in it leaves the viewer for that page.
        <dl
          className="grid grid-cols-[fit-content(45%)_minmax(0,1fr)] gap-x-3 gap-y-2.5 px-5 pt-2 pb-4 text-md max-sm:text-base"
          onClick={(e) => (e.target as Element).closest("a[href]") && onDone()}
        >
          {file.facts.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="min-w-24 text-text-2">{k}</dt>
              <dd className="min-w-0 font-medium break-words">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {!!file.versions?.length && (
        <div className="border-t border-line px-5 py-3.5">
          <p className={capsClass}>Earlier versions</p>
          <ul className="mt-2 flex flex-col gap-1.5 text-md">
            {file.versions.map((v) => (
              <li key={v.key} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate">{v.label}</span>
                <a href={v.href} download className={cn(linkClass, "shrink-0")}>
                  Download
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!!file.actions?.length && (
        <div className="flex flex-wrap gap-2 border-t border-line px-5 py-3.5 sm:mt-auto">
          {file.actions.map((x) => (
            <Button key={x.label} size="sm" variant={x.danger ? "danger-ghost" : "secondary"} onClick={x.onClick}>
              {x.label}
            </Button>
          ))}
        </div>
      )}
    </>
  );
  if (phone)
    return (
      <div className="absolute inset-0 z-10 flex flex-col justify-end">
        <button type="button" aria-label="Close the details" tabIndex={-1} className="absolute inset-0 bg-black/45" onClick={onClose} />
        <div
          role="dialog"
          aria-label="About this file"
          className="relative max-h-[80%] overflow-y-auto rounded-t-2xl bg-surface pb-[max(1rem,env(safe-area-inset-bottom))] shadow-pop"
        >
          <div aria-hidden className="mx-auto mt-2 mb-1 h-1 w-10 rounded-full bg-line-strong" />
          <div className="flex items-center justify-between py-1 pr-2 pl-5">
            <h3 className="text-lg font-bold">About this file</h3>
            <Button size="icon" variant="ghost" aria-label="Close the details" onClick={onClose}>
              <X aria-hidden />
            </Button>
          </div>
          {body}
        </div>
      </div>
    );
  return (
    <aside aria-label="About this file" className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-line">
      <h3 className="px-5 pt-4 pb-1.5 text-md font-semibold">About this file</h3>
      {body}
    </aside>
  );
}

/* ---------------------------------------------------------------- the stage, by kind */

function Stage({
  file,
  kind,
  src,
  frame,
  onShare,
}: {
  file: ViewFile;
  kind: ViewKind;
  src: string;
  frame: React.RefObject<HTMLIFrameElement | null>;
  onShare?: (e: { currentTarget: HTMLElement }) => void;
}) {
  if (kind === "image") return <ImageStage src={src} name={file.name} />;
  if (kind === "pdf") return <iframe src={src} title={file.name} className="size-full border-0 bg-white" />;
  if (kind === "paper") return <iframe ref={frame} src={src} title={file.name} className="size-full border-0 bg-surface-3" />;
  if (kind === "sheet") return <SheetStage href={file.href} />;
  if (kind === "csv" || kind === "text") return <TextStage href={file.href} csv={kind === "csv"} />;
  return <NoPreview file={file} onShare={onShare} />;
}

/** A photo: fitted to the stage; − + and 100% zoom it, Fit puts it back (design 21 Nov). */
function ImageStage({ src, name }: { src: string; name: string }) {
  const [zoom, setZoom] = useState<number | null>(null);
  const step = (d: number) => setZoom((z) => Math.min(4, Math.max(0.25, Math.round(((z ?? 1) + d) * 100) / 100)));
  return (
    <div className="absolute inset-0 flex flex-col">
      <div className={cn("min-h-0 flex-1", zoom === null ? "flex items-center justify-center p-4 sm:p-6" : "overflow-auto p-4")}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a stored file, served by our own /files route */}
        <img
          src={src}
          alt={name}
          onDoubleClick={() => setZoom((z) => (z === null ? 1 : null))}
          className={cn("bg-white shadow-card", zoom === null ? "max-h-full max-w-full object-contain" : "max-w-none")}
          style={zoom === null ? undefined : { width: `${zoom * 100}%` }}
        />
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
        <div className="pointer-events-auto flex items-center gap-0.5 rounded-xl border border-line bg-surface p-1 shadow-pop">
          <Button size="icon-sm" variant="ghost" aria-label="Zoom out" onClick={() => step(-0.25)}>
            <Minus aria-hidden />
          </Button>
          <span className="min-w-[52px] text-center text-md font-semibold tabular">
            {zoom === null ? "Fit" : `${Math.round(zoom * 100)}%`}
          </span>
          <Button size="icon-sm" variant="ghost" aria-label="Zoom in" onClick={() => step(0.25)}>
            <Plus aria-hidden />
          </Button>
          <span aria-hidden className="mx-1 h-5 w-px bg-line" />
          {zoom === null ? (
            <Button size="sm" variant="ghost" onClick={() => setZoom(1)}>
              100%
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setZoom(null)}>
              Fit
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

const MAX_ROWS = 200;
const MAX_COLS = 30;

/** An Excel file read here: each sheet's values as a grid (no formulas or colours), its sheets as tabs. */
function SheetStage({ href }: { href: string }) {
  const [sheets, setSheets] = useState<{ name: string; rows: string[][]; total: number; cols: number }[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [on, setOn] = useState(0);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [{ default: ExcelJS }, buf] = await Promise.all([
          import("exceljs"),
          fetch(href).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status))),
        ]);
        const book = new ExcelJS.Workbook();
        await book.xlsx.load(buf);
        const out = book.worksheets.map((ws) => {
          const rows: string[][] = [];
          const cols = Math.min(ws.columnCount, MAX_COLS);
          ws.eachRow({ includeEmpty: true }, (row, n) => {
            if (n > MAX_ROWS) return;
            const cells: string[] = [];
            for (let c = 1; c <= cols; c++) cells.push(textOf(row.getCell(c).value));
            rows[n - 1] = cells;
          });
          for (let i = 0; i < rows.length; i++) rows[i] ??= Array(cols).fill("");
          return { name: ws.name, rows, total: ws.rowCount, cols };
        });
        if (live) setSheets(out);
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [href]);
  if (failed) return <StageNote>This Excel file could not be read here. Download it to open it in Excel.</StageNote>;
  if (!sheets) return <StageNote>Reading the file…</StageNote>;
  const s = sheets[on];
  if (!s) return <StageNote>This file has no sheets.</StageNote>;
  return (
    <div className="absolute inset-0 flex flex-col gap-3 p-3 sm:p-4">
      <p className="shrink-0 rounded-[10px] border border-line bg-surface px-3.5 py-2 text-md text-text-2">
        Read here as it is in the file: values only, no formulas or colours. Download it to edit it in Excel.
      </p>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[10px] border border-line bg-surface">
        <div className="min-h-0 flex-1 overflow-auto">
          <SheetGrid rows={s.rows} cols={s.cols} />
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-t border-line px-2 py-1.5">
          {sheets.map((x, i) => (
            <button
              key={x.name + i}
              type="button"
              aria-pressed={i === on}
              onClick={() => setOn(i)}
              className={cn(
                "h-8 rounded-lg px-3 text-md",
                i === on ? "bg-primary-soft font-semibold text-primary" : "text-text-2 hover:bg-surface-2",
              )}
            >
              {x.name}
            </button>
          ))}
          <span className="ml-auto px-2 text-xs text-muted">
            {s.total > MAX_ROWS ? `The first ${MAX_ROWS} of ${s.total} rows` : `${s.total} row${s.total === 1 ? "" : "s"}`} · {s.cols}{" "}
            column{s.cols === 1 ? "" : "s"}
          </span>
        </div>
      </div>
    </div>
  );
}

const LETTERS = (n: number) => {
  let s = "";
  for (let x = n + 1; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};

function SheetGrid({ rows, cols }: { rows: string[][]; cols: number }) {
  const cell = "h-8 max-w-[22rem] truncate border-r border-b border-line px-2 text-left align-middle";
  return (
    <table className="border-separate border-spacing-0 text-md tabular" data-fit="">
      <thead>
        <tr>
          <th className={cn(cell, "sticky top-0 left-0 z-20 w-10 bg-surface-2")} />
          {Array.from({ length: cols }, (_, c) => (
            <th
              key={c}
              scope="col"
              className={cn(cell, "sticky top-0 z-10 min-w-16 bg-surface-2 text-center text-xs font-medium text-text-2")}
            >
              {LETTERS(c)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <th scope="row" className={cn(cell, "sticky left-0 z-10 bg-surface-2 text-center text-xs font-medium text-text-2")}>
              {i + 1}
            </th>
            {r.map((v, c) => (
              <td key={c} title={v.length > 30 ? v : undefined} className={cn(cell, /^-?[\d,.]+%?$/.test(v) && "text-right")}>
                {v}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A cell's value as it reads (a formula's result, a date, rich text). */
function textOf(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: string; hyperlink?: string; error?: string };
    if ("result" in o) return textOf(o.result);
    if (o.richText) return o.richText.map((x) => x.text).join("");
    if (o.text !== undefined) return String(o.text);
    if (o.error) return o.error;
    return "";
  }
  return String(v);
}

/** A CSV file as a grid, a text file as it is (the first 200 lines). */
function TextStage({ href, csv }: { href: string; csv: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    fetch(href)
      .then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
      .then((t) => live && setText(t))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [href]);
  if (failed) return <StageNote>This file could not be read here. Download it to open it.</StageNote>;
  if (text === null) return <StageNote>Reading the file…</StageNote>;
  const lines = text.split(/\r?\n/).slice(0, MAX_ROWS);
  if (!csv)
    return (
      <div className="absolute inset-0 overflow-auto p-3 sm:p-4">
        <pre className="min-h-full rounded-[10px] border border-line bg-surface p-4 font-mono text-md whitespace-pre-wrap">
          {lines.join("\n")}
        </pre>
      </div>
    );
  const rows = lines.filter((l) => l.trim()).map(splitCsv);
  const cols = Math.min(MAX_COLS, Math.max(0, ...rows.map((r) => r.length)));
  return (
    <div className="absolute inset-0 overflow-auto p-3 sm:p-4">
      <div className="overflow-auto rounded-[10px] border border-line bg-surface">
        <SheetGrid rows={rows.map((r) => Array.from({ length: cols }, (_, c) => r[c] ?? ""))} cols={cols} />
      </div>
    </div>
  );
}

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === "," || ch === ";") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function StageNote({ children }: { children: ReactNode }) {
  return <p className="absolute inset-0 grid place-items-center px-6 text-center text-md text-text-2">{children}</p>;
}

/** A file with no preview here (Word, zip…): what it is, and Download (design 21 Nov). */
function NoPreview({ file, onShare }: { file: ViewFile; onShare?: (e: { currentTarget: HTMLElement }) => void }) {
  const ext = (file.name.split(".").pop() ?? "").toUpperCase();
  const word = /^DOCX?$/.test(ext) ? "Word document" : ext ? `${ext} file` : "File";
  return (
    <div className="absolute inset-0 grid place-items-center p-6">
      <div className="flex w-full max-w-80 flex-col items-center gap-3 rounded-2xl border border-line bg-surface px-6 py-7 text-center shadow-card">
        <span aria-hidden className="grid size-16 place-items-center rounded-2xl bg-info-soft text-info">
          <FileText className="size-8" />
        </span>
        <div>
          <p className="text-lead font-bold break-words">{file.name}</p>
          <p className="mt-0.5 text-md text-muted">{[word, file.size ? fileSize(file.size) : null].filter(Boolean).join(" · ")}</p>
        </div>
        <p className="text-md text-text-2">
          This kind of file does not open in the app. Download it to open it{/^DOCX?$/.test(ext) ? " in Word" : ""}.
        </p>
        <a href={file.href} download={file.name} className={buttonClass("primary", "lg", "w-full")}>
          <Download aria-hidden /> Download
        </a>
        {onShare && (
          <Button size="lg" variant="secondary" className="w-full" onClick={onShare}>
            <Share2 aria-hidden /> Share
          </Button>
        )}
      </div>
    </div>
  );
}

/** A file as itself, to hand to the phone's share sheet. */
async function fileOf(href: string, name: string) {
  const res = await fetch(href);
  if (!res.ok) throw new Error(`The file could not be fetched (${res.status}).`);
  const blob = await res.blob();
  return new File([blob], name, { type: blob.type });
}

/** Can this browser hand files to the system's share sheet (WhatsApp, email, Teams, AirDrop…)? */
const sharesFiles = () =>
  typeof navigator !== "undefined" &&
  "canShare" in navigator &&
  navigator.canShare({ files: [new File([""], "x.pdf", { type: "application/pdf" })] });

/**
 * Share a file or a paper outside the app (Fawad 21 Nov): the share sheet with the file itself where the browser
 * has one (phones, Windows, Mac), WhatsApp or email with the file downloaded to attach, or the link for the team.
 * The app sends nothing itself.
 */
function ShareMenu({
  file,
  anchor,
  phone,
  onClose,
}: {
  file: { href: string; name: string };
  anchor: HTMLElement;
  phone: boolean;
  onClose: () => void;
}) {
  const text = `Please find attached: ${file.name.replace(/\.[a-z0-9]+$/i, "")}.`;
  const sheet = sharesFiles();
  const download = () => {
    const a = document.createElement("a");
    a.href = file.href;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  const viaSheet = async () => {
    toast({ message: "Getting the file ready…", kind: "wait" });
    try {
      const f = await fileOf(file.href, file.name);
      await navigator.share({ files: [f], title: file.name, text });
      toast("Shared.");
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return toast("Not shared.");
      toast({
        message:
          e instanceof Error && e.message.startsWith("The file")
            ? e.message
            : "This browser could not share the file. Download it and attach it instead.",
        kind: "fail",
      });
    }
  };
  const run = (fn: () => void | Promise<void>) => () => {
    onClose();
    void fn();
  };
  const item =
    "flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-2 text-left text-md hover:bg-surface-2 focus:bg-surface-2 focus:outline-none";
  return (
    <FloatingMenu anchor={() => anchor} onClose={onClose} label={`Share ${file.name}`} width={300}>
      {sheet && (
        <button type="button" role="menuitem" className={item} onClick={run(viaSheet)}>
          <Share2 className="size-4 shrink-0 text-text-2" aria-hidden />
          <span className="min-w-0">
            <span className="block font-medium">Share the file…</span>
            <span className="block text-xs text-muted">WhatsApp, email, WeChat and the rest, with the file attached</span>
          </span>
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        className={item}
        onClick={run(() => {
          // A phone with a share sheet sends the file itself; a computer downloads it to attach in WhatsApp.
          if (phone && sheet) return viaSheet();
          download();
          window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
          toast(`${file.name} downloaded: attach it in WhatsApp (the 📎).`);
        })}
      >
        <MessageCircle className="size-4 shrink-0 text-text-2" aria-hidden />
        <span className="min-w-0">
          <span className="block font-medium">WhatsApp</span>
          <span className="block text-xs text-muted">
            {phone && sheet ? "Pick WhatsApp in the share sheet" : "Downloads the file, then opens WhatsApp to attach it"}
          </span>
        </span>
      </button>
      <button
        type="button"
        role="menuitem"
        className={item}
        onClick={run(() => {
          if (phone && sheet) return viaSheet();
          download();
          window.location.assign(`mailto:?subject=${encodeURIComponent(file.name)}&body=${encodeURIComponent(text)}`);
          toast(`${file.name} downloaded: attach it to the email.`);
        })}
      >
        <Mail className="size-4 shrink-0 text-text-2" aria-hidden />
        <span className="min-w-0">
          <span className="block font-medium">Email</span>
          <span className="block text-xs text-muted">
            {phone && sheet ? "Pick your mail app in the share sheet" : "Downloads the file and opens a new email"}
          </span>
        </span>
      </button>
      <span role="separator" className="my-1 block h-px bg-line" />
      <button
        type="button"
        role="menuitem"
        className={item}
        onClick={run(async () => {
          try {
            await navigator.clipboard.writeText(new URL(file.href, window.location.href).toString());
            toast("Link copied: it opens for people signed in to the app.");
          } catch {
            toast("Could not copy the link.");
          }
        })}
      >
        <Copy className="size-4 shrink-0 text-text-2" aria-hidden />
        <span className="min-w-0">
          <span className="block font-medium">Copy link for the team</span>
          <span className="block text-xs text-muted">Only people signed in to the app can open it</span>
        </span>
      </button>
    </FloatingMenu>
  );
}

/** A photo printed on its own page (a hidden frame with only the picture), never a new tab. */
function printImage(src: string, title: string) {
  const f = document.createElement("iframe");
  f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(f);
  const doc = f.contentDocument!;
  doc.open();
  doc.write(
    `<!doctype html><title>${title.replace(/</g, "&lt;")}</title><style>@page{margin:12mm}html,body{margin:0}img{max-width:100%;max-height:100vh;display:block;margin:auto}</style><img src="${src.replace(/"/g, "&quot;")}">`,
  );
  doc.close();
  const img = doc.querySelector("img")!;
  const go = () => {
    f.contentWindow?.focus();
    f.contentWindow?.print();
    setTimeout(() => f.remove(), 1000);
  };
  if (img.complete) go();
  else img.onload = go;
}
