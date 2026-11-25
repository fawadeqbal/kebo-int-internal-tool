"use client";

import { useState } from "react";
import type { TranslationView } from "@kebo/shared";
import { Badge, Button, cn, Textarea } from "@kebo/ui";
import { ActionForm } from "@/components/common/action-form";
import { SubmitButton } from "@kebo/ui/client";
import { translationAction } from "./actions";

/**
 * The translator's texts (Settings › Chinese on papers): the English, its Chinese and who wrote it. The
 * translator's: Right (a person checked it), Change (type the right one: it wins from now on, and the order items
 * that print it get it), or Again. Papers print the Chinese as soon as it is written; checking makes it sure.
 */
export function TranslationList({ rows }: { rows: TranslationView[] }) {
  return (
    <ul data-part="table" className="flex flex-col">
      {rows.map((r) => (
        <Row key={r.id} r={r} />
      ))}
    </ul>
  );
}

function Row({ r }: { r: TranslationView }) {
  const [editing, setEditing] = useState(false);
  const state =
    r.status === "waiting" ? (
      <Badge tone="neutral">Being written</Badge>
    ) : r.status === "failed" ? (
      <Badge tone="bad" title={r.error ?? undefined}>
        Not written{r.tries ? ` · tried ${r.tries}×` : ""}
      </Badge>
    ) : r.by === "machine" ? (
      <Badge tone="warn">To check</Badge>
    ) : (
      <Badge tone="ok">{r.checkedBy ? `Checked · ${r.checkedBy}` : "Checked"}</Badge>
    );
  return (
    <li className="grid gap-x-6 gap-y-2 border-t border-line py-3 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <p className="text-md whitespace-pre-line text-text-2">{r.source}</p>
      <div className="flex min-w-0 flex-col gap-2">
        {editing ? (
          <ActionForm action={translationAction.bind(null, r.id, "fix")} onDone={(s) => s.ok && setEditing(false)} className="flex flex-col gap-2">
            <label htmlFor={`zh-${r.id}`} className="sr-only">
              The Chinese for: {r.source}
            </label>
            <Textarea id={`zh-${r.id}`} name="zh" lang="zh-Hans" defaultValue={r.zh ?? ""} rows={Math.min(8, Math.max(2, r.source.split("\n").length + 1))} autoFocus />
            <div className="flex gap-2">
              <SubmitButton size="xs" pendingText="Saving…">
                Save
              </SubmitButton>
              <Button size="xs" variant="ghost" type="button" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </ActionForm>
        ) : (
          <p lang="zh-Hans" className={cn("text-md whitespace-pre-line", !r.zh && "text-muted")}>
            {r.zh ?? "—"}
          </p>
        )}
        {!editing && (
          <div className="flex flex-wrap items-center gap-2">
            {state}
            {r.zh && r.by === "machine" && (
              <ActionForm action={translationAction.bind(null, r.id, "check")} showSuccess={false}>
                <SubmitButton size="xs" variant="secondary" pendingText="…">
                  Right
                </SubmitButton>
              </ActionForm>
            )}
            <Button size="xs" variant="ghost" onClick={() => setEditing(true)}>
              {r.zh ? "Change" : "Type it"}
            </Button>
            {r.by !== "staff" && r.status !== "waiting" && (
              <ActionForm action={translationAction.bind(null, r.id, "again")} showSuccess={false}>
                <SubmitButton size="xs" variant="ghost" pendingText="…">
                  Again
                </SubmitButton>
              </ActionForm>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
