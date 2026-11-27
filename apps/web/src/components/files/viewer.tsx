"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Download, FileText } from "lucide-react";
import { fileSize } from "@kebo/shared";
import { buttonClass, capsClass, cn, linkClass } from "@kebo/ui";
import { useIsPhone } from "@/components/common/floating";
import { ignore } from "@/lib/quiet";
import { orderWindowOfPrint } from "@/lib/doc-links";
import {
  choicesOf,
  DocWindow,
  PaperStage,
  saveHref,
  usePaperView,
  withLook,
  type DocState,
  type PaperLook,
  type WindowAction,
} from "@/components/window/doc-window";
import { EmailButton, ShareButton, type Outgoing } from "@/components/send/send";
import { emailOutAction, noteSentAction, noteSharedAction, type Going } from "@/app/(app)/send-actions";

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
  /** Details: label · value. */
  facts?: [string, ReactNode][];
  /** Earlier versions: their name, day and download. */
  versions?: { key: string; label: string; href: string }[];
  /** More things to do (Replace, Rename, Delete…): in ⋯, Delete last. */
  actions?: { label: string; onClick: () => void; danger?: boolean }[];
  /** Email and Share: the words to start from, and the order it is noted on (its file ref). */
  send?: { message?: string; order?: string | null; file?: string | null };
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
  /** An order's paper goes to the order's window (the app's viewer only). */
  toOrder?: (href: string) => void;
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
 * such links next to it (its list, table or box) are the set ‹ › go through. An order's paper opens in the order's
 * own window instead (`toOrder`: one window for an order's documents, 26 Nov). Ctrl/⌘-click or a middle click
 * still open a new tab; a link marked data-new-tab always does.
 */
export function FileViewerProvider({ children, toOrder }: { children: ReactNode; toOrder?: (href: string) => void }) {
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
  const viewer = useMemo<Viewer>(() => ({ open, close, toOrder }), [open, close, toOrder]);

  useEffect(() => {
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.closest("[data-doc-window]")) return;
      const file = viewable(a);
      if (!file) return;
      e.preventDefault();
      // An order's paper: the order's window, with what it takes, Send, and the order's other documents.
      const order = toOrder && file.kind === "paper" ? orderWindowOfPrint(file.href, window.location.pathname + window.location.search) : null;
      if (order) return toOrder!(order);
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
  }, [open, toOrder]);

  return (
    <ViewerContext.Provider value={viewer}>
      {children}
      {state && <FileViewer set={state.set} at={state.at} onMove={(at) => setState((s) => s && { ...s, at })} onClose={close} />}
    </ViewerContext.Provider>
  );
}

/** The app's viewer, its order papers going to the order's window (the app's layout puts it around every page). */
export function AppFileViewer({ children }: { children: ReactNode }) {
  const router = useRouter();
  const toOrder = useCallback((href: string) => router.push(href), [router]);
  return <FileViewerProvider toOrder={toOrder}>{children}</FileViewerProvider>;
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
      if (!file) return false;
      const order = viewer.toOrder && file.kind === "paper" ? orderWindowOfPrint(file.href, window.location.pathname + window.location.search) : null;
      if (order) viewer.toOrder!(order);
      else viewer.open([file]);
      return true;
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
      .catch(ignore("the file's type, size and name for its label (it shows without them)"));
    return () => {
      live = false;
    };
  }, [f.href, known]);
  return head;
}

const NO_LOOK: PaperLook = { copy: null, lang: null };

/**
 * Any file or paper in the one window (design 26 Nov): the file on grey with the view bar (zoom, and a paper's
 * copy and language), Details and Send in the panel, the others of its list in the strip. Download and Print in
 * the header; ⋯ only the rare things (Rename, Open in a new tab, Delete last).
 */
function FileViewer({ set, at, onMove, onClose }: { set: ViewFile[]; at: number; onMove: (at: number) => void; onClose: () => void }) {
  // The phone's Back closes it.
  useEffect(() => {
    window.history.pushState({ fileViewer: true }, "");
    const back = () => onClose();
    window.addEventListener("popstate", back);
    return () => {
      window.removeEventListener("popstate", back);
      if (window.history.state?.fileViewer) window.history.back();
    };
  }, [onClose]);
  // Each file its own view (zoom, copy, tab): a new one starts fresh.
  return <OneFile key={set[at]!.key} set={set} at={at} onMove={onMove} onClose={onClose} />;
}

