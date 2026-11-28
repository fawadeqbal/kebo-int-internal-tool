"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, FileText, RefreshCw, X } from "lucide-react";
import { fileSize, FLOW_STEP_LABEL, inSentence, orderTabPath, paperDone, paperOptionsQuery, STEP_PATH, type PaperCheck } from "@kebo/shared";
import { Button, ButtonLink, capsClass, chipClass, cn, controlClass, controlSizes, Input, linkClass, Notice } from "@kebo/ui";
import { toast } from "@kebo/ui/client";
import { Switch } from "@/components/common/switch-list";
import { useConfirm } from "@/components/common/dialog";
import { uploadToOrder, useFileTools } from "@/components/files/file-tools";
import { FileStage, kindOf, printImage } from "@/components/files/viewer";
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
  type WindowItem,
} from "@/components/window/doc-window";
import { EmailButton, ShareButton, type Outgoing, type Recipient } from "@/components/send/send";
import { emailOutAction, noteSentAction, noteSharedAction, type Going } from "@/app/(app)/send-actions";
import { orderWindowHref } from "@/lib/doc-links";
import type { ActionState } from "@/lib/actions";
import type { HsLine, PaperChecks } from "@/lib/types-papers";
import type { PaperOp } from "@/app/(app)/orders/papers-actions";
import { ownDocumentAction, paperDeleteDraftAction } from "@/app/(app)/orders/files-actions";
import { useTime } from "@/lib/time-client";
import type { PaperLineRow } from "./papers-table";
import { RecordForm } from "./papers-card";
import { rememberOpener } from "@/components/window/focus-return";

/** paperAction bound to the order, the paper and its ref: (op, paper id, …). */
export type PaperRun = (op: PaperOp, paperId: string | null, prev: ActionState, form: FormData) => Promise<ActionState>;
type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** One "Filled from the order" line: tick or dot, label, what it takes; missing data typed right there. */
function CheckRow({
  c,
  fix,
  hsLines,
  canFix,
  base,
  onFix,
  pending,
}: {
  c: PaperCheck;
  fix?: { label: string; type: "text" | "date"; saves: string };
  hsLines: HsLine[];
  canFix: boolean;
  base: string;
  onFix: (field: string, value: string, lineId?: string) => void;
  pending: boolean;
}) {
  const id = useId();
  const [v, setV] = useState("");
  const [hs, setHs] = useState<Record<string, string>>({});
  // Saved on leaving the field as well as with Save (e2e 24 Nov: Tab did not save, and the live paper waited for it);
  // each value once, so the blur that comes before a click on Save does not save it twice.
  const sent = useRef<Record<string, string>>({});
  const save = (key: string, value: string, run: () => void) => {
    if (!value || pending || sent.current[key] === value) return;
    sent.current[key] = value;
    run();
  };
  const mark = c.ok ? (
    <Check className="size-4 shrink-0 text-ok" strokeWidth={3} aria-label="From the order" />
  ) : (
    <span
      role="img"
      className={cn("mx-1 block size-2.5 shrink-0 rounded-full", c.required ? "bg-action" : "bg-warn")}
      aria-label={c.required ? "Needed" : "Missing"}
    />
  );
  const input = canFix && !c.ok && c.fix && c.fix !== "hs" && fix;
  const href = !c.ok && c.href ? (c.href.startsWith("/") ? c.href : `${base}/${orderTabPath(c.href)}`) : null;
  return (
    <li className="flex flex-col gap-1.5 py-2.5">
      <div className="flex items-center gap-2.5 text-sm">
        {mark}
        <span className={cn("shrink-0", !c.ok && c.required && "font-medium")}>{c.label}</span>
        {input ? (
          <form
            className="ml-auto flex min-w-0 items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              save("", v.trim(), () => onFix(c.fix!, v.trim()));
            }}
          >
            <label htmlFor={id} className="sr-only">
              {fix.label}
            </label>
            <input
              id={id}
              type={fix.type}
              value={v}
              onChange={(e) => setV(e.target.value)}
              onBlur={() => save("", v.trim(), () => onFix(c.fix!, v.trim()))}
              className={cn(controlClass, controlSizes.sm, "w-36 min-w-0 border-primary/60")}
            />
            {v.trim() && (
              <Button type="submit" size="xs" variant="secondary" disabled={pending}>
                {pending ? "…" : "Save"}
              </Button>
            )}
          </form>
        ) : (
          <span className="ml-auto min-w-0 truncate text-right text-xs text-text-2" title={c.value}>
            {href ? (
              <Link href={href} className={linkClass}>
                {c.value} · add it
              </Link>
            ) : (
              c.value
            )}
          </span>
        )}
      </div>
      {c.warn && (
        <p className="pl-6 text-xs text-bad">
          <span className="font-medium">{c.value}</span> · {c.warn}
        </p>
      )}
      {input && <p className="pl-6 text-xs text-muted">{c.warn ? "A new date typed here" : "Adding it here"} also saves it on {fix.saves}.</p>}
      {canFix && !c.ok && c.fix === "hs" && hsLines.length > 0 && (
        <ul className="flex flex-col gap-1.5 pl-6">
          {hsLines.map((l) => (
            <li key={l.id}>
              <form
                className="flex items-center gap-2 text-xs"
                onSubmit={(e) => {
                  e.preventDefault();
                  save(l.id, hs[l.id]?.trim() ?? "", () => onFix("hs", hs[l.id]!.trim(), l.id));
                }}
              >
                <label htmlFor={`${id}-${l.id}`} className="min-w-0 flex-1 truncate text-text-2">
                  {l.description}
                </label>
                <input
                  id={`${id}-${l.id}`}
                  value={hs[l.id] ?? ""}
                  onChange={(e) => setHs((x) => ({ ...x, [l.id]: e.target.value }))}
                  onBlur={() => save(l.id, hs[l.id]?.trim() ?? "", () => onFix("hs", hs[l.id]!.trim(), l.id))}
                  inputMode="decimal"
                  className={cn(controlClass, controlSizes.sm, "w-28 tabular")}
                />
                {hs[l.id]?.trim() && (
                  <Button type="submit" size="xs" variant="secondary" disabled={pending}>
                    Save
                  </Button>
                )}
              </form>
              {/* The code the same item had on an earlier order: taken with one click, never filled in by itself. */}
              {l.suggest && !hs[l.id]?.trim() && (
                <button
                  type="button"
                  className={cn(linkClass, "mt-1 text-xs")}
                  disabled={pending}
                  onClick={() => save(l.id, l.suggest!.hsCode, () => onFix("hs", l.suggest!.hsCode, l.id))}
                >
                  Use {l.suggest.hsCode}, as on {l.suggest.from}
                </button>
              )}
            </li>
          ))}
          <li className="text-xs text-muted">Saved on the order&apos;s item, so every document has it.</li>
        </ul>
      )}
    </li>
  );
}

