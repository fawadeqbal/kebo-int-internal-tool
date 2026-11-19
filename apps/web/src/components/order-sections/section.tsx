import type { ReactNode } from "react";
import type { Tone } from "@kebo/shared";
import { cn } from "@kebo/ui";
import { BoxFacts, RecordBox } from "@/components/common/record-box";

/**
 * One box of an order's tab, drawn as every record's box (canvas row "The order on the same pieces", board "Every
 * tab"): the record box's head — its name, one word for where it stands, its buttons (Edit, + Add…; never the
 * orange one: that is the header's next step) — its values as label · value rows (a dash when empty), anything
 * bigger (a table), and its files at its foot. Its button opens a window with only this box's fields.
 */
export function Section({
  title,
  titleMore,
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
  /** Said after the title where there is room (not on a phone): "· Jinan Pharma Machinery". */
  titleMore?: string;
  /** Where it stands, in a word: "Booked 28 Nov". */
  state?: string | null;
  tone?: Tone;
  /** Its buttons (Edit, + Add…). */
  actions?: ReactNode;
  rows?: { label: string; value: ReactNode }[];
  /** Many values (3 or more across before): in two columns of rows once the box is wide enough. */
  cols?: 2 | 3 | 4;
  /** Takes the whole row of the page's grid. */
  wide?: boolean;
  children?: ReactNode;
  /** Its files row (SectionFiles). */
  files?: ReactNode;
  id?: string;
}) {
  return (
    <RecordBox
      id={id}
      title={title}
      titleMore={titleMore}
      word={state ? { text: state, tone } : null}
      what={title.toLowerCase()}
      canEdit={!!actions}
      edit={actions ? <span className="flex flex-wrap items-center gap-1.5">{actions}</span> : undefined}
      className={cn("min-w-0", wide && "lg:col-span-full")}
      files={files}
    >
      {rows && rows.length > 0 && <BoxFacts wide={cols > 2 && rows.length > 3} rows={rows.map((r) => [r.label, r.value])} />}
      {children}
    </RecordBox>
  );
}

/** A box with nothing in it yet: its name, a line that says so, and the button that fills it. */
export function EmptySection({ title, text, action, wide, id }: { title: string; text: string; action?: ReactNode; wide?: boolean; id?: string }) {
  return (
    <RecordBox id={id} title={title} what={title.toLowerCase()} canEdit={!!action} edit={action} className={cn("min-w-0", wide && "lg:col-span-full")}>
      <p className="px-5 py-4 text-md text-text-2 max-sm:px-4">{text}</p>
    </RecordBox>
  );
}