function OneFile({ set, at, onMove, onClose }: { set: ViewFile[]; at: number; onMove: (at: number) => void; onClose: () => void }) {
  const phone = useIsPhone();
  const given = set[at]!;
  const head = useHeadOf(given);
  const file: ViewFile = {
    ...given,
    name: given.name && given.name !== "File" ? given.name : (head?.name ?? given.name),
    type: given.type ?? head?.type ?? null,
    size: given.size ?? head?.size ?? null,
  };
  const kind = kindOf(file);
  const frame = useRef<HTMLIFrameElement>(null);
  const paperView = usePaperView();
  const [imageZoom, setImageZoom] = useState<number | null>(null);
  const [look, setLook] = useState<PaperLook>(NO_LOOK);

  const paper = kind === "paper" ? paperView.info : null;
  const title = kind === "paper" && paper?.title ? paper.title : file.name;
  const shown = kind === "paper" ? withLook(file.viewHref ?? file.href, look) : (file.viewHref ?? file.href);
  const download = kind === "paper" ? (paper?.pdfHref ?? null) : file.href;
  const sendName = kind === "paper" ? `${title}.pdf` : file.name;
  const detail = kind === "paper" ? [paper?.choices?.flatMap((c) => c.options.filter((o) => o.on).map((o) => o.word)).join(" · "), paperView.pages ? `${paperView.pages.of} page${paperView.pages.of === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ") || "PDF" : [file.size ? fileSize(file.size) : null, KIND_WORD[kind]].filter(Boolean).join(" · ");
  // Email and Share (design "Email and Share", 26 Nov): the file as it is, a paper as shown; an order's noted there.
  const out: Outgoing = {
    key: file.key,
    name: sendName,
    detail,
    view: kind === "paper" ? shown : (file.viewHref ?? null),
    download: download ?? file.href,
    file: file.send?.file ?? null,
  };
  const on = { order: file.send?.order ?? null };
  const going: Going[] = [{ key: out.key, name: out.name, download: out.download, file: out.file ?? null }];
  const message = file.send?.message ?? `Please find attached: ${title}.`;
  const canSend = !!download;
  const print =
    kind === "paper" || kind === "pdf"
      ? () => frame.current?.contentWindow?.print()
      : kind === "image"
        ? () => printImage(file.viewHref ?? file.href, title)
        : null;

  const more: WindowAction[] = [
    ...(paper?.excelHref ? [{ label: "Download Excel", onClick: () => saveHref(paper.excelHref!) }] : []),
    { label: "Open in a new tab", onClick: () => window.open(kind === "paper" ? shown : (file.viewHref ?? file.href), "_blank", "noopener") },
    ...(file.actions ?? []).slice().sort((a, b) => Number(!!a.danger) - Number(!!b.danger)),
  ];
  const where = [file.where, kind !== "paper" && file.size ? `${fileSize(file.size)} · ${KIND_WORD[kind]}` : null, kind === "paper" ? paper?.note : null]
    .filter(Boolean)
    .join(" · ");

  const details = (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-[fit-content(45%)_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-md" onClick={(e) => (e.target as Element).closest("a[href]") && onClose()}>
        {(file.facts?.length ? file.facts : ([["Name", file.name], ["What it is", KIND_WORD[kind]], ...(file.size ? [["Size", fileSize(file.size)] as [string, ReactNode]] : []), ...(file.where ? [["Where", file.where] as [string, ReactNode]] : [])] as [string, ReactNode][])).map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="min-w-24 text-text-2">{k}</dt>
            <dd className="min-w-0 font-medium break-words">{v}</dd>
          </div>
        ))}
      </dl>
      {!!file.versions?.length && (
        <div>
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
    </div>
  );
  const foot = canSend ? (
    <>
      <ShareButton items={[out]} message={message} link={kind === "paper" ? shown : file.href} noteAction={on.order ? noteSharedAction.bind(null, on, going) : null} />
      <EmailButton
        title={`Email ${title}`}
        items={[out]}
        to={null}
        subject={title}
        message={message}
        emailAction={emailOutAction.bind(null, on, going)}
        markAction={on.order ? noteSentAction.bind(null, on, going) : null}
        today={new Date().toISOString().slice(0, 10)}
      />
    </>
  ) : null;

  const state: DocState = kind === "paper" ? "doc" : "file";
  return (
    <DocWindow
      kind="viewer"
      title={title}
      state={kind === "paper" ? null : { state, word: `Uploaded · ${KIND_WORD[kind]}` }}
      sub={where || null}
      icon={kind === "image" ? "image" : kind === "sheet" || kind === "csv" ? "sheet" : kind === "paper" ? "doc" : "file"}
      items={set.map((f, i) => ({ key: f.key, name: f.name, state: kindOf(f) === "paper" ? "doc" : "file", go: () => onMove(i) }))}
      at={at}
      itemsLabel="Files here"
      download={download ? { href: download, word: kind === "paper" ? "Download PDF" : "Download", name: kind === "paper" ? undefined : file.name } : null}
      onPrint={print}
      more={more}
      onClose={onClose}
      stage={
        kind === "paper" ? (
          <PaperStage src={shown} title={file.name} frame={frame} {...paperView.stage} />
        ) : (
          <FileStage file={file} kind={kind} src={shown} zoom={imageZoom} frame={frame} />
        )
      }
      view={
        kind === "paper"
          ? { choices: choicesOf(paper, setLook), zoom: paperView.zoom, pages: paperView.pages }
          : kind === "image"
            ? { zoom: { value: imageZoom, shown: imageZoom ?? 1, set: setImageZoom } }
            : null
      }
      panel={{
        label: "About this file",
        tabs: [{ key: "details", label: "Details" }],
        tab: "details",
        onTab: () => {},
        body: details,
        foot,
        bar: { text: <><b className="font-semibold">Details</b> · {where || KIND_WORD[kind]}</>, state: phone ? state : undefined },
      }}
    />
  );
}

/* ---------------------------------------------------------------- the stage, by kind */

export function FileStage({
  file,
  kind,
  src,
  zoom,
  frame,
}: {
  file: ViewFile;
  kind: ViewKind;
  src: string;
  zoom: number | null;
  /** A PDF's frame: the window's Print prints it. */
  frame?: React.RefObject<HTMLIFrameElement | null>;
}) {
  if (kind === "image") return <ImageStage src={src} name={file.name} zoom={zoom} />;
  // The browser's own PDF bar is hidden: Download and Print are the window's, once (one window, 26 Nov).
  if (kind === "pdf")
    return <iframe ref={frame} src={`${src}#toolbar=0&navpanes=0&view=FitH`} title={file.name} className="absolute inset-0 size-full border-0 bg-white" />;
  if (kind === "sheet") return <SheetStage href={file.href} />;
  if (kind === "csv" || kind === "text") return <TextStage href={file.href} csv={kind === "csv"} />;
  return <NoPreview file={file} />;
}

/** A photo: fitted to the stage, or at the zoom picked under it (double-click: 100% and back). */
function ImageStage({ src, name, zoom }: { src: string; name: string; zoom: number | null }) {
  return (
    <div className={cn("absolute inset-0", zoom === null ? "flex items-center justify-center p-4 pb-20 sm:p-6 sm:pb-20" : "scroll-xy scroll-lg p-4 pb-20")}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a stored file, served by our own /files route */}
      <img
        src={src}
        alt={name}
        className={cn("bg-white shadow-card", zoom === null ? "max-h-full max-w-full object-contain" : "max-w-none")}
        style={zoom === null ? undefined : { width: `${zoom * 100}%` }}
      />
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
        <div className="min-h-0 flex-1 scroll-xy scroll-lg">
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
      <div className="absolute inset-0 scroll-xy scroll-lg p-3 sm:p-4">
        <pre className="min-h-full rounded-[10px] border border-line bg-surface p-4 font-mono text-md whitespace-pre-wrap">
          {lines.join("\n")}
        </pre>
      </div>
    );
  const rows = lines.filter((l) => l.trim()).map(splitCsv);
  const cols = Math.min(MAX_COLS, Math.max(0, ...rows.map((r) => r.length)));
  return (
    <div className="absolute inset-0 scroll-xy scroll-lg p-3 sm:p-4">
      <div className="scroll-xy scroll-lg rounded-[10px] border border-line bg-surface">
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

/** A file with no preview here (Word, zip…): what it is; Download is in the header (on a phone, here too). */
function NoPreview({ file }: { file: ViewFile }) {
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
        <a href={file.href} download={file.name} className={buttonClass("primary", "lg", "w-full sm:hidden")}>
          <Download aria-hidden /> Download
        </a>
      </div>
    </div>
  );
}

/** A photo printed on its own page (a hidden frame with only the picture), never a new tab. */
export function printImage(src: string, title: string) {
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
