"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Download, FileText, Link2, Mail, MessageCircle, Send, Share2 } from "lucide-react";
import { SENT_VIA, SENT_VIA_LABEL, SENT_VIA_TEXT, SHARE_VIA_TEXT, type SentVia, type ShareVia } from "@kebo/shared";
import { Button, cn, Field, Input, linkClass, Notice, RULES, Select, Textarea, type ButtonSize, type ButtonVariant } from "@kebo/ui";
import { SubmitButton, toast } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { FloatingMenu, useIsPhone } from "@/components/common/floating";
import { useConfirm } from "@/components/common/dialog";
import { PANEL_FORM, PanelBody, SidePanel, useClosePanel, WhatHappens, WindowFooter } from "@/components/common/panel";
import { saveHref } from "@/components/window/doc-window";
import type { ActionState } from "@/lib/actions";
import { ignore } from "@/lib/quiet";

/*
 * Email and Share (design "Email and Share", 26 Nov 2026): two buttons for everything that goes out, the same in
 * every place, set by props. Email: the app sends it from the company's address, or you send it yourself (your
 * mail app, or "I sent it already": how and when). Share: WhatsApp, WeChat, Telegram, any other app, the link.
 * A place says what goes, to whom, the words, and what "sent" means there (a quotation is marked sent, a payment
 * request kept as sent, the rest noted in History).
 */

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** One thing that goes out: one of our documents as shown (its PDF) or a stored file. */
export interface Outgoing {
  key: string;
  /** The name it goes under: "Commercial invoice CI-2026-0572.pdf". */
  name: string;
  /** "Customer copy · English + 中文 · 2 pages", "412 KB". */
  detail?: string | null;
  /** To look at it first (its print page, or the file to view). */
  view?: string | null;
  /** The PDF as shown (/pdf/…) or the file (/files/…): what is attached, downloaded and shared. */
  download: string;
  /** What it is of the order, for its History: the paper's key, the file's ref. */
  paper?: string | null;
  file?: string | null;
  /** Not final yet: it goes marked DRAFT. */
  draft?: boolean;
  /** Its amount or total, beside it under Include (a quotation's). */
  aside?: string | null;
}

/** Who it goes to. */
export interface Recipient {
  name: string | null;
  email?: string | null;
  /** Copy, as typed in the Copy field ("a@x.com, b@y.com"). */
  cc?: string | null;
  phone?: string | null;
}

/* ---------------------------------------------------------------- Email */

export interface EmailProps {
  /** What goes: the first always; the others under Include, ticked or not (`ticked`). */
  items: Outgoing[];
  /** The others are ticked to start with (a quotation's other ready drafts); else they are offered ("Add …"). */
  ticked?: boolean;
  to: Recipient | null;
  subject: string | ((chosen: Outgoing[]) => string);
  message: string | ((chosen: Outgoing[]) => string);
  /** From the app: gets to, cc, subject, message, include (the keys), attach. */
  emailAction: Action;
  /** Sent by the person: gets via, on, reason, to=sent, include. Null: nothing to mark (Send again, or no place to note it). */
  markAction?: Action | null;
  /** "Mark R1 as sent", "Keep it as sent", "Note it as sent". */
  markWord?: (n: number) => string;
  /** What happens, under the form. */
  happens?: { app?: (chosen: Outgoing[]) => string[]; mark?: (how: string, chosen: Outgoing[]) => string[] };
  /** What to look at before it goes. */
  checks?: string[];
  today: string;
  /** Only by email, again (a quotation already sent). */
  againOnly?: boolean;
  /** "Sent by WhatsApp" goes as the mark's reason (a quotation's); off where a reason means why it is sent again. */
  howAsReason?: boolean;
  sendWord?: (n: number) => string;
}

const nameOf = (o: Outgoing) => o.name.replace(/\.pdf$/i, "");

/**
 * The Email window's body (in the app's one window, SidePanel): From the app (to, copy, subject, what goes,
 * message, Send email) or I'll send it myself (Open my mail app, or I sent it already: how and when).
 */