/** "Refresh from customer": asks why (kept in the order's history) before the buyer is taken again. */
function RefreshBuyer({
  open,
  onClose,
  onSave,
  pending,
  changes,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (reason: string) => void;
  pending: boolean;
  changes: string[];
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby={`${id}-title`}
      className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-0 text-text shadow-pop backdrop:bg-black/40"
    >
      {open && (
        <form
          className="flex flex-col gap-3 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim()) onSave(reason.trim());
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <h2 id={`${id}-title`} className="text-base font-semibold">
              Refresh the buyer from the customer?
            </h2>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted hover:bg-surface-2">
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <p className="text-sm text-text-2">
            {changes.length ? `The customer's ${changes.join(", ")} changed since the order was made. ` : ""}
            Documents made from now on print the customer as it is now. Documents already made final keep the buyer they were printed with.
          </p>
          <label htmlFor={`${id}-reason`} className="text-sm font-medium">
            Why? <span className="font-normal text-muted">Kept in the order&apos;s history.</span>
          </label>
          <Input
            id={`${id}-reason`}
            value={reason}
            maxLength={300}
            autoFocus
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" variant="primary" disabled={pending || !reason.trim()}>
              {pending ? "Saving…" : "Refresh the buyer"}
            </Button>
          </div>
        </form>
      )}
    </dialog>
  );
}

/** The buyer the paper prints: as on the order (frozen when it was made), with "Refresh from customer". */
function BuyerBox({
  p,
  editing,
  pending,
  onRefresh,
}: {
  p: PaperChecks;
  editing: boolean;
  pending: boolean;
  onRefresh: (reason: string) => Promise<boolean>;
}) {
  const { date } = useTime();
  const [open, setOpen] = useState(false);
  if (!p.buyer) return null;
  const { buyer: b, changes } = p.buyer;
  const numbers = [b.taxNo ? `Tax no. ${b.taxNo}` : null, b.regNo ? `Reg. no. ${b.regNo}` : null].filter(Boolean).join(" · ");
  return (
    <section aria-labelledby="buyer" className="rounded-lg border border-line p-3">
      <div className="flex items-center justify-between gap-3">
        <h3 id="buyer" className={capsClass}>
          Buyer as on the order
        </h3>
        {editing && p.canRefreshBuyer && (
          <Button size="xs" variant="ghost" className="-my-1 shrink-0" onClick={() => setOpen(true)}>
            <RefreshCw aria-hidden /> Refresh from customer
          </Button>
        )}
      </div>
      <p className="mt-1 text-sm font-medium">{b.name}</p>
      {(b.address || b.country) && (
        <p className="text-xs whitespace-pre-line text-text-2">{[b.address, b.country].filter(Boolean).join(", ")}</p>
      )}
      {numbers && <p className="text-xs text-muted">{numbers}</p>}
      {changes.length > 0 ? (
        <p className="mt-2 text-xs text-action">
          The customer&apos;s {changes.join(", ")} changed since. This document prints the buyer as on the order until it is refreshed.
        </p>
      ) : (
        <p className="mt-2 text-xs text-muted">
          {b.from === "customer" ? "Refreshed from the customer" : "Taken when the order was made"}
          {b.takenOn ? ` · ${date(b.takenOn)}` : ""} · the same as the customer now.
        </p>
      )}
      <RefreshBuyer
        open={open}
        onClose={() => setOpen(false)}
        pending={pending}
        changes={changes}
        onSave={async (reason) => {
          if (await onRefresh(reason)) setOpen(false);
        }}
      />
    </section>
  );
}

/** The quotation's payment text against the route, when they differ: print it too, or not (the default). */
function TermsBox({ p }: { p: PaperChecks }) {
  const t = p.terms;
  if (!t) return null;
  return (
    <section aria-labelledby="terms" className="rounded-lg border border-warn/40 bg-warn-soft p-3">
      <h3 id="terms" className={capsClass}>
        Payment terms
      </h3>
      <p className="mt-1 text-sm">
        The quotation said <q className="font-medium">{t.quoted.split(/\r?\n/)[0]!.replace(/[\s.;,]+$/, "")}</q>; the route is now{" "}
        <strong>{t.route}</strong>.
      </p>
      <p className="mt-0.5 text-xs text-text-2">
        The document words the payment terms from the route; the agreed conditions are {t.printed ? "printed too" : "left off"}.{" "}
        {/* One place for how the order's papers print (design "terms that travel"). */}
        <Link href={`/orders/${p.orderId}/documents`} className={linkClass}>
          Change in How the documents print
        </Link>
      </p>
    </section>
  );
}


/* ---------------------------------------------------------------- the order's window */

/** What the window shows: one of the order's documents, by what it is. */
export type OrderDocItem =
  | { type: "make"; p: PaperChecks; run: PaperRun; text?: { subject: string; text: string } }
  | { type: "own"; row: PaperLineRow; canMake: boolean; issue?: Action }
  | { type: "quotation"; row: PaperLineRow }
  | {
      type: "upload";
      row: PaperLineRow;
      canRecord: boolean;
      add: Action;
      update?: Action;
      dealId: string;
      today: string;
      shipNumber: string | null;
    };

