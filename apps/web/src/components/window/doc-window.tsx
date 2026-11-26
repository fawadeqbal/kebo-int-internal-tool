"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Minus,
  MoreHorizontal,
  Paperclip,
  Plus,
  Printer,
  X,
} from "lucide-react";
import { Badge, Button, buttonClass, capsClass, cn } from "@kebo/ui";
import { SegmentedChoice } from "@kebo/ui/client";
import { FloatingMenu, useIsPhone } from "@/components/common/floating";
import { useFocusTrap, useMounted } from "@/components/common/dialog";
import { lockScroll } from "@/lib/scroll-lock";
import type { PaperChoice } from "@/components/print/copies";

/*
 * The one window for documents and files (design "One window for documents and files", 26 Nov 2026): making a
 * document, looking at it after, and an uploaded file all open here, and each thing has one place.
 *
 * 1. Header: what it is and where it stands (a badge), ‹ n of N ›, then what you take out of it (Download, Print),
 *    the same in every state; ⋯ holds only rare things never shown elsewhere; ✕ or Esc closes.
 * 2. The page, always in the middle.
 * 3. The view bar under it: how you see it (which copy, the language, zoom, the page), never what it says.
 * 4. The panel at the right: the next step for this state, its one strong button at its foot.
 * 5. The strip: the other documents and files of the same set, the same ones ‹ › go through.
 *
 * On a phone: ✕ · the name · ⋯ on top; the page; one slim line that opens the panel as a sheet; the strong button
 * pinned under it. ⋯ holds the view switches, Download and Print, the set and the rare things.
 */

/* ---------------------------------------------------------------- where a document stands */

/** Where a document or file stands: its badge's colour and its mark in the strip. */
export type DocState = "draft" | "final" | "live" | "file" | "needed" | "todo" | "doc";

const BADGE_TONE: Record<DocState, "warn" | "ok" | "info" | "neutral" | "bad"> = {
  draft: "warn",
  final: "ok",
  live: "info",
  file: "neutral",
  needed: "bad",
  todo: "neutral",
  doc: "neutral",
};

const MARK_WORD: Record<DocState, string> = {
  draft: "Draft",
  final: "Final",
  live: "Live",
  file: "Uploaded file",
  needed: "Needed",
  todo: "Not made yet",
  doc: "Document",
};

/** The small mark beside a name in the strip (and in ⋯ on a phone): ✓ final, a dot for a draft, a ring not made yet… */
export function DocMark({ state, className }: { state: DocState; className?: string }) {
  const box = cn("grid size-4 shrink-0 place-items-center", className);
  if (state === "final")
    return (
      <span role="img" aria-label={MARK_WORD.final} className={cn(box, "text-ok")}>
        <Check className="size-3.5" strokeWidth={3} aria-hidden />
      </span>
    );
  if (state === "needed")
    return (
      <span role="img" aria-label={MARK_WORD.needed} className={cn(box, "text-sm font-bold text-bad")}>
        !
      </span>
    );
  if (state === "file" || state === "doc") {
    const Icon = state === "file" ? Paperclip : FileText;
    return (
      <span role="img" aria-label={MARK_WORD[state]} className={cn(box, "text-text-2")}>
        <Icon className="size-3.5" aria-hidden />
      </span>
    );
  }
  return (
    <span role="img" aria-label={MARK_WORD[state]} className={box}>
      <span
        className={cn(
          "block size-2 rounded-full",
          state === "draft" ? "bg-action" : state === "live" ? "bg-info" : "border-[1.5px] border-muted bg-surface",
        )}
      />
    </span>
  );
}

/* ---------------------------------------------------------------- what the window is given */

/** One of the set the strip and ‹ › go through. */
export interface WindowItem {
  key: string;
  name: string;
  state: DocState;
  go: () => void;
}

/** A rare thing in ⋯ (Make again, Open the step, Delete…): never one of the buttons already on screen. */
export interface WindowAction {
  label: string;
  hint?: string;
  onClick: () => void;
  danger?: boolean;
}

