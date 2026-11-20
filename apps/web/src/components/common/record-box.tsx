import type { ComponentProps, ReactNode } from "react";
import { Pencil } from "lucide-react";
import type { Tone } from "@kebo/shared";
import { Badge, boxHeadClass, boxTitleClass, Card, cn, Dash, RULES } from "@kebo/ui";
import { OpenPanelButton } from "@/components/common/panel";

/**
 * One box of the Overview (design rules 18 Nov): named like the step that fills it, its count, and its own Edit
 * (that part only). The same boxes as the new inquiry's Review step.
 */
export function RecordBox({
  title,
  titleMore,
  word,
  id,
  count,
  step,
  what,
  canEdit,
  className,
  history,
  edit,
  tools,
  files,
  children,
}: {
  title: string;
  /** Said after the title where there is room (not on a phone): "· Jinan Pharma Machinery". */
  titleMore?: string;
  /** Where it stands, in a word, beside the title: "Booked 28 Nov". */
  word?: { text: string; tone?: Tone } | null;
  /** Its anchor (a link to #part scrolls to it). */
  id?: string;
  count?: string;
  /** The inquiry's window part its Edit opens (the URL panel "edit-request"). */
  step?: string;
  what: string;
  canEdit: boolean;
  className?: string;
  /** Its own Edit button, in place of the inquiry window's (an offer's box opens the offer's window). */
  edit?: ReactNode;
  /** More beside the clock (Excel). */
  tools?: ReactNode;
  /** The clock (optional, design rules 18 Nov): the box's own changes. */
  history?: ReactNode;
  /** Its files, at its foot (only when it has some: they are added in its window). */
  files?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className={cn("@container overflow-visible", className)}>
      <section id={id} aria-label={title}>
        <div className={boxHeadClass}>
          <h2 className={boxTitleClass}>
            {title}
            {titleMore && <span className="max-sm:hidden"> · {titleMore}</span>}
          </h2>
          {word && <Badge tone={word.tone ?? "neutral"}>{word.text}</Badge>}
          {/* On a phone the count goes under the title, so the buttons keep their room. */}
          {count && <span className="text-xs text-text-2 max-sm:order-last max-sm:w-full max-sm:pb-1">{count}</span>}
          {/* The buttons are one group at the right: when they do not fit beside the title they go under it
              together, still at the right (never one left on the title's line and the rest in the body). */}
          <span className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
            {tools}
            {history}
            {canEdit && (edit ?? (step && (
              <OpenPanelButton panel="edit-request" id={step} variant="ghost" size="xs" label={`Edit ${what}`} className="text-primary hover:text-primary">
                <Pencil aria-hidden /> Edit
              </OpenPanelButton>
            )))}
          </span>
        </div>
        {children}
        {files}
      </section>
    </Card>
  );
}

/** Label · value rows of a box, the label quiet. `wide`: in two columns of rows once the box is wide enough. */
export function BoxFacts({ rows, wide }: { rows: [string, ReactNode][]; wide?: boolean }) {
  return (
    <dl
      className={cn(
        RULES.box.body,
        "grid grid-cols-[minmax(6.5rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm",
        wide && "@3xl:grid-cols-[minmax(6.5rem,auto)_minmax(0,1fr)_minmax(6.5rem,auto)_minmax(0,1fr)] @3xl:gap-x-6",
      )}
    >
      {rows.map(([k, v], i) => (
        <div key={`${i}:${k}`} className="contents">
          <dt className="text-text-2">{k}</dt>
          <dd className="min-w-0 font-medium break-words">{v === null || v === undefined || v === "" ? <Dash /> : v}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A note across a box (the parts do not add up, what the customer has paid): a tinted strip from edge to edge
 * at the box's own inset, never a smaller box inside the box.
 */
export function BoxNote({ tone = "neutral", className, ...props }: ComponentProps<"p"> & { tone?: "neutral" | "warn" }) {
  return <p className={cn("px-4 py-2 text-sm sm:px-5", tone === "warn" ? "bg-warn-soft" : "bg-surface-2", className)} {...props} />;
}
