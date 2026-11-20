import { ChevronRight, Pencil } from "lucide-react";
import { can } from "@kebo/shared";
import { Badge, EmptyLine, Dash } from "@kebo/ui";
import { requireUser } from "@/lib/session";
import { dateTime, money, qty } from "@/lib/format";
import { dealOf, sourcingOf } from "@/lib/deal-data";
import { EditedMark } from "@/components/edits/edits";
import { editsOf } from "@/lib/edit-data";
import { ItemsExcel } from "@/components/deals/needs-cards";
import { ITEM_COLUMNS } from "@/components/lines/item-columns";
import { HistoryButton, type HistoryEntry } from "@/components/edits/history-button";
import { OpenPanelButton } from "@/components/common/panel";
import { ItemsBox } from "@/components/records/items-box";
import { SheetPart } from "@/components/records/phone-items";
import type { LineColumn, LineRow } from "@/components/lines/line-table";
import { itemsLine } from "./steps";

const price = (v: string) => (v ? Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");

/**
 * "Items" on the Overview, under the client's request: the items in the one items box (canvas board "The
 * inquiry's Overview, from the pieces") — numbered, parts as 2.1 under their item, the model, the quantity and
 * the unit apart, the target price and how many supplier offers answer each — read only, with Edit opening the
 * inquiry's window on its Items step, the box's history on its clock and a line's own history beside it.
 */
export async function ItemsCard({ id }: { id: string }) {
  const me = await requireUser();
  const d = await dealOf(id);
  const sourcing = can(me, "sourcing.manage") ? await sourcingOf(id).catch(() => null) : null;
  // How many offers price each item.
  const offers = new Map<string, number>();
  for (const q of sourcing?.quotes ?? []) for (const item of new Set(q.lines.map((l) => l.requestedItemId).filter((x): x is string => !!x))) offers.set(item, (offers.get(item) ?? 0) + 1);
  const edits = await editsOf("inquiry", id);
  const needs = edits.cards.needs;
  const offersWord = (n: number) => (n === 1 ? "1 offer" : `${n} offers`);

  const rows: LineRow[] = d.items.map((i) => ({
    key: i.id,
    parentKey: i.parentId,
    values: { description: i.description, model: i.model ?? "", quantity: i.quantity, unit: i.unit, targetPrice: i.targetPrice ?? "" },
    badge: <EditedMark card={needs} k={i.id} />,
  }));
  // The one set of item columns; the model only when an item has one, the offers only for people who source.
  const columns: LineColumn[] = [
    ...ITEM_COLUMNS.filter((c) => c.key !== "model" || d.items.some((i) => i.model)).map((c) =>
      c.key === "quantity" ? { ...c, format: (v: LineRow["values"]) => qty(v.quantity!) } : c.key === "targetPrice" ? { ...c, phoneHidden: false, format: (v: LineRow["values"]) => price(v.targetPrice!) || <Dash /> } : c,
    ),
    ...(sourcing
      ? [
          {
            key: "offers",
            label: "Offers",
            width: "6rem",
            format: (_v: LineRow["values"], r: LineRow) => {
              const n = offers.get(r.key) ?? 0;
              return n ? <Badge tone="ok">{offersWord(n)}</Badge> : <Badge tone="neutral">No offer</Badge>;
            },
          } satisfies LineColumn,
        ]
      : []),
  ];
  // The box's own changes (who, when, old → new, why), then where it started; a line's own, beside it.
  const entries: HistoryEntry[] = [
    ...(needs?.edits ?? []).map((e) => ({ lines: e.changes, reason: e.reason, by: e.by, at: dateTime(e.at) })),
    { lines: ["Added with the inquiry"], reason: null, by: d.createdBy.name, at: dateTime(d.createdAt), start: true },
  ];
  const own = (key: string) => (needs?.edits ?? []).filter((e) => e.lines?.[key]?.length);
  const no = new Map(d.items.map((i) => [i.id, i.no]));

  return (
    <div id="items" className="scroll-mt-24">
      <ItemsBox
        title="Items"
        count={itemsLine(d)}
        what="the items"
        canEdit={d.allowed.edit}
        edit={
          <OpenPanelButton panel="edit-request" id="items" variant="ghost" size="xs" label={d.items.length ? "Edit items" : "Add items"} className="text-primary hover:text-primary">
            <Pencil aria-hidden /> {d.items.length ? "Edit" : "Add items"}
          </OpenPanelButton>
        }
        tools={d.items.length ? <ItemsExcel items={d.items} /> : undefined}
        history={<HistoryButton title="Items" entries={entries} allHref={`/inquiries/${id}/history`} />}
        label="Items they asked for"
        rows={rows}
        columns={columns}
        numbers={d.items.map((i) => i.no)}
        after={
          (needs?.edits ?? []).some((e) => e.lines && Object.keys(e.lines).length)
            ? {
                label: "History",
                cell: (r) => {
                  const mine = own(r.key);
                  return mine.length ? (
                    <HistoryButton
                      title={`Item ${no.get(r.key)}`}
                      allHref={`/inquiries/${id}/history`}
                      entries={mine.map((e) => ({ lines: e.lines![r.key]!, reason: e.reason, by: e.by, at: dateTime(e.at) }))}
                    />
                  ) : null;
                },
              }
            : undefined
        }
        // A phone: the item line, read only; a tap shows the offers that price it and its own changes.
        phone={d.items.map((i) => {
          const n = offers.get(i.id) ?? 0;
          const target = i.targetPrice ? price(i.targetPrice) : null;
          const theirs = (sourcing?.quotes ?? []).flatMap((q) =>
            q.lines.filter((l) => l.requestedItemId === i.id && !l.alternativeOfId).map((l) => ({ q, price: Number(l.unitPrice) })),
          );
          const sameMoney = theirs.length > 1 && theirs.every((t) => t.q.currency === theirs[0]!.q.currency);
          const low = sameMoney ? Math.min(...theirs.filter((t) => t.price > 0).map((t) => t.price)) : null;
          const mine = own(i.id);
          return {
            key: i.id,
            no: i.no,
            part: !!i.parentId,
            title: i.description.split("\n")[0],
            under: i.model || undefined,
            badge: <EditedMark card={needs} k={i.id} />,
            sub: [`${qty(i.quantity)} ${i.unit}`, sourcing && n ? offersWord(n) : null].filter(Boolean).join(" · "),
            amount: sourcing && n === 0 ? <span className="rounded-md bg-warn-soft px-1.5 py-0.5 text-xs font-semibold text-warn">No offer</span> : undefined,
            more: target ? `target ${target}` : undefined,
            sheet: {
              sub: [i.model, `${qty(i.quantity)} ${i.unit}`, target ? `target ${target}` : null].filter(Boolean).join(" · "),
              body: (
                <>
                  {sourcing && (
                    <SheetPart title="Offers for it">
                      {theirs.length ? (
                        <ul className="flex flex-col divide-y divide-line/60">
                          {theirs.map((t, k) => (
                            <li key={`${t.q.id}-${k}`}>
                              <a href={`/inquiries/${id}/offers/${t.q.id}`} className="flex items-center gap-2 py-2 text-sm">
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate font-semibold">{t.q.factory.name}</span>
                                  <span className="flex items-center gap-1.5 text-xs text-text-2">
                                    {low !== null && t.price === low && <span className="rounded bg-ok-soft px-1 text-2xs font-bold text-ok">Lowest</span>}
                                    {t.q.leadTime ?? "lead time not said"}
                                  </span>
                                </span>
                                <span className="shrink-0 font-bold tabular">{t.price > 0 ? money(String(t.price), t.q.currency) : "no price"}</span>
                                <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
                              </a>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <EmptyLine>No supplier offer has it yet.</EmptyLine>
                      )}
                    </SheetPart>
                  )}
                  {mine.length > 0 && (
                    <SheetPart title="Its changes">
                      {mine.map((e, k) => (
                        <p key={k} className="py-1 text-md">
                          {e.lines![i.id]!.join(" · ")}
                          <span className="block text-xs text-text-2">{[e.reason, e.by, dateTime(e.at)].filter(Boolean).join(" · ")}</span>
                        </p>
                      ))}
                    </SheetPart>
                  )}
                  {d.allowed.edit && (
                    <div className="px-4 pt-1 pb-2">
                      <OpenPanelButton panel="edit-request" id="items" className="w-full">
                        <Pencil aria-hidden /> Edit items
                      </OpenPanelButton>
                    </div>
                  )}
                </>
              ),
            },
          };
        })}
        empty={
          <>
            <strong className="text-text">No item list yet.</strong> That is fine: the items come from the supplier offers, or add them here.
          </>
        }
      />
    </div>
  );
}
