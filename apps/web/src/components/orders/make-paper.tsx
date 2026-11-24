"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Copy, Download, FileText, Mail, MessageCircle, Minus, MoreHorizontal, Plus, Printer, RefreshCw, Send, Share2, X } from "lucide-react";
import { FLOW_STEP_LABEL, inSentence, paperOptionsQuery, type PaperCheck } from "@kebo/shared";
import { Badge, Button, buttonClass, cn, Input, controlClass, controlSizes, Notice, chipClass, linkClass, capsClass } from "@kebo/ui";
import { toast } from "@kebo/ui/client";
import { Switch } from "@/components/common/switch-list";
import { FloatingMenu } from "@/components/common/floating";
import { lockScroll } from "@/lib/scroll-lock";
import type { ActionState } from "@/lib/actions";
import type { PaperChecks } from "@/lib/types-papers";
import type { PaperOp } from "@/app/(app)/orders/papers-actions";
import { useTime } from "@/lib/time-client";

/** paperAction bound to the order, the paper and its ref: (op, paper id, …). */
export type PaperRun = (op: PaperOp, paperId: string | null, prev: ActionState, form: FormData) => Promise<ActionState>;

const menuItem = "flex min-h-10 w-full items-center rounded-md px-3 text-left text-md hover:bg-surface-2 focus:bg-surface-2 focus:outline-none";

/** The sheet's own width on screen (A4 at 96 dpi with the desk around it): "Fit width" zooms it to the stage. */
const SHEET = 860;

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
  hsLines: { id: string; description: string }[];
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
  const href = !c.ok && c.href ? (c.href.startsWith("/") ? c.href : `${base}/${c.href}`) : null;
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

/**
 * The Make page (board OrderV3MakePaper): on the left what the paper takes from
 * the order — missing data typed right there and saved where it belongs —, its
 * options and Make final / Save as draft; on the right the paper itself in our
 * document template, with the usual View / Print and Download PDF buttons.
 * On a phone the checks come first and the preview under them.
 */
