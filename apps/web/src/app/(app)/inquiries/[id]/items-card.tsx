import { Pencil } from "lucide-react";
import { can } from "@kebo/shared";
import { Badge } from "@kebo/ui";
import { requireUser } from "@/lib/session";
import { dateTime, qty } from "@/lib/format";
import { dealOf, sourcingOf } from "@/lib/deal-data";
import { EditedMark } from "@/components/edits/edits";
import { editsOf } from "@/lib/edit-data";
import { ItemsExcel } from "@/components/deals/needs-cards";
import { ITEM_COLUMNS } from "@/components/lines/item-columns";
import { HistoryButton, type HistoryEntry } from "@/components/edits/history-button";
import { OpenPanelButton } from "@/components/common/panel";
import { ItemsBox } from "@/components/records/items-box";
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
      c.key === "quantity" ? { ...c, format: (v: LineRow["values"]) => qty(v.quantity!) } : c.key === "targetPrice" ? { ...c, phoneHidden: false, format: (v: LineRow["values"]) => price(v.targetPrice!) || <span className="text-muted">—</span> } : c,
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
        phone={d.items.map((i) => {
          const n = offers.get(i.id) ?? 0;
          return {
            key: i.id,
            no: i.no,
            part: !!i.parentId,
            title: i.description.split("\n")[0],
            badge: <EditedMark card={needs} k={i.id} />,
            sub: [`${qty(i.quantity)} ${i.unit}`, i.model, sourcing ? (n ? offersWord(n) : "no offer") : null].filter(Boolean).join(" · "),
            amount: i.targetPrice ? price(i.targetPrice) : undefined,
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