/** One switch of the view bar (which copy, the language). */
export interface ViewChoice {
  label: string;
  value: string;
  options: { value: string; word: string }[];
  pick: (value: string) => void;
}

/** The view bar: how you see it. */
export interface ViewBarProps {
  choices?: ViewChoice[];
  /** null: fitted to the width (shown: the size that is); a number: zoomed. */
  zoom?: { value: number | null; shown: number; set: (z: number | null) => void } | null;
  pages?: { at: number; of: number } | null;
}

/** The panel: its tabs, what the open one holds, and the one strong button at its foot (the same on every tab). */
export interface WindowPanel {
  label: string;
  tabs: { key: string; label: string; count?: number }[];
  tab: string;
  onTab: (key: string) => void;
  body: ReactNode;
  foot?: ReactNode;
  /** A phone's one slim line: what the panel holds ("2 to fill · vessel and ports"), opening it as a sheet. */
  bar: { text: ReactNode; state?: DocState };
}

export interface DocWindowProps {
  /** "Viewer" (any file or paper, over every page) or "order" (an order's documents, its own address). */
  kind: "viewer" | "order";
  title: string;
  /** The number beside the name (on a phone under it, after the state). */
  number?: string | null;
  state?: { state: DocState; word: string } | null;
  /** The line under the name: the order, the customer, where it comes from. */
  sub?: string | null;
  icon?: "doc" | "file" | "image" | "sheet";
  /** The set the strip and ‹ › go through, and where this one is in it. */
  items?: WindowItem[];
  at?: number;
  itemsLabel?: string;
  download?: { href: string; word: string; name?: string } | null;
  onPrint?: (() => void) | null;
  more?: WindowAction[];
  onClose: () => void;
  stage: ReactNode;
  view?: ViewBarProps | null;
  panel?: WindowPanel | null;
}

const ICONS = { doc: FileText, file: FileText, image: ImageIcon, sheet: FileSpreadsheet };
const iconButton =
  "grid size-9 shrink-0 place-items-center rounded-[10px] text-text-2 hover:bg-surface-2 hover:text-text disabled:opacity-40 max-sm:size-11";

/* ---------------------------------------------------------------- the window */