export function MakePaper({
  p,
  run,
  base,
  backHref,
  send,
}: {
  p: PaperChecks;
  run: PaperRun;
  base: string;
  backHref: string;
  send?: { email: string | null; phone: string | null; text: string; subject: string };
}) {
  const { date } = useTime();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [opts, setOpts] = useState<Record<string, boolean>>(Object.fromEntries(p.options.map((o) => [o.key, o.on])));
  const [reload, setReload] = useState(0);
  const [sheet, setSheet] = useState(false);
  const [more, setMore] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const uid = useId();
  const final = p.paper?.status === "final";
  const draft = p.paper?.status === "draft";
  const editing = !final && p.canMake;
  // "prices,stamp,-terms": an option named is on; a part of the paper named with a minus is hidden.
  const optList = paperOptionsQuery(opts);

  const q = new URLSearchParams(p.ref ? { ref: p.ref } : {});
  const pdf = `/pdf/${p.kind}/${p.orderId}${q.size ? `?${q}` : ""}`;
  const preview = useMemo(() => {
    const s = new URLSearchParams({ embed: "1", ...(p.ref ? { ref: p.ref } : {}), ...(final ? {} : { opts: optList }), r: String(reload) });
    return `/print/orders/${p.orderId}/${p.kind}?${s}`;
  }, [p.orderId, p.kind, p.ref, final, optList, reload]);

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
    // Once final, the side says "Made final · the date" above Send it: no second "Made final" notice (e2e 24 Nov).
    if (id) await call("final", id, { options: opts });
  };

  const required = p.checks.filter((c) => c.required && !c.ok);
  const missing = p.checks.filter((c) => !c.ok);
  const done = p.checks.length - missing.length;
  const stepHref = `${base}/${p.step === "factory" ? "factory" : p.step}`;
  const status = final ? "Final" : draft ? "Draft" : null;
  const sub = [
    p.paper && p.versions.length > 1 ? `Version ${p.paper.version}` : null,
    `From the ${FLOW_STEP_LABEL[p.step]} step`,
    p.refNo,
    p.buyer?.buyer.name ?? null,
  ]
    .filter(Boolean)
    .join(" · ");

  const close = () => router.push(backHref);
  // Esc closes; the order page under it stays still.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("[role=dialog] [role=dialog], [role=menu]")) close();
    };
    window.addEventListener("keydown", key);
    const unlock = lockScroll();
    return () => {
      window.removeEventListener("keydown", key);
      unlock();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- close only reads backHref
  }, [backHref]);

  const printIt = () => frame.current?.contentWindow?.print();
  const message =
    send?.text ??
    `Dear ${p.buyer?.buyer.name ?? "Sir/Madam"},\n\nPlease find attached our ${p.label.toLowerCase()} ${p.number} for order ${p.refNo}.\n\nBest regards,`;

  /* ------------------------------------------------ the side: what it takes, or (final) send it */
  const side = (
    <div className="flex flex-col gap-4">
      {error && <Notice tone="bad">{error}</Notice>}
      {notice && <Notice tone="ok">{notice}</Notice>}

      {p.factories && p.factories.length > 1 && (
        <nav aria-label="Supplier" className="flex flex-wrap gap-1.5">
          {p.factories.map((f) => (
            <Link
              key={f.id}
              href={`${base}/papers/${p.kind}?ref=${f.id}`}
              aria-current={p.ref === f.id ? "page" : undefined}
              className={chipClass(p.ref === f.id)}
            >
              {f.name}
            </Link>
          ))}
        </nav>
      )}

      {final ? (
        <SendIt p={p} pdf={pdf} message={message} send={send} date={date} />
      ) : (
        <section aria-labelledby="filled">
          <div className="flex items-baseline justify-between gap-3">
            <h3 id="filled" className={capsClass}>
              {p.canMake ? "Before it is final" : "Filled from the order"}
            </h3>
            <span className={cn("text-md font-semibold", missing.length ? "text-action" : "text-ok")}>
              {missing.length ? `${missing.length} to fill` : "Ready"}
            </span>
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
                base={base}
                pending={pending}
                onFix={(field, value, lineId) => call("fix", null, { field, value, ...(lineId ? { lineId } : {}) })}
              />
            ))}
          </ul>
        </section>
      )}

      {!final && (
        <BuyerBox p={p} editing={p.canRefreshBuyer} pending={pending} onRefresh={async (reason) => !!(await call("buyer", null, { reason })).ok} />
      )}
      {!final && <TermsBox p={p} />}

      {editing && p.options.length > 0 && (
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

      {p.live ? (
        <p className="text-xs text-muted">Printed from the data whenever it is opened: nothing to make final.</p>
      ) : p.kind === "payment-request" || p.kind === "payment-receipt" ? (
        <p className="text-xs text-muted">
          {p.kind === "payment-request"
            ? "Kept as sent: send it from the order's Payment step (Send request). Nothing to make here."
            : "Kept when its payment was recorded: nothing to make here."}
        </p>
      ) : !p.canMake ? (
        <p className="text-xs text-muted">You can see this document; making it needs the &ldquo;Documents and bank&rdquo; permission.</p>
      ) : final ? (
        <div className="flex flex-col gap-1.5">
          <Button variant="secondary" disabled={pending} onClick={() => call("again", null, {})}>
            {pending ? "Starting…" : `Make again (version ${p.paper!.version + 1})`}
          </Button>
          <p className="text-xs text-muted">
            If the order changes, version {p.paper!.version + 1} starts as a draft; version {p.paper!.version} stays as it was
            {p.paper!.finalAt ? ` made final on ${date(p.paper!.finalAt)}` : ""}.
          </p>
        </div>
      ) : (
        !p.ready &&
        required.length > 0 && <p className="text-xs text-action">Still needed before Make final: {required.map((c) => inSentence(c.label)).join(", ")}.</p>
      )}

      {p.versions.length > 1 && (
        <section aria-labelledby="versions">
          <h3 id="versions" className={capsClass}>
            Versions
          </h3>
          <ul className="mt-1 flex flex-col divide-y divide-line text-sm">
            {p.versions.map((v) => (
              <li key={v.id} className="flex min-h-10 items-center justify-between gap-2">
                <span>
                  Version {v.version} · {v.status === "final" ? `final${v.finalAt ? ` ${date(v.finalAt)}` : ""}` : "draft"}
                </span>
                {v.id === p.paper?.id ? (
                  <span className="text-xs font-semibold text-ok">Showing</span>
                ) : (
                  <a
                    href={`/print/orders/${p.orderId}/${p.kind}?${new URLSearchParams({ v: String(v.version), ...(p.ref ? { ref: p.ref } : {}) })}`}
                    data-file-name={`${p.label} · version ${v.version}`}
                    className={linkClass}
                  >
                    View
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );

  const makeButtons = editing && !p.live && p.kind !== "payment-request" && p.kind !== "payment-receipt" && (
    <>
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() => call("draft", null, { options: opts }).then((r) => r.ok && setNotice("Saved as a draft."))}
        className="max-sm:flex-1"
      >
        Save as draft
      </Button>
      <Button
        variant="primary"
        disabled={pending || !p.ready}
        onClick={makeFinal}
        title={p.ready ? undefined : `Still needed: ${required.map((c) => inSentence(c.label)).join(", ")}`}
        className="max-sm:flex-1"
      >
        {pending ? "Saving…" : "Make final"}
      </Button>
    </>
  );

  return (
    <div className="fixed inset-0 z-[70] flex" data-make-window="">
      <button type="button" tabIndex={-1} aria-label="Close" className="absolute inset-0 bg-black/50" onClick={close} />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${uid}-t`}
        className="relative flex w-full flex-col overflow-hidden bg-surface shadow-pop sm:m-6 sm:rounded-2xl"
      >
        {/* Head: what it is, where it comes from; Download PDF, Print, then Save as draft and Make final (design 21 Nov). */}
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line pr-1 pl-1 sm:h-16 sm:gap-3 sm:pr-3 sm:pl-5">
          <Button size="icon" variant="ghost" aria-label="Close" onClick={close} className="sm:hidden">
            <X aria-hidden />
          </Button>
          <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-primary-soft text-primary max-sm:hidden">
            <FileText className="size-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={`${uid}-t`} className="flex min-w-0 items-center gap-2 text-base font-semibold max-sm:font-bold">
              <span className="truncate">
                {p.label}
                <span className="max-sm:hidden"> {p.number}</span>
              </span>
              {status && <Badge tone={final ? "ok" : "info"}>{status}</Badge>}
            </h2>
            <p className="truncate text-xs text-muted sm:text-md">
              <span className="sm:hidden">{p.number} · </span>
              {sub}
            </p>
          </div>
          <div className="flex items-center gap-2 max-sm:hidden">
            <a href={pdf} className={buttonClass("secondary", "md")}>
              <Download aria-hidden /> Download PDF
            </a>
            <Button variant={final ? "primary" : "secondary"} onClick={printIt}>
              <Printer aria-hidden /> Print
            </Button>
            {makeButtons && <span aria-hidden className="mx-1 h-6 w-px bg-line" />}
            {makeButtons}
          </div>
          <button
            ref={moreRef}
            type="button"
            aria-label="More"
            aria-haspopup="menu"
            aria-expanded={more}
            onClick={() => setMore((m) => !m)}
            className={cn(buttonClass("secondary", "icon"), "max-sm:border-0 max-sm:shadow-none")}
          >
            <MoreHorizontal aria-hidden />
          </button>
          {more && (
            <FloatingMenu anchor={() => moreRef.current} onClose={() => setMore(false)} label="More">
              <a role="menuitem" href={pdf} className={menuItem} onClick={() => setMore(false)}>
                Download PDF
              </a>
              <button
                type="button"
                role="menuitem"
                className={menuItem}
                onClick={() => {
                  setMore(false);
                  printIt();
                }}
              >
                Print
              </button>
              <Link role="menuitem" href={stepHref} className={menuItem}>
                Back to {FLOW_STEP_LABEL[p.step]}
              </Link>
            </FloatingMenu>
          )}
          <Button size="icon-sm" variant="ghost" aria-label="Close (Esc)" onClick={close} className="max-sm:hidden">
            <X aria-hidden />
          </Button>
        </header>

        <div className="flex min-h-0 flex-1">
          <aside aria-label={final ? "Send it" : "What it takes"} className="w-[368px] shrink-0 scroll-y border-r border-line px-5 py-4 max-lg:w-80 max-sm:hidden">
            {side}
          </aside>
          <Stage src={preview} title={`${p.label} preview`} frame={frame} live={!final} />
        </div>

        {/* Phone: what is missing (or Send it), then Save / Make final; the side opens as a sheet. */}
        <div className="shrink-0 border-t border-line bg-surface sm:hidden">
          <button
            type="button"
            onClick={() => setSheet(true)}
            className={cn("flex min-h-12 w-full items-center gap-2.5 px-4 text-left text-sm", missing.length && !final ? "bg-action-soft" : "")}
          >
            {final ? (
              <>
                <Send className="size-4 text-primary" aria-hidden /> <span className="flex-1 font-semibold">Send it to the customer</span>
              </>
            ) : missing.length ? (
              <>
                <span className="grid size-5 place-items-center rounded-full bg-action text-2xs font-bold text-white">{missing.length}</span>
                <span className="flex-1">
                  <b>{missing.length} to fill</b> · {missing.map((c) => inSentence(c.label)).join(", ")}
                </span>
              </>
            ) : (
              <>
                <Check className="size-4 text-ok" strokeWidth={3} aria-hidden /> <span className="flex-1">Ready · what it takes and what shows</span>
              </>
            )}
            <span className="font-semibold text-primary">{final ? "Open" : missing.length ? "Fill" : "See"}</span>
          </button>
          {makeButtons && <div className="flex gap-2 border-t border-line px-3 pt-2.5 pb-[max(0.875rem,env(safe-area-inset-bottom))]">{makeButtons}</div>}
        </div>
        {sheet && (
          <div className="absolute inset-0 z-10 flex flex-col justify-end sm:hidden">
            <button type="button" aria-label="Close" tabIndex={-1} className="absolute inset-0 bg-black/45" onClick={() => setSheet(false)} />
            <div role="dialog" aria-label={final ? "Send it" : "Before it is final"} className="relative max-h-[80%] scroll-y rounded-t-2xl bg-surface px-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-pop">
              <div aria-hidden className="mx-auto mt-2 mb-1 h-1 w-10 rounded-full bg-line-strong" />
              <div className="flex justify-end">
                <Button size="icon" variant="ghost" aria-label="Close" onClick={() => setSheet(false)}>
                  <X aria-hidden />
                </Button>
              </div>
              {side}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

/** The page itself, on grey, as large as the stage fits (or zoomed); it scrolls inside its own frame. */
function Stage({ src, title, frame, live }: { src: string; title: string; frame: React.RefObject<HTMLIFrameElement | null>; live: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const [fit, setFit] = useState(1);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setFit(Math.max(0.3, Math.min(1, (el.clientWidth - 16) / SHEET)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = zoom ?? fit;
  // The sheet inside the frame is zoomed (the page is ours: same site), so the frame's own scroll is the only one.
  const apply = useCallback(() => {
    frame.current?.contentDocument?.documentElement.style.setProperty("zoom", String(scale));
  }, [frame, scale]);
  useEffect(apply, [apply]);
  const step = (d: number) => setZoom(Math.min(2, Math.max(0.3, Math.round((scale + d) * 20) / 20)));
  return (
    <div ref={box} className="relative min-w-0 flex-1 bg-surface-3">
      <iframe ref={frame} src={src} title={title} onLoad={apply} className="absolute inset-0 size-full border-0" />
      <span className="pointer-events-none absolute top-3 right-4 inline-flex items-center gap-1.5 rounded-full border border-line bg-surface/90 px-2.5 py-1 text-xs text-text-2 max-sm:hidden">
        <span aria-hidden className={cn("size-1.5 rounded-full", live ? "bg-ok" : "bg-muted")} />
        {live ? "Live · updates as you change it" : "As it was made final"}
      </span>
      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border border-line bg-surface p-1 shadow-pop max-sm:hidden">
        <Button size="icon-sm" variant="ghost" aria-label="Zoom out" onClick={() => step(-0.1)}>
          <Minus aria-hidden />
        </Button>
        <span className="min-w-[52px] text-center text-md font-semibold tabular">{Math.round(scale * 100)}%</span>
        <Button size="icon-sm" variant="ghost" aria-label="Zoom in" onClick={() => step(0.1)}>
          <Plus aria-hidden />
        </Button>
        <span aria-hidden className="mx-1 h-5 w-px bg-line" />
        <Button size="sm" variant="ghost" aria-pressed={zoom === null} onClick={() => setZoom(null)}>
          Fit width
        </Button>
      </div>
    </div>
  );
}

/** Made final: send it to the customer — WhatsApp, email, the share sheet with the PDF, or the text to paste. */
function SendIt({
  p,
  pdf,
  message: first,
  send,
  date,
}: {
  p: PaperChecks;
  pdf: string;
  message: string;
  send?: { email: string | null; phone: string | null; text: string; subject: string };
  date: (d: string) => string;
}) {
  const [message, setMessage] = useState(first);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const name = `${p.label} ${p.number}.pdf`;
  const subject = send?.subject ?? `${p.label} ${p.number} · order ${p.refNo}`;
  const download = () => {
    const a = document.createElement("a");
    a.href = pdf;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  const sheet = typeof navigator !== "undefined" && "canShare" in navigator && navigator.canShare({ files: [new File([""], "x.pdf", { type: "application/pdf" })] });
  const phone = typeof window !== "undefined" && window.matchMedia("(max-width: 639px), (pointer: coarse)").matches;
  const viaSheet = async () => {
    setBusy(true);
    try {
      const res = await fetch(pdf);
      if (!res.ok) throw new Error(`The PDF could not be made (${res.status}).`);
      const file = new File([await res.blob()], name, { type: "application/pdf" });
      await navigator.share({ files: [file], title: subject, text: message });
      toast("Shared.");
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) toast({ message: e instanceof Error ? e.message : "Could not share it.", kind: "fail" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-labelledby={`${id}-s`} className="flex flex-col gap-3">
      <div className="flex items-start gap-2.5 rounded-xl bg-ok-soft px-3.5 py-3 text-sm text-ok">
        <Check className="mt-0.5 size-4 shrink-0" strokeWidth={3} aria-hidden />
        <span>
          <b>Made final</b>
          {p.paper?.finalAt ? ` · ${date(p.paper.finalAt)}` : ""}. The number is locked and it stays as it was made.
        </span>
      </div>
      <div>
        <h3 id={`${id}-s`} className={capsClass}>
          Send it to the customer
        </h3>
        {send?.email || send?.phone ? <p className="mt-0.5 text-xs text-muted">To {[send.email, send.phone].filter(Boolean).join(" · ")}</p> : null}
      </div>
      <label htmlFor={`${id}-m`} className="sr-only">
        Message
      </label>
      <textarea
        id={`${id}-m`}
        rows={7}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        className={cn(controlClass, "h-auto py-2 text-sm leading-relaxed")}
      />
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => {
            if (phone && sheet) return void viaSheet();
            download();
            window.open(`https://wa.me/${(send?.phone ?? "").replace(/\D/g, "")}?text=${encodeURIComponent(message)}`, "_blank", "noopener");
            toast(`${name} downloaded: attach it in WhatsApp (the 📎).`);
          }}
        >
          <MessageCircle aria-hidden /> WhatsApp
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => {
            if (phone && sheet) return void viaSheet();
            download();
            window.location.assign(`mailto:${send?.email ?? ""}?${new URLSearchParams({ subject, body: message }).toString().replace(/\+/g, "%20")}`);
            toast(`${name} downloaded: attach it to the email.`);
          }}
        >
          <Mail aria-hidden /> Email
        </Button>
        {sheet && (
          <Button variant="secondary" disabled={busy} onClick={() => void viaSheet()}>
            <Share2 aria-hidden /> {busy ? "Preparing…" : "Share sheet…"}
          </Button>
        )}
        <Button
          variant="secondary"
          onClick={() => {
            void navigator.clipboard?.writeText(message).then(
              () => toast("Text copied."),
              () => toast("Could not copy the text."),
            );
          }}
        >
          <Copy aria-hidden /> Copy text
        </Button>
      </div>
      <p className="text-xs text-muted">On a phone WhatsApp and Email send the PDF itself; on a computer it downloads, to attach. The app sends nothing itself.</p>
    </section>
  );
}
