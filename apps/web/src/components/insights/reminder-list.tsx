"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlarmClock,
  AlertTriangle,
  Banknote,
  Check,
  ChevronDown,
  CircleAlert,
  Factory,
  FileText,
  Inbox,
  Package,
  Undo2,
} from "lucide-react";
import { Button, cn } from "@kebo/ui";
import { reminderAction } from "@/app/(app)/money/actions";
import type { Reminders } from "@/lib/types-insights";

const KIND_ICON = { order: Package, quote: FileText, deal: Inbox, offer: Factory, money: Banknote } as const;
const LEVEL = {
  bad: { ring: "bg-bad-soft text-bad", label: "Urgent" },
  warn: { ring: "bg-warn-soft text-warn", label: "Soon" },
  info: { ring: "bg-info-soft text-info", label: "When you can" },
} as const;

type Item = Reminders["items"][number];

/**
 * "Needs attention": the most urgent first, each with its action. "Later" puts
 * one off for a day, three days or a week; "Done" hides it until it changes.
 */
export function ReminderList({ data, limit = 8 }: { data: Reminders; limit?: number }) {
  const router = useRouter();
  const [gone, setGone] = useState<Map<string, string>>(new Map());
  const [menu, setMenu] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [, start] = useTransition();
  const items = data.items.filter((i) => !gone.has(i.key));
  const shown = all ? items : items.slice(0, limit);

  const act = (it: Item, what: "snooze" | "done", days?: number) => {
    setMenu(null);
    setGone((m) =>
      new Map(m).set(it.key, what === "done" ? "Marked done" : `Put off ${days === 1 ? "until tomorrow" : `for ${days} days`}`),
    );
    start(async () => {
      await reminderAction(what, it.key, days);
      router.refresh();
    });
  };
  const undo = (key: string) => {
    setGone((m) => {
      const n = new Map(m);
      n.delete(key);
      return n;
    });
    start(async () => {
      await reminderAction("restore", key);
      router.refresh();
    });
  };

  if (data.items.length === 0)
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-ok-soft text-ok">
          <Check className="size-6" aria-hidden />
        </span>
        <p className="font-medium">All clear</p>
        <p className="text-sm text-muted">
          Nothing needs you right now{data.counts.hidden ? ` (${data.counts.hidden} put off or done)` : ""}.
        </p>
      </div>
    );

  return (
    <div className="flex flex-col">
      <ul className="flex flex-col divide-y divide-line" aria-label="Needs attention">
        {shown.map((it) => {
          const Icon = KIND_ICON[it.kind];
          return (
            <li key={it.key} className="group flex items-start gap-3 px-4 py-3">
              <span
                className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full", LEVEL[it.level].ring)}
                title={LEVEL[it.level].label}
              >
                {it.level === "bad" ? (
                  <CircleAlert className="size-4" aria-hidden />
                ) : it.level === "warn" ? (
                  <AlertTriangle className="size-4" aria-hidden />
                ) : (
                  <Icon className="size-4" aria-hidden />
                )}
                <span className="sr-only">{LEVEL[it.level].label}</span>
              </span>
              <div className="min-w-0 flex-1">
                <Link href={it.href} className="block text-sm font-medium hover:text-primary">
                  {it.title}
                </Link>
                {(it.detail || it.who) && (
                  <p className="mt-0.5 text-xs text-muted">
                    {it.detail}
                    {it.who && <span className="ml-1 rounded bg-surface-2 px-1.5 py-0.5 text-text-2">{it.who}</span>}
                  </p>
                )}
              </div>
              <div className="relative flex shrink-0 items-center gap-1">
                <Link
                  href={it.href}
                  className="hidden rounded-md border border-line px-2 py-1 text-xs font-medium hover:border-line-strong hover:bg-surface-2 sm:inline-block"
                >
                  {it.action}
                </Link>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => setMenu(menu === it.key ? null : it.key)}
                  aria-expanded={menu === it.key}
                  aria-label={`Put off: ${it.title}`}
                >
                  <AlarmClock aria-hidden />
                  <ChevronDown className="size-3" aria-hidden />
                </Button>
                <Button size="xs" variant="ghost" onClick={() => act(it, "done")} aria-label={`Done: ${it.title}`} title="Done">
                  <Check aria-hidden />
                </Button>
                {menu === it.key && (
                  <div
                    role="menu"
                    className="absolute top-full right-0 z-30 mt-1 flex w-44 flex-col rounded-lg border border-line bg-surface p-1 shadow-pop"
                  >
                    {[
                      [1, "Tomorrow"],
                      [3, "In 3 days"],
                      [7, "Next week"],
                    ].map(([d, label]) => (
                      <button
                        key={d}
                        type="button"
                        role="menuitem"
                        onClick={() => act(it, "snooze", d as number)}
                        className="rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-surface-2"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {[...gone.entries()].slice(-1).map(([key, what]) => (
        <p
          key={key}
          role="status"
          className="flex items-center justify-between gap-2 border-t border-line bg-surface-2/60 px-4 py-2 text-xs text-text-2"
        >
          {what}.
          <button
            type="button"
            onClick={() => undo(key)}
            className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
          >
            <Undo2 className="size-3.5" aria-hidden /> Undo
          </button>
        </p>
      ))}
      {items.length > limit && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="border-t border-line px-4 py-2.5 text-left text-sm font-medium text-primary hover:bg-surface-2/60"
        >
          {all ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}
    </div>
  );
}