export function DocWindow(p: DocWindowProps) {
  const mounted = useMounted();
  const phone = useIsPhone();
  const id = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const stripRef = useRef<HTMLElement>(null);
  const box = useRef<HTMLElement>(null);
  // Tab stays in the window, and closing it gives the focus back to what opened it (review 27 Nov: after its
  // last button Tab went on over the page behind). Before the effect that focuses its title: the trap notes
  // what had the focus first.
  useFocusTrap(box, mounted);
  const [more, setMore] = useState(false);
  const [sheet, setSheet] = useState(false);
  const items = p.items ?? [];
  const at = p.at ?? 0;
  const prev = items.length > 1 && at > 0 ? items[at - 1]! : null;
  const next = items.length > 1 && at < items.length - 1 ? items[at + 1]! : null;
  const { onClose } = p;

  // Esc closes (a menu or the sheet first), ← → move; the page under it stays still.
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      // Another window over this one (a confirm, a file's Rename…) takes the keys first.
      const busy =
        more || sheet || !!document.querySelector("[role=menu], dialog[open]") || document.querySelectorAll('[role=dialog][aria-modal="true"]').length > 1;
      const typing = !!(e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable]");
      if (e.key === "Escape") {
        if (sheet) setSheet(false);
        else if (!busy) onClose();
      } else if (!busy && !typing && e.key === "ArrowLeft" && prev) prev.go();
      else if (!busy && !typing && e.key === "ArrowRight" && next) next.go();
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [onClose, prev, next, more, sheet]);
  useEffect(() => lockScroll(), []);
  useEffect(() => {
    if (mounted) titleRef.current?.focus({ preventScroll: true });
  }, [mounted, p.title, p.number]);
  // The strip shows the one open in it.
  useEffect(() => {
    stripRef.current?.querySelector<HTMLElement>("[aria-current]")?.scrollIntoView?.({ block: "nearest", inline: "center" });
  }, [mounted, at]);

  if (!mounted) return null;
  const Icon = ICONS[p.icon ?? "doc"];
  const view = p.view;
  const choices = view?.choices?.filter((c) => c.options.length > 1) ?? [];
  const panel = p.panel;
  const moreItems = p.more ?? [];
  const hasMore = phone ? true : moreItems.length > 0;

  const header = (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line pr-3 pl-5 max-sm:h-14 max-sm:gap-1 max-sm:px-1">
      <Button size="icon" variant="ghost" aria-label="Close" onClick={onClose} className="sm:hidden">
        <X aria-hidden />
      </Button>
      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-primary-soft text-primary max-sm:hidden">
        <Icon className="size-[18px]" />
      </span>
      <div className="min-w-0 flex-1 max-sm:text-center">
        <div className="flex min-w-0 items-center gap-2 max-sm:justify-center">
          <h2 id={`${id}-t`} ref={titleRef} tabIndex={-1} className="truncate text-base font-semibold outline-none">
            {p.title}
            {p.number && <span className="max-sm:hidden"> {p.number}</span>}
          </h2>
          {p.state && (
            <Badge tone={BADGE_TONE[p.state.state]} className="max-sm:hidden">
              {p.state.word}
            </Badge>
          )}
        </div>
        {/* A phone: where it stands and its number; a laptop: the order, the customer, where it comes from. */}
        <p className="flex min-w-0 items-center gap-1.5 truncate text-md text-muted max-sm:justify-center max-sm:text-xs">
          {phone ? (
            <>
              {p.state && <DocMark state={p.state.state} className="size-3" />}
              <span className="truncate">{[p.state?.word, p.number].filter(Boolean).join(" · ") || p.sub}</span>
            </>
          ) : (
            <span className="truncate">{p.sub}</span>
          )}
        </p>
      </div>
      {items.length > 1 && (
        <div className="flex items-center gap-0.5 text-md text-muted max-sm:hidden">
          <button type="button" className={iconButton} disabled={!prev} aria-label={prev ? `Previous: ${prev.name}` : "No previous one"} onClick={() => prev?.go()}>
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <span className="tabular whitespace-nowrap">
            {at + 1} of {items.length}
          </span>
          <button type="button" className={iconButton} disabled={!next} aria-label={next ? `Next: ${next.name}` : "No next one"} onClick={() => next?.go()}>
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>
      )}
      {(p.download || p.onPrint) && <span aria-hidden className="h-6 w-px bg-line max-sm:hidden" />}
      {p.download && (
        <a href={p.download.href} download={p.download.name} className={buttonClass("secondary", "md", "max-sm:hidden")}>
          <Download aria-hidden /> {p.download.word}
        </a>
      )}
      {p.onPrint && (
        <Button variant="secondary" onClick={p.onPrint} className="max-sm:hidden">
          <Printer aria-hidden /> Print
        </Button>
      )}
      {hasMore && (
        <button
          ref={moreRef}
          type="button"
          aria-label="More"
          aria-haspopup="menu"
          aria-expanded={more}
          onClick={() => setMore((m) => !m)}
          className={cn(iconButton, "border border-line-strong bg-surface max-sm:border-0 max-sm:bg-transparent")}
        >
          <MoreHorizontal className="size-4 max-sm:size-5" aria-hidden />
        </button>
      )}
      <Button size="icon-sm" variant="ghost" aria-label="Close (Esc)" onClick={onClose} className="max-sm:hidden">
        <X aria-hidden />
      </Button>
      {more && (
        <FloatingMenu anchor={() => moreRef.current} onClose={() => setMore(false)} label={p.title} width={280}>
          {phone && (
            <PhoneMore
              choices={choices}
              download={p.download ?? null}
              onPrint={p.onPrint ?? null}
              items={items}
              at={at}
              itemsLabel={p.itemsLabel}
              close={() => setMore(false)}
            />
          )}
          {phone && moreItems.length > 0 && <span role="separator" className="my-1 block h-px bg-line" />}
          {moreItems.map((x) => (
            <MenuRow
              key={x.label}
              label={x.label}
              hint={x.hint}
              danger={x.danger}
              onClick={() => {
                setMore(false);
                x.onClick();
              }}
            />
          ))}
        </FloatingMenu>
      )}
    </header>
  );

  const stage = (
    <div className="relative min-w-0 flex-1 bg-surface-3">
      {p.stage}
      {view && !phone && (choices.length > 0 || view.zoom || view.pages) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center px-4">
          <div
            role="toolbar"
            aria-label="How you see it"
            className="pointer-events-auto flex max-w-full scroll-x scroll-none items-center gap-1.5 rounded-xl border border-line bg-surface p-1 shadow-pop"
          >
            {choices.map((c) => (
              <SegmentedChoice
                key={c.label}
                label={c.label}
                value={c.value}
                options={c.options.map((o) => ({ value: o.value, label: o.word }))}
                onChange={c.pick}
                className="border-0"
              />
            ))}
            {choices.length > 0 && (view.zoom || view.pages) && <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-line" />}
            {view.zoom && <Zoom zoom={view.zoom} />}
            {view.pages && view.pages.of > 0 && (
              <span className="shrink-0 px-2 text-md whitespace-nowrap text-text-2 tabular">
                Page {view.pages.at} of {view.pages.of}
              </span>
            )}
          </div>
        </div>
      )}
      {phone && view?.pages && view.pages.of > 1 && (
        <span className="pointer-events-none absolute right-3 bottom-3 z-10 rounded-full bg-black/70 px-2.5 py-1 text-xs font-medium text-white tabular">
          Page {view.pages.at} of {view.pages.of}
        </span>
      )}
      {phone && prev && (
        <button
          type="button"
          aria-label={`Previous: ${prev.name}`}
          onClick={prev.go}
          className="absolute top-1/2 left-2 z-10 grid size-11 -translate-y-1/2 place-items-center rounded-full border border-line bg-surface/90 shadow-card"
        >
          <ChevronLeft className="size-5" aria-hidden />
        </button>
      )}
      {phone && next && (
        <button
          type="button"
          aria-label={`Next: ${next.name}`}
          onClick={next.go}
          className="absolute top-1/2 right-2 z-10 grid size-11 -translate-y-1/2 place-items-center rounded-full border border-line bg-surface/90 shadow-card"
        >
          <ChevronRight className="size-5" aria-hidden />
        </button>
      )}
    </div>
  );

  const tabs = panel && panel.tabs.length > 1 && (
    <div role="tablist" aria-label={panel.label} className="flex shrink-0 items-end gap-5 border-b border-line px-5">
      {panel.tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={t.key === panel.tab}
          onClick={() => panel.onTab(t.key)}
          className={cn(
            "-mb-px flex h-[46px] items-center gap-1.5 border-b-2 text-md",
            t.key === panel.tab ? "border-primary-solid font-bold text-text" : "border-transparent font-medium text-text-2 hover:text-text",
          )}
        >
          {t.label}
          {!!t.count && <span className="rounded-md bg-warn-soft px-1.5 text-xs font-semibold text-warn tabular">{t.count}</span>}
        </button>
      ))}
    </div>
  );
  const panelBody = panel && (
    <div role={panel.tabs.length > 1 ? "tabpanel" : undefined} aria-label={panel.tabs.find((t) => t.key === panel.tab)?.label ?? panel.label} className="min-h-0 flex-1 scroll-y px-5 py-4">
      {panel.tabs.length === 1 && <h3 className={cn(capsClass, "mb-3")}>{panel.tabs[0]!.label}</h3>}
      {panel.body}
    </div>
  );

  return createPortal(
    <div className={cn("fixed inset-0 flex", p.kind === "viewer" ? "z-[80]" : "z-[70]")} data-doc-window={p.kind}>
      <button type="button" aria-label="Close" tabIndex={-1} className="absolute inset-0 bg-black/50" onClick={onClose} />
      <section
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        className="relative m-0 flex w-full flex-col overflow-hidden bg-surface shadow-pop sm:m-6 sm:rounded-2xl"
      >
        {header}
        <div className="flex min-h-0 flex-1">
          {stage}
          {panel && !phone && (
            <aside aria-label={panel.label} className="flex w-80 shrink-0 flex-col border-l border-line lg:w-[380px]">
              {tabs}
              {panelBody}
              {panel.foot && <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3">{panel.foot}</div>}
            </aside>
          )}
        </div>
        {/* The set, along the bottom on a laptop; the same ones ‹ › go through. */}
        {!phone && items.length > 1 && (
          <nav ref={stripRef} aria-label={p.itemsLabel ?? "The others here"} className="flex h-14 shrink-0 items-center gap-2 scroll-x scroll-lg border-t border-line bg-surface-2/60 px-5">
            {items.map((x, i) => (
              <button
                key={x.key}
                type="button"
                title={x.name}
                aria-current={i === at ? "true" : undefined}
                onClick={i === at ? undefined : x.go}
                className={cn(
                  "inline-flex h-8 max-w-60 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-md",
                  i === at ? "border-primary bg-primary-soft font-semibold" : "border-line bg-surface hover:border-line-strong",
                )}
              >
                <DocMark state={x.state} />
                <span className="truncate">{x.name}</span>
              </button>
            ))}
          </nav>
        )}
        {/* A phone: the panel in one slim line, its strong button pinned under it. */}
        {phone && panel && (
          <div className="shrink-0 border-t border-line bg-surface">
            <button type="button" onClick={() => setSheet(true)} className="flex min-h-[52px] w-full items-center gap-2.5 px-4 text-left text-md">
              {panel.bar.state && <DocMark state={panel.bar.state} />}
              <span className="min-w-0 flex-1 truncate">{panel.bar.text}</span>
              <ChevronUp className="size-4 shrink-0 text-muted" aria-hidden />
            </button>
            {panel.foot && (
              <div className="flex gap-2.5 border-t border-line px-4 pt-2.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] [&>*:last-child]:flex-1">
                {panel.foot}
              </div>
            )}
          </div>
        )}
        {phone && panel && sheet && (
          <div className="absolute inset-0 z-20 flex flex-col justify-end">
            <button type="button" aria-label="Close" tabIndex={-1} className="absolute inset-0 bg-black/45" onClick={() => setSheet(false)} />
            <div role="dialog" aria-label={panel.label} className="relative flex max-h-[88%] flex-col rounded-t-2xl bg-surface shadow-pop">
              <div aria-hidden className="mx-auto mt-2 mb-1 h-1 w-10 shrink-0 rounded-full bg-line-strong" />
              {tabs}
              {panelBody}
              <div className="flex shrink-0 gap-2.5 border-t border-line px-4 pt-2.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] [&>*:last-child]:flex-1">
                <Button variant="secondary" onClick={() => setSheet(false)}>
                  Close
                </Button>
                {panel.foot}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}

function Zoom({ zoom }: { zoom: NonNullable<ViewBarProps["zoom"]> }) {
  const step = (d: number) => zoom.set(Math.min(3, Math.max(0.3, Math.round((zoom.shown + d) * 20) / 20)));
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <Button size="icon-sm" variant="ghost" aria-label="Zoom out" onClick={() => step(-0.1)}>
        <Minus aria-hidden />
      </Button>
      <span className="min-w-12 text-center text-md font-semibold tabular">{Math.round(zoom.shown * 100)}%</span>
      <Button size="icon-sm" variant="ghost" aria-label="Zoom in" onClick={() => step(0.1)}>
        <Plus aria-hidden />
      </Button>
      <Button size="sm" variant="ghost" aria-pressed={zoom.value === null} onClick={() => zoom.set(null)}>
        Fit
      </Button>
    </span>
  );
}

function MenuRow({ label, hint, onClick, danger, children }: { label: string; hint?: string; onClick: () => void; danger?: boolean; children?: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex min-h-10 w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-md hover:bg-surface-2 focus:bg-surface-2 focus:outline-none",
        danger && "text-bad",
      )}
    >
      {children}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </button>
  );
}