export interface OrderWindowProps {
  order: { id: string; refNo: string; customer: string };
  doc: OrderDocItem;
  /** The order's documents (the strip and ‹ ›) and which one this is (its row's key); `out`: how a final one goes out. */
  items: { key: string; name: string; state: DocState; href: string; out?: Outgoing | null }[];
  current: string | null;
  /** The window's own address (no way back): the link for the team. */
  self: string;
  back: string;
  /** Who it goes to (the customer's main contact; none for a supplier's paper). */
  to: Recipient | null;
  sender: string;
  today: string;
  /** How it opened: a version, a copy, a language. */
  look: { v: string | null; copy: string | null; lang: string | null };
}

/**
 * One window for every document of an order (design "One window for documents and files", 26 Nov 2026): a paper
 * the app makes, the proforma and the packing list, the quotation, and the papers others issue. The page in the
 * middle with its view bar, the panel at the right with the one strong button for where it stands (Make final,
 * Send, Upload), Download PDF and Print in the header, the order's other documents in the strip.
 */
export function OrderDocWindow(props: OrderWindowProps) {
  const d = props.doc;
  if (d.type === "make") return <MakeWindow {...props} doc={d} />;
  if (d.type === "own") return <OwnWindow {...props} doc={d} />;
  if (d.type === "quotation") return <QuotationWindow {...props} doc={d} />;
  return <UploadWindow {...props} doc={d} />;
}

/** What every order window shares: closing back where it was opened, and the order's documents. */
function useOrderWindow(props: OrderWindowProps) {
  const router = useRouter();
  const { back } = props;
  // Back where it was opened, and the focus on the link that opened it (the window is a page of its own).
  const close = useCallback(() => {
    rememberOpener(back);
    router.push(back);
  }, [router, back]);
  const at = props.items.findIndex((x) => x.key === props.current);
  const items: WindowItem[] =
    at < 0 ? [] : props.items.map((x) => ({ key: x.key, name: x.name, state: x.state, go: () => router.replace(x.href, { scroll: false }) }));
  return { router, close, items, at: Math.max(0, at) };
}