export function EmailWindow(p: EmailProps) {
  const close = useClosePanel();
  const [by, setBy] = useState<"app" | "self">("app");
  const [self, setSelf] = useState<"mail" | "done">("mail");
  const [how, setHow] = useState<SentVia>("whatsapp");
  const [opened, setOpened] = useState(false);
  const [left, setLeft] = useState<string[]>(() => (p.ticked ? [] : p.items.slice(1).map((x) => x.key)));
  const chosen = p.items.filter((x, i) => i === 0 || !left.includes(x.key));
  const many = chosen.length > 1;
  const [subjectTyped, setSubjectTyped] = useState<string | null>(null);
  const [messageTyped, setMessageTyped] = useState<string | null>(null);
  const [toTyped, setToTyped] = useState<string | null>(null);
  const subject = subjectTyped ?? (typeof p.subject === "function" ? p.subject(chosen) : p.subject);
  const message = messageTyped ?? (typeof p.message === "function" ? p.message(chosen) : p.message);
  const to = toTyped ?? p.to?.email ?? "";
  const canMark = !!p.markAction && !p.againOnly;
  const markWord = p.markWord ?? ((n: number) => (n > 1 ? `Note ${n} as sent` : "Note it as sent"));
  const drafts = chosen.filter((x) => x.draft);

  const include = p.items.length > 1 && (
    <fieldset className="flex flex-col">
      <legend className="mb-1.5 text-sm font-medium text-text">Include</legend>
      <div className="flex flex-col divide-y divide-line rounded-xl border border-line">
        {p.items.map((x, i) => {
          const me = i === 0;
          const on = me || !left.includes(x.key);
          return (
            <label key={x.key} className={cn("flex min-h-11 items-center gap-2.5 px-3.5 py-2 text-sm", !me && "cursor-pointer hover:bg-surface-2/60")}>
              <input
                type="checkbox"
                checked={on}
                disabled={me}
                onChange={(e) => setLeft((l) => (e.target.checked ? l.filter((k) => k !== x.key) : [...l, x.key]))}
                className="size-[18px] shrink-0 accent-primary"
              />
              <span className="min-w-0">
                <span className="block truncate font-semibold">{nameOf(x)}</span>
                {x.detail && <span className="block truncate text-xs text-text-2">{x.detail}</span>}
              </span>
              {x.aside && <span className="ml-auto tabular whitespace-nowrap text-text-2">{x.aside}</span>}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
  // What goes, with a look and a download each (the first with Include shows them all).
  const files = (
    <div className="flex flex-col divide-y divide-line rounded-xl border border-line">
      {chosen.map((x) => (
        <div key={x.key} className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 text-md">
          <span className="flex min-w-0 items-center gap-2 font-semibold">
            <FileText className="size-4 shrink-0 text-primary" aria-hidden />
            <span className="truncate">{x.name}</span>
          </span>
          <span className="flex gap-4">
            {x.view && (
              <a href={x.view} className={linkClass} aria-label={many ? `See ${x.name}` : undefined}>
                See it
              </a>
            )}
            <a href={x.download} download className={linkClass} aria-label={many ? `Download ${x.name}` : undefined}>
              Download
            </a>
          </span>
        </div>
      ))}
    </div>
  );
  const keys = chosen.map((x) => <input key={x.key} type="hidden" name="include" value={x.key} />);
  const choice = (value: "app" | "self", title: string, sub: string) => (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-2.5 rounded-xl border bg-surface px-3.5 py-3 text-sm transition-colors",
        by === value ? "border-primary bg-primary-soft/50 ring-1 ring-primary" : "border-line hover:border-line-strong",
      )}
    >
      <input type="radio" name="send-by" className="mt-1 accent-primary" checked={by === value} onChange={() => setBy(value)} />
      <span>
        <span className="block font-semibold">{title}</span>
        <span className="block text-xs text-text-2">{sub}</span>
      </span>
    </label>
  );
  const sub = (value: "mail" | "done", title: string, text: string) => (
    <label className={cn("flex cursor-pointer items-start gap-2.5 rounded-lg px-1 py-1.5 text-sm", self === value && "font-medium")}>
      <input type="radio" name="self-how" className="mt-1 accent-primary" checked={self === value} onChange={() => setSelf(value)} />
      <span>
        <span className="block font-semibold">{title}</span>
        <span className="block text-xs font-normal text-text-2">{text}</span>
      </span>
    </label>
  );
  const fields = (
    <>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="To" htmlFor="send-to" required hint="Several: separate them with commas">
          <Input id="send-to" name="to" type="text" inputMode="email" value={to} onChange={(e) => setToTyped(e.target.value)} />
        </Field>
        {by === "app" && (
          <Field label="Copy" htmlFor="send-cc" optional>
            <Input id="send-cc" name="cc" type="text" inputMode="email" defaultValue={p.to?.cc ?? ""} />
          </Field>
        )}
      </div>
      <Field label="Subject" htmlFor="send-subject">
        <Input id="send-subject" name="subject" maxLength={300} value={subject} onChange={(e) => setSubjectTyped(e.target.value)} />
      </Field>
      {include}
      <Field label="Message" htmlFor="send-message">
        <Textarea id="send-message" name="message" rows={4} value={message} onChange={(e) => setMessageTyped(e.target.value)} />
      </Field>
    </>
  );
  // Open my mail app: what goes downloads, the mail app opens with the words; then "Sent it?".
  const openMail = () => {
    for (const x of chosen) saveHref(x.download, x.name);
    window.location.assign(`mailto:${to.trim()}?${new URLSearchParams({ subject, body: message }).toString().replace(/\+/g, "%20")}`);
    setOpened(true);
  };

  return (
    <PanelBody>
      {!!p.checks?.length && (
        <div className="mb-4">
          <Notice tone="todo">
            <p className="font-semibold">Before it goes</p>
            <ul className="mt-1 list-disc pl-5">
              {p.checks.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </Notice>
        </div>
      )}
      {drafts.length > 0 && (
        <div className="mb-4">
          <Notice tone="todo">
            {drafts.map(nameOf).join(", ")} {drafts.length > 1 ? "are drafts" : "is a draft"}: it goes marked DRAFT. Make it final first to send the real one.
          </Notice>
        </div>
      )}
      {!p.againOnly && (
        <fieldset className="mb-5 flex flex-col gap-2">
          <legend className="mb-2 text-xs font-bold text-text-2">Who sends it?</legend>
          {choice("app", "From the app", "From the company's email, with the files attached")}
          {choice("self", "I'll send it myself", "Your own mail app, or mark it sent if it went another way")}
        </fieldset>
      )}
      {by === "app" ? (
        <ActionForm key="app" action={p.emailAction} onDone={(st) => close(st)} className={PANEL_FORM}>
          {() => (
            <>
              {keys}
              <input type="hidden" name="attach" value="on" />
              {fields}
              {files}
              <WhatHappens
                lines={
                  p.happens?.app?.(chosen) ?? [
                    `One email goes out from the company's address with ${many ? `the ${chosen.length} files` : "the file"} attached.`,
                    "It is noted where it belongs (the order's History).",
                  ]
                }
              />
              <WindowFooter>
                <SubmitButton pendingText="Sending…">
                  <Send aria-hidden /> {p.sendWord?.(chosen.length) ?? (many ? `Send ${chosen.length}` : "Send email")}
                </SubmitButton>
              </WindowFooter>
            </>
          )}
        </ActionForm>
      ) : (
        <div className={PANEL_FORM}>
          {canMark && (
            <fieldset className="flex flex-col gap-1">
              <legend className="sr-only">How</legend>
              {sub("mail", "Open my mail app", "The files download and your mail app opens with the words; attach them there.")}
              {sub("done", "I sent it already", "WhatsApp, WeChat, in person…: nothing is sent, it is only marked as sent.")}
            </fieldset>
          )}
          {self === "mail" || !canMark ? (
            <>
              {fields}
              {files}
              {opened && <Notice tone="ok">Your mail app opened with the words, and the files downloaded: attach them there and send.</Notice>}
              {opened && canMark ? (
                <ActionForm key="mailed" action={p.markAction!} onDone={(st) => close(st)} className="contents">
                  {() => (
                    <>
                      {keys}
                      <input type="hidden" name="to" value="sent" />
                      <input type="hidden" name="via" value="email" />
                      {p.howAsReason !== false && <input type="hidden" name="reason" value={`Sent ${SENT_VIA_TEXT.email}`} />}
                      <WindowFooter>
                        <SubmitButton pendingText="Saving…">
                          <Check aria-hidden /> Sent it: {markWord(chosen.length).replace(/^[A-Z]/, (c) => c.toLowerCase())}
                        </SubmitButton>
                      </WindowFooter>
                    </>
                  )}
                </ActionForm>
              ) : (
                <WindowFooter>
                  <Button variant="primary" onClick={openMail}>
                    <Mail aria-hidden /> Open my mail app
                  </Button>
                </WindowFooter>
              )}
            </>
          ) : (
            <ActionForm key="done" action={p.markAction!} onDone={(st) => close(st)} className={PANEL_FORM}>
              {(s) => (
                <>
                  {keys}
                  <input type="hidden" name="to" value="sent" />
                  <input type="hidden" name="via" value={how} />
                  {p.howAsReason !== false && <input type="hidden" name="reason" value={`Sent ${SENT_VIA_TEXT[how]}`} />}
                  <div className={RULES.form.fields}>
                    <Field label="How" htmlFor="sent-how">
                      <Select id="sent-how" value={how} onChange={(e) => setHow(e.target.value as SentVia)}>
                        {SENT_VIA.map((v) => (
                          <option key={v} value={v}>
                            {SENT_VIA_LABEL[v]}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Sent on" htmlFor="sent-on" optional error={s.errors?.on}>
                      <Input id="sent-on" name="on" type="date" max={p.today} defaultValue={s.values?.on} />
                    </Field>
                  </div>
                  {include}
                  <WhatHappens
                    lines={
                      p.happens?.mark?.(SENT_VIA_TEXT[how], chosen) ?? ["Nothing is sent by the app.", `It is noted as sent ${SENT_VIA_TEXT[how]}, in the order's History.`]
                    }
                  />
                  <WindowFooter>
                    <SubmitButton pendingText="Saving…">
                      <Check aria-hidden /> {markWord(chosen.length)}
                    </SubmitButton>
                  </WindowFooter>
                </>
              )}
            </ActionForm>
          )}
        </div>
      )}
    </PanelBody>
  );
}

/** The Email window in the app's one window, with its title ("Email the commercial invoice"). */
export function EmailPanel({ title, description, onClose, ...p }: EmailProps & { title: string; description?: string; onClose: () => void }) {
  return (
    <SidePanel title={title} description={description} onClose={onClose} className={RULES.window.part}>
      <EmailWindow {...p} />
    </SidePanel>
  );
}

/** The Email button: opens the Email window. `strong` where sending is the next step. */
export function EmailButton({
  label = "Email",
  title,
  description,
  strong,
  size,
  className,
  ...p
}: EmailProps & { label?: string; title: string; description?: string; strong?: boolean; size?: ButtonSize; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={strong ? "primary" : "secondary"} size={size} onClick={() => setOpen(true)} className={className}>
        <Mail aria-hidden /> {label}
      </Button>
      {open && <EmailPanel {...p} title={title} description={description} onClose={() => setOpen(false)} />}
    </>
  );
}

/* ---------------------------------------------------------------- Share */

/** Share's props: plain values and server actions only, so a server page can give them (and a ⋯ menu can hold them). */
export interface ShareProps {
  items: Outgoing[];
  /** The words that go with it (the app opened shows them, to change before it goes). */
  message: string;
  to?: Recipient | null;
  /** Copy link: the address for the team (people signed in to the app). */
  link?: string | null;
  /** Once shared: noted where it belongs, or marked sent (a server action, given how: whatsapp, wechat…). */
  noteAction?: ((via: ShareVia) => Promise<ActionState>) | null;
  /** Marking it sent asks first: "Mark R1 as sent {via}?" ({via}: "on WhatsApp"). */
  ask?: { question: string; confirmLabel: string } | null;
}

const APP_WORD: Partial<Record<ShareVia, string>> = { whatsapp: "WhatsApp", wechat: "WeChat", telegram: "Telegram", share: "the app you chose", download: "" };

/** Can this browser hand files to the system's share sheet (WhatsApp, WeChat, Mail…)? */
const sheetFor = (files: File[]) => typeof navigator !== "undefined" && "canShare" in navigator && navigator.canShare({ files });
const coarse = () => typeof window !== "undefined" && window.matchMedia("(max-width: 639px), (pointer: coarse)").matches;

async function filesOf(items: Outgoing[]) {
  return Promise.all(
    items.map(async (x) => {
      const res = await fetch(x.download);
      if (!res.ok) throw new Error(`${x.name} could not be made (${res.status}).`);
      return new File([await res.blob()], x.name, { type: res.headers.get("content-type") ?? "application/pdf" });
    }),
  );
}

/**
 * The Share menu's work, for a button or a row's ⋯: on a phone the phone's own share sheet (every app gets the
 * file itself); on a computer the app's menu (WhatsApp, WeChat, Telegram, other apps, Copy link, Download).
 */
export function useShare(p: ShareProps) {
  const phone = useIsPhone();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { ask, dialog } = useConfirm();
  const names = p.items.map((x) => x.name).join(", ");

  const shared = (via: ShareVia) => {
    if (!p.noteAction || via === "download") return;
    const note = async () => {
      const r = await p.noteAction!(via);
      if (!r.ok) toast({ message: r.message ?? "It could not be noted.", kind: "fail" });
    };
    if (p.ask) ask({ question: p.ask.question.replace("{via}", SHARE_VIA_TEXT[via]), confirmLabel: p.ask.confirmLabel }, () => void note());
    else void note();
  };
  const run = async (via: ShareVia) => {
    setAnchor(null);
    try {
      if (via === "share") {
        const files = await filesOf(p.items);
        if (!sheetFor(files)) throw new Error("This browser cannot share files: use Download, then attach it.");
        await navigator.share({ files, text: p.message });
        return shared("share");
      }
      for (const x of p.items) saveHref(x.download, x.name);
      const digits = (p.to?.phone ?? "").replace(/\D/g, "");
      if (via === "whatsapp") window.open(`https://wa.me/${digits}?text=${encodeURIComponent(p.message)}`, "_blank", "noopener");
      if (via === "telegram") window.open(`tg://msg?text=${encodeURIComponent(p.message)}`, "_self");
      let copied = false;
      if (via === "wechat") {
        copied = (await navigator.clipboard?.writeText(p.message).then(() => true, ignore("copying the message for WeChat"))) ?? false;
        window.location.assign("weixin://");
      }
      const opens =
        via !== "wechat" ? "opens with the message" : copied ? "opens: the message is copied, paste it" : "opens, but the message could not be copied";
      toast(via === "download" ? `${names} downloaded.` : `${APP_WORD[via]} ${opens}; ${names} downloaded: attach it there.`);
      shared(via);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) toast({ message: e instanceof Error ? e.message : "Could not share it.", kind: "fail" });
    }
  };
  const copyLink = async () => {
    setAnchor(null);
    try {
      await navigator.clipboard.writeText(new URL(p.link!, window.location.href).toString());
      toast("Link copied: it opens for people signed in to the app.");
    } catch {
      toast({ message: "Could not copy the link.", kind: "fail" });
    }
  };
  /** From a button (or a row's ⋯, `el` the button the menu was on). */
  const start = (el: HTMLElement | null) => {
    // A phone: straight to its own share sheet, when it takes files.
    if (phone && coarse() && "canShare" in navigator) return void run("share");
    setAnchor(el ?? document.body);
  };
  const item = (label: string, icon: ReactNode, onClick: () => void, hint?: string) => (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex min-h-10 w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-md hover:bg-surface-2 focus:bg-surface-2 focus:outline-none"
    >
      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-surface-2 text-text-2">{icon}</span>
      <span className="min-w-0">
        <span className="block">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </button>
  );
  const chat = <MessageCircle className="size-4" aria-hidden />;
  const node = (
    <>
      {anchor && (
        <FloatingMenu
          anchor={() => anchor}
          onClose={() => setAnchor(null)}
          label={`Share ${names}`}
          width={300}
          header={
            <div className="px-3 pt-2 pb-1.5">
              <p className="truncate text-md font-semibold">{names}</p>
              {p.to?.name && <p className="truncate text-xs text-muted">To {[p.to.name, p.to.phone].filter(Boolean).join(" · ")}</p>}
            </div>
          }
        >
          {item("WhatsApp", chat, () => void run("whatsapp"), p.to?.phone ? `To ${p.to.phone}` : "Pick the chat there")}
          {item("WeChat", chat, () => void run("wechat"), "The message is copied to paste")}
          {item("Telegram", chat, () => void run("telegram"))}
          {typeof navigator !== "undefined" && "canShare" in navigator && item("Other apps…", <Share2 className="size-4" aria-hidden />, () => void run("share"))}
          {p.link && item("Copy link", <Link2 className="size-4" aria-hidden />, () => void copyLink(), "For the team")}
          {item("Download", <Download className="size-4" aria-hidden />, () => void run("download"))}
        </FloatingMenu>
      )}
      {dialog}
    </>
  );
  return { start, node };
}

/** The Share button. */
export function ShareButton({
  label = "Share",
  variant = "secondary",
  size,
  className,
  ...p
}: ShareProps & { label?: string; variant?: ButtonVariant; size?: ButtonSize; className?: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const s = useShare(p);
  return (
    <>
      <Button ref={ref} variant={variant} size={size} onClick={() => s.start(ref.current)} className={className} aria-haspopup="menu">
        <Share2 aria-hidden /> {label}
      </Button>
      {s.node}
    </>
  );
}

/** A share started from a ⋯ menu: opens at once at the element the menu was on (give it a new key each time). */
export function ShareNow({ share, at }: { share: ShareProps; at: () => HTMLElement | null }) {
  const s = useShare(share);
  const { start } = s;
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    start(at());
  }, [start, at]);
  return <>{s.node}</>;
}
