"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Copy, Mail, MessageCircle } from "lucide-react";
import { FLOW_STEP_LABEL, inSentence, type PaperCheck } from "@kebo/shared";
import { Alert, Badge, Button, buttonClass, Card, Checkbox, cn } from "@kebo/ui";
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
              className="h-8 w-36 min-w-0 rounded-md border-[1.5px] border-primary/60 bg-surface px-2.5 text-sm focus:border-primary focus:outline-none"
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
      {input && <p className="pl-6 text-xs text-muted">Adding it here also saves it on {fix.saves}.</p>}
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
                  className="h-7 w-28 rounded-md border border-line-strong bg-surface px-2 text-xs focus:border-primary focus:outline-none"
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