/** A paper of ours in the window: its frame, how it is shown (copy, language, zoom), its PDF as shown, Print. */
function usePaper(base: string, pdfBase: string, first: PaperLook) {
  const frame = useRef<HTMLIFrameElement>(null);
  const view = usePaperView();
  const [look, setLook] = useState<PaperLook>(first);
  const src = withLook(base, look);
  const info = view.info;
  const shownAs = info?.choices?.flatMap((c) => c.options.filter((o) => o.on).map((o) => o.word)).join(" · ");
  return {
    src,
    /** The PDF as shown: the paper says it once it loads (its copy, its language). */
    pdf: info?.pdfHref ?? withLook(pdfBase, look),
    detail: [shownAs, view.pages ? `${view.pages.of} page${view.pages.of === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ") || "PDF",
    note: info?.note ?? null,
    excel: info?.excelHref ?? null,
    print: () => frame.current?.contentWindow?.print(),
    stage: (title: string) => <PaperStage src={src} title={title} frame={frame} {...view.stage} />,
    view: { choices: choicesOf(info, setLook), zoom: view.zoom, pages: view.pages },
    /** The same page on its own, for Open in a new tab. */
    alone: () => window.open(src.replace(/([?&])embed=1&?/, "$1").replace(/[?&]$/, ""), "_blank", "noopener"),
  };
}

const goingOf = (x: Outgoing): Going => ({ key: x.key, name: x.name, download: x.download, paper: x.paper ?? null, file: x.file ?? null });

/**
 * Share and Email for one of the order's documents (design "Email and Share", 26 Nov 2026): the panel's foot,
 * Email strong (sending is the next step). Email can take the order's other final documents along (under Include);
 * each send is noted in the order's History.
 */
function useOrderPair(
  props: OrderWindowProps,
  what: Outgoing,
  name: string,
  text?: { subject: string; text: string },
  /** "our proforma" for a paper we make, "the bill of lading" for one others issue. */
  whose: "our" | "the" = "our",
) {
  const { order, to, sender } = props;
  const others = props.items.flatMap((x) => (x.out && x.key !== props.current && x.out.download !== what.download ? [x.out] : []));
  const items = [what, ...others];
  const on = { order: order.id };
  const going = items.map(goingOf);
  const message =
    text?.text ??
    `Dear ${to?.name ?? "Sir/Madam"},\n\nPlease find attached ${whose} ${name.replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase())} for order ${order.refNo}.\n\nBest regards,\n${sender}`;
  const foot = (
    <>
      <ShareButton
        items={[what]}
        message={message.replace(/\n\nBest regards,[\s\S]*$/, "")}
        to={to}
        link={props.self}
        noteAction={noteSharedAction.bind(null, on, [goingOf(what)])}
      />
      <EmailButton
        strong
        label={to?.name ? `Email ${to.name}` : "Email"}
        title={`Email the ${name.replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase())}`}
        description={`${order.refNo} · ${order.customer}`}
        items={items}
        to={to}
        subject={(chosen) => text?.subject ?? (chosen.length > 1 ? `${name} and ${chosen.length - 1} more · order ${order.refNo}` : `${name} · order ${order.refNo}`)}
        message={message}
        emailAction={emailOutAction.bind(null, on, going)}
        markAction={noteSentAction.bind(null, on, going)}
        today={props.today}
      />
    </>
  );
  return { foot };
}

/** The panel's tab: the first one of its state until another is picked (a new state opens its own first tab). */
function useTab(first: string) {
  const [picked, setPicked] = useState({ first, tab: first });
  return [picked.first === first ? picked.tab : first, (tab: string) => setPicked({ first, tab })] as const;
}

/** Label · value, left of each other (the app's one facts style). */
function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[fit-content(45%)_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-md">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="min-w-24 text-text-2">{k}</dt>
          <dd className="min-w-0 font-medium break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The versions of a paper: the one shown, and Show for the others (the page changes in place). */
function Versions({ list, shown, onShow }: { list: { n: number; words: string }[]; shown: number; onShow: (n: number) => void }) {
  if (list.length < 2) return null;
  return (
    <section aria-label="Versions">
      <h3 className={capsClass}>Versions</h3>
      <ul className="mt-1 flex flex-col divide-y divide-line text-md">
        {list.map((v) => (
          <li key={v.n} className="flex min-h-10 items-center justify-between gap-2">
            <span>
              Version {v.n} · {v.words}
            </span>
            {v.n === shown ? (
              <span className="text-xs font-semibold text-ok">Showing</span>
            ) : (
              <button type="button" className={linkClass} onClick={() => onShow(v.n)}>
                Show
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Where the page shows something other than a paper (a file not uploaded yet, one kept elsewhere). */
function StageCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="absolute inset-0 grid place-items-center p-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-2xl border border-line bg-surface px-6 py-7 text-center shadow-card">
        <span aria-hidden className="grid size-14 place-items-center rounded-2xl bg-surface-2 text-text-2">
          <FileText className="size-7" />
        </span>
        <p className="text-lead font-bold">{title}</p>
        <div className="text-md text-text-2">{children}</div>
      </div>
    </div>
  );
}

const versionOf = (v: string | null) => (v && /^\d{1,3}$/.test(v) ? Number(v) : null);

/* ---------------------------------------------------------------- a paper the app makes */

function MakeWindow(props: OrderWindowProps & { doc: Extract<OrderDocItem, { type: "make" }> }) {
  const { p, run } = props.doc;
  const w = useOrderWindow(props);
  const { router } = w;
  const { date } = useTime();
  const [pending, start] = useTransition();
  const { ask, dialog } = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [opts, setOpts] = useState<Record<string, boolean>>(Object.fromEntries(p.options.map((o) => [o.key, o.on])));
  const [reload, setReload] = useState(0);
  const [v, setV] = useState<number | null>(versionOf(props.look.v));
  const final = p.paper?.status === "final";
  const draft = p.paper?.status === "draft";
  // Kept as sent (a payment request, a receipt): no draft and nothing to make here.
  const kept = p.kind === "payment-request" || p.kind === "payment-receipt";
  const keptDone = kept && paperDone(p.state);
  const editing = !final && p.canMake && !p.live && !kept;
  const sendable = final || p.live || keptDone;
  // "prices,stamp,-terms": an option named is on; a part of the paper named with a minus is hidden.
  const optList = paperOptionsQuery(opts);
  const shownV = v && p.paper && v !== p.paper.version ? v : null;

  const refQ: Record<string, string> = p.ref ? { ref: p.ref } : {};
  const base = useMemo(
    () =>
      `/print/orders/${p.orderId}/${p.kind}?${new URLSearchParams({
        embed: "1",
        ...refQ,
        ...(shownV ? { v: String(shownV) } : final ? {} : { opts: optList }),
        r: String(reload),
      })}`,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refQ is p.ref
    [p.orderId, p.kind, p.ref, final, optList, reload, shownV],
  );
  const pq = new URLSearchParams(refQ);
  if (shownV) pq.set("v", String(shownV));
  const paper = usePaper(base, `/pdf/${p.kind}/${p.orderId}${pq.size ? `?${pq}` : ""}`, { copy: props.look.copy, lang: props.look.lang });

  const call = (op: PaperOp, paperId: string | null, body: Record<string, unknown>) =>
    new Promise<ActionState>((resolve) =>
      start(async () => {
        setError(null);
        setNotice(null);
        const form = new FormData();
        form.set("payload", JSON.stringify(body));
        const r = await run(op, paperId, {}, form);
        if (r.ok) {
          setReload((n) => n + 1);
          router.refresh();
        } else setError(r.message ?? "Something went wrong. Please try again.");
        resolve(r);
      }),
    );
  const makeFinal = async () => {
    let id = draft ? p.paper!.id : null;
    if (!id) {
      const r = await call("draft", null, { options: opts });
      if (!r.ok) return;
      id = (r.data as PaperChecks).paper?.id ?? null;
    }
    if (id) await call("final", id, { options: opts });
  };

  const required = p.checks.filter((c) => c.required && !c.ok);
  const missing = p.checks.filter((c) => !c.ok);
  const done = p.checks.length - missing.length;
  const orderBase = `/orders/${p.orderId}`;
  const stepHref = `${orderBase}/${STEP_PATH[p.step]}`;
  const stepWord = FLOW_STEP_LABEL[p.step];
  const named = [p.label, p.number ?? p.refNo].filter(Boolean).join(" ");
  const forWhom = p.buyer?.buyer.name ?? p.suppliers?.find((f) => f.id === p.ref)?.name ?? props.order.customer;

  const send = useOrderPair(
    props,
    { key: props.current ?? p.kind, name: `${named}.pdf`, detail: paper.detail, view: paper.src.replace(/([?&])embed=1&?/, "$1"), download: paper.pdf, paper: props.current, draft: !sendable },
    [p.label, p.number].filter(Boolean).join(" "),
    props.doc.text,
  );

  const first = editing ? "make" : "details";
  const [tab, setTab] = useTab(first);

  const state: { state: DocState; word: string } = p.live
    ? { state: "live", word: "Live · as of today" }
    : final
      ? { state: "final", word: `Final · version ${p.paper!.version}` }
      : draft
        ? { state: "draft", word: `Draft · version ${p.paper!.version}` }
        : kept
          ? keptDone
            ? { state: "final", word: "Kept as sent" }
            : { state: "todo", word: "Not sent yet" }
          : { state: "todo", word: "Not made yet" };

  const makeBody = (
    <div className="flex flex-col gap-4">
      {error && <Notice tone="bad">{error}</Notice>}
      {notice && <Notice tone="ok">{notice}</Notice>}
      {p.suppliers && p.suppliers.length > 1 && (
        <nav aria-label="Supplier" className="flex flex-wrap gap-1.5">
          {p.suppliers.map((f) => (
            <Link
              key={f.id}
              href={orderWindowHref(p.orderId, p.kind, { ref: f.id, back: props.back })}
              replace
              aria-current={p.ref === f.id ? "page" : undefined}
              className={chipClass(p.ref === f.id)}
            >
              {f.name}
            </Link>
          ))}
        </nav>
      )}
      <section aria-labelledby="filled">
        <div className="flex items-baseline justify-between gap-3">
          <h3 id="filled" className={capsClass}>
            Before it is final
          </h3>
          <span className={cn("text-md font-semibold", missing.length ? "text-action" : "text-ok")}>{missing.length ? `${missing.length} to fill` : "Ready"}</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
          <div className="h-full rounded-full bg-primary-solid" style={{ width: `${p.checks.length ? (done / p.checks.length) * 100 : 100}%` }} />
        </div>
        <p className="mt-1.5 text-xs text-muted">
          {done} of {p.checks.length} ready. Typed here, saved on the order, so every document has it.
        </p>
        <ul className="mt-1 flex flex-col divide-y divide-line">
          {p.checks.map((c) => (
            <CheckRow
              key={c.key}
              c={c}
              fix={p.fixes[c.key]}
              hsLines={p.hsLines}
              canFix={p.canMake}
              base={orderBase}
              pending={pending}
              onFix={(field, value, lineId) => call("fix", null, { field, value, ...(lineId ? { lineId } : {}) })}
            />
          ))}
        </ul>
      </section>
      <BuyerBox p={p} editing={p.canRefreshBuyer} pending={pending} onRefresh={async (reason) => !!(await call("buyer", null, { reason })).ok} />
      <TermsBox p={p} />
      {p.options.length > 0 && (
        <section aria-labelledby="show">
          <h3 id="show" className={capsClass}>
            Show on the document
          </h3>
          <ul className="mt-1 flex flex-col divide-y divide-line">
            {p.options.map((o) => (
              <li key={o.key} className="flex min-h-10 items-center justify-between gap-3 text-sm">
                <span>{o.label}</span>
                <Switch checked={!!opts[o.key]} label={o.label} onChange={(on) => setOpts((x) => ({ ...x, [o.key]: on }))} />
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-muted">The page updates as you switch; kept with the draft and when it is made final.</p>
        </section>
      )}
      {!p.ready && required.length > 0 && (
        <p className="text-xs text-action">Still needed before Make final: {required.map((c) => inSentence(c.label)).join(", ")}.</p>
      )}
    </div>
  );

  const detailsBody = (
    <div className="flex flex-col gap-5">
      {tab === "details" && error && <Notice tone="bad">{error}</Notice>}
      <Facts
        rows={[
          ["Number", p.number ?? "Given when it is made final"],
          ["For", forWhom],
          [
            "Step",
            <Link key="s" href={stepHref} className={linkClass}>
              {stepWord}
            </Link>,
          ],
          ["Made from", p.madeFrom],
          ...(p.paper
            ? [
                [
                  final ? "Made final" : "Saved",
                  final && p.paper.finalAt ? date(p.paper.finalAt) : date(p.paper.madeAt),
                ] as [string, ReactNode],
              ]
            : []),
        ]}
      />
      {p.live ? (
        <p className="text-md text-text-2">Printed from the data whenever it is opened: nothing to make final.</p>
      ) : kept ? (
        <p className="text-md text-text-2">
          {p.kind === "payment-request"
            ? `Kept as sent: send it from the order's ${stepWord} step (Send request).`
            : "Kept when its payment was recorded: nothing to make here."}
        </p>
      ) : !p.canMake ? (
        <p className="text-md text-text-2">You can see this document; making it needs the &ldquo;Documents and bank&rdquo; permission.</p>
      ) : final ? (
        <p className="text-md text-text-2">
          If the order changes, Make again (in ⋯) starts version {p.paper!.version + 1} as a draft; version {p.paper!.version} stays as it was made.
        </p>
      ) : null}
      <Versions
        list={p.versions.map((x) => ({ n: x.version, words: x.status === "final" ? `final${x.finalAt ? ` ${date(x.finalAt)}` : ""}` : "draft" }))}
        shown={shownV ?? p.paper?.version ?? 0}
        onShow={(n) => setV(n === p.paper?.version ? null : n)}
      />
    </div>
  );

  const foot = editing ? (
    <>
      <span className="mr-auto text-xs text-muted max-sm:hidden">{p.ready ? "Ready to make final" : `Fill ${required.length} more to make it final`}</span>
      <Button variant="secondary" disabled={pending} onClick={() => call("draft", null, { options: opts }).then((r) => r.ok && setNotice("Saved as a draft."))}>
        Save as draft
      </Button>
      <Button
        variant="primary"
        disabled={pending || !p.ready}
        onClick={() => void makeFinal()}
        title={p.ready ? undefined : `Still needed: ${required.map((c) => inSentence(c.label)).join(", ")}`}
      >
        {pending ? "Saving…" : "Make final"}
      </Button>
    </>
  ) : sendable ? (
    send.foot
  ) : kept ? (
    <ButtonLink href={stepHref} variant="primary">
      Open the {stepWord} step
    </ButtonLink>
  ) : null;

  const more: WindowAction[] = [
    ...(p.canMake && final && !p.live && !kept
      ? [
          {
            label: "Make again",
            hint: `Starts version ${p.paper!.version + 1}; version ${p.paper!.version} stays as made`,
            onClick: () =>
              ask(
                {
                  question: `Start version ${p.paper!.version + 1} of the ${p.label.toLowerCase()}? It starts as a draft from the order as it is now; version ${p.paper!.version} stays exactly as it was made.`,
                  confirmLabel: `Start version ${p.paper!.version + 1}`,
                },
                () => void call("again", null, {}),
              ),
          },
        ]
      : []),
    ...(paper.excel ? [{ label: "Download Excel", onClick: () => saveHref(paper.excel!) }] : []),
    { label: `Open the ${stepWord} step`, onClick: () => router.push(stepHref) },
    { label: "Open in a new tab", onClick: paper.alone },
    ...(p.canMake && draft && p.paper
      ? [
          {
            label: "Delete the draft",
            danger: true,
            onClick: () =>
              ask({ question: `Delete the draft of the ${p.label.toLowerCase()} (version ${p.paper!.version})?`, confirmLabel: "Delete the draft", danger: true }, () =>
                start(async () => {
                  const res = await paperDeleteDraftAction(p.orderId, p.paper!.id);
                  if (!res.ok) toast({ message: res.message ?? "Something went wrong.", kind: "fail" });
                  router.refresh();
                }),
              ),
          },
        ]
      : []),
  ];

  const tabs = editing
    ? [
        { key: "make", label: "Make", count: missing.length },
        { key: "details", label: "Details" },
      ]
    : [{ key: "details", label: "Details" }];

  return (
    <>
      <DocWindow
        kind="order"
        title={p.label}
        number={p.number}
        state={state}
        sub={[p.refNo, forWhom, `from the ${stepWord} step`, paper.note].filter(Boolean).join(" · ")}
        items={w.items}
        at={w.at}
        itemsLabel="This order's documents"
        download={{ href: paper.pdf, word: "Download PDF" }}
        onPrint={paper.print}
        more={more}
        onClose={w.close}
        stage={paper.stage(`${p.label} as it prints`)}
        view={paper.view}
        panel={{
          label: editing ? "Make it" : "About it",
          tabs,
          tab,
          onTab: setTab,
          body: tab === "make" ? makeBody : detailsBody,
          foot,
          bar: editing
            ? missing.length
              ? {
                  text: (
                    <>
                      <b className="font-semibold text-action">{missing.length} to fill</b> · {missing.map((c) => inSentence(c.label)).join(", ")}
                    </>
                  ),
                  state: "draft",
                }
              : { text: "Ready · what it takes and what shows", state: "final" }
            : { text: <>Details · {p.madeFrom}</> },
        }}
      />
      {dialog}
    </>
  );
}

