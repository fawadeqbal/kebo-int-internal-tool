"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, Copy, FileSpreadsheet, FileText, Plus, Send } from "lucide-react";
import { FACTORY_REQUEST_STATUS_TONE, REQUEST_CHANNEL_LABEL, REQUEST_CHANNELS, type FactoryRequestStatus } from "@kebo/shared";
import { Badge, Button, buttonClass, Checkbox, cn, EmptyState, Field, Input, Select, Textarea } from "@kebo/ui";
import { ConfirmSubmit, SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";
import type { FactoryRequests } from "@/lib/types-flow";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

const day = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : null;
const month = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }) : null);

/** What the answer column says: offer in, waiting N days (late after the reply-by date), declined, no reply. */
function answerOf(r: FactoryRequests["items"][number]): { text: string; tone: (typeof FACTORY_REQUEST_STATUS_TONE)[FactoryRequestStatus] | "bad" } {
  if (r.status === "quoted") return { text: "Offer received", tone: "ok" };
  if (r.status === "sent") {
    const d = r.waitingDays ?? 0;
    return { text: `Waiting · ${d === 0 ? "today" : d === 1 ? "1 day" : `${d} days`}`, tone: r.late ? "bad" : d >= 3 ? "warn" : "info" };
  }
  return { text: r.statusLabel, tone: FACTORY_REQUEST_STATUS_TONE[r.status] };
}

/**
 * Factories asked for a price on this inquiry, and who answered; "Ask
 * factories" opens the picker with the message and the list to send. Sending
 * happens on WeChat or email; here we keep who was asked and when.
 */
