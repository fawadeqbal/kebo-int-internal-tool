import type { ReactNode } from "react";
import type { Tone } from "@kebo/shared";
import { Badge, cn, subTitleClass } from "@kebo/ui";
import { RecordBox } from "@/components/common/record-box";

/** One part of a box: its name, a word for where it stands, what it holds so far, and its one button. */
export interface BoxPart {
  key: string;
  title: string;
  word?: { text: string; tone?: Tone } | null;
  /** What it holds (label · value); empty values are left out. */
  facts: [string, ReactNode][];
  /** Said while it holds nothing yet ("Not booked yet."). */
  empty?: string;
  /** Its button (Edit, or Add while empty). */
  action?: ReactNode;
  /** Its files, under it (only when it has some). */
  files?: ReactNode;
}

const said = (v: ReactNode) => v !== null && v !== undefined && v !== "" && v !== false;

/**
 * One box made of parts, a line each (canvas board "Shipping": a shipment's Booking, Container and loading, Vessel
 * and B/L, Freight and insurance, Arrival and customs): each part's name and word, what it holds in a line of
 * label · value, and its own button — so a record with steps inside one thing is one box, not five. On a phone the
 * parts stack, the button under the facts. Any record with such a thing uses it (a shipment, a site test).
 */
export function PartsBox({
  title,
  titleMore,
  word,
  actions,
  parts,
  id,
  className,
}: {
  title: string;
  titleMore?: string;
  word?: { text: string; tone?: Tone } | null;
  /** The box's own buttons (Remove a shipment, + Add…). */
  actions?: ReactNode;
  parts: BoxPart[];
  id?: string;
  className?: string;
}) {
  return (
    <RecordBox id={id} title={title} titleMore={titleMore} word={word} what={title.toLowerCase()} canEdit={!!actions} edit={actions} className={className}>
      <ul aria-label={`${title}: its parts`} className="divide-y divide-line">
        {parts.map((p) => {
          const facts = p.facts.filter(([, v]) => said(v));
          return (
            <li key={p.key} aria-label={p.title} className="flex flex-col gap-2 px-5 py-3 max-sm:px-4">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1.5 @2xl:grid-cols-[12rem_minmax(0,1fr)_auto]">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <h3 className={subTitleClass}>{p.title}</h3>
                  {p.word && <Badge tone={p.word.tone ?? "neutral"}>{p.word.text}</Badge>}
                </div>
                <div className={cn("col-span-2 row-start-2 min-w-0 @2xl:col-span-1 @2xl:col-start-2 @2xl:row-start-1")}>
                  {facts.length ? (
                    <dl className="flex flex-wrap gap-x-5 gap-y-1 text-md">
                      {facts.map(([k, v], i) => (
                        <div key={`${i}:${k}`} className="flex min-w-0 items-baseline gap-1.5">
                          <dt className="text-text-2">{k}</dt>
                          <dd className="min-w-0 font-medium break-words">{v}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="text-md text-text-2">{p.empty ?? "Nothing yet."}</p>
                  )}
                </div>
                {p.action && <div className="col-start-2 row-start-1 flex flex-wrap items-center justify-end gap-1.5 @2xl:col-start-3">{p.action}</div>}
              </div>
              {p.files && <div className="-mx-5 -mb-3 empty:hidden max-sm:-mx-4">{p.files}</div>}
            </li>
          );
        })}
      </ul>
    </RecordBox>
  );
}
