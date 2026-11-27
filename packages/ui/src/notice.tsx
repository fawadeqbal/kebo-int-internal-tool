import type { ReactNode } from "react";
import { AlertTriangle, Check, Info, X } from "lucide-react";
import { cn } from "./cn";

/** What a notice says: something to look at or do, a problem, a note, something done, or a quiet aside. */
export type NoticeTone = "todo" | "bad" | "info" | "ok" | "neutral";

const TONES: Record<NoticeTone, { box: string; dot: string; Icon: typeof Info }> = {
  todo: { box: "border-action/25 bg-action-soft/60 [&_a:not([data-variant])]:text-action", dot: "bg-action-solid", Icon: AlertTriangle },
  bad: { box: "border-bad/25 bg-bad-soft [&_a:not([data-variant])]:text-bad", dot: "bg-bad-solid", Icon: X },
  info: { box: "border-info/20 bg-info-soft [&_a:not([data-variant])]:text-info", dot: "bg-info-solid", Icon: Info },
  ok: { box: "border-ok/20 bg-ok-soft", dot: "bg-ok", Icon: Check },
  neutral: { box: "border-line bg-surface-2", dot: "bg-text-2", Icon: Info },
};

/**
 * The one notice (canvas group 7, "Boxes and notices"): a box only when something needs a look — an optional bold
 * title, one or two lines, and the way to fix it (a link in the words, or a button on the right; on a phone, under
 * the words). Every page says its problems, notes and warnings with this, in the box they concern.
 */
export function Notice({
  tone = "info",
  title,
  children,
  action,
  className,
  role,
}: {
  /** How a screen reader hears it: "alert" (at once) is the default for "bad"; "status" waits its turn. */
  role?: "alert" | "status";
  tone?: NoticeTone;
  title?: ReactNode;
  children?: ReactNode;
  /** A button on the right (on a phone, under the words). */
  action?: ReactNode;
  className?: string;
}) {
  const t = TONES[tone];
  return (
    <div
      role={role ?? (tone === "bad" ? "alert" : "status")}
      className={cn(
        "flex flex-wrap items-start gap-x-2.5 gap-y-2 rounded-xl border px-3.5 py-3 text-md text-text [&_a:not([data-variant])]:font-bold [&_a:not([data-variant])]:underline [&_a:not([data-variant])]:underline-offset-2 [&_strong]:font-bold",
        t.box,
        className,
      )}
    >
      <span aria-hidden className={cn("mt-px grid size-5 shrink-0 place-items-center rounded-full text-white", t.dot)}>
        <t.Icon className="size-3" strokeWidth={3} />
      </span>
      <div className="min-w-0 flex-[1_1_14rem]">
        {title && <p className="font-bold">{title}</p>}
        {children && <div className={title ? "text-text-2" : undefined}>{children}</div>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2 max-sm:w-full max-sm:pl-7">{action}</div>}
    </div>
  );
}
