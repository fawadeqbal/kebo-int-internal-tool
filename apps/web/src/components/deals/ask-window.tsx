"use client";

import { ConfirmDialog } from "@/components/common/dialog";
import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Copy, FileSpreadsheet, Filter, Plus, Search } from "lucide-react";
import { REQUEST_CHANNEL_LABEL, REQUEST_CHANNELS } from "@kebo/shared";
import { Badge, Button, buttonClass, cn, Field, Input, Select, Textarea } from "@kebo/ui";
import { SubmitButton, toast } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { FloatingMenu } from "@/components/common/floating";
import { useClosePanel, WhatHappens } from "@/components/common/panel";
import type { ActionState } from "@/lib/actions";
import type { FactoryRequests } from "@/lib/types-flow";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/**
 * "Ask factories for prices" (board AskFactories): tick the factories (each
 * gets its own request to follow), how they were asked, the day sent and the
 * day the answer is due, and a note of what was sent. The message for WeChat
 * and the item list in Excel stay at hand under the note.
 */
export function AskWindow({
  data,
  ask,
  message,
  excelHref,
  today,
}: {
  data: FactoryRequests;
  ask: Action;
  message: string;
  excelHref: string | null;
  today: string;
}) {
  const close = useClosePanel();
  const [picked, setPicked] = useState<string[]>([]);
  const [find, setFind] = useState("");
  const [q, setQ] = useState("");
  const [copied, setCopied] = useState(false);
  const open = data.suggestions.filter((f) => !f.askedHere);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (t ? open.filter((f) => [f.name, f.contact, f.wechat].filter(Boolean).join(" ").toLowerCase().includes(t)) : open).slice(0, 60);
  }, [open, q]);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <ActionForm action={ask} onDone={close} keepFields className="flex min-h-0 flex-1 flex-col">
      {(s) => (
        <>
          <div data-panel-body className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4 sm:px-6">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-semibold">
                Factories<span className="text-bad"> *</span> <span className="font-normal text-muted">· {picked.length} chosen</span>
              </span>
              <Link href="/factories?panel=new-factory" className={buttonClass("secondary", "sm")}>
                <Plus aria-hidden /> New supplier
              </Link>
            </div>
            <div className="flex flex-wrap items-center gap-2.5 rounded-[14px] border border-line bg-surface p-3">
              <span className="relative min-w-0 flex-[1_1_220px]">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
                <Input
                  type="search"
                  aria-label="Search suppliers"
                  placeholder="Search suppliers…"
                  value={find}
                  onChange={(e) => {
                    setFind(e.target.value);
                    if (!e.target.value) setQ("");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      setQ(find);
                    }
                  }}
                  className="h-10 pl-9"
                />
              </span>
              <Button onClick={() => setQ(find)}>
                <Filter aria-hidden /> Filter
              </Button>
            </div>
            {open.length === 0 ? (
              <p className="text-sm text-muted">Every supplier in your list is asked already. Add a new supplier to ask one more.</p>
            ) : shown.length === 0 ? (
              <p className="text-sm text-muted">No supplier matches “{q}”.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {shown.map((f) => {
                  const on = picked.includes(f.id);
                  const sub = [
                    f.contact,
                    f.wechat ? `WeChat ${f.wechat}` : f.reach,
                    f.offers ? `${f.offers} offer${f.offers === 1 ? "" : "s"}${f.won ? `, ${f.won} won` : ""}` : "new",
                  ].filter(Boolean);
                  return (
                    <li key={f.id}>
                      <label
                        className={cn(
                          "flex cursor-pointer items-center gap-3 rounded-[10px] border px-3 py-2.5",
                          on ? "border-primary-line bg-primary-soft/40" : "border-line bg-surface hover:border-line-strong",
                        )}
                      >
                        <input type="checkbox" name="factoryId" value={f.id} checked={on} onChange={() => toggle(f.id)} className="size-[18px] flex-none accent-primary" />
                        <span className="min-w-0 flex-1 text-sm">
                          <strong className="block truncate">{f.name}</strong>
                          <span className="block truncate text-xs text-muted">{sub.join(" · ")}</span>
                        </span>
                        {f.goodAt ? <Badge tone="ok">Good on {f.goodAt.toLowerCase()}</Badge> : f.isNew ? <Badge tone="info">Just added</Badge> : null}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            {s.errors?.factoryIds && <p className="text-xs text-bad">{s.errors.factoryIds[0]}</p>}
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Asked by" htmlFor="ask-channel" error={s.errors?.channel}>
                <Select id="ask-channel" name="channel" defaultValue="wechat">
                  {REQUEST_CHANNELS.map((c) => (
                    <option key={c} value={c}>
                      {REQUEST_CHANNEL_LABEL[c]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Sent on" htmlFor="ask-sent" required error={s.errors?.sentOn}>
                <Input id="ask-sent" name="sentOn" type="date" max={today} defaultValue={today} />
              </Field>
              <Field label="Reply by" htmlFor="ask-reply" error={s.errors?.replyBy}>
                <Input id="ask-reply" name="replyBy" type="date" min={today} />
              </Field>
              <Field
                label="Note to keep"
                htmlFor="ask-note"
                error={s.errors?.note}
                className="sm:col-span-3"
                hint={
                  <span className="flex flex-wrap gap-x-3 gap-y-1">
                    <button type="button" onClick={copy} className="inline-flex items-center gap-1 text-primary hover:underline">
                      {copied ? <Check className="size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />} {copied ? "Message copied" : "Copy the message for WeChat"}
                    </button>
                    {excelHref && (
                      <a href={excelHref} className="inline-flex items-center gap-1 text-primary hover:underline">
                        <FileSpreadsheet className="size-3" aria-hidden /> The item list (Excel, no customer name)
                      </a>
                    )}
                  </span>
                }
              >
                <Textarea id="ask-note" name="note" rows={3} maxLength={500} placeholder="What you sent them: the written need, photos, the customer’s drawing…" />
              </Field>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-line bg-surface-2/50 px-5 py-3.5 sm:px-6">
            <Button variant="ghost" onClick={() => close()}>
              Cancel
            </Button>
            <SubmitButton pendingText="Saving…" disabled={!picked.length}>
              <Check aria-hidden /> Save · {picked.length} request{picked.length === 1 ? "" : "s"}
            </SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/** A request's "More ▾": declined, no reply, still waiting, or remove it. */
export function RequestMore({
  name,
  status,
  setStatus,
  remove,
}: {
  name: string;
  status: string;
  setStatus: Action;
  remove: Action;
}) {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: Action, values: Record<string, string>) => () => {
    setOpen(false);
    start(async () => {
      const form = new FormData();
      for (const [k, v] of Object.entries(values)) form.set(k, v);
      const r = await fn({}, form);
      if (!r.ok && r.message) toast(r.message);
      router.refresh();
    });
  };
  const item = "flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-surface-2 focus:bg-surface-2 focus:outline-none";
  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More for ${name}`}
        disabled={pending}
        className={buttonClass("ghost", "sm")}
        onClick={() => setOpen((o) => !o)}
      >
        More <ChevronDown aria-hidden />
      </button>
      {open && (
        <FloatingMenu anchor={() => ref.current} onClose={() => setOpen(false)} label={`${name}: request`} width={220}>
          {status !== "declined" && (
            <button type="button" role="menuitem" className={item} onClick={run(setStatus, { status: "declined" })}>
              They declined
            </button>
          )}
          {status !== "no_reply" && status !== "quoted" && (
            <button type="button" role="menuitem" className={item} onClick={run(setStatus, { status: "no_reply" })}>
              No reply
            </button>
          )}
          {(status === "declined" || status === "no_reply") && (
            <button type="button" role="menuitem" className={item} onClick={run(setStatus, { status: "sent" })}>
              Still waiting
            </button>
          )}
          <span role="separator" className="my-1 block h-px bg-line" />
          <button
            type="button"
            role="menuitem"
            className={cn(item, "text-bad")}
            onClick={() => {
              setOpen(false);
              setAsking(true);
            }}
          >
            Remove the request
          </button>
        </FloatingMenu>
      )}
      {asking && (
        <ConfirmDialog
          title={`Remove the request to ${name}?`}
          confirmLabel="Remove the request"
          cancelLabel="Keep it"
          danger
          busy={pending}
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            run(remove, {})();
          }}
        >
          <WhatHappens lines={["The line leaves this inquiry. Nothing else changes.", `${name} stays in Partners.`]} />
        </ConfirmDialog>
      )}
    </>
  );
}
