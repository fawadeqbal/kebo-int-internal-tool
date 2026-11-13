import type { ReactNode } from "react";
import { Badge, cn } from "@kebo/ui";
import type { Tone } from "@kebo/shared";

/**
 * One small section of an order's page (the order without checklists): its
 * name, one word for where it stands, its values read-only (a dash when
 * empty), anything bigger (a table), its own files, and its button — which
 * opens a window with only this section's fields. Nothing is ticked.
 */
export function Section({
  title,
  state,
  tone = "neutral",
  actions,
  rows,
  cols = 2,
  wide,
  children,
  files,
  id,
}: {
  title: string;
  /** Where it stands, in a word: "Booked 28 Nov". */
  state?: string | null;
  tone?: Tone;
  /** Its buttons (Edit, and at most one main one). */
  actions?: ReactNode;
  rows?: { label: string; value: ReactNode }[];
  cols?: 2 | 3 | 4;
  /** Takes the whole row of the page's grid. */
  wide?: boolean;
  children?: ReactNode;
  /** Its files row (SectionFiles). */
  files?: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} aria-label={title} className={cn("flex min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-card", wide && "lg:col-span-full")}>
      <div className="flex min-h-[54px] flex-wrap items-center gap-x-2.5 gap-y-1.5 px-[18px] pt-3 pb-2.5">
        <h2 className="min-w-0 flex-1 text-[15px] font-bold">{title}</h2>
        {state && <Badge tone={tone}>{state}</Badge>}
        {actions}
      </div>
      {rows && rows.length > 0 && (
        <dl className={cn("grid grid-cols-2 gap-x-[18px] gap-y-3 px-[18px] pt-1 pb-3.5", cols === 3 && "sm:grid-cols-3", cols === 4 && "sm:grid-cols-4")}>
          {rows.map((r) => (
            <div key={r.label} className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-xs text-text-2">{r.label}</dt>
              <dd className="text-[13px] font-semibold [overflow-wrap:anywhere]">{r.value === null || r.value === undefined || r.value === "" ? <span className="font-normal text-muted">—</span> : r.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {children}
      {files && (
        <>
          <span className="flex-1" />
          {files}
        </>
      )}
    </section>
  );
}

/** A section with nothing in it yet: a dashed box that says so, with the button that fills it. */
export function EmptySection({ title, text, action, wide, id }: { title: string; text: string; action?: ReactNode; wide?: boolean; id?: string }) {
  return (
    <section
      id={id}
      aria-label={title}
      className={cn("flex min-h-16 min-w-0 flex-wrap items-center gap-x-3.5 gap-y-2 rounded-xl border border-dashed border-line-strong bg-surface-2/40 px-[18px] py-3.5", wide && "lg:col-span-full")}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h2 className="text-[15px] font-bold">{title}</h2>
        <span className="text-[12.5px] text-text-2">{text}</span>
      </div>
      {action}
    </section>
  );
}

/** A stage's sections in a grid: one or two columns beside the order's side panel. */
export function SectionGrid({ cols = 2, children }: { cols?: 1 | 2; children: ReactNode }) {
  return <div className={cn("grid min-w-0 items-stretch gap-4", cols === 2 && "lg:grid-cols-2")}>{children}</div>;
}
