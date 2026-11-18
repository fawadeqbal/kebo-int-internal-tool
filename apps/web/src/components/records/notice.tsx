import type { ReactNode } from "react";
import { AlertTriangle, Check, Info, X } from "lucide-react";
import { cn } from "@kebo/ui";

/** What a notice says: something to do, a problem, a note, or something done. */
export type NoticeTone = "todo" | "bad" | "info" | "ok";

const TONES: Record<NoticeTone, { box: string; dot: string; Icon: typeof Info }> = {
  todo: { box: "border-action/25 bg-action-soft/60 [&_a]:text-action", dot: "bg-action-solid", Icon: AlertTriangle },
  bad: { box: "border-bad/25 bg-bad-soft [&_a]:text-bad", dot: "bg-bad-solid", Icon: X },
  info: { box: "border-info/20 bg-info-soft [&_a]:text-info", dot: "bg-info", Icon: Info },
  ok: { box: "border-ok/20 bg-ok-soft", dot: "bg-ok", Icon: Check },
};

/**
 * The one notice of a record (canvas board "What changes, piece by piece"): only when something needs a look —
 * its title, one or two lines and the way to fix it (a link in the text, or a button on the right). The same on
 * every record: On hold · Take off hold; Lost · Reopen; Before you send; a customer's country not set · Add it.
 */
export function Notice({
  tone,
  title,
  children,
  action,
  className,
}: {
  tone: NoticeTone;
  title: ReactNode;
  children?: ReactNode;
  /** A button on the right (on a phone, under the words). */
  action?: ReactNode;
  className?: string;
}) {
  const t = TONES[tone];
  return (
    <div
      role={tone === "bad" ? "alert" : "status"}
      className={cn(
        "flex flex-wrap items-start gap-x-2.5 gap-y-2 rounded-xl border px-3.5 py-3 text-[13.5px] leading-[19px] text-text [&_a]:font-bold [&_a]:underline [&_a]:underline-offset-2",
        t.box,
        className,
      )}
    >
      <span aria-hidden className={cn("mt-px grid size-5 shrink-0 place-items-center rounded-full text-white", t.dot)}>
        <t.Icon className="size-3" strokeWidth={3} />
      </span>
      <div className="min-w-0 flex-[1_1_14rem]">
        <p className="font-bold">{title}</p>
        {children && <div className="text-text-2">{children}</div>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2 max-sm:w-full max-sm:pl-7">{action}</div>}
    </div>
  );
}
