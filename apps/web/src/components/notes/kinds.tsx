import { CalendarClock, Mail, MapPin, MessageCircle, Phone, StickyNote, Users, type LucideIcon } from "lucide-react";
import { FOLLOW_UP_KIND_LABEL, NOTE_KIND_LABEL, type FollowUpKind, type NoteKind } from "@kebo/shared";
import { todayIn } from "@kebo/utils";
import { cn } from "@kebo/ui";
import { TZ } from "@/lib/format";

export const NOTE_ICON: Record<NoteKind, LucideIcon> = { note: StickyNote, call: Phone, visit: MapPin, whatsapp: MessageCircle, email: Mail };
export const FOLLOW_UP_ICON: Record<FollowUpKind, LucideIcon> = { call: Phone, visit: MapPin, meeting: Users, other: CalendarClock };

/** A kind's icon in a round tile, its name for screen readers (the row reads "Call. Ali says…"). */
export function KindIcon({ kind, of, className }: { kind: string; of: "note" | "followUp"; className?: string }) {
  const Icon = of === "note" ? (NOTE_ICON[kind as NoteKind] ?? StickyNote) : (FOLLOW_UP_ICON[kind as FollowUpKind] ?? CalendarClock);
  const label = of === "note" ? NOTE_KIND_LABEL[kind as NoteKind] : FOLLOW_UP_KIND_LABEL[kind as FollowUpKind];
  return (
    <span className={cn("mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text-2", className)}>
      <Icon aria-hidden className="size-3.5" />
      <span className="sr-only">{label ?? kind}.</span>
    </span>
  );
}

const time = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "numeric", minute: "2-digit", hourCycle: "h23" }).format(d);
const day = (d: Date, year: boolean) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}) }).format(d);

/** When a note's call or visit happened: "9:02" today, "28 Oct 9:02" this year, "28 Oct 2025" before. */
export function whenText(iso: string) {
  const d = new Date(iso);
  const today = todayIn(TZ);
  const on = todayIn(TZ, d);
  if (on === today) return time(d);
  if (on.slice(0, 4) === today.slice(0, 4)) return `${day(d, false)} ${time(d)}`;
  return day(d, true);
}

/** When a follow-up is due: "today 11:00", "tomorrow", "Thu 5 Nov 14:00". */
export function dueText(dueOn: string, dueAt: string | null, today = todayIn(TZ)) {
  const tomorrow = new Date(`${today}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const d =
    dueOn === today
      ? "today"
      : dueOn === tomorrow.toISOString().slice(0, 10)
        ? "tomorrow"
        : new Date(`${dueOn}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  return dueAt ? `${d} ${dueAt}` : d;
}

/** Today in the company's time zone (the date field's default). */
export const todayHere = () => todayIn(TZ);
