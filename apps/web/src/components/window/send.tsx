"use client";

import { useId, useState, type ReactNode } from "react";
import { FileText, Link2, Mail, MessageCircle } from "lucide-react";
import { Button, Field, Input, Notice, Textarea } from "@kebo/ui";
import { SegmentedChoice, toast } from "@kebo/ui/client";
import { saveHref } from "./doc-window";

/** What goes out: the PDF as it is shown (its copy and language), or the file itself. */
export interface SendWhat {
  href: string;
  /** The name it is saved and shared under ("Commercial invoice CI-2026-0572.pdf"). */
  name: string;
  /** "Customer copy · English + 中文 · 2 pages", "412 KB · PDF". */
  detail: string;
  /** Not final yet: it goes out marked DRAFT. */
  draft?: boolean;
  /** One of our papers (its copy and language switch under the page), not a file. */
  paper?: boolean;
}

export interface SendTo {
  name: string | null;
  email: string | null;
  phone: string | null;
}

type Via = "email" | "whatsapp" | "link";

/** Can this browser hand files to the system's share sheet (WhatsApp, email, AirDrop…)? On a phone or a tablet only. */
const shareSheet = () =>
  typeof navigator !== "undefined" &&
  "canShare" in navigator &&
  window.matchMedia("(max-width: 639px), (pointer: coarse)").matches &&
  navigator.canShare({ files: [new File([""], "x.pdf", { type: "application/pdf" })] });

/**
 * The panel's Send tab (one window, 26 Nov 2026): Email, WhatsApp or the link, who to, the words, and what is
 * attached as it is shown. The app sends nothing itself: on a phone the share sheet takes the file; on a computer
 * it downloads to attach and the mail app or WhatsApp opens with the words. `onNoted` keeps it in the order's History.
 * Returns the tab's body, its one strong button (the panel's foot) and the phone's slim line.
 */
export function useSend({
  what,
  to,
  subject,
  message,
  link,
  onNoted,
}: {
  what: SendWhat;
  to?: SendTo | null;
  subject: string;
  message: string;
  /** The link for the team (signed-in people): the window's own address, else the file's. */
  link?: string;
  onNoted?: (via: "share" | "download", message: string) => Promise<unknown>;
}): { body: ReactNode; foot: ReactNode; bar: string } {
  const id = useId();
  const [via, setVia] = useState<Via>(to?.email || !to?.phone ? "email" : "whatsapp");
  const [email, setEmail] = useState(to?.email ?? "");
  const [phone, setPhone] = useState(to?.phone ?? "");
  const [subj, setSubj] = useState(subject);
  const [text, setText] = useState(message);
  const [busy, setBusy] = useState(false);
  const who = to?.name ?? null;

  const viaSheet = async () => {
    const res = await fetch(what.href);
    if (!res.ok) throw new Error(`The file could not be made (${res.status}).`);
    const file = new File([await res.blob()], what.name, { type: res.headers.get("content-type") ?? "application/pdf" });
    await navigator.share({ files: [file], title: subj, text });
  };
  const send = async () => {
    if (via === "link") {
      try {
        await navigator.clipboard.writeText(new URL(link ?? what.href, window.location.href).toString());
        toast("Link copied: it opens for people signed in to the app.");
      } catch {
        toast({ message: "Could not copy the link.", kind: "fail" });
      }
      return;
    }
    setBusy(true);
    try {
      if (shareSheet()) {
        await viaSheet();
        await onNoted?.("share", text);
        toast("Shared.");
        return;
      }
      saveHref(what.href, what.name);
      if (via === "email")
        window.location.assign(`mailto:${email.trim()}?${new URLSearchParams({ subject: subj, body: text }).toString().replace(/\+/g, "%20")}`);
      else window.open(`https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
      await onNoted?.("download", text);
      toast(`${what.name} downloaded: attach it ${via === "email" ? "to the email" : "in WhatsApp (the 📎)"}.`);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError"))
        toast({ message: e instanceof Error ? e.message : "Could not send it.", kind: "fail" });
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <div className="flex flex-col gap-4">
      <SegmentedChoice<Via>
        label="How to send it"
        value={via}
        onChange={setVia}
        options={[
          { value: "email", label: "Email" },
          { value: "whatsapp", label: "WhatsApp" },
          { value: "link", label: "Copy link" },
        ]}
      />
      {what.draft && <Notice tone="todo">Not final yet: it goes out marked DRAFT. Make it final first to send the real one.</Notice>}
      {via === "email" && (
        <>
          <Field label="To" htmlFor={`${id}-to`} optional>
            <Input id={`${id}-to`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
          </Field>
          <Field label="Subject" htmlFor={`${id}-s`}>
            <Input id={`${id}-s`} value={subj} onChange={(e) => setSubj(e.target.value)} maxLength={200} />
          </Field>
        </>
      )}
      {via === "whatsapp" && (
        <Field label="To" htmlFor={`${id}-ph`} optional hint="With the country code; empty: pick the chat in WhatsApp.">
          <Input id={`${id}-ph`} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+92 300 1234567" />
        </Field>
      )}
      {via !== "link" && (
        <Field label="Message" htmlFor={`${id}-m`}>
          <Textarea id={`${id}-m`} rows={6} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} />
        </Field>
      )}
      <div>
        <p className="mb-1.5 text-sm font-medium">{via === "link" ? "The link opens" : "Attached"}</p>
        <div className="flex items-center gap-2.5 rounded-[10px] border border-primary-line bg-primary-soft px-3 py-2.5">
          <FileText className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 text-md">
            <b className="block truncate font-semibold">{what.name}</b>
            <span className="block truncate text-xs text-text-2">{what.detail}</span>
          </span>
        </div>
        <p className="mt-1.5 text-xs text-muted">
          {via === "link"
            ? "For the team: it opens for people signed in to the app."
            : `${what.paper ? "Sends it as you see it: change the copy or the language under the page. " : ""}On a computer the file downloads to attach; on a phone the share sheet takes it.`}
        </p>
      </div>
    </div>
  );
  const foot = (
    <Button variant="primary" disabled={busy} onClick={() => void send()}>
      {via === "email" ? <Mail aria-hidden /> : via === "whatsapp" ? <MessageCircle aria-hidden /> : <Link2 aria-hidden />}
      {busy ? "Preparing…" : via === "link" ? "Copy the link" : `${via === "email" ? "Email" : "WhatsApp"} ${who ?? "it"}`}
    </Button>
  );
  const bar = via === "link" ? "Copy the link for the team" : `${via === "email" ? "Email" : "WhatsApp"}${who ? ` ${who}` : ""} · ${what.name}`;
  return { body, foot, bar };
}