/* ---------------------------------------------------------------- the proforma and the packing list */

function OwnWindow(props: OrderWindowProps & { doc: Extract<OrderDocItem, { type: "own" }> }) {
  const { row: r, canMake, issue } = props.doc;
  const w = useOrderWindow(props);
  const { router } = w;
  const [pending, start] = useTransition();
  const { ask, dialog } = useConfirm();
  const [v, setV] = useState<number | null>(versionOf(props.look.v));
  const orderId = props.order.id;
  const kind = r.kind as "proforma" | "packing-list";
  const shownV = v && r.version && v !== r.version ? v : null;
  const base = `/print/orders/${orderId}/${kind}?${new URLSearchParams({ embed: "1", ...(shownV ? { v: String(shownV) } : {}) })}`;
  const pdfBase = `/pdf/${kind}/${orderId}${shownV ? `?v=${shownV}` : ""}`;
  const paper = usePaper(base, pdfBase, { copy: props.look.copy, lang: props.look.lang });
  const draft = !!r.draft;
  const issued = paperDone(r.state) && !draft;
  const notIssued = kind === "proforma" && r.state === "can";
  const waiting = r.state === "wait";
  const named = [r.label, r.number].filter(Boolean).join(" ");
  const stepHref = `/orders/${orderId}/${STEP_PATH[r.step]}`;
  const act = (op: "final" | "again" | "delete") =>
    start(async () => {
      const res = await ownDocumentAction(orderId, kind, op);
      if (!res.ok) toast({ message: res.message ?? "Something went wrong.", kind: "fail" });
      router.refresh();
    });

  const send = useOrderPair(
    props,
    { key: r.key, name: `${named || r.label}.pdf`, detail: paper.detail, view: paper.src.replace(/([?&])embed=1&?/, "$1"), download: paper.pdf, paper: r.key, draft: !issued },
    named || r.label,
  );
  const first = issued ? "details" : "make";
  const [tab, setTab] = useTab(first);

  const state: { state: DocState; word: string } = draft
    ? { state: "draft", word: `Draft · version ${r.version}` }
    : notIssued
      ? { state: "todo", word: "Not issued yet" }
      : waiting
        ? { state: "todo", word: "Waiting for the packing" }
        : issued
          ? { state: "final", word: r.version ? `Final · version ${r.version}` : "Final" }
          : { state: "todo", word: r.stateLabel };

  const makeBody = (
    <div className="flex flex-col gap-3 text-md text-text-2">
      {draft ? (
        <p>
          Version {r.version} is a draft: it prints the order as it is now. Make it final to keep it so; version {(r.version ?? 2) - 1} stays as it was
          printed.
        </p>
      ) : notIssued ? (
        <p>
          Issuing gives it its number dated today (your letters, the date, the customer&apos;s letters, the handler&apos;s count) and makes it final:
          printing it again shows exactly what it prints now. A correction later is Make again (version 2, same number).
        </p>
      ) : waiting ? (
        <p>The packing list is made from the packing on Shipping: the cases, their sizes and weights. Fill the packing there and it shows here.</p>
      ) : (
        <p>{r.sub}</p>
      )}
      {!canMake && <p className="text-muted">Making it needs the &ldquo;Documents and bank&rdquo; permission.</p>}
    </div>
  );
  const detailsBody = (
    <div className="flex flex-col gap-5">
      <Facts
        rows={[
          ["Number", r.number ?? (kind === "proforma" ? "Given when it is issued" : "—")],
          ["For", props.order.customer],
          [
            "Step",
            <Link key="s" href={stepHref} className={linkClass}>
              {FLOW_STEP_LABEL[r.step]}
            </Link>,
          ],
          ["Made from", kind === "proforma" ? "the order's items, prices and terms" : "the packing on Shipping: cases, sizes, weights"],
        ]}
      />
      <Versions
        list={Array.from({ length: r.version ?? 0 }, (_, i) => ({ n: i + 1, words: i + 1 === r.version ? (draft ? "draft" : "now") : "as printed" }))}
        shown={shownV ?? r.version ?? 0}
        onShow={(n) => setV(n === r.version ? null : n)}
      />
    </div>
  );
  const finalWord = kind === "proforma" ? `Issue version ${r.version}` : `Make version ${r.version} final`;
  const foot =
    draft && canMake ? (
      <Button
        variant="primary"
        disabled={pending}
        onClick={() =>
          ask(
            {
              question: `Make version ${r.version} of the ${r.label.toLowerCase()} final? It keeps exactly what it prints now; version ${(r.version ?? 2) - 1} stays as it was.`,
              confirmLabel: kind === "proforma" ? "Issue it" : "Make it final",
            },
            () => act("final"),
          )
        }
      >
        {pending ? "Saving…" : finalWord}
      </Button>
    ) : notIssued && issue ? (
      <Button
        variant="primary"
        disabled={pending}
        onClick={() =>
          ask(
            {
              question:
                "Issue the proforma now? It gets its number dated today and is final: re-printing it shows exactly what it prints now. A correction later is Make again (version 2, same number).",
              confirmLabel: "Issue it",
            },
            () =>
              start(async () => {
                const res = await issue({}, new FormData());
                if (!res.ok) toast({ message: res.message ?? "Something went wrong.", kind: "fail" });
                router.refresh();
              }),
          )
        }
      >
        {pending ? "Issuing…" : "Issue it"}
      </Button>
    ) : waiting ? (
      <ButtonLink href={`/orders/${orderId}/shipping#packing`} variant="primary">
        Open the packing
      </ButtonLink>
    ) : issued ? (
      send.foot
    ) : null;
  const more: WindowAction[] = [
    ...(canMake && issued && r.version
      ? [
          {
            label: "Make again",
            hint: `Starts version ${r.version + 1}; version ${r.version} stays as printed`,
            onClick: () =>
              ask(
                {
                  question: `Start version ${r.version! + 1} of the ${r.label.toLowerCase()} from the order as it is now? Version ${r.version} stays exactly as it was printed; the number stays ${r.number}.`,
                  confirmLabel: `Start version ${r.version! + 1}`,
                },
                () => act("again"),
              ),
          },
        ]
      : []),
    { label: `Open the ${FLOW_STEP_LABEL[r.step]} step`, onClick: () => router.push(stepHref) },
    { label: "Open in a new tab", onClick: paper.alone },
    ...(canMake && draft
      ? [
          {
            label: "Delete the draft",
            danger: true,
            onClick: () =>
              ask(
                { question: `Delete the draft of the ${r.label.toLowerCase()} (version ${r.version})? Version ${(r.version ?? 2) - 1} stays.`, confirmLabel: "Delete the draft", danger: true },
                () => act("delete"),
              ),
          },
        ]
      : []),
  ];
  return (
    <>
      <DocWindow
        kind="order"
        title={r.label}
        number={r.number}
        state={state}
        sub={[props.order.refNo, props.order.customer, `from the ${FLOW_STEP_LABEL[r.step]} step`, paper.note].filter(Boolean).join(" · ")}
        items={w.items}
        at={w.at}
        itemsLabel="This order's documents"
        download={{ href: paper.pdf, word: "Download PDF" }}
        onPrint={paper.print}
        more={more}
        onClose={w.close}
        stage={paper.stage(`${r.label} as it prints`)}
        view={paper.view}
        panel={{
          label: issued ? "About it" : "Make it",
          tabs: issued
            ? [{ key: "details", label: "Details" }]
            : [
                { key: "make", label: kind === "proforma" && !draft ? "Issue" : "Make" },
                { key: "details", label: "Details" },
              ],
          tab,
          onTab: setTab,
          body: tab === "make" ? makeBody : detailsBody,
          foot,
          bar: { text: <>{state.word} · {r.sub}</>, state: state.state },
        }}
      />
      {dialog}
    </>
  );
}