export function FactoriesAsked({
  data,
  ask,
  statusActions,
  removeActions,
  message,
  excelHref,
  files,
  sourcingHref,
  canEdit,
  today,
  closed,
}: {
  data: FactoryRequests;
  ask: Action;
  statusActions: Record<string, Action>;
  removeActions: Record<string, Action>;
  /** The message for WeChat or email, made from the inquiry's items. */
  message: string;
  /** The item list as an Excel file for the factories (no customer name). */
  excelHref: string | null;
  files: { id: string; name: string; size: number }[];
  sourcingHref: string;
  canEdit: boolean;
  today: string;
  closed: boolean;
}) {
  const [asking, setAsking] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      {asking ? (
        <AskPanel
          action={ask}
          suggestions={data.suggestions}
          message={message}
          excelHref={excelHref}
          files={files}
          today={today}
          onDone={() => setAsking(false)}
        />
      ) : data.items.length === 0 ? (
        <EmptyState
          className="py-8"
          icon={Send}
          title="No factory asked yet"
          description="Send the list to two or three factories. Their answers come back as offers on Factory prices."
          action={
            canEdit && !closed ? (
              <Button size="sm" variant="primary" onClick={() => setAsking(true)}>
                <Send aria-hidden /> Ask factories
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
            {data.items.map((r) => {
              const a = answerOf(r);
              return (
                <li key={r.id} className="grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{r.factory.name}</span>
                    <span className="block text-xs text-muted">
                      Asked {day(r.sentOn)}
                      {r.channel && ` · ${REQUEST_CHANNEL_LABEL[r.channel]}`}
                      {r.replyBy && r.status === "sent" && ` · reply by ${day(r.replyBy)}`}
                      {r.note && ` · ${r.note}`}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={a.tone}>{a.text}</Badge>
                    {r.status === "sent" && canEdit && (
                      <>
                        <Link href={sourcingHref} className={buttonClass("secondary", "xs")}>
                          <Plus aria-hidden /> Add their offer
                        </Link>
                        <StatusButton action={statusActions[r.id]!} status="declined" label="Declined" />
                        <StatusButton action={statusActions[r.id]!} status="no_reply" label="No reply" />
                      </>
                    )}
                    {(r.status === "declined" || r.status === "no_reply") && canEdit && <StatusButton action={statusActions[r.id]!} status="sent" label="Still waiting" />}
                    {r.status !== "quoted" && canEdit && (
                      <ActionForm action={removeActions[r.id]!} showSuccess={false} className="inline-flex">
                        <ConfirmSubmit size="xs" variant="danger-ghost" pendingText="…" message={`Remove ${r.factory.name} from the factories asked?`}>
                          Remove
                        </ConfirmSubmit>
                      </ActionForm>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          {canEdit && !closed && (
            <div>
              <Button size="sm" variant="secondary" onClick={() => setAsking(true)}>
                <Send aria-hidden /> Ask more factories
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatusButton({ action, status, label }: { action: Action; status: string; label: string }) {
  return (
    <ActionForm action={action} showSuccess={false} className="inline-flex">
      <input type="hidden" name="status" value={status} />
      <SubmitButton size="xs" variant="ghost" pendingText="…">
        {label}
      </SubmitButton>
    </ActionForm>
  );
}

/** Pick the factories, copy the message, download the list, then mark them as asked. */
function AskPanel({
  action,
  suggestions,
  message,
  excelHref,
  files,
  today,
  onDone,
}: {
  action: Action;
  suggestions: FactoryRequests["suggestions"];
  message: string;
  excelHref: string | null;
  files: { id: string; name: string; size: number }[];
  today: string;
  onDone: () => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [find, setFind] = useState("");
  const [text, setText] = useState(message);
  const [copied, setCopied] = useState(false);
  const open = suggestions.filter((f) => !f.askedHere);
  const shown = useMemo(() => {
    const q = find.trim().toLowerCase();
    return (q ? open.filter((f) => f.name.toLowerCase().includes(q)) : open).slice(0, 40);
  }, [open, find]);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  return (
    <ActionForm action={action} onDone={onDone} keepFields className="flex flex-col gap-4 rounded-xl border border-primary/25 bg-primary-soft/30 p-3 sm:p-4">
      {(s) => (
        <>
          <div>
            <p className="text-sm font-semibold">Ask factories for prices</p>
            <p className="text-xs text-muted">Send the same list to each factory; their answers come back as offers on Factory prices.</p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <fieldset className="flex min-w-0 flex-col gap-2">
              <legend className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Factories</legend>
              {open.length > 8 && <Input aria-label="Find a factory" placeholder="Find a factory…" value={find} onChange={(e) => setFind(e.target.value)} className="h-8" />}
              {open.length === 0 ? (
                <p className="text-sm text-muted">
                  Every factory in your list is asked already.{" "}
                  <Link href="/factories" className="text-primary hover:underline">
                    Add a factory
                  </Link>
                </p>
              ) : (
                <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
                  {shown.map((f) => (
                    <li key={f.id}>
                      <label className={cn("flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2", picked.includes(f.id) ? "border-primary bg-surface" : "border-line bg-surface hover:border-line-strong")}>
                        <Checkbox name="factoryId" value={f.id} checked={picked.includes(f.id)} onChange={() => toggle(f.id)} className="mt-0.5" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{f.name}</span>
                          <span className="block text-xs text-muted">
                            {[f.offers ? `${f.offers} offer${f.offers === 1 ? "" : "s"} before` : null, f.lastAskedOn ? `last asked ${month(f.lastAskedOn)}` : null, f.reach].filter(Boolean).join(" · ") || "Not asked before"}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              {s.errors?.factoryIds && <p className="text-xs text-bad">{s.errors.factoryIds[0]}</p>}
            </fieldset>
            <div className="flex min-w-0 flex-col gap-3">
              <div>
                <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">What they get</p>
                <ul className="flex flex-col gap-1">
                  {excelHref && (
                    <li>
                      <a href={excelHref} className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm hover:border-line-strong">
                        <FileSpreadsheet className="size-4 shrink-0 text-ok" aria-hidden /> <span className="min-w-0 flex-1 truncate font-medium">The item list (Excel)</span>
                        <span className="text-xs text-muted">no customer name</span>
                      </a>
                    </li>
                  )}
                  {files.map((f) => (
                    <li key={f.id}>
                      <a href={`/files/${f.id}`} className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm hover:border-line-strong">
                        <FileText className="size-4 shrink-0 text-muted" aria-hidden /> <span className="min-w-0 flex-1 truncate">{f.name}</span>
                        <span className="text-xs text-muted tabular">{kb(f.size)}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
              <Field label="Message for WeChat or email" htmlFor="ask-message" hint="Copy it into the chat or email, with the files">
                <Textarea id="ask-message" rows={7} value={text} onChange={(e) => setText(e.target.value)} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Sent by" htmlFor="ask-channel" optional error={s.errors?.channel}>
                  <Select id="ask-channel" name="channel" defaultValue="wechat">
                    {REQUEST_CHANNELS.map((c) => (
                      <option key={c} value={c}>
                        {REQUEST_CHANNEL_LABEL[c]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Reply by" htmlFor="ask-reply" optional error={s.errors?.replyBy}>
                  <Input id="ask-reply" name="replyBy" type="date" min={today} />
                </Field>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <Button type="button" size="sm" variant="ghost" onClick={onDone}>
              Cancel
            </Button>
            <span className="flex-1" />
            <Button type="button" size="sm" variant="secondary" onClick={copy}>
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />} {copied ? "Copied" : "Copy message"}
            </Button>
            {excelHref && (
              <a href={excelHref} className={buttonClass("secondary", "sm")}>
                <FileSpreadsheet aria-hidden /> Download list (Excel)
              </a>
            )}
            <SubmitButton size="sm" pendingText="Saving…" disabled={!picked.length}>
              {picked.length ? `Mark ${picked.length === 1 ? "1 factory" : `${picked.length} factories`} as asked` : "Choose the factories"}
            </SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
