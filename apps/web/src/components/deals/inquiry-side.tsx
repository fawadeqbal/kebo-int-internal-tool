import type { ReactNode } from "react";
import { FileText } from "lucide-react";
import { Card, CardHeader, cn } from "@kebo/ui";
import type { HistoryEntry } from "@/lib/types";

/** Which inquiry step a change belongs to (null: the inquiry as a whole, e.g. its stage or who handles it). */
export type ChangeStep = "needs" | "sourcing" | "quotation";

export const CHANGE_STEP_LABEL: Record<ChangeStep, string> = { needs: "Needs", sourcing: "Factory offers", quotation: "Quotation" };

/** A change's step: its record type, and for files whose they are (the customer's, or a factory offer's). */
export function changeStep(e: HistoryEntry, offerFiles: string[] = []): ChangeStep | null {
  if (e.entityType === "factory_quote") return "sourcing";
  if (e.entityType === "quotation") return "quotation";
  if (e.entityType === "attachment")
    return /factory offer/i.test(e.summary ?? "") || offerFiles.some((f) => (e.summary ?? "").includes(f)) ? "sourcing" : "needs";
  if (e.entityType === "inquiry") return e.action === "create" || e.action === "update" || e.action === "split" ? "needs" : null;
  return null;
}

/** The few latest changes of one step (newest first). */
export function changesIn(entries: HistoryEntry[], step: ChangeStep, offerFiles: string[] = [], limit = 4) {
  return entries.filter((e) => changeStep(e, offerFiles) === step).slice(0, limit);
}

export interface Chip {
  id: string;
  name: string;
  /** "URS", "drawing": shown after the name. */
  tag?: string | null;
  href?: string;
}

/** Files as round chips (each opens the file), and where to add more. */
export function FileChips({
  files,
  add,
  empty = "No files yet.",
  className,
}: {
  files: Chip[];
  add?: ReactNode;
  empty?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {files.map((f) => (
        <a
          key={f.id}
          href={f.href ?? `/files/${f.id}?view=1`}
          target="_blank"
          rel="noreferrer"
          title={f.name}
          className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 py-1 text-xs font-medium hover:border-line-strong"
        >
          <FileText className="size-3.5 shrink-0 text-muted" aria-hidden />
          <span className="max-w-56 truncate">{f.name}</span>
          {f.tag && <span className="shrink-0 font-normal text-muted">· {f.tag}</span>}
        </a>
      ))}
      {!files.length && !add && <p className="w-full text-xs text-muted">{empty}</p>}
      {add}
    </div>
  );
}

/** The side card "Files": the step's files and, for people who may, "+ Add files". */
export function FilesCard({ files, add, empty }: { files: Chip[]; add?: ReactNode; empty?: string }) {
  return (
    <Card>
      <CardHeader title="Files" />
      <div className="px-4 py-3.5">
        <FileChips files={files} add={add} empty={empty ?? "No files on this step yet."} className="flex-col items-start" />
      </div>
    </Card>
  );
}

/** The dashed "+ Add files" chip (a button or a link). */
export const addChipClass =
  "inline-flex items-center gap-1 rounded-full border border-dashed border-primary/40 px-3 py-1 text-xs font-medium text-primary hover:bg-primary-soft";