/* ---------------------------------------------------------------- the quotation the order was made from */

function QuotationWindow(props: OrderWindowProps & { doc: Extract<OrderDocItem, { type: "quotation" }> }) {
  const { row: r } = props.doc;
  const w = useOrderWindow(props);
  const view = new URL(r.links?.view ?? "/", "http://x");
  view.searchParams.delete("back");
  view.searchParams.set("embed", "1");
  const paper = usePaper(view.pathname + view.search, r.links?.pdf ?? "", { copy: props.look.copy, lang: props.look.lang });
  const send = useOrderPair(props, { key: r.key, name: `${r.label}.pdf`, detail: paper.detail, view: r.links?.view ?? null, download: paper.pdf, paper: r.key }, r.label);
  const [tab, setTab] = useTab("details");
  return (
    <DocWindow
      kind="order"
      title={r.label}
      state={{ state: "final", word: "Accepted" }}
      sub={[props.order.refNo, props.order.customer, "the quotation the order was made from"].join(" · ")}
      items={w.items}
      at={w.at}
      itemsLabel="This order's documents"
      download={{ href: paper.pdf, word: "Download PDF" }}
      onPrint={paper.print}
      more={[
        ...(paper.excel ? [{ label: "Download Excel", onClick: () => saveHref(paper.excel!) }] : []),
        { label: "Open in a new tab", onClick: paper.alone },
      ]}
      onClose={w.close}
      stage={paper.stage(`${r.label} as it prints`)}
      view={paper.view}
      panel={{
        label: "About it",
        tabs: [{ key: "details", label: "Details" }],
        tab,
        onTab: setTab,
        body: (
          <Facts
            rows={[
              ["What it is", "The quotation the customer accepted; the order was made from it"],
              ["For", props.order.customer],
              ["Order", props.order.refNo],
            ]}
          />
        ),
        foot: send.foot,
        bar: { text: <>Details · the quotation the order was made from</> },
      }}
    />
  );
}

