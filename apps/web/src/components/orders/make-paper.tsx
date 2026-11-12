"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Copy, Mail, MessageCircle, RefreshCw, X } from "lucide-react";
import { FLOW_STEP_LABEL, inSentence, type PaperCheck } from "@kebo/shared";
import { Alert, Badge, Button, buttonClass, Card, Checkbox, cn, Input } from "@kebo/ui";
import { FileActions } from "@/components/common/file-actions";
import type { ActionState } from "@/lib/actions";
import type { PaperChecks } from "@/lib/types-papers";
import type { PaperOp } from "@/app/(app)/orders/papers-actions";

/** paperAction bound to the order, the paper and its ref: (op, paper id, …). */
export type PaperRun = (op: PaperOp, paperId: string | null, prev: ActionState, form: FormData) => Promise<ActionState>;

/** "02 Nov 2026" in the person's own time zone. */
const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

/** The sheet's own width (A4 at 96 dpi plus a margin): the preview is scaled down to fit. */
const SHEET = 860;
const SHEET_HEIGHT = 1180;

/** The preview in our document template: the print page in a frame, scaled to the column's width. */
function Preview({ src, title }: { src: string; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.6);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, el.clientWidth / SHEET));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div
      ref={box}
      className="relative w-full overflow-hidden rounded-lg border border-line bg-[#e7ebf0]"
      style={{ height: SHEET_HEIGHT * scale }}
    >
      <iframe
        title={title}
        src={src}
        className="absolute top-0 left-0 origin-top-left border-0"
        style={{ width: SHEET, height: SHEET_HEIGHT, transform: `scale(${scale})` }}
      />
    </div>
  );
}

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
  const mark = c.ok ? (
    <Check className="size-4 shrink-0 text-ok" strokeWidth={3} aria-label="From the order" />
  ) : (
    <span
      role="img"
      className={cn("mx-1 block size-2.5 shrink-0 rounded-full", c.required ? "bg-[#9a3412]" : "bg-warn")}
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
              if (v.trim()) onFix(c.fix!, v.trim());
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
              placeholder="Add it here"
              className="h-8 w-36 min-w-0 rounded-md border-[1.5px] border-primary/60 bg-surface px-2.5 text-sm focus:border-primary focus:outline-none focus-visible:ring-3 focus-visible:ring-ring"
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
              <Link href={href} className="font-medium text-primary hover:underline">
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
                  if (hs[l.id]?.trim()) onFix("hs", hs[l.id]!.trim(), l.id);
                }}
              >
                <label htmlFor={`${id}-${l.id}`} className="min-w-0 flex-1 truncate text-text-2">
                  {l.description}
                </label>
                <input
                  id={`${id}-${l.id}`}
                  value={hs[l.id] ?? ""}
                  onChange={(e) => setHs((x) => ({ ...x, [l.id]: e.target.value }))}
                  placeholder="e.g. 8422.40"
                  inputMode="decimal"
                  className="h-7 w-28 rounded-md border border-line-strong bg-surface px-2 text-xs focus:border-primary focus:outline-none focus-visible:ring-3 focus-visible:ring-ring"
                />
                {hs[l.id]?.trim() && (
                  <Button type="submit" size="xs" variant="secondary" disabled={pending}>
                    Save
                  </Button>
                )}
              </form>
            </li>
          ))}
          <li className="text-xs text-muted">Saved on the order&apos;s line, so every paper has it.</li>
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
            Papers made from now on print the customer as it is now. Papers already made final keep the buyer they were printed with.
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
            placeholder="e.g. The customer moved to a new address"
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
  const [open, setOpen] = useState(false);
  if (!p.buyer) return null;
  const { buyer: b, changes } = p.buyer;
  const numbers = [b.taxNo ? `Tax no. ${b.taxNo}` : null, b.regNo ? `Reg. no. ${b.regNo}` : null].filter(Boolean).join(" · ");
  return (
    <section aria-labelledby="buyer" className="rounded-lg border border-line p-3">
      <div className="flex items-center justify-between gap-3">
        <h3 id="buyer" className="text-[11px] font-semibold tracking-wide text-muted uppercase">
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
        <p className="mt-2 text-xs text-[#9a3412]">
          The customer&apos;s {changes.join(", ")} changed since. This paper prints the buyer as on the order until it is refreshed.
        </p>
      ) : (
        <p className="mt-2 text-xs text-muted">
          {b.from === "customer" ? "Refreshed from the customer" : "Taken when the order was made"}
          {b.takenOn ? ` · ${when(b.takenOn)}` : ""} · the same as the customer now.
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
function TermsBox({ p, editing, pending, onChange }: { p: PaperChecks; editing: boolean; pending: boolean; onChange: (print: boolean) => void }) {
  const t = p.terms;
  // Ticked at once while it is saved; then as saved.
  const [mine, setMine] = useState<boolean | null>(null);
  const on = pending && mine !== null ? mine : !!t?.printed;
  if (!t) return null;
  return (
    <section aria-labelledby="terms" className="rounded-lg border border-warn/40 bg-warn-soft p-3">
      <h3 id="terms" className="text-[11px] font-semibold tracking-wide text-muted uppercase">
        Payment terms
      </h3>
      <p className="mt-1 text-sm">
        The quotation said <q className="font-medium">{t.quoted.split(/\r?\n/)[0]!.replace(/[\s.;,]+$/, "")}</q>; the route is now{" "}
        <strong>{t.route}</strong>.
      </p>
      <p className="mt-0.5 text-xs text-text-2">The paper words the payment terms from the route.</p>
      <label className="mt-2 flex items-center gap-2.5 text-sm">
        <Checkbox
          checked={on}
          disabled={!editing || pending}
          onChange={(e) => {
            setMine(e.target.checked);
            onChange(e.target.checked);
          }}
        />
        Print the quotation&apos;s text too
      </label>
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
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [opts, setOpts] = useState<Record<string, boolean>>(Object.fromEntries(p.options.map((o) => [o.key, o.on])));
  const [reload, setReload] = useState(0);
  const [copied, setCopied] = useState(false);
  const final = p.paper?.status === "final";
  const draft = p.paper?.status === "draft";
  const editing = !final && p.canMake;
  const optList = Object.entries(opts)
    .filter(([, on]) => on)
    .map(([k]) => k)
    .join(",");

  const q = new URLSearchParams(p.ref ? { ref: p.ref } : {});
  const view = `/print/orders/${p.orderId}/${p.kind}?${new URLSearchParams({ ...(p.ref ? { ref: p.ref } : {}), back: `${base}/papers/${p.kind}${p.ref ? `?ref=${p.ref}` : ""}` })}`;
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
    if (id) {
      const r = await call("final", id, { options: opts });
      if (r.ok) setNotice(`Made final: ${p.number}.`);
    }
  };

  const required = p.checks.filter((c) => c.required && !c.ok);
  const stepHref = `${base}/${p.step === "factory" ? "factory" : p.step}`;

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
      <Card className="flex flex-col gap-4 p-4 sm:p-5">
        <div>
          <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold">
            {final ? p.label : `Make the ${p.label.charAt(0).toLowerCase()}${p.label.slice(1)}`}
            {p.paper && (
              <Badge tone={final ? "ok" : "info"}>
                {final ? "Final" : "Draft"}
                {p.versions.length > 1 ? ` · version ${p.paper.version}` : ""}
              </Badge>
            )}
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            From the{" "}
            <Link href={stepHref} className="hover:underline">
              {FLOW_STEP_LABEL[p.step]}
            </Link>{" "}
            step · filled from {p.refNo} · <span className="tabular">{p.number}</span>
          </p>
        </div>

        {p.factories && p.factories.length > 1 && (
          <nav aria-label="Factory" className="flex flex-wrap gap-1.5">
            {p.factories.map((f) => (
              <Link
                key={f.id}
                href={`${base}/papers/${p.kind}?ref=${f.id}`}
                aria-current={p.ref === f.id ? "page" : undefined}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs",
                  p.ref === f.id ? "border-primary bg-primary-soft text-primary" : "border-line text-text-2",
                )}
              >
                {f.name}
              </Link>
            ))}
          </nav>
        )}

        {error && <Alert tone="error">{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}

        <section aria-labelledby="filled">
          <h3 id="filled" className="text-[11px] font-semibold tracking-wide text-muted uppercase">
            Filled from the order
          </h3>
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

        <BuyerBox
          p={p}
          editing={!final && p.canRefreshBuyer}
          pending={pending}
          onRefresh={async (reason) => !!(await call("buyer", null, { reason })).ok}
        />
        <TermsBox p={p} editing={p.canRefreshBuyer && !final} pending={pending} onChange={(print) => call("quotedTerms", null, { print })} />

        {editing && p.options.length > 0 && (
          <fieldset>
            <legend className="text-[11px] font-semibold tracking-wide text-muted uppercase">Options</legend>
            <div className="mt-1.5 flex flex-col gap-2">
              {p.options.map((o) => (
                <label key={o.key} className="flex items-center gap-2.5 text-sm">
                  <Checkbox checked={!!opts[o.key]} onChange={(e) => setOpts((x) => ({ ...x, [o.key]: e.target.checked }))} />
                  {o.label}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {p.live ? (
          <p className="text-xs text-muted">Printed from the data whenever it is opened: nothing to make final.</p>
        ) : p.kind === "payment-request" || p.kind === "payment-receipt" ? (
          <p className="text-xs text-muted">
            {p.kind === "payment-request"
              ? "Kept as sent: send it from the order's Payment step (Send request). Nothing to make here."
              : "Kept when its payment was recorded: nothing to make here."}
          </p>
        ) : p.canMake ? (
          final ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-text-2">
                Version {p.paper!.version} is final{p.paper!.finalAt ? ` since ${when(p.paper!.finalAt)}` : ""}: it stays exactly as it was
                printed.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" disabled={pending} onClick={() => call("again", null, {})}>
                  {pending ? "Starting…" : `Make again (version ${p.paper!.version + 1})`}
                </Button>
                <Link href={backHref} className={buttonClass("ghost", "sm")}>
                  Back to {FLOW_STEP_LABEL[p.step]}
                </Link>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="primary" disabled={pending || !p.ready} onClick={makeFinal}>
                  {pending ? "Saving…" : "Make final"}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => call("draft", null, { options: opts }).then((r) => r.ok && setNotice("Saved as a draft."))}
                >
                  Save as draft
                </Button>
                <Link href={backHref} className={buttonClass("ghost", "sm")}>
                  Cancel
                </Link>
              </div>
              {!p.ready && required.length > 0 && (
                <p className="text-xs text-[#9a3412]">Still needed: {required.map((c) => inSentence(c.label)).join(", ")}.</p>
              )}
              <p className="text-xs text-muted">
                Final locks the number and ticks the item. If the order changes later, <strong>Make again</strong> creates version{" "}
                {(p.paper?.version ?? 1) + 1} and keeps version {p.paper?.version ?? 1}.
              </p>
            </div>
          )
        ) : (
          <p className="text-xs text-muted">
            You can see this paper; making it needs the &ldquo;Papers, documents and bank&rdquo; permission.
          </p>
        )}

        {p.versions.length > 1 && (
          <section aria-labelledby="versions">
            <h3 id="versions" className="text-[11px] font-semibold tracking-wide text-muted uppercase">
              Versions
            </h3>
            <ul className="mt-1 flex flex-col gap-1 text-xs">
              {p.versions.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-2">
                  <span>
                    Version {v.version} · {v.status === "final" ? `final${v.finalAt ? ` ${when(v.finalAt)}` : ""}` : "draft"}
                  </span>
                  <a
                    href={`/print/orders/${p.orderId}/${p.kind}?${new URLSearchParams({ v: String(v.version), ...(p.ref ? { ref: p.ref } : {}) })}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-primary hover:underline"
                  >
                    View
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {send && final && (
          <section aria-labelledby="send" className="flex flex-col gap-2 rounded-lg border border-line bg-surface-2 p-3">
            <h3 id="send" className="text-sm font-semibold">
              Send it to the customer
            </h3>
            <p className="text-xs text-muted">Download the PDF, then send it with this text.</p>
            <p className="rounded-md bg-surface p-2 text-xs whitespace-pre-line text-text-2">{send.text}</p>
            <div className="flex flex-wrap gap-2">
              <a
                href={`mailto:${send.email ?? ""}?${new URLSearchParams({ subject: send.subject, body: send.text }).toString().replace(/\+/g, "%20")}`}
                className={buttonClass("secondary", "xs")}
              >
                <Mail aria-hidden /> Email
              </a>
              <a
                href={`https://wa.me/${(send.phone ?? "").replace(/\D/g, "")}?text=${encodeURIComponent(send.text)}`}
                target="_blank"
                rel="noreferrer"
                className={buttonClass("secondary", "xs")}
              >
                <MessageCircle aria-hidden /> WhatsApp
              </a>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  void navigator.clipboard?.writeText(send.text);
                  setCopied(true);
                }}
              >
                <Copy aria-hidden /> {copied ? "Copied" : "Copy the text"}
              </Button>
            </div>
          </section>
        )}
      </Card>

      <section aria-label="Preview" className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted">{final ? "As it was made final" : "Preview in our document template · updates as you type"}</p>
          <FileActions viewHref={view} pdfHref={pdf} of={p.label.toLowerCase()} />
        </div>
        <Preview src={preview} title={`${p.label} preview`} />
      </section>
    </div>
  );
}