/** ⋯ on a phone: how you see it, Download and Print, then the others of the set; the rare things follow. */
function PhoneMore({
  choices,
  download,
  onPrint,
  items,
  at,
  itemsLabel,
  close,
}: {
  choices: ViewChoice[];
  download: DocWindowProps["download"];
  onPrint: (() => void) | null;
  items: WindowItem[];
  at: number;
  itemsLabel?: string;
  close: () => void;
}) {
  const run = (fn: () => void) => () => {
    close();
    fn();
  };
  return (
    <>
      {choices.map((c) => (
        <div key={c.label} role="group" aria-label={c.label} className="flex flex-col pb-1">
          <p className={cn(capsClass, "px-3 pt-2 pb-1")}>{c.label}</p>
          {c.options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="menuitemradio"
              aria-checked={o.value === c.value}
              onClick={run(() => c.pick(o.value))}
              className="flex min-h-10 w-full items-center justify-between gap-3 rounded-md px-3 text-left text-md hover:bg-surface-2 focus:bg-surface-2 focus:outline-none aria-checked:font-semibold"
            >
              {o.word}
              {o.value === c.value && <Check className="size-4 text-primary" aria-hidden />}
            </button>
          ))}
        </div>
      ))}
      {choices.length > 0 && <span role="separator" className="my-1 block h-px bg-line" />}
      {download && (
        <MenuRow label={download.word} onClick={run(() => saveHref(download.href, download.name))}>
          <Download className="size-4 shrink-0 text-text-2" aria-hidden />
        </MenuRow>
      )}
      {onPrint && (
        <MenuRow label="Print" onClick={run(onPrint)}>
          <Printer className="size-4 shrink-0 text-text-2" aria-hidden />
        </MenuRow>
      )}
      {items.length > 1 && (
        <>
          <span role="separator" className="my-1 block h-px bg-line" />
          <p className={cn(capsClass, "px-3 pt-2 pb-1")}>{itemsLabel ?? "The others here"}</p>
          {items.map((x, i) => (
            <MenuRow key={x.key} label={i === at ? `${x.name} · showing` : x.name} onClick={run(i === at ? () => {} : x.go)}>
              <DocMark state={x.state} />
            </MenuRow>
          ))}
        </>
      )}
    </>
  );
}