/* ---------------------------------------------------------------- a paper others issue (uploaded, or needed) */

function UploadWindow(props: OrderWindowProps & { doc: Extract<OrderDocItem, { type: "upload" }> }) {
  const { row: r, canRecord, add, update, dealId, today, shipNumber } = props.doc;
  const w = useOrderWindow(props);
  const tools = useFileTools();
  const { date, dateTime } = useTime();
  const pdfFrame = useRef<HTMLIFrameElement>(null);
  const file = r.doc?.file ? (tools?.files.find((f) => f.sourceId === r.doc!.file!.id) ?? null) : null;
  const needed = !file && (r.state === "miss" || r.state === "draft");
  const kept = r.state === "else";
  const [zoom, setZoom] = useState<number | null>(null);
  // Upload or Kept elsewhere, in the panel: open on a needed paper; a new state (saved) puts it away.
  const [recordFor, setRecordFor] = useState<{ state: string; mode: "upload" | "elsewhere" | null }>({ state: r.state, mode: needed && canRecord ? "upload" : null });
  const record = recordFor.state === r.state ? recordFor.mode : needed && canRecord ? "upload" : null;
  const setRecord = (mode: "upload" | "elsewhere" | null) => setRecordFor({ state: r.state, mode });
  const viewFile = file ? { key: file.id, name: file.name, href: file.href, viewHref: file.viewHref, type: file.type, size: file.size } : null;
  const kind = viewFile ? kindOf(viewFile) : "other";
  const send = useOrderPair(
    props,
    {
      key: r.key,
      name: file?.name ?? r.label,
      detail: file ? `${fileSize(file.size)} · ${(file.name.split(".").pop() ?? "").toUpperCase()}` : null,
      view: file?.viewHref ?? null,
      download: file?.href ?? "",
      file: file?.id ?? null,
    },
    [r.label, r.number].filter(Boolean).join(" "),
    undefined,
    "the",
  );
  const [tab, setTab] = useTab(record ? "record" : "details");
  const prefilled = { ...r, number: r.number ?? ((r.docKind === "bill_of_lading" || r.docKind === "airway_bill") && shipNumber ? shipNumber : null) };

  const state: { state: DocState; word: string } = file
    ? { state: "file", word: `Uploaded · ${kind === "image" ? "Photo" : (file.name.split(".").pop() ?? "File").toUpperCase()}` }
    : kept
      ? { state: "final", word: "Kept elsewhere" }
      : needed
        ? { state: "needed", word: "Needed" }
        : { state: "final", word: "Recorded" };

  const details = (
    <div className="flex flex-col gap-5">
      <Facts
        rows={[
          ["What it is", r.label],
          ["Number", r.number ?? "—"],
          ...(r.doc?.issuedOn ? [["Date", date(r.doc.issuedOn)] as [string, ReactNode]] : []),
          ...(kept ? [["Kept", r.doc?.keptWhere || "elsewhere"] as [string, ReactNode]] : []),
          ...(file
            ? ([
                ["File", `${file.name} · ${fileSize(file.size)}`],
                ["Added", `${file.by?.name ?? "System"} · ${dateTime(file.at)}`],
              ] as [string, ReactNode][])
            : []),
          ["Step", FLOW_STEP_LABEL[r.step]],
        ]}
      />
      {r.sub && !kept && <p className="text-md text-text-2">{r.sub}</p>}
      {!!file?.versions.length && (
        <section aria-label="Earlier versions">
          <h3 className={capsClass}>Earlier versions</h3>
          <ul className="mt-2 flex flex-col gap-1.5 text-md">
            {file.versions.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate">
                  v{v.version} · {v.name}
                </span>
                <a href={v.href} download className={cn(linkClass, "shrink-0")}>
                  Download
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
  const recordBody = record && (
    <RecordForm
      r={prefilled}
      mode={record}
      dealId={dealId}
      add={add}
      update={r.doc ? update : undefined}
      today={today}
      onDone={() => setRecord(null)}
      send={async (f) => {
        const res = await uploadToOrder(props.order.id, f, { step: r.step });
        return { id: res.sourceId, error: res.error };
      }}
    />
  );
  const tabs = record
    ? [{ key: "record", label: record === "upload" ? "Upload it" : "Kept elsewhere" }]
    : [{ key: "details", label: "Details" }];
  const openTab = tabs.some((t) => t.key === tab) ? tab : tabs[0]!.key;
  const foot = record ? null : needed && canRecord ? (
    <Button variant="primary" onClick={() => setRecord("upload")}>
      Upload
    </Button>
  ) : file ? (
    send.foot
  ) : null;
  const more: WindowAction[] = [
    ...(file?.can.replace ? [{ label: "Replace file…", hint: "keeps this one as an earlier version", onClick: () => tools?.open({ kind: "replace", file }) }] : []),
    ...(file?.can.rename ? [{ label: "Rename", onClick: () => tools?.open({ kind: "rename", file }) }] : []),
    ...(canRecord && needed && record !== "elsewhere" ? [{ label: "Kept elsewhere…", hint: "no file in the app; counts as done", onClick: () => setRecord("elsewhere") }] : []),
    ...(canRecord && kept ? [{ label: "Upload it instead", onClick: () => setRecord("upload") }] : []),
    ...(file ? [{ label: "Open in a new tab", onClick: () => window.open(file.viewHref ?? file.href, "_blank", "noopener") }] : []),
    ...(file?.can.remove ? [{ label: "Delete", danger: true, onClick: () => tools?.open({ kind: "delete", files: [file] }) }] : []),
  ];

  return (
    <DocWindow
      kind="order"
      title={r.label}
      number={r.number}
      state={state}
      sub={[props.order.refNo, props.order.customer, `on the ${FLOW_STEP_LABEL[r.step]} step`].join(" · ")}
      icon={kind === "image" ? "image" : "file"}
      items={w.items}
      at={w.at}
      itemsLabel="This order's documents"
      download={file ? { href: file.href, word: "Download", name: file.name } : null}
      onPrint={
        file && kind === "image" ? () => printImage(file.viewHref ?? file.href, file.name) : file && kind === "pdf" ? () => pdfFrame.current?.contentWindow?.print() : null
      }
      more={more}
      onClose={w.close}
      stage={
        viewFile ? (
          <FileStage file={viewFile} kind={kind} src={viewFile.viewHref ?? viewFile.href} zoom={zoom} frame={pdfFrame} />
        ) : kept ? (
          <StageCard title="Kept elsewhere">
            {r.doc?.keptWhere ? `${r.doc.keptWhere}. ` : ""}No file is kept in the app; it counts as done.
          </StageCard>
        ) : needed ? (
          <StageCard title={`The ${r.label.replace(/ \(.*\)$/, "").toLowerCase()} is not here yet`}>
            {canRecord ? "Upload it with its number and date: on the right, or below on a phone." : "Someone with the “Documents and bank” permission uploads it."}
          </StageCard>
        ) : (
          <StageCard title="Recorded">No file was kept with it.</StageCard>
        )
      }
      view={viewFile && kind === "image" ? { zoom: { value: zoom, shown: zoom ?? 1, set: setZoom } } : null}
      panel={{
        label: record ? "Upload it" : "About it",
        tabs,
        tab: openTab,
        onTab: setTab,
        body: openTab === "record" ? recordBody : details,
        foot,
        bar: record
          ? { text: <>{record === "upload" ? "Upload it" : "Kept elsewhere"} · the file, its number and date</>, state: "needed" }
          : { text: <>{state.word} · {r.label}</>, state: state.state },
      }}
    />
  );
}
