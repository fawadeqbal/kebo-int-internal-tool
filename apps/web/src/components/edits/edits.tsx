"use client";

import { ChoiceChips } from "@/components/common/choice-chips";
import { useState, type ReactNode } from "react";
import { REASON_CHOICES } from "@kebo/shared";
import { Button, Field, Textarea, Badge, Notice } from "@kebo/ui";
import { Modal } from "@/components/common/dialog";
import type { EditCard } from "@/lib/types-edits";
import { formatDayMonth, formatTime, todayIn, type TimeStyle } from "@kebo/utils";
import { useTime } from "@/lib/time-client";

/** "today 10:40", "10 Nov 16:02": company time, the company's way. */
export function whenText(iso: string, style: TimeStyle) {
  return todayIn(style.zone, new Date(iso)) === todayIn(style.zone) ? `today ${formatTime(iso, style)}` : `${formatDayMonth(iso, style)} ${formatTime(iso, style)}`;
}

/**
 * "Edited 2× · last by Sana, today 10:40" in a card's header: the saved lines (or values) were changed twice
 * after the first save. A click shows each edit: who, when, why and what. Nothing when never edited.
 */
export function EditsChip({ card, title = "This card" }: { card: EditCard | null | undefined; title?: string }) {
  const { style } = useTime();
  const [open, setOpen] = useState(false);
  if (!card || card.count === 0) return null;
  const last = card.edits[0];
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-6 items-center rounded-full bg-warn-soft px-2.5 text-xs font-semibold whitespace-nowrap text-warn hover:ring-2 hover:ring-warn/30"
        title="What changed, who and why"
      >
        Edited {card.count}×{last?.by && <span className="max-sm:hidden"> · last by {last.by.split(" ")[0]}, {whenText(last.at, style)}</span>}
      </button>
      {open && (
        <Modal title={`${title} · edited ${card.count}× since first saved`} onClose={() => setOpen(false)}>
          <ol className="flex flex-col divide-y divide-line">
            {card.edits.map((e) => (
              <li key={`${e.n}-${e.at}`} className="flex flex-col gap-1 py-3">
                <span className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge size="sm" tone="warn">Edit {e.n}</Badge>
                  <b>{e.by ?? "Someone"}</b>
                  <span className="text-xs text-muted">{whenText(e.at, style)}</span>
                </span>
                {e.reason && (
                  <span className="text-sm">
                    <b>Why:</b> {e.reason}
                  </span>
                )}
                {e.changes.length > 0 && (
                  <ul className="text-md leading-relaxed text-text-2">
                    {e.changes.slice(0, 12).map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                    {e.changes.length > 12 && <li>and {e.changes.length - 12} more</li>}
                  </ul>
                )}
              </li>
            ))}
            {card.first && (
              <li className="flex flex-wrap items-center gap-2 py-3 text-sm">
                <Badge size="sm" tone="ok">First saved</Badge>
                <b>{card.first.by ?? "Someone"}</b>
                <span className="text-xs text-muted">{whenText(card.first.at, style)}</span>
              </li>
            )}
          </ol>
        </Modal>
      )}
    </>
  );
}

/** "edited" / "edited 2×" after a line's description: how often it changed since the first save. */
export function editedMark(card: EditCard | null | undefined, key: string): ReactNode {
  const n = card?.keys[key] ?? 0;
  if (!n) return null;
  return (
    <span className="ml-1.5 align-middle text-2xs font-semibold text-warn" title={`Changed in ${n} edit${n === 1 ? "" : "s"} since it was first saved`}>
      edited{n > 1 ? ` ${n}×` : ""}
    </span>
  );
}

/**
 * "Why are you changing these lines?": what changed, then the reason (quick choices or own words).
 * `n` is the edit this save will be ("Edit 3").
 */
export function ReasonDialog({
  title = "Why are you changing these items?",
  n,
  note,
  changes,
  choices = REASON_CHOICES.edit,
  busy,
  onCancel,
  onSave,
  sub = "Your reason is kept with this edit, in the record's history.",
  saveLabel = "Save changes",
  cancelLabel = "Back to editing",
}: {
  sub?: string;
  saveLabel?: string;
  cancelLabel?: string;
  title?: string;
  n?: number;
  /** The server's own words when it asked (e.g. a quotation is priced from these lines). */
  note?: string;
  changes: string[];
  choices?: readonly string[];
  busy?: boolean;
  onCancel: () => void;
  onSave: (reason: string) => void;
}) {
  const [pick, setPick] = useState<string | null>(null);
  const [text, setText] = useState("");
  const reason = (text.trim() || pick || "").trim();
  return (
    <Modal
      title={
        <span className="flex flex-wrap items-center gap-2">
          {title}
          {n ? <Badge size="sm" tone="warn">Edit {n}</Badge> : null}
        </span>
      }
      sub={sub}
      onClose={onCancel}
      busy={busy}
      cancel={false}
      footer={
        <>
          <Button type="button" variant="secondary" data-window-cancel="" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button type="button" disabled={!reason || busy} onClick={() => onSave(reason)}>
            {busy ? "Saving…" : saveLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {note && <Notice tone="todo">{note}</Notice>}
        {changes.length > 0 && (
          <ul className="flex max-h-56 flex-col divide-y divide-line overflow-y-auto rounded-lg border border-line text-md">
            {changes.map((c, i) => (
              <li key={i} className="px-3 py-2">
                {c}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold">
            Reason <span className="text-bad">*</span>
          </span>
          <ChoiceChips label="Reason" value={pick ?? ""} options={choices} onChange={setPick} />
          <Field label="Or write it" htmlFor="edit-reason">
            <Textarea id="edit-reason" rows={2} className="min-h-0" maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

/** editedMark as a component (for server pages): "edited" / "edited 2×" after a line or value. */
export function EditedMark({ card, k }: { card: EditCard | null | undefined; k: string }) {
  return <>{editedMark(card, k)}</>;
}
