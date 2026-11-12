"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { REASON_CHOICES } from "@kebo/shared";
import { useClosePanel } from "@/components/common/panel";
import { recordEditAction } from "@/lib/edit-actions";
import type { EditCard, EditRef } from "@/lib/types-edits";
import { ReasonDialog } from "./edits";

/** `confirm`: the order's checks saw something out of order (the message says what): ask, then save anyway with why. */
export type SaveResult = { ok: true } | { ok: false; message: string; reasonChoices?: string[]; confirm?: boolean };

type Asking = { changes: string[]; note?: string; choices?: readonly string[]; anyway?: boolean; go: (reason: string) => Promise<void> };

/**
 * The one way an edit panel saves (lines or values): the first save is plain;
 * changing what was already saved asks why first ("Edit 3", what changed, the
 * reason), and the server can still ask (a priced line). Once saved, the edit is
 * kept with its reason for the card's "Edited n×", the page is refreshed and the
 * panel closes.
 */
export function useEditSave({ edit, card, what = "lines" }: { edit?: EditRef; card?: EditCard | null; what?: "lines" | "values" | "steps" }) {
  const router = useRouter();
  const close = useClosePanel();
  const [asking, setAsking] = useState<Asking | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async ({
    changes,
    keys = [],
    askWhy,
    run,
  }: {
    changes: string[];
    keys?: string[];
    askWhy: boolean;
    /** Sends the changes (with the reason, when there is one); may be called again with one after it asked, or to go ahead (`confirm`). */
    run: (reason?: string, confirm?: boolean) => Promise<SaveResult>;
  }) => {
    // `why`: the reason for changing what was saved (counts as an edit); `anyway`: the reason for going ahead past a check.
    const go = async (why?: string, anyway?: string) => {
      const reason = anyway ?? why;
      setBusy(true);
      setError(null);
      const r = await run(reason, anyway !== undefined);
      if (!r.ok) {
        setBusy(false);
        if (r.confirm && anyway === undefined) {
          setAsking({ changes: [], note: r.message, choices: REASON_CHOICES.anyway, anyway: true, go: (x) => go(why, x) });
          return;
        }
        if (r.reasonChoices && !reason) {
          setAsking({ changes, note: r.message, choices: r.reasonChoices.length ? r.reasonChoices : undefined, go });
          return;
        }
        setAsking(null);
        setError(r.message);
        return;
      }
      if (edit && (why || !card?.first)) {
        await recordEditAction({ ...edit, kind: why ? "edit" : "first", reason: why, changes: changes.slice(0, 60), keys: keys.slice(0, 500) }).catch(
          () => undefined,
        );
      }
      setBusy(false);
      setAsking(null);
      router.refresh();
      close({ ok: true });
    };
    if (askWhy) setAsking({ changes, go });
    else await go();
  };

  const dialog: ReactNode = asking ? (
    <ReasonDialog
      // A new question starts empty (the reason picked for the edit is not the reason for going ahead).
      key={asking.anyway ? "anyway" : "why"}
      title={asking.anyway ? "Check before saving" : `Why are you changing ${what === "lines" ? "these lines" : what === "steps" ? "the steps" : "what was saved"}?`}
      sub={asking.anyway ? "Go back and fix it, or save it anyway and say why. The reason is kept in the history." : undefined}
      saveLabel={asking.anyway ? "Save anyway" : undefined}
      cancelLabel={asking.anyway ? "Go back and fix" : undefined}
      n={asking.anyway ? undefined : (card?.count ?? 0) + 1}
      note={asking.note?.replace(/\d{4}-\d{2}-\d{2}/g, (d) =>
        new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }),
      )}
      changes={asking.changes}
      choices={asking.choices ?? (what === "lines" ? REASON_CHOICES.edit : REASON_CHOICES.editValues)}
      busy={busy}
      onCancel={() => setAsking(null)}
      onSave={(reason) => void asking.go(reason)}
    />
  ) : null;

  return { save, dialog, busy, error, setError };
}
