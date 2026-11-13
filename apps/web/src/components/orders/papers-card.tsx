"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Paperclip, Upload } from "lucide-react";
import { PAPER_STATE_TONE, paperDone, type PaperState } from "@kebo/shared";
import { Alert, Badge, Button, buttonClass, Card, CardHeader, cn, Field, Input } from "@kebo/ui";
import type { ActionState } from "@/lib/actions";
import type { PaperRow } from "@/lib/types-papers";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** Sends a file to the deal's files and answers its id (server actions cap bodies at 1 MB, so files go through a route). */
async function uploadToDeal(dealId: string, file: File, note: string): Promise<{ id?: string; error?: string }> {
  const body = new FormData();
  body.set("file", file, file.name);
  body.set("kind", "other");
  body.set("note", note.slice(0, 300));
  try {
    const res = await fetch(`/files/inquiries/${dealId}`, { method: "POST", body });
    const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    if (!res.ok) return { error: json.error ?? (res.status === 413 ? "This file is too large." : `Upload failed (${res.status})`) };
    return { id: json.id };
  } catch {
    return { error: "The connection dropped. Try again." };
  }
}

const SOURCE: Record<string, { label: string; tone: "primary" | "info" | "neutral" | "warn" }> = {
  app: { label: "Made by the app", tone: "primary" },
  up: { label: "Uploaded", tone: "info" },
  else: { label: "Kept elsewhere", tone: "neutral" },
  miss: { label: "Missing", tone: "warn" },
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Dates in a line ("version 1 · 2026-11-02") as people read them: "02 Nov". */
const readable = (line: string) =>
  line.replace(/(\d{4})-(\d{2})-(\d{2})/g, (_, _y, m: string, d: string) => `${d} ${MONTHS[Number(m) - 1]}`);

/** Where the paper's View / Print goes. */
function viewHref(base: string, r: PaperRow, back: string) {
  if (r.source === "upload") return r.doc?.file ? `/files/${r.doc.file.id}?view=1` : null;
  if (!r.printable) return null;
  const q = new URLSearchParams({ ...(r.ref ? { ref: r.ref } : {}), back });
  return `/print/orders/${base.split("/").pop()}/${r.kind}?${q}`;
}

/** Upload the paper (to the deal's files) or say where it is kept: both record it in the order's document set. */
export function RecordForm({
  r,
  mode,
  dealId,
  add,
  update,
  onDone,
  send,
  hint,
  today,
}: {
  r: PaperRow;
  mode: "upload" | "elsewhere";
  dealId: string;
  add: Action;
  update?: Action;
  onDone: () => void;
  /** Where the file goes (default: the deal's files). */
  send?: (file: File) => Promise<{ id?: string; error?: string }>;
  hint?: string;
  /** Prefills the date (Upload on Documents). */
  today?: string;
}) {
  const id = useId();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const submit = (form: FormData) =>
    start(async () => {
      setError(null);
      const body = new FormData();
      if (!update && r.docKind) body.set("kind", r.docKind);
      if (!update && r.docKind === "other") body.set("title", r.label);
      body.set("number", String(form.get("number") ?? ""));
      body.set("issuedOn", String(form.get("issuedOn") ?? ""));
      if (mode === "upload") {
        if (!file) return setError("Choose the file.");
        const up = send ? await send(file) : await uploadToDeal(dealId, file, r.label);
        if (up.error || !up.id) return setError(up.error ?? "The file was not kept.");
        body.set("attachmentId", up.id);
        body.set("status", "ready");
        body.set("keptWhere", "");
      } else {
        body.set("status", "elsewhere");
        body.set("keptWhere", String(form.get("keptWhere") ?? ""));
      }
      const res = await (update ?? add)({}, body);
      if (res.ok) {
        onDone();
        router.refresh();
      } else setError(res.message ?? "Something went wrong. Please try again.");
    });
  return (
    <form action={submit} className="mt-2 flex flex-col gap-3 rounded-lg border border-line bg-surface p-3">
      {error && <Alert tone="error">{error}</Alert>}
      {mode === "upload" ? (
        <Field label="The file" htmlFor={`${id}-file`}>
          <Input id={`${id}-file`} type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="pt-1.5" />
        </Field>
      ) : (
        <Field label="Where is it" htmlFor={`${id}-where`} hint="So anyone can find it: a shelf, a person, a bank, an email">
          <Input
            id={`${id}-where`}
            name="keptWhere"
            maxLength={200}
            required
            defaultValue={r.doc?.keptWhere ?? ""}
            placeholder="e.g. Original B/L with Habib Bank, Lahore"
          />
        </Field>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Number" htmlFor={`${id}-no`} optional>
          <Input id={`${id}-no`} name="number" maxLength={60} defaultValue={r.number ?? ""} />
        </Field>
        <Field label="Date" htmlFor={`${id}-on`} optional>
          <Input id={`${id}-on`} name="issuedOn" type="date" defaultValue={r.doc?.issuedOn ?? (mode === "upload" ? (today ?? "") : "")} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={pending}>
          {pending ? "Saving…" : mode === "upload" ? "Upload" : "Mark as done"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        {(hint || mode === "elsewhere") && <span className="text-xs text-muted">{hint ?? "No file is stored; it counts as done."}</span>}
      </div>
    </form>
  );
}

export function StateMark({ state }: { state: PaperState }) {
  return paperDone(state) ? (
    <span className="grid size-[18px] shrink-0 place-items-center rounded-full bg-ok text-white" role="img" aria-label="Done">
      <Check className="size-3" strokeWidth={3.5} aria-hidden />
    </span>
  ) : (
    <span className="block size-[18px] shrink-0 rounded-full border-[1.5px] border-line-strong bg-surface" role="img" aria-label="Open" />
  );
}

/**
 * The papers of a step (boards OrderV3Shipping/Payment/Production "Papers", and
 * the Documents page's list): each with where it stands and the button for it —
 * View / Print, Make, Upload or Kept elsewhere. Made, uploaded and kept
 * elsewhere all count as done.
 */
export function PapersCard({
  rows,
  base,
  dealId,
  canMake,
  canRecord,
  addAction,
  updateActions,
  variant = "side",
  title = "Papers",
  description,
  back,
}: {
  rows: PaperRow[];
  base: string;
  dealId: string;
  canMake: boolean;
  canRecord: boolean;
  addAction: Action;
  updateActions: Record<string, Action>;
  variant?: "side" | "main";
  title?: string;
  description?: string;
  /** Where the print page's Back returns. */
  back: string;
}) {
  const [open, setOpen] = useState<{ key: string; mode: "upload" | "elsewhere" } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const main = variant === "main";
  // Papers made once per payment (receipts, requests) can be many: show the latest few and a "more" link.
  const KEEP = 2;
  const count: Record<string, number> = {};
  for (const r of rows) count[r.kind] = (count[r.kind] ?? 0) + 1;
  const seen: Record<string, number> = {};
  const shown: (PaperRow | { more: string; label: string; hidden: number })[] = [];
  for (const r of rows) {
    seen[r.kind] = (seen[r.kind] ?? 0) + 1;
    const n = count[r.kind]!;
    const folded = n > KEEP + 1 && !expanded.has(r.kind);
    if (folded && seen[r.kind]! <= n - KEEP) {
      if (seen[r.kind] === 1) shown.push({ more: r.kind, label: r.label.replace(/\s+\d+$/, ""), hidden: n - KEEP });
      continue;
    }
    shown.push(r);
  }
  if (!rows.length && !main) return null;
  return (
    <Card id={main ? "papers" : undefined} className={main ? "scroll-mt-24" : undefined}>
      <CardHeader title={title} description={description} />
      {rows.length ? (
        <ul className={cn("flex flex-col divide-y divide-line", main ? "px-2 py-1" : "px-4")}>
          {shown.map((r) => {
            if ("more" in r)
              return (
                <li key={`more-${r.more}`} className={cn("py-2.5", main && "px-2")}>
                  <button
                    type="button"
                    className="text-sm font-medium text-primary hover:underline"
                    onClick={() => setExpanded((e) => new Set(e).add(r.more))}
                  >
                    Show {r.hidden} earlier {r.label.toLowerCase()}
                    {r.hidden === 1 ? "" : "s"}
                  </button>
                </li>
              );
            const view = viewHref(base, r, back);
            const make = r.makeable ? `${base}/papers/${r.kind}${r.ref ? `?ref=${r.ref}` : ""}` : null;
            const badge = r.source === "app" ? SOURCE.app! : (SOURCE[r.state] ?? null);
            const recording = open?.key === r.key;
            const buttons = (
              <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                {r.source === "upload" && canRecord && (r.state === "miss" || r.state === "draft") && !recording && (
                  <>
                    <Button size="xs" variant="secondary" onClick={() => setOpen({ key: r.key, mode: "upload" })}>
                      <Upload aria-hidden /> Upload
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => setOpen({ key: r.key, mode: "elsewhere" })}>
                      Kept elsewhere…
                    </Button>
                  </>
                )}
                {r.source === "upload" && canRecord && r.state === "else" && !recording && (
                  <Button size="xs" variant="ghost" onClick={() => setOpen({ key: r.key, mode: "elsewhere" })}>
                    Change
                  </Button>
                )}
                {make && canMake && !r.live && !r.kept && (r.state === "can" || r.state === "wait" || r.state === "draft") ? (
                  <Link href={make} className={buttonClass(r.state === "wait" ? "secondary" : "primary", "xs")}>
                    {r.state === "draft" ? "Continue" : r.kind === "shipping-advice" ? "Make and send" : "Make"}
                  </Link>
                ) : view ? (
                  <Link href={view} target={r.source === "upload" ? "_blank" : undefined} className={buttonClass("ghost", "xs")}>
                    {r.source === "upload" ? (
                      <>
                        <Paperclip aria-hidden /> View
                      </>
                    ) : (
                      "View / Print"
                    )}
                  </Link>
                ) : r.kind === "packing-list" && r.state === "wait" ? (
                  <Link href={`${base}/shipping#packing`} className={buttonClass("secondary", "xs")}>
                    Make it
                  </Link>
                ) : null}
              </span>
            );
            const name = make ? (
              <Link href={make} className="hover:underline">
                {r.label}
              </Link>
            ) : (
              r.label
            );
            const sub = readable([r.number, r.sub].filter(Boolean).join(" · "));
            return (
              <li key={r.key} className={cn("py-3", main && "px-2")}>
                {main ? (
                  <div className="grid grid-cols-[18px_minmax(0,1fr)] gap-x-3 gap-y-1.5 sm:grid-cols-[18px_minmax(0,1fr)_auto]">
                    <span className="mt-0.5">
                      <StateMark state={r.state} />
                    </span>
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {name}
                        {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
                        {r.source === "app" && !paperDone(r.state) && (
                          <span className="text-xs font-normal text-muted">{r.stateLabel}</span>
                        )}
                      </span>
                      {sub && <span className="block text-xs text-muted tabular">{sub}</span>}
                    </span>
                    <span className="col-start-2 sm:col-start-3 sm:row-start-1">{buttons}</span>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0 text-sm font-medium">{name}</span>
                      <Badge tone={PAPER_STATE_TONE[r.state]}>{r.stateLabel}</Badge>
                    </span>
                    <span className="flex items-end justify-between gap-2">
                      <span className="min-w-0 text-xs text-muted tabular">{sub}</span>
                      {buttons}
                    </span>
                  </div>
                )}
                {recording && (
                  <RecordForm
                    r={r}
                    mode={open.mode}
                    dealId={dealId}
                    add={addAction}
                    update={r.doc ? updateActions[r.doc.id] : undefined}
                    onDone={() => setOpen(null)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-4 py-4 text-sm text-muted">No papers on this step yet.</p>
      )}
    </Card>
  );
}