/** A link followed as a download, from a menu rather than a link. */
export function saveHref(href: string, name?: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = name ?? "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/* ---------------------------------------------------------------- our own papers, in a frame */

/** The sheet's own width on screen (A4 at 96 dpi with the grey around it): Fit zooms it to the stage. */
export const SHEET = 860;

/** What a paper in the frame says of itself (its toolbar, inside the frame): its PDF, Excel, the view switches. */
export interface PaperInfo {
  title: string;
  pdfHref: string;
  excelHref?: string;
  choices?: PaperChoice[];
  note?: string;
}

/** Which copy and which language a paper is shown in: read from a switch's link, put on the frame's address. */
export type PaperLook = { copy: string | null; lang: string | null };

export function lookOf(href: string): PaperLook {
  const q = new URL(href, "http://x").searchParams;
  return { copy: q.get("copy"), lang: q.get("lang") };
}

export function withLook(src: string, look: PaperLook): string {
  const u = new URL(src, "http://x");
  for (const k of ["copy", "lang"] as const) {
    const v = look[k];
    if (v) u.searchParams.set(k, v);
    else u.searchParams.delete(k);
  }
  return u.pathname + u.search;
}

/** The paper's switches as the view bar draws them; picking one shows the paper so (the frame loads it again). */
export function choicesOf(info: PaperInfo | null, setLook: (l: PaperLook) => void): ViewChoice[] {
  return (info?.choices ?? []).map((c) => ({
    label: c.label,
    value: (c.options.find((o) => o.on) ?? c.options[0])?.key ?? "",
    options: c.options.map((o) => ({ value: o.key, word: o.word })),
    pick: (k) => {
      const o = c.options.find((x) => x.key === k);
      if (o) setLook(lookOf(o.href));
    },
  }));
}

/** A paper's view state in the window: its zoom (null: fitted), the fitted size, its pages and what it says of itself. */
export function usePaperView() {
  const [zoom, setZoom] = useState<number | null>(null);
  const [fit, setFit] = useState(1);
  const [pages, setPages] = useState<{ at: number; of: number } | null>(null);
  const [info, setInfo] = useState<PaperInfo | null>(null);
  return {
    zoom: { value: zoom, shown: zoom ?? fit, set: setZoom },
    pages,
    info,
    stage: { zoom, onFit: setFit, onPages: setPages, onInfo: setInfo },
  };
}

/**
 * One of our papers in its frame (the page is ours: the same site), the whole sheet's width in view on any screen:
 * the page inside is zoomed to the stage (or to the zoom picked), counts its pages, and says what it is.
 */
export function PaperStage({
  src,
  title,
  frame,
  zoom,
  onFit,
  onPages,
  onInfo,
}: {
  src: string;
  title: string;
  frame: RefObject<HTMLIFrameElement | null>;
  zoom: number | null;
  onFit: (fit: number) => void;
  onPages: (p: { at: number; of: number } | null) => void;
  onInfo: (info: PaperInfo) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setFit(Math.max(0.3, Math.min(1, (el.clientWidth - 16) / SHEET)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => onFit(fit), [fit, onFit]);
  const scale = zoom ?? fit;

  // The pages: each sheet is an A4 page or more (a long one runs on); the one in view from how far it is scrolled.
  const count = useCallback(() => {
    const doc = frame.current?.contentDocument;
    if (!doc?.documentElement) return;
    // Our two sheets: KeboDoc's (.kebo-doc) and the plain one's (.kebo-sheet); never one inside the other.
    const sheets = [...doc.querySelectorAll<HTMLElement>(".kebo-doc, .kebo-sheet")].filter((s) => !s.parentElement?.closest(".kebo-doc, .kebo-sheet"));
    if (!sheets.length) return onPages(null);
    const of = sheets.reduce((n, s) => n + Math.max(1, Math.ceil(s.offsetHeight / ((s.offsetWidth * 297) / 210) - 0.03)), 0);
    const el = doc.scrollingElement ?? doc.documentElement;
    const max = el.scrollHeight - el.clientHeight;
    onPages({ of, at: max > 4 ? Math.min(of, 1 + Math.round((el.scrollTop / max) * (of - 1))) : 1 });
  }, [frame, onPages]);
  const apply = useCallback(() => {
    frame.current?.contentDocument?.documentElement?.style.setProperty("zoom", String(scale));
    count();
  }, [frame, scale, count]);
  useEffect(apply, [apply]);
  const loaded = () => {
    apply();
    frame.current?.contentWindow?.addEventListener("scroll", count, { passive: true });
  };

  // The paper's toolbar (inside the frame) says what its buttons are: the window draws them itself.
  useEffect(() => {
    const got = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return;
      const d = e.data as { type?: string } & PaperInfo;
      if (d?.type === "kebo-paper") onInfo({ title: d.title, pdfHref: d.pdfHref, excelHref: d.excelHref, choices: d.choices, note: d.note });
    };
    window.addEventListener("message", got);
    return () => window.removeEventListener("message", got);
  }, [frame, onInfo]);

  return (
    <div ref={box} className="absolute inset-0">
      <iframe ref={frame} src={src} title={title} onLoad={loaded} className="size-full border-0 bg-surface-3" />
    </div>
  );
}
