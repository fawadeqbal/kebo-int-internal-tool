import { can } from "@kebo/shared";
import { Badge, Card, CardBody, CardHeader, Td, Th, THead, Tr } from "@kebo/ui";
import { requireUser } from "@/lib/session";
import { qty } from "@/lib/format";
import { dealOf, sourcingOf } from "@/lib/deal-data";
import { LinesCard } from "@/components/orders/step-view";
import { EditedMark } from "@/components/edits/edits";
import { editsOf } from "@/lib/edit-data";
import { ItemsEditor, ItemsExcel, ItemsView } from "@/components/deals/needs-cards";
import { dealFieldsAction } from "../../actions";
import { itemsLine } from "../steps";

export const metadata = { title: "Inquiry · needs" };

/**
 * Needs (board "Inquiry — Needs"): the items — numbered, parts under their item, model, quantity, unit,
 * target price and how many factory offers answer each — with Add item (the lines editor); then what the
 * customer wrote.
 */
export default async function DealNeeds({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const d = await dealOf(id);
  const sourcing = can(me, "sourcing.manage") ? await sourcingOf(id).catch(() => null) : null;
  const quoted = d.quotation?.revisions.some((r) => r.status !== "draft") ?? false;
  // How many offers price each item.
  const offers = new Map<string, number>();
  for (const q of sourcing?.quotes ?? []) for (const id of new Set(q.lines.map((l) => l.requestedItemId).filter((x): x is string => !!x))) offers.set(id, (offers.get(id) ?? 0) + 1);
  const parentNo = new Map(d.items.map((i) => [i.id, i.no]));
  const edits = await editsOf("inquiry", id);
  const needs = edits.cards.needs;
  const fromOffer = (sourcing?.quotes.length ?? 0) > 0 && d.items.length > 0;

  const table = (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-[13px]">
        <THead>
          <tr>
            <Th className="w-14">#</Th>
            <Th>Item</Th>
            <Th>Model</Th>
            <Th className="text-right">Qty</Th>
            <Th>Unit</Th>
            <Th className="text-right">Target price</Th>
            {sourcing && <Th>Offers</Th>}
          </tr>
        </THead>
        <tbody>
          {d.items.map((i) => {
            const n = offers.get(i.id) ?? 0;
            return (
              <Tr key={i.id}>
                <Td className="tabular">{i.no}</Td>
                <Td>
                  <span className="block font-semibold whitespace-pre-line">
                    {i.description}
                    <EditedMark card={needs} k={i.id} />
                  </span>
                  {i.parentId && <span className="block text-xs text-text-2">part of {parentNo.get(i.parentId)}</span>}
                </Td>
                <Td>{i.model ?? ""}</Td>
                <Td className="text-right tabular">{qty(i.quantity)}</Td>
                <Td>{i.unit}</Td>
                <Td className="text-right tabular">{i.targetPrice ? Number(i.targetPrice).toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—"}</Td>
                {sourcing && <Td>{n ? <Badge tone="ok">{n === 1 ? "1 offer" : n + " offers"}</Badge> : <Badge tone="neutral">No offer</Badge>}</Td>}
              </Tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <LinesCard
        title="Items"
        description={d.items.length ? (fromOffer ? "made from the first offer" : itemsLine(d)) : "none yet"}
        canEdit={d.allowed.edit}
        editLabel={d.items.length ? "Edit items" : "Add item"}
        actions={d.items.length ? <ItemsExcel items={d.items} /> : undefined}
        edits={needs}
        panelTitle={d.items.length ? "Edit items" : "Add items"}
        panelDescription="What the customer needs: type, paste their list or upload Excel. Nothing is saved until Save changes."
        view={
          d.items.length ? (
            table
          ) : (
            <p className="px-5 py-6 text-sm text-text-2">
              <strong className="text-text">No item list yet.</strong> That is fine: the items come from the factory offers, or add them here.
            </p>
          )
        }
        phone={<ItemsView items={d.items} requirements={null} phone />}
        edit={
          <ItemsEditor
            items={d.items}
            requirements={d.requirements}
            action={dealFieldsAction.bind(null, d.id)}
            upload={!quoted}
            edit={{ type: "inquiry", id: d.id, card: "needs" }}
            card={needs}
          />
        }
      />
      <Card>
        <CardHeader title="Written by the customer" />
        <CardBody>
          <span className="block text-xs text-muted">What they need</span>
          <p className="mt-0.5 text-sm whitespace-pre-line">{d.requirements || "—"}</p>
        </CardBody>
      </Card>
    </div>
  );
}
