import type { LineChange } from "@/lib/revisions";
import { formatMoney } from "@/lib/utils/money";

const qty = (n: number) => n.toLocaleString("en", { maximumFractionDigits: 2 });

/** "Price 68,000 → 65,500", "Added: Spare tooling" — what the customer will notice in the new version. */
export function RevisionChanges({ changes, currency }: { changes: LineChange[]; currency: string }) {
  if (changes.length === 0) return <p className="text-sm text-muted">Same lines and prices; only the dates or terms may differ.</p>;
  return (
    <ul className="flex flex-col gap-2.5 text-sm">
      {changes.map((c, i) => (
        <li key={i} className="flex flex-col">
          <span className="font-medium text-text">
            {c.kind === "added" ? "Added: " : c.kind === "removed" ? "Removed: " : ""}
            {c.name}
          </span>
          <span className="text-xs text-muted tabular">
            {c.kind === "added" && `${qty(c.quantity)} ${c.unit} × ${formatMoney(c.unitPrice, currency)}`}
            {c.kind === "changed" &&
              [
                c.unitPrice && `Price ${formatMoney(c.unitPrice[0], currency)} → ${formatMoney(c.unitPrice[1], currency)}`,
                c.quantity && `Qty ${qty(c.quantity[0])} → ${qty(c.quantity[1])}`,
                c.unit && `Unit ${c.unit[0]} → ${c.unit[1]}`,
                c.details && "Description updated",
              ]
                .filter(Boolean)
                .join(" · ")}
          </span>
        </li>
      ))}
    </ul>
  );
}
